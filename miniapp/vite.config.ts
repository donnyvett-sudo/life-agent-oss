import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// MINIAPP_BASE = path on GitHub Pages, e.g. "/life-coach-app/" (the Pages repo name).
export default defineConfig({
  // LIFE_DESK=1: build into the Mac app, relative paths.
  base: process.env.LIFE_DESK ? "./" : (process.env.MINIAPP_BASE ?? "/"),
  plugins: [react()],
});
