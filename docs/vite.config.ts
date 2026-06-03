import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages serves the project site under /agent-conductor/.
export default defineConfig({
  base: "/agent-conductor/",
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // Multi-page: the landing site + a standalone Board guide page.
      input: {
        main: "index.html",
        kanban: "kanban.html",
      },
      output: {
        manualChunks: {
          flow: ["@xyflow/react"],
          shiki: ["shiki/core", "shiki/engine/javascript"],
        },
      },
    },
  },
});
