import { defineConfig, type Plugin } from "vite";
import path from "path";

/** Electron loads the UI via file:// — crossorigin blocks module/CSS loads and causes a blank window. */
function electronFileProtocolHtml(): Plugin {
  return {
    name: "electron-file-protocol-html",
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(="[^"]*")?/g, "");
    },
  };
}

export default defineConfig(({ mode }) => {
  // Never default packaged builds to "development" — that emits jsxDEV and crashes React in Electron.
  const nodeEnv = process.env.NODE_ENV || (mode === "production" ? "production" : "development");

  return {
    // base must be "./" so Electron can load built assets via file:// protocol
    base: "./",
    plugins: [electronFileProtocolHtml()],
    // Vite runs from the project root. root tells Vite where to find index.html.
    root: path.resolve(__dirname, "src"),
    // envDir is the project root — same directory as vite.config.ts and .env
    envDir: path.resolve(__dirname),
    build: {
      // Output to project-root/dist
      outDir: path.resolve(__dirname, "dist"),
      emptyOutDir: true,
      modulePreload: false,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "src/index.html"),
          captain: path.resolve(__dirname, "src/captain/index.html"),
        },
      },
    },
    resolve: {
      alias: {
        // use the npm polyfill packages so browser-external references are satisfied
        events: path.resolve(__dirname, "node_modules/events"),
        inherits: path.resolve(__dirname, "node_modules/inherits"),
        util: path.resolve(__dirname, "node_modules/util/"),
        // The Node build of csv-parse/sync reads Buffer and crashes the Electron window.
        "csv-parse/sync": path.resolve(__dirname, "node_modules/csv-parse/dist/esm/sync.js"),
      },
    },
    optimizeDeps: {
      include: ["events", "inherits", "util"],
    },
    define: {
      // provide minimal process shim for libraries that check process.env
      "process.env.NODE_ENV": JSON.stringify(nodeEnv),
    },
  };
});
