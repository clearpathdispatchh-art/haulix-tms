import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Whether to polyfill `process` and `Buffer`
      include: ['process', 'buffer'],
      // Whether to polyfill specific modules
      globals: {
        process: true,
        Buffer: true,
      },
    }),
  ],
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage', 'firebase/functions'],
  },
})