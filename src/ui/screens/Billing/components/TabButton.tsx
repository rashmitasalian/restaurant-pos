import React from "react";
import styles from "../Billing.module.css";

interface TabButtonProps {
  keyName?: string;
  label: string;
  count?: number | null;
  active?: boolean;
  onClick?: () => void;
}

export default function TabButton({
  label,
  count = null,
  active = false,
  onClick,
}: TabButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`${styles.tabButton} ${active ? styles.tabActive : ""}`}
    >
      {label}
      {count !== null && count > 0 && (
        <span className={styles.tabCount}>{count}</span>
      )}
    </button>
  );
}
