import React from "react";
import type { LucideIcon } from "lucide-react";
import styles from "../Billing.module.css";
import { Icon } from "../../../components/ui/Icon";

interface TabButtonProps {
  keyName?: string;
  label: string;
  count?: number | null;
  active?: boolean;
  onClick?: () => void;
  icon?: LucideIcon;
}

export default function TabButton({
  label,
  count = null,
  active = false,
  onClick,
  icon,
}: TabButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`${styles.tabButton} ${active ? styles.tabActive : ""}`}
    >
      {icon ? <Icon icon={icon} size="sm" /> : null}
      {label}
      {count !== null && count > 0 && <span className={styles.tabCount}>{count}</span>}
    </button>
  );
}
