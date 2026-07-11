import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  // base must be "./" so Electron can load built assets via file:// protocol
  base: "./",
  // Vite runs from the project root. root tells Vite where to find index.html.
  root: path.resolve(__dirname, "src"),
  // envDir is the project root — same directory as vite.config.ts and .env
  envDir: path.resolve(__dirname),
  build: {
    // Output to project-root/dist
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      // use the npm polyfill packages so browser-external references are satisfied
      events: path.resolve(__dirname, "node_modules/events"),
      inherits: path.resolve(__dirname, "node_modules/inherits"),
      util: path.resolve(__dirname, "node_modules/util/"),
    },
  },
  optimizeDeps: {
    include: ["events", "inherits", "util"],
  },
  define: {
    // provide minimal process shim for libraries that check process.env
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
  },
});
