import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/** Renderer-only Vite config (no Electron spawn) — for web preview / packaging renderer */
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4521,
    strictPort: true,
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  base: './',
})
