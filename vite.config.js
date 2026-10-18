import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'resolve-js-to-jsx',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './App.js' || source.endsWith('/App.js') || source === './App') {
          return path.resolve(__dirname, 'src/App.jsx')
        }
        return null
      },
    },
    react(),
  ],
})
