import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/boatrace-ai-predictor/', // GitHub Pages用
  build: {
    outDir: 'dist',
    // data/races.json を dist にコピー
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  },
  publicDir: 'public'
})
