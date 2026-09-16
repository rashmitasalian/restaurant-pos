import type { StaffDto } from "../../../shared/pos";
import type { AttendanceShiftConfig } from "../../../app/db/posRepository";

const NON_SHIFT_IDS = new Set(["half-day", "half"]);

export function sanitizeAttendanceShifts(shifts: AttendanceShiftConfig[]): AttendanceShiftConfig[] {
  return shifts.filter(
    (entry) =>
      entry.id &&
      entry.label &&
      !NON_SHIFT_IDS.has(entry.id.toLowerCase()) &&
      Number.isFinite(entry.hours) &&
      entry.hours > 0,
  );
}

export function filterStaffBySearch(staff: StaffDto[], query: string): StaffDto[] {
  const lowered = query.trim().toLowerCase();
  if (!lowered) {
    return staff;
  }
  return staff.filter((member) => {
    const haystack = [
      member.name,
      member.phone,
      member.designation || "",
      member.linkedUsername || "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(lowered);
  });
}

export function staffInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.slice(0, 2) || "ST").toUpperCase();
}

export function formatOvertimeHours(minutes: number): string {
  const total = Math.max(0, Number(minutes || 0));
  if (total === 0) {
    return "—";
  }
  const hours = total / 60;
  return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

export function formatOvertimeInput(minutes: number): string {
  const hours = Math.max(0, Number(minutes || 0)) / 60;
  if (hours === 0) {
    return "";
  }
  return String(Math.round(hours * 10) / 10);
}

export function parseOvertimeHours(value: string): number {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    return 0;
  }
  return Math.trunc(hours * 60);
}
