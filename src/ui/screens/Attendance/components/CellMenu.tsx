import React from "react";
import { Check, ChevronDown } from "lucide-react";
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
  disabled?: boolean;
  disabledTitle?: string;
};

const TONE_CLASS: Record<string, string> = {
  present: menuStyles.tonePresent,
  absent: menuStyles.toneAbsent,
  halfDay: menuStyles.toneHalfDay,
  leave: menuStyles.toneLeave,
  holiday: menuStyles.toneHoliday,
  empty: menuStyles.toneEmpty,
};

export default function CellMenu<T extends string>({
  label,
  options,
  onSelect,
  ariaLabel,
  tone,
  align = "left",
  disabled = false,
  disabledTitle,
}: CellMenuProps<T>) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  if (disabled) {
    return (
      <div className={menuStyles.root}>
        <span className={menuStyles.disabledLabel} title={disabledTitle}>
          {label}
        </span>
      </div>
    );
  }

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
                <Check size={14} className="ui-menu-check" aria-hidden />
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
