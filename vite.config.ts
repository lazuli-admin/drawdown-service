import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  server: { proxy: { "/api": "http://localhost:8787" } },
  build: { outDir: "../dist" },
});