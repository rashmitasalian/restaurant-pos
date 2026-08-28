import React from "react";
import { ChevronDown } from "lucide-react";
import styles from "./CellMenu.module.css";

export type CellMenuOption<T extends string> = {
  value: T;
  label: string;
  selected?: boolean;
};

type CellMenuProps<T extends string> = {
  label: React.ReactNode;
  options: CellMenuOption<T>[];
  onSelect: (value: T) => void;
  ariaLabel: string;
  tone?: string;
  align?: "left" | "right";
};

const TONE_CLASS: Record<string, string> = {
  present: styles.tonePresent,
  absent: styles.toneAbsent,
  late: styles.toneLate,
  halfDay: styles.toneHalfDay,
  leave: styles.toneLeave,
  holiday: styles.toneHoliday,
  weekOff: styles.toneWeekOff,
};

export default function CellMenu<T extends string>({
  label,
  options,
  onSelect,
  ariaLabel,
  tone,
  align = "left",
}: CellMenuProps<T>) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${tone ? TONE_CLASS[tone] || "" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className={styles.triggerLabel}>{label}</span>
        <ChevronDown size={14} className={styles.chevron} aria-hidden />
      </button>
      {open ? (
        <div className={`${styles.menu} ${align === "right" ? styles.menuRight : ""}`} role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.selected}
              className={`${styles.option} ${option.selected ? styles.optionSelected : ""}`}
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
            >
              {option.selected ? <span className={styles.check}>✓</span> : <span className={styles.checkSpacer} />}
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
