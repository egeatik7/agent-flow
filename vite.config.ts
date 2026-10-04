import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'path'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4521,
    strictPort: true,
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/boot.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // playwright-core is loaded at run time from node_modules; bundling it drags in optional parts (kerberos, chromium-bidi) that are not installed.
              external: ['electron', 'electron-store', 'onnxruntime-node', 'onnxruntime-common', /^playwright(-core)?(\/.*)?$/, /^chromium-bidi(\/.*)?$/, 'kerberos'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
      renderer: {},
    }),
  ],
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
