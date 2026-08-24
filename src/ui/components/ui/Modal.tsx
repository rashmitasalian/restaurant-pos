import React from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export function Modal({
  open,
  title,
  onClose,
  children,
  large = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  large?: boolean;
}) {
  const ref = useFocusTrap<HTMLDivElement>(open, onClose);
  if (!open) {
    return null;
  }
  return (
    <div className="ui-overlay" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ui-dialog-title"
        tabIndex={-1}
        className={`ui-dialog${large ? " ui-dialog-lg" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 id="ui-dialog-title" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
            {title}
          </h3>
          <button type="button" className="ui-btn ui-btn-ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
