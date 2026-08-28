import type { AttendanceStatus } from "../../../shared/pos";

/** Present or half-day — employee worked (or partially worked). */
export function isWorkingAttendanceStatus(status: AttendanceStatus | null | undefined): boolean {
  return status === "present" || status === "half-day";
}

export function canMarkLate(status: AttendanceStatus | null | undefined): boolean {
  return isWorkingAttendanceStatus(status);
}

export function canRecordOvertime(status: AttendanceStatus | null | undefined): boolean {
  return isWorkingAttendanceStatus(status);
}

export function canSetShift(status: AttendanceStatus | null | undefined): boolean {
  return isWorkingAttendanceStatus(status);
}

export function attendanceFieldHint(field: "late" | "ot" | "shift", status: AttendanceStatus | null): string {
  if (isWorkingAttendanceStatus(status)) {
    return "";
  }
  if (!status) {
    return "Set Present or Half Day first.";
  }
  if (field === "shift") {
    return "Shift applies when employee worked.";
  }
  if (field === "ot") {
    return "Overtime applies to Present or Half Day only.";
  }
  return "Late applies to Present or Half Day only.";
}
