import React from "react";
import { ChevronDown } from "lucide-react";
import { PortalMenu } from "../../../components/ui/PortalMenu";
import menuStyles from "./CellMenu.module.css";

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
  present: menuStyles.tonePresent,
  absent: menuStyles.toneAbsent,
  late: menuStyles.toneLate,
  halfDay: menuStyles.toneHalfDay,
  leave: menuStyles.toneLeave,
  holiday: menuStyles.toneHoliday,
  weekOff: menuStyles.toneWeekOff,
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
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  return (
    <div className={menuStyles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={`${menuStyles.trigger} ${tone ? TONE_CLASS[tone] || "" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className={menuStyles.triggerLabel}>{label}</span>
        <ChevronDown size={14} className={menuStyles.chevron} aria-hidden />
      </button>
      <PortalMenu
        open={open}
        anchorRef={triggerRef}
        align={align}
        onClose={() => setOpen(false)}
      >
        <div role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.selected}
              className={`ui-menu-item ${option.selected ? "ui-menu-item-selected" : ""}`}
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
            >
              {option.selected ? (
                <span className="ui-menu-check">✓</span>
              ) : (
                <span className="ui-menu-checkSpacer" />
              )}
              {option.label}
            </button>
          ))}
        </div>
      </PortalMenu>
    </div>
  );
}
