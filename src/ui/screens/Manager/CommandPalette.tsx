import React from "react";
import { createPortal } from "react-dom";
import { Input } from "../../components/ui/Input";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { ManagerSection, PeopleTab } from "../../../shared/manageSections";
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
  const backdrop = useBackdropDismiss(onClose);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setHighlight(0);
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return items.slice(0, 12);
    }
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

  if (!open) {
    return null;
  }

  const run = (item: CommandItem) => {
    onClose();
    item.run();
  };

  return createPortal(
    <div className={styles.overlay} role="presentation" {...backdrop}>
      <div
        ref={dialogRef}
        className={`ui-dialog ${styles.panel}`}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        tabIndex={-1}
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
  opts?: {
    allowedManageSections?: ManagerSection[];
    allowedPeopleTabs?: PeopleTab[];
  },
): CommandItem[] {
  const allowedSections = new Set(opts?.allowedManageSections ?? []);
  const allowedPeople = new Set(opts?.allowedPeopleTabs ?? []);
  const canSection = (section: ManagerSection) =>
    !opts?.allowedManageSections || allowedSections.has(section);
  const canPeopleTab = (tab: PeopleTab) => !opts?.allowedPeopleTabs || allowedPeople.has(tab);

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
    ...(canSection("people")
      ? [
          go("people", "People", "Attendance"),
          ...(canPeopleTab("attendance")
            ? [
                {
                  id: "people-attendance",
                  label: "Attendance",
                  hint: "People",
                  section: "people" as ManagerSection,
                  run: () => {
                    onNavigate("people");
                    window.location.hash = "#manage-people-attendance";
                  },
                },
              ]
            : []),
          ...(canPeopleTab("roster")
            ? [
                {
                  id: "people-roster",
                  label: "Roster",
                  hint: "People",
                  section: "people" as ManagerSection,
                  run: () => {
                    onNavigate("people");
                    window.location.hash = "#manage-people-roster";
                  },
                },
              ]
            : []),
          ...(canPeopleTab("advances")
            ? [
                {
                  id: "people-advances",
                  label: "Salary Advances",
                  hint: "People",
                  section: "people" as ManagerSection,
                  run: () => {
                    onNavigate("people");
                    window.location.hash = "#manage-people-advances";
                  },
                },
              ]
            : []),
          ...(canPeopleTab("accounts")
            ? [
                {
                  id: "people-accounts",
                  label: "Accounts",
                  hint: "People",
                  section: "people" as ManagerSection,
                  run: () => {
                    onNavigate("people");
                    window.location.hash = "#manage-people-accounts";
                  },
                },
              ]
            : []),
        ]
      : []),
    go("reports", "Reports"),
    go("history", "History"),
    go("review", "Owner Review", "Needs Review"),
    go("audit", "Audit"),
    go("settings", "Settings"),
  ].filter((item) => {
    if (item.section && item.section !== "people") {
      return canSection(item.section);
    }
    if (item.id.startsWith("people-")) {
      return true;
    }
    return true;
  });
}
