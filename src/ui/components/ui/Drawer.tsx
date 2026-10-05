import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import styles from "./Drawer.module.css";
import { Icon } from "./Icon";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";
import { useFocusTrap } from "../../hooks/useFocusTrap";

type DrawerProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  /** Close when the pointer is pressed and released on the dimmed page. */
  closeOnBackdrop?: boolean;
};

export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  closeOnBackdrop = true,
}: DrawerProps) {
  const panelRef = useFocusTrap<HTMLElement>(open, onClose);
  const backdrop = useBackdropDismiss(onClose, closeOnBackdrop);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className={styles.overlay} role="presentation" {...backdrop}>
      <aside
        ref={panelRef}
        className={`${styles.panel} ${wide ? styles.wide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <Icon icon={X} size="md" />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  );
}
