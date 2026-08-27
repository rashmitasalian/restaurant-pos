import React from "react";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useManageDensity, type ManageDensity } from "./ManageDensity";
import styles from "./ManageShell.module.css";

export type ManageShellWidth = "form" | "operational" | "full";

export type ManageShellTab = {
  id: string;
  label: string;
};

type ManageShellProps = {
  title: string;
  description?: string;
  primaryAction?: React.ReactNode;
  tabs?: ManageShellTab[];
  tab?: string;
  onTabChange?: (id: string) => void;
  toolbar?: React.ReactNode;
  width?: ManageShellWidth;
  showViewMenu?: boolean;
  children: React.ReactNode;
};

function ViewMenu() {
  const { density, setDensity } = useManageDensity();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (next: ManageDensity) => {
    setDensity(next);
    setOpen(false);
  };

  return (
    <div className={styles.viewMenu} ref={ref}>
      <button
        type="button"
        className={styles.viewBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        View
      </button>
      {open ? (
        <div className={styles.viewDropdown} role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={density === "comfortable"}
            className={styles.viewOption}
            onClick={() => pick("comfortable")}
          >
            {density === "comfortable" ? "● " : "○ "}Comfortable
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={density === "compact"}
            className={styles.viewOption}
            onClick={() => pick("compact")}
          >
            {density === "compact" ? "● " : "○ "}Compact
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ManageShell({
  title,
  description,
  primaryAction,
  tabs,
  tab,
  onTabChange,
  toolbar,
  width = "operational",
  showViewMenu = true,
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
          <div className={styles.primaryAction}>
            {primaryAction}
            {showViewMenu ? <ViewMenu /> : null}
          </div>
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
