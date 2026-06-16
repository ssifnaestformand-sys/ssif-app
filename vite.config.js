import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        main:       resolve(__dirname, 'index.html'),
        admin:      resolve(__dirname, 'admin/index.html'),
        infoscreen: resolve(__dirname, 'infoscreen/index.html'),
      },
      output: {
        manualChunks: {
          'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          'react':    ['react', 'react-dom'],
        },
      },
    },
  },
})
