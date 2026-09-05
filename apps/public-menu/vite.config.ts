import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  envDir: ".",
  server: {
    port: 5174,
  },
  preview: {
    port: 5174,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
