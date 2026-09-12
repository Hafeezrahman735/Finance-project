import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // The API listens on 8000 (apps/api/.env PORT). Same-origin in dev; no CORS.
      "/api": "http://localhost:8000",
      "/healthz": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.js"],
    include: ["test/**/*.test.jsx"],
    globals: false,
  },
})
