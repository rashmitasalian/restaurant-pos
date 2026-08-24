import React from "react";

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      (window as any).pos?.writeLog?.("error", `[ErrorBoundary] ${error.message}`, {
        stack: error.stack,
        componentStack: info.componentStack,
      });
    } catch (_) {}
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            background: "var(--pos-danger-tint)",
            padding: 32,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}></div>
          <h2 style={{ margin: "0 0 8px", color: "var(--pos-danger-strong)", fontSize: 22 }}>
            Something went wrong
          </h2>
          <p
            style={{
              color: "var(--pos-tx-sub)",
              marginBottom: 24,
              maxWidth: 420,
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            An unexpected error occurred. Press the button below to reload the app.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 28px",
              background: "var(--pos-danger-strong)",
              color: "var(--pos-surface)",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            Reload App
          </button>
          {this.state.error && (
            <details
              style={{
                marginTop: 28,
                fontSize: 12,
                color: "var(--pos-tx-muted)",
                maxWidth: 600,
                width: "100%",
              }}
            >
              <summary style={{ cursor: "pointer", marginBottom: 6 }}>Error details</summary>
              <pre
                style={{
                  background: "var(--pos-surface-hover)",
                  border: "1px solid var(--pos-line)",
                  borderRadius: 6,
                  padding: 12,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {this.state.error.message}
                {"\n\n"}
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
