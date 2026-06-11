import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import boardPkg from "../board/package.json" with { type: "json" };

// The version badge in the masthead follows the published conductor-board CLI.
const APP_VERSION = boardPkg.version;

// GitHub Pages serves the project site under /agent-conductor/.
export default defineConfig({
  base: "/agent-conductor/",
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
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
