import React from "react";

export type ToastType = "success" | "error" | "info";

export type Toast = {
  id: number;
  message: string;
  type: ToastType;
  /** Optional action button — Toast stays until dismissed when an action is present. */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss after ms. Defaults: success=3000, info=4000, error=6000. */
  duration?: number;
};

type ToastContextType = {
  showToast: (
    message: string,
    type?: ToastType,
    options?: { action?: Toast["action"]; duration?: number },
  ) => void;
};

export const ToastContext = React.createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

let _nextId = 1;

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  info: 4000,
  error: 6000,
};

const COLORS: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: "var(--pos-surface)", border: "var(--pos-success)", icon: "OK" },
  error: { bg: "var(--pos-surface)", border: "var(--pos-danger)", icon: "Err" },
  info: { bg: "var(--pos-surface)", border: "var(--pos-teal)", icon: "Info" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timers = React.useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = React.useCallback((id: number) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = React.useCallback(
    (
      message: string,
      type: ToastType = "info",
      options?: { action?: Toast["action"]; duration?: number },
    ) => {
      const id = _nextId++;
      const duration = options?.duration ?? DEFAULT_DURATION[type];
      const toast: Toast = { id, message, type, action: options?.action, duration };

      setToasts((prev) => [...prev.slice(-4), toast]); // max 5 visible

      // Auto-dismiss — skip if there's an action (user must explicitly close)
      if (!options?.action) {
        timers.current[id] = setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  // Clean up timers on unmount
  React.useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Toast stack — bottom-center, zero layout impact */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          aria-atomic="false"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            zIndex: 99999,
            pointerEvents: "none",
          }}
        >
          {toasts.map((t) => {
            const c = COLORS[t.type];
            return (
              <div
                key={t.id}
                role="alert"
                style={{
                  pointerEvents: "all",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: c.bg,
                  border: `1px solid var(--pos-line)`,
                  borderLeft: `3px solid ${c.border}`,
                  boxShadow: "var(--pos-shadow-overlay)",
                  color: "var(--pos-tx)",
                  fontSize: 13,
                  fontWeight: 600,
                  maxWidth: "min(480px, 90vw)",
                  animation: "toastSlideUp 180ms ease",
                }}
              >
                {/* Type icon */}
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    border: `1.5px solid ${c.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 900,
                    flexShrink: 0,
                    color: c.border,
                  }}
                >
                  {c.icon}
                </span>

                {/* Message */}
                <span style={{ flex: 1 }}>{t.message}</span>

                {/* Optional action button */}
                {t.action && (
                  <button
                    onClick={() => {
                      t.action!.onClick();
                      dismiss(t.id);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: `1px solid ${c.border}`,
                      background: "transparent",
                      color: c.border,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.action.label}
                  </button>
                )}

                {/* Dismiss */}
                <button
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--pos-tx-muted)",
                    fontSize: 18,
                    cursor: "pointer",
                    lineHeight: 1,
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes toastSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
