import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { Icon } from "./Icon";

export function Modal({
  open,
  title,
  onClose,
  children,
  large = false,
  front = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  large?: boolean;
  /** Stack above other overlays such as drawers (confirmations opened from them). */
  front?: boolean;
}) {
  const ref = useFocusTrap<HTMLDivElement>(open, onClose);
  if (!open) {
    return null;
  }
  return createPortal(
    <div className={`ui-overlay${front ? " ui-overlay-front" : ""}`} onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ui-dialog-title"
        tabIndex={-1}
        className={`ui-dialog${large ? " ui-dialog-lg" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ui-dialog-header">
          <h3 id="ui-dialog-title" className="ui-dialog-title">
            {title}
          </h3>
          <button type="button" className="ui-dialog-close" onClick={onClose} aria-label="Close">
            <Icon icon={X} size="md" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
