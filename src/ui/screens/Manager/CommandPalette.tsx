import React from "react";
import { createPortal } from "react-dom";
import { Input } from "../../components/ui/Input";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { ManagerSection } from "./managerSections";
import { MANAGER_SECTION_HASH } from "./managerSections";
import styles from "./CommandPalette.module.css";

export type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  section?: ManagerSection;
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
};

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const dialogRef = useFocusTrap<HTMLDivElement>(open, onClose);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 12);
    return items
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.hint || "").toLowerCase().includes(q) ||
          (item.section || "").includes(q),
      )
      .slice(0, 12);
  }, [items, query]);

  React.useEffect(() => {
    setHighlight(0);
  }, [query]);

  if (!open) return null;

  const run = (item: CommandItem) => {
    onClose();
    item.run();
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className={`ui-dialog ${styles.panel}`}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(filtered.length - 1, h + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(0, h - 1));
          } else if (e.key === "Enter" && filtered[highlight]) {
            e.preventDefault();
            run(filtered[highlight]);
          }
        }}
      >
        <Input
          label="Jump to"
          labelHidden
          placeholder="Go to section or action…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <ul className={styles.list} role="listbox">
          {filtered.length === 0 ? (
            <li className={styles.empty}>No matches</li>
          ) : (
            filtered.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  className={`${styles.item} ${index === highlight ? styles.itemActive : ""}`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => run(item)}
                >
                  <span>{item.label}</span>
                  {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <p className={styles.footer}>Enter to open · Esc to close</p>
      </div>
    </div>,
    document.body,
  );
}

export function buildManageCommands(
  onNavigate: (section: ManagerSection) => void,
): CommandItem[] {
  const go = (section: ManagerSection, label: string, hint?: string): CommandItem => ({
    id: section,
    label,
    hint,
    section,
    run: () => {
      onNavigate(section);
      window.location.hash = MANAGER_SECTION_HASH[section];
    },
  });

  return [
    go("overview", "Overview", "Manage"),
    go("grocery", "Grocery", "Buying lists"),
    go("expenses", "Expenses"),
    go("menu", "Menu"),
    go("people", "People", "Attendance"),
    {
      id: "people-attendance",
      label: "Attendance",
      hint: "People",
      section: "people",
      run: () => {
        onNavigate("people");
        window.location.hash = "#manage-people-attendance";
      },
    },
    {
      id: "people-roster",
      label: "Roster",
      hint: "People",
      section: "people",
      run: () => {
        onNavigate("people");
        window.location.hash = "#manage-people-roster";
      },
    },
    {
      id: "people-advances",
      label: "Salary Advances",
      hint: "People",
      section: "people",
      run: () => {
        onNavigate("people");
        window.location.hash = "#manage-people-advances";
      },
    },
    {
      id: "people-accounts",
      label: "Accounts",
      hint: "People",
      section: "people",
      run: () => {
        onNavigate("people");
        window.location.hash = "#manage-people-accounts";
      },
    },
    go("reports", "Reports"),
    go("history", "History"),
    go("audit", "Audit"),
    go("settings", "Settings"),
  ];
}
