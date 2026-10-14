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
        target: "ws://localhost:8081",
        ws: true,
      },
      "/healthz": "http://localhost:8081",
      "/auth": "http://localhost:8081",
    },
  },
});
