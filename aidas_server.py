#!/usr/bin/env python3
"""
A.I.D.A.S. (Autonomous Industrial Defect & Alignment Scanner) Telemetry Server
==============================================================================
Production-ready asynchronous vision & quality inspection server for NAT-003.
Powered by Python 3.13, asyncio, websockets, OpenCV, and YOLOv8n.

Features:
- Asynchronous WebSocket server on ws://localhost:8765
- Live OpenCV camera stream (cv2.VideoCapture(0)) with fallback synthetic frame generator
- Ultra-fast real-time inference with YOLOv8n (<35ms target latency)
- OpenCV HUD rendering: bounding boxes, labels, targeting reticles, status banners
- Real-time base64 JPEG video frame encoding (`image_frame` key)
- Manufacturing Bill of Materials (BOM) compliance verification
- Defect taxonomy classification: PASS, DEFECT_MISSING, DEFECT_WRONG_PART
- Live JSON telemetry broadcasting to A.I.D.A.S. Industrial Dashboard
- Graceful shutdown handling on KeyboardInterrupt
"""

import asyncio
import base64
import json
import logging
import signal
import sys
import time
from typing import Dict, List, Optional, Set

import cv2
import numpy as np
import websockets
from ultralytics import YOLO

# ---------------------------------------------------------------------------
# Configuration & Constants
# ---------------------------------------------------------------------------
WS_HOST = "localhost"
WS_PORT = 8765
MODEL_PATH = "yolov8n.pt"
CAMERA_INDEX = 0

# Bill of Materials (BOM) Reference Map: Slot ID -> Expected Component Label
BOM: Dict[str, str] = {
    "SLOT-9114": "cell phone",
    "SLOT-9211": "bottle",
    "SLOT-9824": "book"
}

SLOT_KEYS: List[str] = list(BOM.keys())
CONFIDENCE_THRESHOLD = 0.60    # Compliance pass criterion (>0.60)
TARGET_LATENCY_MS = 35.0      # Target inference latency SLA (<35ms)
SLOT_CYCLE_INTERVAL = 4.0     # Automatic conveyor slot advance interval (seconds)
BROADCAST_INTERVAL = 0.15     # Video telemetry broadcast interval (~6.6 Hz)
JPEG_QUALITY = 75             # Real-time streaming JPEG compression quality

# Global State
connected_clients: Set[websockets.ServerConnection] = set()
running = True
active_slot_index = 0
last_slot_cycle_time = time.time()
manual_slot_override: Optional[str] = None
interlock_tripped = False


# ---------------------------------------------------------------------------
# Vision & Inspection Pipeline
# ---------------------------------------------------------------------------
class InspectionEngine:
    def __init__(self, model_path: str = MODEL_PATH, cam_idx: int = CAMERA_INDEX):
        print(f"[*] Initializing Ultralytics YOLO model '{model_path}'...")
        self.model = YOLO(model_path)
        
        # Warmup model with a dummy tensor
        dummy = np.zeros((320, 320, 3), dtype=np.uint8)
        self.model(dummy, verbose=False, imgsz=320)
        print("[+] YOLOv8 model warmed up and ready.")

        print(f"[*] Connecting to optical camera feed (cv2.VideoCapture({cam_idx}))...")
        self.cap = cv2.VideoCapture(cam_idx)
        
        # Set camera acquisition resolution & buffer for optimal low latency
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        self.camera_available = self.cap.isOpened()
        if self.camera_available:
            # Verify frame readability
            ret, _ = self.cap.read()
            if ret:
                print(f"[+] Optical camera (index {cam_idx}) initialized successfully.")
            else:
                print(f"[!] Warning: Camera device opened but frame read failed. Falling back to synthetic feed.")
                self.camera_available = False
        else:
            print(f"[!] Camera index {cam_idx} unavailable. Using synthetic optical inspection feed.")

        self.synthetic_frame_counter = 0

    def capture_frame(self) -> np.ndarray:
        """Captures a frame from hardware camera or generates a synthetic inspection frame."""
        if self.camera_available:
            ret, frame = self.cap.read()
            if ret and frame is not None and frame.size > 0:
                return frame

        # Synthetic fallback frame simulating conveyor inspection station
        self.synthetic_frame_counter += 1
        frame = np.full((480, 640, 3), 18, dtype=np.uint8)
        # Conveyor guidelines
        cv2.line(frame, (0, 120), (640, 120), (50, 70, 90), 1, cv2.LINE_AA)
        cv2.line(frame, (0, 360), (640, 360), (50, 70, 90), 1, cv2.LINE_AA)
        cv2.putText(
            frame,
            "A.I.D.A.S. SYNTHETIC OPTICAL FEED // CAM-01",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (6, 182, 212),
            1,
            cv2.LINE_AA
        )
        return frame

    def inspect_frame(self, frame: np.ndarray, active_slot: str) -> dict:
        """
        Runs YOLO object detection, renders HUD annotations and bounding boxes
        directly on the OpenCV frame, evaluates manufacturing quality, and
        encodes the final frame into base64 JPEG format.
        """
        expected_part = BOM[active_slot]
        
        # Run inference with perf timer
        t_start = time.perf_counter()
        results = self.model(frame, verbose=False, imgsz=320, conf=0.25)
        inference_time_ms = (time.perf_counter() - t_start) * 1000.0

        # Extract pure model inference latency reported by Ultralytics if available
        if results and hasattr(results[0], "speed") and "inference" in results[0].speed:
            reported_speed = results[0].speed["inference"]
            latency_ms = round(reported_speed if reported_speed > 0 else inference_time_ms, 2)
        else:
            latency_ms = round(inference_time_ms, 2)

        # Parse detections
        detections: List[dict] = []
        detected_items: List[str] = []

        if results and len(results) > 0 and results[0].boxes is not None:
            boxes = results[0].boxes
            for i in range(len(boxes)):
                cls_id = int(boxes.cls[i].item())
                label = self.model.names.get(cls_id, f"item_{cls_id}").lower()
                conf = float(boxes.conf[i].item())
                detected_items.append(label)
                
                # Bounding box coordinates normalized to percentages
                xyxy = boxes.xyxy[i].tolist()
                detections.append({
                    "label": label,
                    "confidence": conf,
                    "xyxy": xyxy,
                    "bbox": {
                        "x": round((xyxy[0] / frame.shape[1]) * 100, 1),
                        "y": round((xyxy[1] / frame.shape[0]) * 100, 1),
                        "w": round(((xyxy[2] - xyxy[0]) / frame.shape[1]) * 100, 1),
                        "h": round(((xyxy[3] - xyxy[1]) / frame.shape[0]) * 100, 1),
                    }
                })

        # ===================================================================
        # Quality Evaluation Logic:
        # - "PASS": Component matches bill of materials with confidence > 0.60
        # - "DEFECT_MISSING": Expected component missing on conveyor slot
        # - "DEFECT_WRONG_PART": Mismatched component detected
        # ===================================================================
        matching_detections = [d for d in detections if d["label"] == expected_part]
        mismatched_detections = [d for d in detections if d["label"] != expected_part]

        # Check for PASS: expected component found with confidence > 0.60
        passing_matches = [d for d in matching_detections if d["confidence"] > CONFIDENCE_THRESHOLD]

        if passing_matches:
            best_match = max(passing_matches, key=lambda d: d["confidence"])
            status = "PASS"
            confidence_pct = round(best_match["confidence"] * 100, 2)
            part_name = expected_part
            message = (
                f"PASS: Component '{expected_part}' verified on {active_slot} "
                f"(confidence: {confidence_pct:.1f}% > {int(CONFIDENCE_THRESHOLD * 100)}%)."
            )
            conveyor_active = True
            primary_bbox = best_match["bbox"]

        elif mismatched_detections:
            # Foreign or mismatched part detected on this slot
            top_mismatch = max(mismatched_detections, key=lambda d: d["confidence"])
            status = "DEFECT_WRONG_PART"
            confidence_pct = round(top_mismatch["confidence"] * 100, 2)
            part_name = top_mismatch["label"]
            message = (
                f"DEFECT_WRONG_PART: Incompatible part '{part_name}' detected on {active_slot}. "
                f"Expected '{expected_part}'."
            )
            conveyor_active = False
            primary_bbox = top_mismatch["bbox"]

        elif matching_detections:
            # Expected part detected, but failed confidence threshold <= 0.60
            top_match = max(matching_detections, key=lambda d: d["confidence"])
            status = "DEFECT_MISSING"
            confidence_pct = round(top_match["confidence"] * 100, 2)
            part_name = expected_part
            message = (
                f"DEFECT_MISSING: Marginal signal for '{expected_part}' on {active_slot} "
                f"({confidence_pct:.1f}% <= {int(CONFIDENCE_THRESHOLD * 100)}% threshold)."
            )
            conveyor_active = False
            primary_bbox = top_match["bbox"]

        else:
            # Nothing detected on slot
            status = "DEFECT_MISSING"
            confidence_pct = 0.0
            part_name = "None"
            message = f"DEFECT_MISSING: Expected component '{expected_part}' missing on conveyor slot {active_slot}."
            conveyor_active = False
            primary_bbox = {"x": 35.0, "y": 30.0, "w": 30.0, "h": 40.0}

        # ===================================================================
        # OpenCV Direct HUD Drawing & Video Frame Rendering
        # ===================================================================
        annotated_frame = frame.copy()
        h, w = annotated_frame.shape[:2]

        # Colors in BGR
        CYAN = (212, 182, 6)
        WHITE = (248, 250, 252)
        GREEN = (80, 200, 30)
        RED = (50, 50, 240)
        ORANGE = (20, 160, 245)

        if status == "PASS":
            status_color = GREEN
            status_label = "PASS // COMPLIANT"
        elif status == "DEFECT_WRONG_PART":
            status_color = RED
            status_label = "DEFECT // WRONG PART"
        else:
            status_color = ORANGE
            status_label = "DEFECT // MISSING COMPONENT"

        # Draw inspection conveyor motion guidelines
        cv2.line(annotated_frame, (0, int(h * 0.25)), (w, int(h * 0.25)), (70, 70, 50), 1, cv2.LINE_AA)
        cv2.line(annotated_frame, (0, int(h * 0.75)), (w, int(h * 0.75)), (70, 70, 50), 1, cv2.LINE_AA)

        # Center Optical Targeting Crosshair
        cx, cy = w // 2, h // 2
        cv2.circle(annotated_frame, (cx, cy), 24, CYAN, 1, cv2.LINE_AA)
        cv2.circle(annotated_frame, (cx, cy), 5, CYAN, -1, cv2.LINE_AA)
        cv2.line(annotated_frame, (cx - 35, cy), (cx + 35, cy), CYAN, 1, cv2.LINE_AA)
        cv2.line(annotated_frame, (cx, cy - 35), (cx, cy + 35), CYAN, 1, cv2.LINE_AA)

        # Draw Bounding Boxes and Labels for each detection
        for det in detections:
            x1, y1, x2, y2 = map(int, det["xyxy"])
            det_label = det["label"]
            det_conf = det["confidence"]

            is_expected = (det_label == expected_part)
            if is_expected and det_conf > CONFIDENCE_THRESHOLD:
                box_color = GREEN
            elif not is_expected:
                box_color = RED
            else:
                box_color = ORANGE

            # Bounding box rectangle
            cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), box_color, 2)

            # High-tech corner bracket accents
            c_len = min(16, (x2 - x1) // 4, (y2 - y1) // 4)
            if c_len > 3:
                cv2.line(annotated_frame, (x1, y1), (x1 + c_len, y1), WHITE, 2)
                cv2.line(annotated_frame, (x1, y1), (x1, y1 + c_len), WHITE, 2)
                cv2.line(annotated_frame, (x2, y1), (x2 - c_len, y1), WHITE, 2)
                cv2.line(annotated_frame, (x2, y1), (x2, y1 + c_len), WHITE, 2)
                cv2.line(annotated_frame, (x1, y2), (x1 + c_len, y2), WHITE, 2)
                cv2.line(annotated_frame, (x1, y2), (x1, y2 - c_len), WHITE, 2)
                cv2.line(annotated_frame, (x2, y2), (x2 - c_len, y2), WHITE, 2)
                cv2.line(annotated_frame, (x2, y2), (x2, y2 - c_len), WHITE, 2)

            # High-contrast label tag
            tag_text = f"{det_label.upper()} {det_conf * 100:.1f}%"
            (tw, th), _ = cv2.getTextSize(tag_text, cv2.FONT_HERSHEY_SIMPLEX, 0.44, 1)
            cv2.rectangle(annotated_frame, (x1, max(0, y1 - 22)), (x1 + tw + 8, y1), box_color, -1)
            cv2.putText(
                annotated_frame,
                tag_text,
                (x1 + 4, max(14, y1 - 5)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.44,
                (0, 0, 0),
                1,
                cv2.LINE_AA
            )

        # Highlight missing component target area if empty slot
        if status == "DEFECT_MISSING" and not detections:
            bx1, by1, bx2, by2 = int(w * 0.28), int(h * 0.26), int(w * 0.72), int(h * 0.74)
            cv2.rectangle(annotated_frame, (bx1, by1), (bx2, by2), RED, 2)
            cv2.putText(
                annotated_frame,
                f"MISSING TARGET: {expected_part.upper()}",
                (bx1 + 14, by1 + 35),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.58,
                RED,
                2,
                cv2.LINE_AA
            )

        # Top Tactical HUD Bar
        cv2.rectangle(annotated_frame, (10, 8), (w - 10, 42), (18, 14, 10), -1)
        cv2.rectangle(annotated_frame, (10, 8), (w - 10, 42), (60, 60, 60), 1)
        cv2.putText(
            annotated_frame,
            f"A.I.D.A.S. HUD // {active_slot} // BOM EXP: {expected_part.upper()}",
            (20, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            WHITE,
            1,
            cv2.LINE_AA
        )
        cv2.putText(
            annotated_frame,
            status_label,
            (w - 235, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.46,
            status_color,
            2,
            cv2.LINE_AA
        )

        # Bottom Diagnostics HUD Bar
        cv2.rectangle(annotated_frame, (10, h - 38), (w - 10, h - 10), (18, 14, 10), -1)
        cv2.rectangle(annotated_frame, (10, h - 38), (w - 10, h - 10), (60, 60, 60), 1)
        cv2.putText(
            annotated_frame,
            f"INFERENCE: {latency_ms}ms | CONF: {confidence_pct:.1f}% | CONVEYOR: {'ACTIVE' if conveyor_active else 'HALTED'}",
            (20, h - 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.44,
            CYAN,
            1,
            cv2.LINE_AA
        )

        # ===================================================================
        # Base64 JPEG Frame Encoding
        # ===================================================================
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
        success, buffer = cv2.imencode('.jpg', annotated_frame, encode_params)
        image_frame_base64 = base64.b64encode(buffer).decode('utf-8') if success else ""

        return {
            "timestamp": round(time.time(), 3),
            "slot_id": active_slot,
            "part_name": part_name,
            "status": status,
            "confidence": confidence_pct,
            "message": message,
            "conveyor_active": conveyor_active,
            "latency_ms": latency_ms,
            "detected_items": detected_items,
            "image_frame": image_frame_base64,
            # Aliases for direct React dashboard compatibility
            "slotId": active_slot,
            "component": part_name,
            "componentId": active_slot,
            "latency": latency_ms,
            "defectReason": message,
            "bbox": primary_bbox,
        }

    def release(self):
        """Releases camera hardware and OpenCV resources."""
        if self.camera_available and self.cap is not None:
            self.cap.release()
            print("[+] Optical camera hardware released.")
        cv2.destroyAllWindows()


# ---------------------------------------------------------------------------
# WebSocket Server & Client Connection Handler
# ---------------------------------------------------------------------------
async def ws_handler(websocket: websockets.ServerConnection):
    """
    Handles incoming WebSocket connections from the A.I.D.A.S. React dashboard.
    Prints required connection message and registers client for broadcasts.
    """
    global manual_slot_override, interlock_tripped

    # Exact required connection announcement
    print("[+] A.I.D.A.S. Dashboard Connected!", flush=True)

    connected_clients.add(websocket)
    try:
        # Listen for client control commands (e.g. slot selection, interlock reset)
        async for raw_msg in websocket:
            try:
                msg = json.loads(raw_msg)
                if msg.get("command") == "select_slot" and msg.get("slot_id") in BOM:
                    manual_slot_override = msg.get("slot_id")
                    print(f"[*] Dashboard manually selected slot: {manual_slot_override}")
                elif msg.get("command") == "reset_interlock":
                    interlock_tripped = False
                    print("[+] Dashboard reset line interlock.")
            except (json.JSONDecodeError, AttributeError):
                pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        print("[-] A.I.D.A.S. Dashboard Disconnected.", flush=True)


async def broadcast_telemetry(payload: dict):
    """Broadcasts JSON telemetry string to all connected WebSocket clients."""
    if not connected_clients:
        return

    payload_json = json.dumps(payload)
    # Broadcast asynchronously to all active dashboard sockets
    websockets.broadcast(connected_clients, payload_json)


# ---------------------------------------------------------------------------
# Main Inspection & Telemetry Loop
# ---------------------------------------------------------------------------
async def inspection_loop(engine: InspectionEngine):
    """
    Asynchronous background task that continuously runs camera acquisition,
    YOLOv8 quality evaluation, and broadcasts telemetry with image_frame to port 8765.
    """
    global active_slot_index, last_slot_cycle_time, running, manual_slot_override

    print("[+] Vision telemetry inspection loop activated.")
    last_logged_time = 0.0

    while running:
        # Determine active conveyor slot
        if manual_slot_override:
            active_slot = manual_slot_override
        else:
            # Advance slot cyclically along conveyor line
            now = time.time()
            if now - last_slot_cycle_time >= SLOT_CYCLE_INTERVAL:
                active_slot_index = (active_slot_index + 1) % len(SLOT_KEYS)
                last_slot_cycle_time = now
            active_slot = SLOT_KEYS[active_slot_index]

        # Run frame capture & YOLO inference in thread pool to prevent blocking event loop
        frame = await asyncio.to_thread(engine.capture_frame)
        telemetry = await asyncio.to_thread(engine.inspect_frame, frame, active_slot)

        # Broadcast telemetry packet with base64 image_frame to WebSocket clients
        await broadcast_telemetry(telemetry)

        # Periodic console diagnostic output
        now = time.time()
        if now - last_logged_time >= 2.0:
            last_logged_time = now
            status_indicator = "✓ PASS" if telemetry["status"] == "PASS" else f"✗ {telemetry['status']}"
            latency_flag = "OK" if telemetry["latency_ms"] < TARGET_LATENCY_MS else "HIGH"
            frame_kb = round(len(telemetry.get("image_frame", "")) / 1024, 1)
            print(
                f"[TELEMETRY] Slot: {telemetry['slot_id']} ({BOM[telemetry['slot_id']]}) | "
                f"Result: {status_indicator} | "
                f"Detected: {telemetry['part_name']} ({telemetry['confidence']}%) | "
                f"Latency: {telemetry['latency_ms']}ms [{latency_flag}] | "
                f"Frame: {frame_kb}KB | "
                f"Clients: {len(connected_clients)}",
                flush=True
            )

        # Yield control and sleep for target broadcast interval (~6.6 Hz)
        await asyncio.sleep(BROADCAST_INTERVAL)


# ---------------------------------------------------------------------------
# Server Entrypoint & Lifecycle Management
# ---------------------------------------------------------------------------
async def main():
    global running

    print("=" * 72)
    print(" A.I.D.A.S. INDUSTRIAL COMMAND CENTER // INFERENCE TELEMETRY SERVER")
    print(" Architecture: Python 3.13 | websockets | OpenCV | YOLOv8n")
    print(f" Bill of Materials: {json.dumps(BOM)}")
    print(f" Target Latency: <{TARGET_LATENCY_MS} ms")
    print(" Real-Time Video Streaming: Base64 JPEG (image_frame)")
    print("=" * 72)

    # Initialize inspection engine
    engine = InspectionEngine(model_path=MODEL_PATH, cam_idx=CAMERA_INDEX)

    # Start WebSocket server on ws://localhost:8765 with max_size supporting image frames
    print(f"[*] Binding WebSocket server on ws://{WS_HOST}:{WS_PORT}...")
    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT, max_size=10_000_000)
    print(f"[+] WebSocket server active on ws://{WS_HOST}:{WS_PORT}")
    print("[*] Waiting for A.I.D.A.S. Dashboard connection...")

    # Launch inspection worker task
    inspection_task = asyncio.create_task(inspection_loop(engine))

    try:
        # Keep running until cancelled or stopped
        await inspection_task
    except asyncio.CancelledError:
        pass
    finally:
        print("\n[*] Shutting down server subsystems...")
        running = False
        inspection_task.cancel()
        server.close()
        await server.wait_closed()
        engine.release()
        print("[+] Graceful shutdown complete. A.I.D.A.S. server stopped.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[!] KeyboardInterrupt received. Server terminated cleanly.")
        sys.exit(0)
