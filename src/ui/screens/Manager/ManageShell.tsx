import React from "react";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import styles from "./ManageShell.module.css";

export type ManageShellWidth = "form" | "operational" | "full";

export type ManageShellTab = {
  id: string;
  label: string;
};

type ManageShellProps = {
  title: string;
  description?: string;
  /** Dominant create/primary control — sits top-right with the title */
  primaryAction?: React.ReactNode;
  tabs?: ManageShellTab[];
  tab?: string;
  onTabChange?: (id: string) => void;
  toolbar?: React.ReactNode;
  width?: ManageShellWidth;
  children: React.ReactNode;
};

/**
 * Manage workspace chrome.
 * Header contract: title (+ description) left · primaryAction right.
 * Tabs / toolbar are optional bands below. Density “View” control was removed —
 * it only nudged table padding and cluttered every section header.
 */
export function ManageShell({
  title,
  description,
  primaryAction,
  tabs,
  tab,
  onTabChange,
  toolbar,
  width = "operational",
  children,
}: ManageShellProps) {
  const widthClass =
    width === "form" ? styles.widthForm : width === "full" ? styles.widthFull : styles.widthOps;

  return (
    <div className={styles.shell}>
      <div className={styles.workspaceHeader}>
        <div className={styles.titleRow}>
          <div className={styles.titleBlock}>
            <h1 className={`pos-ph-title ${styles.title}`}>{title}</h1>
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
          {primaryAction ? <div className={styles.primaryAction}>{primaryAction}</div> : null}
        </div>
        {tabs && tabs.length > 0 && tab && onTabChange ? (
          <div className={styles.tabsRow}>
            <SegmentedControl
              ariaLabel={`${title} sections`}
              options={tabs}
              value={tab}
              onChange={onTabChange}
            />
          </div>
        ) : null}
        {toolbar ? <div className={styles.toolbarRow}>{toolbar}</div> : null}
      </div>
      <div className={styles.scroll}>
        <div className={`${styles.contentInner} ${widthClass}`}>{children}</div>
      </div>
    </div>
  );
}
