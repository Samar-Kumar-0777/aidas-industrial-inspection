import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  Camera,
  ShieldAlert,
  CheckCircle2,
  Download,
  Cpu,
  Zap,
  Radio,
  RefreshCw,
  AlertTriangle,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Crosshair,
  Maximize2,
  Sliders,
  Eye,
  Layers,
  ArrowRight,
  RotateCcw,
  Sparkles,
  Server
} from 'lucide-react';

// Predefined component catalog for simulation
const COMPONENT_CATALOG = [
  { id: 'CMP-AERO-01', name: 'Titanium Blade Stator V4', category: 'Aerospace', tolerance: '±0.02 mm' },
  { id: 'CMP-AUTO-88', name: 'Silicon Carbide Inverter Core', category: 'Automotive EV', tolerance: '±0.05 mm' },
  { id: 'CMP-ROBO-12', name: 'Precision Harmonic Drive Gear', category: 'Robotics', tolerance: '±0.01 mm' },
  { id: 'CMP-MEDI-07', name: 'Micro-Fluidic Valve Manifold', category: 'Medical Tech', tolerance: '±0.03 mm' }
];

const DEFECT_TYPES = {
  PASS: {
    label: 'PASS',
    title: 'COMPONENT VERIFIED - OPTICAL INSPECTION PASSED',
    desc: 'All structural dimensions, solder joints, and optical fiducials within tolerance.',
    pillClass: 'status-pass',
    badgeBg: 'rgba(16, 185, 129, 0.15)',
    textColor: '#10b981',
    borderColor: '#10b981'
  },
  DEFECT_MISSING: {
    label: 'DEFECT_MISSING',
    title: 'CRITICAL: SMD CAPACITOR ARRAY C-14 ABSENT',
    desc: 'Surface mount component missing at target coordinates X:342 Y:190. Solder pads exposed.',
    pillClass: 'status-defect-missing',
    badgeBg: 'rgba(239, 68, 68, 0.2)',
    textColor: '#ef4444',
    borderColor: '#ef4444'
  },
  DEFECT_MISALIGNED: {
    label: 'DEFECT_MISALIGNED',
    title: 'WARNING: RADIAL SKEW DISPLACEMENT +11.4° EXCEEDS SPEC',
    desc: 'Angular alignment threshold exceeded (Max ±1.5°). Automatic robotic realignment required.',
    pillClass: 'status-defect-misaligned',
    badgeBg: 'rgba(245, 158, 11, 0.2)',
    textColor: '#f59e0b',
    borderColor: '#f59e0b'
  },
  DEFECT_WRONG_PART: {
    label: 'DEFECT_WRONG_PART',
    title: 'SECURITY TRIP: INCOMPATIBLE PART SKU DETECTED',
    desc: 'Part barcode mismatch: Read [SKU-X820], expected [CMP-AERO-01]. Incompatible footprint.',
    pillClass: 'status-defect-wrong',
    badgeBg: 'rgba(244, 63, 94, 0.2)',
    textColor: '#f43f5e',
    borderColor: '#f43f5e'
  }
};

export default function App() {
  // Connection states: 'CONNECTED' | 'RECONNECTING' | 'SIMULATED'
  const [wsStatus, setWsStatus] = useState('RECONNECTING');
  const [isSimulatedActive, setIsSimulatedActive] = useState(true);
  const [isConveyorRunning, setIsConveyorRunning] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [filterType, setFilterType] = useState('ALL');
  const [selectedLogItem, setSelectedLogItem] = useState(null);
  const [hudOverlay, setHudOverlay] = useState({ grid: true, crosshair: true, bbox: true });

  // System statistics
  const [stats, setStats] = useState({
    scanned: 12480,
    defects: 46,
    defectRate: 0.37,
    avgLatency: 23.4,
    passCount: 12434
  });

  // Current live inspection item
  const [currentInspection, setCurrentInspection] = useState({
    slotId: 'SLOT-8924',
    component: COMPONENT_CATALOG[0].name,
    componentId: COMPONENT_CATALOG[0].id,
    category: COMPONENT_CATALOG[0].category,
    status: 'PASS',
    confidence: 99.4,
    latency: 22.8,
    timestamp: new Date().toISOString(),
    bbox: { x: 35, y: 30, w: 30, h: 40 },
    defectReason: 'Nominal surface geometry & fiducial compliance',
    image_frame: null
  });

  // Emergency Line Interlock state
  const [interlockState, setInterlockState] = useState({
    operational: true,
    triggeredAt: null,
    reason: null
  });

  // Telemetry Audit log items (kept compact, max 10 records)
  const [auditLogs, setAuditLogs] = useState(() => {
    const initial = [];
    const now = Date.now();
    for (let i = 5; i >= 1; i--) {
      const isDefect = i === 3;
      const status = isDefect ? 'DEFECT_WRONG_PART' : 'PASS';
      initial.push({
        id: `LOG-${1000 + i}`,
        slotId: `SLOT-${9114 + i * 3}`,
        component: isDefect ? 'bottle' : 'cell phone',
        componentId: `SLOT-${9114 + i * 3}`,
        status,
        confidence: isDefect ? 91.2 : 98.6,
        latency: 21.5,
        timestamp: new Date(now - i * 4200).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + Math.floor((now % 1000) / 10),
        isoTime: new Date(now - i * 4200).toISOString(),
        defectReason: isDefect ? 'Mismatched part detected' : 'Optical inspection passed'
      });
    }
    return initial;
  });

  // Real HTML5 Live Webcam Reference & State
  const videoRef = useRef(null);
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState(null);

  // Initialize Real HTML5 Webcam Stream
  useEffect(() => {
    let stream = null;
    const startWebcam = async () => {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user'
            },
            audio: false
          });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
              videoRef.current?.play().catch(() => {});
            };
          }
          setWebcamActive(true);
          setWebcamError(null);
        }
      } catch (err) {
        console.warn('Webcam stream not accessible:', err);
        setWebcamActive(false);
        setWebcamError(err.message || 'Webcam permission denied');
      }
    };

    startWebcam();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Quality Telemetry Log Ref & Smooth Auto-Scroll
  const logContainerRef = useRef(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [auditLogs]);

  // Clock
  const [clock, setClock] = useState('');

  const socketRef = useRef(null);
  const audioCtxRef = useRef(null);

  // Sound generator (Web Audio API)
  const playSound = useCallback((type) => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'PASS') {
        // High harmonic futuristic blip
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else {
        // Dual harsh sawtooth emergency buzz
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, ctx.currentTime);
        osc.frequency.setValueAtTime(160, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch {
      // AudioContext not allowed or unsupported
    }
  }, [soundEnabled]);

  // Real-time clock updater
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const ms = String(now.getMilliseconds()).padStart(3, '0').slice(0, 2);
      setClock(`${timeStr}.${ms}`);
    };
    updateTime();
    const timer = setInterval(updateTime, 50);
    return () => clearInterval(timer);
  }, []);

  // Process incoming telemetry (whether from WebSocket or Simulation)
  const handleNewTelemetry = useCallback((raw) => {
    const status = raw.status || 'PASS';
    const isDefect = status !== 'PASS';
    const latencyVal = raw.latency_ms !== undefined ? Number(raw.latency_ms) : (raw.latency !== undefined ? Number(raw.latency) : 23.4);
    const confidenceVal = typeof raw.confidence === 'number'
      ? (raw.confidence <= 1.0 ? Number((raw.confidence * 100).toFixed(1)) : Number(raw.confidence.toFixed(1)))
      : 98.5;
    const slotVal = raw.slot_id || raw.slotId || 'SLOT-9114';
    const partVal = raw.part_name || raw.component || 'Inspected Component';
    const messageVal = raw.message || raw.defectReason || (isDefect ? `${status} identified on ${slotVal}` : 'Optical inspection passed');

    const data = {
      ...raw,
      slotId: slotVal,
      slot_id: slotVal,
      component: partVal,
      part_name: partVal,
      componentId: raw.componentId || slotVal,
      status,
      confidence: confidenceVal,
      latency: latencyVal,
      latency_ms: latencyVal,
      defectReason: messageVal,
      message: messageVal,
      conveyor_active: raw.conveyor_active !== undefined ? raw.conveyor_active : !isDefect,
      image_frame: raw.image_frame || null,
      bbox: raw.bbox || { x: 35, y: 30, w: 30, h: 40 }
    };

    if (raw.conveyor_active !== undefined) {
      setIsConveyorRunning(Boolean(raw.conveyor_active));
    }

    // Update current inspection HUD
    setCurrentInspection(data);

    // Play synthesized sound
    playSound(status);

    // Update stats
    setStats((prev) => {
      const newScanned = prev.scanned + 1;
      const newDefects = isDefect ? prev.defects + 1 : prev.defects;
      const newPass = isDefect ? prev.passCount : prev.passCount + 1;
      const rate = ((newDefects / newScanned) * 100).toFixed(2);
      const rollingLatency = Number(((prev.avgLatency * 19 + latencyVal) / 20).toFixed(1));
      return {
        scanned: newScanned,
        defects: newDefects,
        defectRate: Number(rate),
        avgLatency: rollingLatency,
        passCount: newPass
      };
    });

    // Update Emergency Interlock
    if (isDefect) {
      setInterlockState({
        operational: false,
        triggeredAt: new Date().toLocaleTimeString(),
        reason: `${status}: ${messageVal}`
      });
    }

    // Prepend to audit log (strictly keep latest 10 items in state)
    const logItem = {
      id: `LOG-${Date.now().toString().slice(-5)}`,
      slotId: slotVal,
      component: partVal,
      componentId: raw.componentId || slotVal,
      status,
      confidence: confidenceVal,
      latency: latencyVal,
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + Math.floor(Math.random() * 90 + 10),
      isoTime: new Date().toISOString(),
      defectReason: messageVal
    };

    setAuditLogs((prev) => [logItem, ...prev.slice(0, 9)]);
  }, [playSound]);

  // WebSocket Connection Logic
  useEffect(() => {
    let reconnectTimer = null;
    let ws = null;

    const connectWebSocket = () => {
      try {
        setWsStatus('RECONNECTING');
        ws = new WebSocket('wss://solid-spiders-burn.loca.lt');
        socketRef.current = ws;

        ws.onopen = () => {
          setWsStatus('CONNECTED');
          setIsSimulatedActive(false);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            handleNewTelemetry(data);
          } catch {
            // Ignore malformed packet
          }
        };

        ws.onclose = () => {
          setWsStatus('RECONNECTING');
          setIsSimulatedActive(true);
          reconnectTimer = setTimeout(connectWebSocket, 4000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        setWsStatus('RECONNECTING');
        setIsSimulatedActive(true);
        reconnectTimer = setTimeout(connectWebSocket, 4000);
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [handleNewTelemetry]);

  // Fallback / Autonomous Simulation Stream Loop
  useEffect(() => {
    if (!isSimulatedActive || !isConveyorRunning) return;

    const interval = setInterval(() => {
      // If line is halted due to interlock, hold conveyor unless reset
      if (!interlockState.operational) return;

      const randomComp = COMPONENT_CATALOG[Math.floor(Math.random() * COMPONENT_CATALOG.length)];
      const rand = Math.random();
      let status = 'PASS';
      let confidence = Number((98.2 + Math.random() * 1.7).toFixed(1));
      let defectReason = 'Nominal optical profile & geometry compliance';

      if (rand < 0.05) {
        status = 'DEFECT_MISSING';
        confidence = Number((94.5 + Math.random() * 4.2).toFixed(1));
        defectReason = 'SMD Capacitor C-14 missing at X:342 Y:190';
      } else if (rand < 0.10) {
        status = 'DEFECT_MISALIGNED';
        confidence = Number((92.1 + Math.random() * 5.0).toFixed(1));
        defectReason = 'Rotational skew +11.4° exceeds ±1.5° tolerance';
      } else if (rand < 0.14) {
        status = 'DEFECT_WRONG_PART';
        confidence = Number((95.8 + Math.random() * 3.5).toFixed(1));
        defectReason = 'Part mismatch: Barcode SKU-X820 detected instead of spec';
      }

      const slotNumber = 8900 + Math.floor(Math.random() * 500);
      const simulatedData = {
        slotId: `SLOT-${slotNumber}`,
        component: randomComp.name,
        componentId: randomComp.id,
        category: randomComp.category,
        status,
        confidence,
        latency: Number((20.2 + Math.random() * 8.5).toFixed(1)),
        timestamp: new Date().toISOString(),
        bbox: {
          x: status === 'DEFECT_MISALIGNED' ? 38 : 35,
          y: status === 'DEFECT_MISALIGNED' ? 32 : 30,
          w: 30,
          h: 40
        },
        defectReason
      };

      handleNewTelemetry(simulatedData);
    }, 2400);

    return () => clearInterval(interval);
  }, [isSimulatedActive, isConveyorRunning, interlockState.operational, handleNewTelemetry]);

  // Manual Trigger for demonstration
  const triggerManualInspection = (desiredStatus) => {
    const randomComp = COMPONENT_CATALOG[Math.floor(Math.random() * COMPONENT_CATALOG.length)];
    const def = DEFECT_TYPES[desiredStatus];
    const slotNumber = 9000 + Math.floor(Math.random() * 999);
    const data = {
      slotId: `SLOT-${slotNumber}`,
      component: randomComp.name,
      componentId: randomComp.id,
      category: randomComp.category,
      status: desiredStatus,
      confidence: desiredStatus === 'PASS' ? 99.6 : 95.2,
      latency: 21.4,
      timestamp: new Date().toISOString(),
      bbox: { x: 35, y: 30, w: 30, h: 40 },
      defectReason: def.desc
    };
    handleNewTelemetry(data);
  };

  // Reset Emergency Interlock
  const handleResetInterlock = () => {
    setInterlockState({
      operational: true,
      triggeredAt: null,
      reason: null
    });
  };

  // Export CSV Handler
  const handleExportCSV = () => {
    const headers = ['Timestamp', 'Slot_ID', 'Component_ID', 'Component_Name', 'Status', 'Confidence_Pct', 'Latency_ms', 'Inspection_Decision', 'Defect_Notes'];
    const rows = auditLogs.map((log) => [
      `"${log.isoTime || log.timestamp}"`,
      `"${log.slotId}"`,
      `"${log.componentId}"`,
      `"${log.component.replace(/"/g, '""')}"`,
      `"${log.status}"`,
      log.confidence,
      log.latency,
      `"${log.status === 'PASS' ? 'ACCEPTED' : 'REJECTED'}"`,
      `"${(log.defectReason || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `AIDAS_NAT003_AuditLog_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered logs
  const filteredLogs = auditLogs.filter((log) => {
    if (filterType === 'PASS') return log.status === 'PASS';
    if (filterType === 'DEFECTS') return log.status !== 'PASS';
    return true;
  });

  const currentDef = DEFECT_TYPES[currentInspection.status] || DEFECT_TYPES.PASS;
  const isEmergencyActive = !interlockState.operational;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-obsidian)', color: 'var(--text-main)' }}>
      {/* ===================================================================
          1. TOP EMERGENCY BANNER (Active when Interlock Trips)
          =================================================================== */}
      {isEmergencyActive && (
        <div
          style={{
            background: 'linear-gradient(90deg, #991b1b 0%, #ef4444 50%, #991b1b 100%)',
            color: '#ffffff',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '2px solid #fecaca',
            boxShadow: '0 4px 25px rgba(239, 68, 68, 0.7)',
            zIndex: 100,
            animation: 'emergency-pulse 1s ease-in-out infinite'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <ShieldAlert size={28} className="animate-spin" style={{ animationDuration: '3s', filter: 'drop-shadow(0 0 8px white)' }} />
            <div>
              <div style={{ fontFamily: 'var(--font-tech)', fontSize: '1.05rem', fontWeight: 700, letterSpacing: '1px' }}>
                LINE INTERLOCK HALTED // EMERGENCY STOP ENGAGED
              </div>
              <div style={{ fontSize: '0.82rem', opacity: 0.95, fontFamily: 'var(--font-mono)' }}>
                {interlockState.reason} · Triggered: {interlockState.triggeredAt}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleResetInterlock}
              style={{
                backgroundColor: '#ffffff',
                color: '#991b1b',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.85rem',
                padding: '8px 18px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                fontFamily: 'var(--font-tech)',
                letterSpacing: '0.5px'
              }}
            >
              <RotateCcw size={16} /> RESET INTERLOCK & RESUME CONVEYOR
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================
          2. HEADER BAR
          =================================================================== */}
      <header
        style={{
          borderBottom: '1px solid var(--panel-border)',
          backgroundColor: 'rgba(9, 13, 22, 0.92)',
          backdropFilter: 'blur(16px)',
          padding: '12px 24px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          position: 'sticky',
          top: 0,
          zIndex: 40
        }}
      >
        {/* Left: Branding & Track */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.25), rgba(16, 185, 129, 0.15))',
              border: '1px solid var(--accent-cyan)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 16px var(--accent-cyan-glow)'
            }}
          >
            <Cpu size={24} color="#06b6d4" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1
                style={{
                  fontFamily: 'var(--font-tech)',
                  fontSize: '1.28rem',
                  fontWeight: 700,
                  letterSpacing: '0.8px',
                  background: 'linear-gradient(90deg, #f8fafc, #22d3ee)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent'
                }}
              >
                A.I.D.A.S. Industrial Command Center
              </h1>
              <span
                style={{
                  backgroundColor: 'rgba(6, 182, 212, 0.15)',
                  color: '#22d3ee',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600
                }}
              >
                NAT-003
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <span>SEVA FIRST 2026 // Autonomous Manufacturing Inspection</span>
              <span>•</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>SYS.CLK {clock}</span>
            </div>
          </div>
        </div>

        {/* Right: Telemetry Status, Audio, Conveyor Pause, CSV Download */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* WebSocket / Fallback Stream Pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '20px',
              backgroundColor: 'rgba(17, 24, 39, 0.8)',
              border: `1px solid ${wsStatus === 'CONNECTED' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(6, 182, 212, 0.4)'}`
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: wsStatus === 'CONNECTED' ? 'var(--accent-emerald)' : 'var(--accent-cyan)',
                boxShadow: wsStatus === 'CONNECTED' ? '0 0 10px #10b981' : '0 0 10px #06b6d4'
              }}
            />
            <div style={{ fontSize: '0.76rem', fontFamily: 'var(--font-mono)' }}>
              {wsStatus === 'CONNECTED' ? (
                <span style={{ color: 'var(--accent-emerald-light)' }}>WS CONNECTED (PORT 8765)</span>
              ) : (
                <span style={{ color: 'var(--accent-cyan-light)' }}>FALLBACK SIMULATED (WS RECONNECTING)</span>
              )}
            </div>
          </div>

          {/* Sound FX Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            title={soundEnabled ? 'Mute Inspection Audio' : 'Enable Inspection Audio'}
            style={{
              backgroundColor: soundEnabled ? 'rgba(6, 182, 212, 0.15)' : 'rgba(17, 24, 39, 0.8)',
              border: `1px solid ${soundEnabled ? 'var(--accent-cyan)' : 'var(--panel-border)'}`,
              color: soundEnabled ? '#22d3ee' : 'var(--text-muted)',
              padding: '7px 12px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.78rem',
              fontFamily: 'var(--font-tech)'
            }}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{soundEnabled ? 'AUDIO ON' : 'MUTED'}</span>
          </button>

          {/* Conveyor Toggle */}
          <button
            onClick={() => setIsConveyorRunning(!isConveyorRunning)}
            style={{
              backgroundColor: isConveyorRunning ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${isConveyorRunning ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
              color: isConveyorRunning ? 'var(--accent-emerald-light)' : 'var(--accent-crimson-light)',
              padding: '7px 12px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.78rem',
              fontFamily: 'var(--font-tech)'
            }}
          >
            {isConveyorRunning ? <Pause size={15} /> : <Play size={15} />}
            <span>{isConveyorRunning ? 'CONVEYOR ACTIVE' : 'CONVEYOR PAUSED'}</span>
          </button>

          {/* Export Audit CSV Button */}
          <button
            onClick={handleExportCSV}
            style={{
              backgroundColor: '#06b6d4',
              color: '#080d16',
              border: 'none',
              fontWeight: 700,
              fontSize: '0.82rem',
              padding: '8px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 0 20px rgba(6, 182, 212, 0.4)',
              fontFamily: 'var(--font-tech)',
              letterSpacing: '0.5px',
              transition: 'all 0.2s ease'
            }}
          >
            <Download size={16} strokeWidth={2.5} />
            <span>EXPORT AUDIT CSV</span>
          </button>
        </div>
      </header>

      {/* ===================================================================
          3. MAIN CONTENT CONTAINER
          =================================================================== */}
      <main style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* TOP KPI METRIC CARDS (4-Grid) */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px'
          }}
        >
          {/* Card 1: Total Scanned */}
          <div className="glass-card" style={{ padding: '18px 20px' }}>
            <div className="tech-bracket-tl" />
            <div className="tech-bracket-tr" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-tech)', color: 'var(--text-muted)', letterSpacing: '0.8px' }}>
                  TOTAL SCANNED COMPONENTS
                </span>
                <div style={{ fontSize: '1.9rem', fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: '4px', color: '#f8fafc' }}>
                  {stats.scanned.toLocaleString()}
                </div>
              </div>
              <div style={{ padding: '10px', borderRadius: '10px', backgroundColor: 'rgba(6, 182, 212, 0.12)', border: '1px solid rgba(6, 182, 212, 0.3)' }}>
                <CheckCircle2 size={22} color="#06b6d4" />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              <span>Yield: <strong style={{ color: 'var(--accent-emerald)' }}>{((stats.passCount / stats.scanned) * 100).toFixed(2)}%</strong></span>
              <span>Pass: <strong style={{ color: '#e2e8f0' }}>{stats.passCount.toLocaleString()}</strong></span>
              <span>Defects: <strong style={{ color: 'var(--accent-crimson)' }}>{stats.defects}</strong></span>
            </div>
          </div>

          {/* Card 2: Defect Rate */}
          <div className="glass-card" style={{ padding: '18px 20px' }}>
            <div className="tech-bracket-tl" />
            <div className="tech-bracket-tr" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-tech)', color: 'var(--text-muted)', letterSpacing: '0.8px' }}>
                  DEFECT RATE (%)
                </span>
                <div
                  style={{
                    fontSize: '1.9rem',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    marginTop: '4px',
                    color: stats.defectRate > 1.0 ? 'var(--accent-crimson)' : stats.defectRate > 0.6 ? '#f59e0b' : 'var(--accent-emerald)'
                  }}
                >
                  {stats.defectRate.toFixed(2)}%
                </div>
              </div>
              <div
                style={{
                  padding: '10px',
                  borderRadius: '10px',
                  backgroundColor: stats.defectRate > 1.0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.12)',
                  border: `1px solid ${stats.defectRate > 1.0 ? 'rgba(239, 68, 68, 0.35)' : 'rgba(16, 185, 129, 0.35)'}`
                }}
              >
                <ShieldAlert size={22} color={stats.defectRate > 1.0 ? '#ef4444' : '#10b981'} />
              </div>
            </div>
            {/* Visual Tolerance Gauge */}
            <div style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '4px' }}>
                <span>Current: {stats.defectRate}%</span>
                <span>Max Tolerance: 0.85%</span>
              </div>
              <div style={{ width: '100%', height: '5px', backgroundColor: 'rgba(51, 65, 85, 0.6)', borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, (stats.defectRate / 1.5) * 100)}%`,
                    height: '100%',
                    backgroundColor: stats.defectRate > 0.85 ? '#ef4444' : '#10b981',
                    boxShadow: stats.defectRate > 0.85 ? '0 0 10px #ef4444' : '0 0 8px #10b981',
                    transition: 'width 0.4s ease'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Card 3: Average Latency */}
          <div className="glass-card" style={{ padding: '18px 20px' }}>
            <div className="tech-bracket-tl" />
            <div className="tech-bracket-tr" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-tech)', color: 'var(--text-muted)', letterSpacing: '0.8px' }}>
                  AVERAGE LATENCY
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
                  <div style={{ fontSize: '1.9rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#22d3ee' }}>
                    {stats.avgLatency}
                  </div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>ms</span>
                </div>
              </div>
              <div style={{ padding: '10px', borderRadius: '10px', backgroundColor: 'rgba(6, 182, 212, 0.12)', border: '1px solid rgba(6, 182, 212, 0.3)' }}>
                <Zap size={22} color="#06b6d4" />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              <span>Target: <strong style={{ color: 'var(--accent-emerald)' }}>&lt; 35.0 ms</strong></span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>CUDA TensorRT FP16</span>
            </div>
          </div>

          {/* Card 4: Line Interlock Status */}
          <div
            className={`glass-card ${isEmergencyActive ? 'hazard-alert' : ''}`}
            style={{
              padding: '18px 20px',
              border: isEmergencyActive ? '1px solid var(--accent-crimson)' : '1px solid rgba(16, 185, 129, 0.4)'
            }}
          >
            <div className="tech-bracket-tl" />
            <div className="tech-bracket-tr" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-tech)', color: 'var(--text-muted)', letterSpacing: '0.8px' }}>
                  LINE INTERLOCK STATUS
                </span>
                <div
                  style={{
                    fontSize: isEmergencyActive ? '1.1rem' : '1.35rem',
                    fontWeight: 700,
                    fontFamily: 'var(--font-tech)',
                    marginTop: '6px',
                    letterSpacing: '0.5px',
                    color: isEmergencyActive ? '#ef4444' : '#10b981'
                  }}
                >
                  {isEmergencyActive ? 'LINE HALTED - EMERGENCY STOP' : 'OPERATIONAL'}
                </div>
              </div>
              <div
                style={{
                  padding: '10px',
                  borderRadius: '10px',
                  backgroundColor: isEmergencyActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.15)',
                  border: `1px solid ${isEmergencyActive ? 'var(--accent-crimson)' : 'var(--accent-emerald)'}`
                }}
              >
                <Activity size={22} color={isEmergencyActive ? '#ef4444' : '#10b981'} />
              </div>
            </div>
            <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', color: isEmergencyActive ? '#fca5a5' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {isEmergencyActive ? 'Automated Brake Engaged' : 'Conveyor Speed: 1.85 m/s'}
              </span>
              {isEmergencyActive && (
                <button
                  onClick={handleResetInterlock}
                  style={{
                    fontSize: '0.68rem',
                    padding: '3px 8px',
                    backgroundColor: 'rgba(239, 68, 68, 0.3)',
                    border: '1px solid #ef4444',
                    color: '#fff',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-tech)'
                  }}
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>
        </section>

        {/* 2-COLUMN WORKSPACE: LEFT 2/3 INSPECTION STAGE + RIGHT 1/3 TELEMETRY SIDEBAR */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(360px, 1fr)', gap: '20px', flex: 1 }}>
          
          {/* ===================================================================
              4. MAIN INSPECTION STAGE (Left 2/3)
              =================================================================== */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Live Camera Viewport Container */}
            <div
              className={`glass-panel ${isEmergencyActive ? 'hazard-stripes' : ''}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                borderRadius: '14px',
                border: isEmergencyActive ? '2px solid #ef4444' : '1px solid var(--panel-border)'
              }}
            >
              {/* Top Viewport Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 18px',
                  backgroundColor: 'rgba(15, 23, 42, 0.85)',
                  borderBottom: '1px solid var(--panel-border)',
                  fontSize: '0.78rem',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Camera size={16} color={webcamActive ? '#10b981' : '#06b6d4'} />
                    <span style={{ fontWeight: 600, color: '#f8fafc' }}>
                      {webcamActive ? 'CAM-01 LIVE OPTICAL WEBCAM' : 'CAM-01 OPTICAL HUD // CONNECTING'}
                    </span>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: webcamActive ? '#10b981' : '#f59e0b',
                        boxShadow: webcamActive ? '0 0 8px #10b981' : '0 0 8px #f59e0b',
                        display: 'inline-block',
                        marginLeft: '4px'
                      }}
                    />
                  </div>
                  <span style={{ color: 'var(--text-dim)' }}>|</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>120 FPS</span>
                  <span style={{ color: 'var(--text-dim)' }}>|</span>
                  <span style={{ color: 'var(--text-muted)' }}>EXP: 1/8000s</span>
                  <span style={{ color: 'var(--text-dim)' }}>|</span>
                  <span style={{ color: 'var(--text-muted)' }}>450nm STEREO UV</span>
                </div>

                {/* HUD Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => setHudOverlay(h => ({ ...h, grid: !h.grid }))}
                    style={{
                      backgroundColor: hudOverlay.grid ? 'rgba(6, 182, 212, 0.2)' : 'transparent',
                      border: '1px solid rgba(6, 182, 212, 0.3)',
                      color: hudOverlay.grid ? '#22d3ee' : 'var(--text-dim)',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.68rem'
                    }}
                  >
                    GRID
                  </button>
                  <button
                    onClick={() => setHudOverlay(h => ({ ...h, crosshair: !h.crosshair }))}
                    style={{
                      backgroundColor: hudOverlay.crosshair ? 'rgba(6, 182, 212, 0.2)' : 'transparent',
                      border: '1px solid rgba(6, 182, 212, 0.3)',
                      color: hudOverlay.crosshair ? '#22d3ee' : 'var(--text-dim)',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.68rem'
                    }}
                  >
                    RETICLE
                  </button>
                  <button
                    onClick={() => setHudOverlay(h => ({ ...h, bbox: !h.bbox }))}
                    style={{
                      backgroundColor: hudOverlay.bbox ? 'rgba(6, 182, 212, 0.2)' : 'transparent',
                      border: '1px solid rgba(6, 182, 212, 0.3)',
                      color: hudOverlay.bbox ? '#22d3ee' : 'var(--text-dim)',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.68rem'
                    }}
                  >
                    BOUNDS
                  </button>
                </div>
              </div>

              {/* Viewport Canvas / Stage with Real-Time Video Frame Streaming */}
              <div
                style={{
                  position: 'relative',
                  height: '380px',
                  backgroundColor: '#05080e',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {/* 1. Real-Time Video Frame Stream from OpenCV/WebSocket or HTML5 Video */}
                {currentInspection.image_frame ? (
                  <img
                    src={`data:image/jpeg;base64,${currentInspection.image_frame}`}
                    alt="A.I.D.A.S. Real-Time Optical Telemetry Feed"
                    className="w-full h-full object-cover"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      zIndex: 1
                    }}
                  />
                ) : (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      zIndex: 1,
                      filter: 'contrast(1.06) brightness(1.02)'
                    }}
                  />
                )}

                {/* Optical Feed Loading / Fallback Banner if no stream is active yet */}
                {!currentInspection.image_frame && !webcamActive && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(5, 8, 14, 0.88)',
                      zIndex: 2,
                      gap: '12px'
                    }}
                  >
                    <Camera size={40} color="#06b6d4" className="animate-pulse" />
                    <div style={{ fontFamily: 'var(--font-tech)', fontSize: '0.92rem', color: '#22d3ee', letterSpacing: '0.5px' }}>
                      ACQUIRING REAL-TIME OPTICAL STREAM...
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      Connecting to wss://solid-spiders-burn.loca.lt / video device
                    </div>
                  </div>
                )}

                {/* 2. Animated High-Tech Scan Laser */}
                {isConveyorRunning && (
                  <div
                    className="scan-laser"
                    style={{ zIndex: 8, pointerEvents: 'none' }}
                  />
                )}

                {/* 3. Conveyor Belt Background Grid & Tracks */}
                {hudOverlay.grid && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0.3,
                      backgroundImage: `
                        linear-gradient(rgba(6, 182, 212, 0.3) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(6, 182, 212, 0.3) 1px, transparent 1px)
                      `,
                      backgroundSize: '40px 40px',
                      pointerEvents: 'none',
                      zIndex: 5
                    }}
                  />
                )}

                {/* 4. Conveyor Motion Rail Guidelines */}
                <div
                  style={{
                    position: 'absolute',
                    top: '25%',
                    bottom: '25%',
                    left: 0,
                    right: 0,
                    borderTop: '1px dashed rgba(6, 182, 212, 0.4)',
                    borderBottom: '1px dashed rgba(6, 182, 212, 0.4)',
                    pointerEvents: 'none',
                    zIndex: 6
                  }}
                />

                {/* 5. Slot Bounding Box Overlay directly over the Live Webcam Feed */}
                {hudOverlay.bbox && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: `translate(-50%, -50%) ${currentInspection.status === 'DEFECT_MISALIGNED' ? 'rotate(10deg)' : 'rotate(0deg)'}`,
                      width: '320px',
                      height: '230px',
                      border: `2px solid ${currentDef.borderColor}`,
                      borderRadius: '8px',
                      boxShadow: `0 0 25px ${currentDef.badgeBg}, inset 0 0 15px ${currentDef.badgeBg}`,
                      pointerEvents: 'none',
                      zIndex: 12,
                      transition: 'border-color 0.3s ease, transform 0.3s ease'
                    }}
                  >
                    {/* Bounding Box Coordinates & Confidence Tag */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '-26px',
                        left: '0px',
                        backgroundColor: currentDef.borderColor,
                        color: '#080d16',
                        fontSize: '0.68rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '3px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>{currentInspection.slotId}</span>
                      <span>CONF: {currentInspection.confidence}%</span>
                      <span>{currentInspection.component}</span>
                    </div>

                    {/* Corner Targeting Pins */}
                    <div style={{ position: 'absolute', top: -4, left: -4, width: 10, height: 10, borderTop: '3px solid white', borderLeft: '3px solid white' }} />
                    <div style={{ position: 'absolute', top: -4, right: -4, width: 10, height: 10, borderTop: '3px solid white', borderRight: '3px solid white' }} />
                    <div style={{ position: 'absolute', bottom: -4, left: -4, width: 10, height: 10, borderBottom: '3px solid white', borderLeft: '3px solid white' }} />
                    <div style={{ position: 'absolute', bottom: -4, right: -4, width: 10, height: 10, borderBottom: '3px solid white', borderRight: '3px solid white' }} />
                  </div>
                )}

                {/* 6. High-Tech Reticle Crosshairs */}
                {hudOverlay.crosshair && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      pointerEvents: 'none',
                      width: '90px',
                      height: '90px',
                      opacity: 0.7,
                      zIndex: 14
                    }}
                  >
                    <Crosshair size={90} color="#06b6d4" strokeWidth={1.2} />
                  </div>
                )}

                {/* 7. Left Telemetry HUD Readout */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '12px',
                    left: '16px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.72rem',
                    color: 'rgba(248, 250, 252, 0.9)',
                    backgroundColor: 'rgba(9, 13, 22, 0.88)',
                    backdropFilter: 'blur(8px)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid rgba(51, 65, 85, 0.6)',
                    zIndex: 20
                  }}
                >
                  <div>SLOT: <span style={{ color: '#22d3ee', fontWeight: 600 }}>{currentInspection.slotId}</span></div>
                  <div>PART: <span style={{ color: '#f8fafc' }}>{currentInspection.component}</span></div>
                  <div>FEED: <span style={{ color: webcamActive ? '#10b981' : '#f59e0b' }}>{webcamActive ? 'LIVE OPTICAL WEBCAM' : 'INITIALIZING'}</span></div>
                </div>

                {/* 8. Right Telemetry HUD Readout */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '12px',
                    right: '16px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.72rem',
                    textAlign: 'right',
                    color: 'rgba(248, 250, 252, 0.9)',
                    backgroundColor: 'rgba(9, 13, 22, 0.88)',
                    backdropFilter: 'blur(8px)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid rgba(51, 65, 85, 0.6)',
                    zIndex: 20
                  }}
                >
                  <div>INFERENCE: <span style={{ color: '#22d3ee', fontWeight: 600 }}>{currentInspection.latency} ms</span></div>
                  <div>CONFIDENCE: <span style={{ color: currentDef.textColor, fontWeight: 700 }}>{currentInspection.confidence}%</span></div>
                  <div>DISPOSITION: <span style={{ color: currentDef.textColor }}>{currentInspection.status}</span></div>
                </div>
              </div>

              {/* Confidence Meter Gauge Bar (0 - 100%) */}
              <div
                style={{
                  padding: '14px 20px',
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  borderTop: '1px solid var(--panel-border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px'
                }}
              >
                <div style={{ minWidth: '170px' }}>
                  <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-tech)', color: 'var(--text-muted)' }}>
                    TARGET CONFIDENCE METER
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '2px' }}>
                    <span style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: currentDef.textColor }}>
                      {currentInspection.confidence}%
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      (Threshold: 90.0%)
                    </span>
                  </div>
                </div>

                {/* Dynamic Gradient Gauge Bar */}
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      height: '10px',
                      backgroundColor: 'rgba(30, 41, 59, 0.8)',
                      borderRadius: '5px',
                      overflow: 'hidden',
                      position: 'relative'
                    }}
                  >
                    <div
                      style={{
                        width: `${currentInspection.confidence}%`,
                        height: '100%',
                        background:
                          currentInspection.status === 'PASS'
                            ? 'linear-gradient(90deg, #059669, #10b981, #34d399)'
                            : currentInspection.status === 'DEFECT_MISALIGNED'
                            ? 'linear-gradient(90deg, #d97706, #f59e0b)'
                            : 'linear-gradient(90deg, #b91c1c, #ef4444)',
                        boxShadow: `0 0 12px ${currentDef.borderColor}`,
                        transition: 'width 0.4s ease, background 0.4s ease'
                      }}
                    />
                    {/* 90% threshold benchmark line */}
                    <div
                      style={{
                        position: 'absolute',
                        left: '90%',
                        top: 0,
                        bottom: 0,
                        width: '2px',
                        backgroundColor: '#ffffff',
                        opacity: 0.7
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.66rem', color: 'var(--text-dim)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                    <span>0%</span>
                    <span>50%</span>
                    <span>90% PASS CRITERIA</span>
                    <span>100%</span>
                  </div>
                </div>
              </div>

              {/* Status Indicator Tactical Banner */}
              <div
                style={{
                  padding: '16px 20px',
                  backgroundColor: currentDef.badgeBg,
                  borderTop: `1px solid ${currentDef.borderColor}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '14px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      backgroundColor: currentDef.borderColor,
                      color: '#080d16',
                      fontWeight: 800,
                      fontFamily: 'var(--font-tech)',
                      fontSize: '0.9rem',
                      letterSpacing: '0.5px'
                    }}
                  >
                    {currentDef.label}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: currentDef.textColor, fontFamily: 'var(--font-tech)' }}>
                      {currentDef.title}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-main)', opacity: 0.9, marginTop: '2px' }}>
                      {currentInspection.defectReason || currentDef.desc}
                    </div>
                  </div>
                </div>

                {/* Slot ID indicator */}
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>INSPECTED COMPONENT</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc' }}>{currentInspection.slotId}</div>
                </div>
              </div>
            </div>

            {/* Manual QA Simulation & Injection Dock */}
            <div
              className="glass-card"
              style={{
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} color="#06b6d4" />
                <span style={{ fontFamily: 'var(--font-tech)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  INSPECTION TEST RIG (INJECT QA DEFECTS):
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => triggerManualInspection('PASS')}
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid #10b981',
                    color: '#34d399',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-tech)'
                  }}
                >
                  ✓ Force PASS
                </button>
                <button
                  onClick={() => triggerManualInspection('DEFECT_MISSING')}
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid #ef4444',
                    color: '#f87171',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-tech)'
                  }}
                >
                  ⚠ Missing Part
                </button>
                <button
                  onClick={() => triggerManualInspection('DEFECT_MISALIGNED')}
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid #f59e0b',
                    color: '#fbbf24',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-tech)'
                  }}
                >
                  ⟳ Misalignment
                </button>
                <button
                  onClick={() => triggerManualInspection('DEFECT_WRONG_PART')}
                  style={{
                    backgroundColor: 'rgba(244, 63, 94, 0.15)',
                    border: '1px solid #f43f5e',
                    color: '#fda4af',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-tech)'
                  }}
                >
                  ✕ Wrong Part
                </button>
              </div>
            </div>
          </div>

          {/* ===================================================================
              5. QUALITY TELEMETRY LOG SIDEBAR (Right 1/3)
              =================================================================== */}
          <div
            className="glass-panel"
            style={{
              display: 'flex',
              flexDirection: 'column',
              borderRadius: '14px',
              overflow: 'hidden',
              maxHeight: '400px',
              height: '400px'
            }}
          >
            {/* Sidebar Header */}
            <div
              style={{
                padding: '12px 18px',
                borderBottom: '1px solid var(--panel-border)',
                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Layers size={18} color="#06b6d4" />
                  <h2 style={{ fontFamily: 'var(--font-tech)', fontSize: '1.02rem', fontWeight: 700, letterSpacing: '0.5px' }}>
                    Quality Telemetry Log
                  </h2>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Live Scanned Stream // Max 10 Records ({filteredLogs.length} displayed)
                </div>
              </div>

              {/* Filter Tabs */}
              <div style={{ display: 'flex', gap: '4px', backgroundColor: 'rgba(30, 41, 59, 0.6)', padding: '3px', borderRadius: '6px' }}>
                {['ALL', 'PASS', 'DEFECTS'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    style={{
                      backgroundColor: filterType === type ? 'var(--accent-cyan)' : 'transparent',
                      color: filterType === type ? '#080d16' : 'var(--text-muted)',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.68rem',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-tech)'
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Streaming Table List with internal smooth auto-scrolling */}
            <div
              ref={logContainerRef}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '10px',
                maxHeight: '340px'
              }}
            >
              {filteredLogs.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                  No telemetry records matching filter.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {filteredLogs.slice(0, 10).map((log, index) => {
                    const isDefect = log.status !== 'PASS';
                    const isSelected = selectedLogItem?.id === log.id;
                    const defInfo = DEFECT_TYPES[log.status] || DEFECT_TYPES.PASS;

                    return (
                      <div
                        key={log.id}
                        onClick={() => setSelectedLogItem(log)}
                        style={{
                          padding: '12px 14px',
                          borderRadius: '8px',
                          backgroundColor: isSelected ? 'rgba(6, 182, 212, 0.15)' : 'rgba(15, 23, 42, 0.75)',
                          border: isSelected
                            ? '1px solid var(--accent-cyan)'
                            : isDefect
                            ? '1px solid rgba(239, 68, 68, 0.3)'
                            : '1px solid rgba(51, 65, 85, 0.35)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 700,
                                fontSize: '0.82rem',
                                color: '#f8fafc'
                              }}
                            >
                              {log.slotId}
                            </span>
                            <span
                              style={{
                                fontSize: '0.66rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontFamily: 'var(--font-tech)',
                                fontWeight: 700,
                                color: defInfo.textColor,
                                backgroundColor: defInfo.badgeBg,
                                border: `1px solid ${defInfo.borderColor}`
                              }}
                            >
                              {log.status}
                            </span>
                          </div>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                            {log.timestamp}
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '0.74rem' }}>
                          <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '170px' }}>
                            {log.component}
                          </span>
                          <div style={{ display: 'flex', gap: '10px', fontFamily: 'var(--font-mono)' }}>
                            <span style={{ color: defInfo.textColor }}>{log.confidence}%</span>
                            <span style={{ color: 'var(--accent-cyan)' }}>{log.latency}ms</span>
                          </div>
                        </div>

                        {/* Expandable brief if defect */}
                        {isDefect && (
                          <div style={{ marginTop: '6px', fontSize: '0.68rem', color: '#fca5a5', fontFamily: 'var(--font-sans)', borderTop: '1px dashed rgba(239,68,68,0.2)', paddingTop: '4px' }}>
                            {log.defectReason}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected Item Quick Inspector Drawer (if selected) */}
            {selectedLogItem && (
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'rgba(9, 13, 22, 0.95)',
                  borderTop: '1px solid var(--accent-cyan)',
                  fontSize: '0.74rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ color: '#22d3ee', fontFamily: 'var(--font-tech)' }}>
                    EVENT INSPECTOR // {selectedLogItem.id}
                  </strong>
                  <button
                    onClick={() => setSelectedLogItem(null)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  Slot: <strong style={{ color: '#fff' }}>{selectedLogItem.slotId}</strong> | Model: {selectedLogItem.component}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  Diagnostic: <span style={{ color: selectedLogItem.status === 'PASS' ? '#34d399' : '#f87171' }}>{selectedLogItem.defectReason}</span>
                </div>
              </div>
            )}

            {/* Edge Diagnostics Footer */}
            <div
              style={{
                padding: '12px 18px',
                borderTop: '1px solid var(--panel-border)',
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                fontSize: '0.68rem',
                fontFamily: 'var(--font-mono)'
              }}
            >
              <div>
                <span style={{ color: 'var(--text-dim)' }}>GPU LOAD:</span>
                <div style={{ color: '#22d3ee', fontWeight: 600 }}>48°C · 34%</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)' }}>VRAM:</span>
                <div style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>3.4 / 16 GB</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)' }}>PIPE:</span>
                <div style={{ color: '#f8fafc', fontWeight: 600 }}>ZeroMQ / WS</div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ===================================================================
          6. FOOTER BAR
          =================================================================== */}
      <footer
        style={{
          borderTop: '1px solid var(--panel-border)',
          backgroundColor: 'rgba(9, 13, 22, 0.95)',
          padding: '10px 24px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.74rem',
          color: 'var(--text-dim)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>A.I.D.A.S. Framework v3.4-PROD</span>
          <span>•</span>
          <span>SEVA FIRST 2026 NAT-003</span>
          <span>•</span>
          <span style={{ color: 'var(--accent-cyan)' }}>ISO 9001 / IPC-A-610G COMPLIANT</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span>WebSocket Target: <code style={{ color: '#22d3ee' }}>wss://solid-spiders-burn.loca.lt</code></span>
          <span>Secure Edge Pipeline</span>
        </div>
      </footer>
    </div>
  );
}
