import { defineConfig } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'main/index.ts') },
        // Native module: loaded from node_modules at runtime (asarUnpack).
        external: ['onnxruntime-node']
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: { input: { preload: resolve(__dirname, 'renderer/preload.ts') } }
    }
  },
  renderer: {
    root: 'renderer',
    build: {
      outDir: 'dist/renderer',
      rollupOptions: { input: { overlay: resolve(__dirname, 'renderer/overlay/index.html') } }
    }
  }
})
