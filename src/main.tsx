import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "./ui/pos-theme.css";
import App from "./ui/App";

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

createRoot(document.getElementById("root")!).render(<App />);
