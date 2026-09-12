import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The API listens on 8000 (apps/api/.env PORT). Same-origin in dev; no CORS.
      "/api": "http://localhost:8000",
      "/healthz": "http://localhost:8000",
    },
  },
})
