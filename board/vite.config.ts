import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Served from the local board server at the root, so relative asset paths.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  // Dev only: proxy the board server's SSE + API so `npm run dev` gives live HMR
  // of the UI while real status updates stream from a board running on :3042.
  server: {
    port: 5173,
    proxy: {
      "/events": { target: "http://localhost:3042", changeOrigin: true, ws: false },
      "/api": "http://localhost:3042",
      "/health": "http://localhost:3042",
      "/history": "http://localhost:3042",
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          motion: ["framer-motion"],
          yaml: ["js-yaml"],
        },
      },
    },
  },
});
