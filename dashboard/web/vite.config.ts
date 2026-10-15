import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base + no module-preload polyfill => the built index.html has NO
// inline <script>, so CSP `script-src 'self'` holds. All assets same-origin.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    target: "es2020",
    sourcemap: false,
    modulePreload: { polyfill: false },
    cssCodeSplit: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: process.env.VOIDMAIN_WS_URL || "ws://localhost:8080",
        ws: true,
      },
      "/healthz": process.env.VOIDMAIN_BACKEND_URL || "http://localhost:8080",
      "/auth": process.env.VOIDMAIN_BACKEND_URL || "http://localhost:8080",
      "/debug": process.env.VOIDMAIN_BACKEND_URL || "http://localhost:8080",
      "/debug.html": process.env.VOIDMAIN_BACKEND_URL || "http://localhost:8080",
      "/alerts": process.env.VOIDMAIN_BACKEND_URL || "http://localhost:8080",
    },
  },
});
