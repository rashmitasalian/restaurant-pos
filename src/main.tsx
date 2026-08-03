import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "./ui/pos-theme.css";
import App from "./ui/App";

const rendererStartupT0 = typeof performance !== "undefined" ? performance.now() : Date.now();
(window as any).__posStartupT0 = rendererStartupT0;

function rendererElapsedMs() {
  if (typeof performance !== "undefined") {
    return Number((performance.now() - rendererStartupT0).toFixed(1));
  }
  return Number((Date.now() - rendererStartupT0).toFixed(1));
}

function logRendererStartup(stage: string, context?: Record<string, unknown>) {
  const payload = { elapsedMs: rendererElapsedMs(), ...(context || {}) };
  console.info(`[renderer-startup] ${stage}`, payload);
  try {
    (window as any).pos?.writeLog?.("info", `[renderer-startup] ${stage}`, payload).catch(() => {
      // best effort telemetry
    });
  } catch {
    // ignore logging failures
  }
}

logRendererStartup("bundle-evaluated");
if (document.readyState === "loading") {
  window.addEventListener(
    "DOMContentLoaded",
    () => {
      logRendererStartup("dom-content-loaded");
    },
    { once: true },
  );
} else {
  logRendererStartup("dom-content-loaded");
}

// ── Global error handlers for the renderer process ──────────────────────────
window.onerror = (_msg, _src, _line, _col, error) => {
  try {
    const pos = (window as any).pos;
    pos?.writeLog?.("error", `[window.onerror] ${error?.message || _msg}`, {
      stack: error?.stack,
      source: _src,
      line: _line,
      col: _col,
    });
  } catch (_) {}
};

window.onunhandledrejection = (event: PromiseRejectionEvent) => {
  try {
    const pos = (window as any).pos;
    const reason = event.reason;
    pos?.writeLog?.("error", `[unhandledrejection] ${reason?.message || reason}`, {
      stack: reason?.stack,
    });
  } catch (_) {}
};

logRendererStartup("react-render:start");
createRoot(document.getElementById("root")!).render(<App />);
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    logRendererStartup("react-render:two-frames");
  });
});
