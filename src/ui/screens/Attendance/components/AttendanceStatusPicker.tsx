import React from "react";
import type { AttendanceStatus } from "../../../../shared/pos";
import styles from "./AttendanceStatusPicker.module.css";

const QUICK_STATUSES: Array<{ value: AttendanceStatus; label: string }> = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "leave", label: "Leave" },
  { value: "late", label: "Late" },
  { value: "week-off", label: "Off" },
];

const MORE_STATUSES: Array<{ value: AttendanceStatus; label: string }> = [
  { value: "half-day", label: "Half Day" },
  { value: "holiday", label: "Holiday" },
];

type AttendanceStatusPickerProps = {
  value: AttendanceStatus;
  employee: string;
  onChange: (status: AttendanceStatus) => void;
  onFocus?: () => void;
  focusRef?: React.Ref<HTMLButtonElement>;
};

export default function AttendanceStatusPicker({
  value,
  employee,
  onChange,
  onFocus,
  focusRef,
}: AttendanceStatusPickerProps) {
  const isQuick = QUICK_STATUSES.some((option) => option.value === value);

  return (
    <div className={styles.root} onFocus={onFocus}>
      <div className={styles.quickRow} role="group" aria-label={`Attendance status for ${employee}`}>
        {QUICK_STATUSES.map((option, index) => (
          <button
            key={option.value}
            ref={index === 0 ? focusRef : undefined}
            type="button"
            className={`${styles.chip} ${value === option.value ? styles.chipActive : ""}`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <select
        className={`pos-select ${styles.moreSelect} ${!isQuick ? styles.moreSelectActive : ""}`}
        value={isQuick ? "" : value}
        aria-label={`Other status for ${employee}`}
        onChange={(event) => {
          const next = event.target.value as AttendanceStatus;
          if (next) {
            onChange(next);
          }
        }}
      >
        <option value="">{isQuick ? "More…" : MORE_STATUSES.find((o) => o.value === value)?.label || "More…"}</option>
        {MORE_STATUSES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
