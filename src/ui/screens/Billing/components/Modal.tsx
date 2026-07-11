import React from "react";
import styles from "../Billing.module.css";

interface ModalProps {
  size?: "small" | "medium" | "large" | "default";
  onClose?: () => void;
  children?: React.ReactNode;
}

export default function Modal({
  size = "default",
  onClose,
  children,
}: ModalProps) {
  const cls =
    size === "small"
      ? styles.modalDialogSmall
      : size === "medium"
      ? styles.modalDialogMedium
      : size === "large"
      ? styles.modalDialogLarge
      : styles.modalDialog;
  return (
    <div className={styles.modalOverlay}>
      <div className={cls}>{children}</div>
    </div>
  );
}
