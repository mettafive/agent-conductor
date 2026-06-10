import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The version badge in the masthead. Keep in sync with board/package.json on release
// (the cross-workspace JSON import doesn't inline cleanly in vite's config bundler).
const APP_VERSION = "3.3.4";

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
