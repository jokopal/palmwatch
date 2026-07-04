import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api ke FastAPI (port 8000) saat dev agar tanpa masalah CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
