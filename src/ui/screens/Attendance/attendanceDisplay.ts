import type { AttendanceStatus } from "../../../shared/pos";

export function formatAttendanceDate(dateOnly: string): string {
  const [year, month, day] = dateOnly.split("-").map((part) => Number(part));
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function shiftAttendanceDate(dateOnly: string, deltaDays: number): string {
  const [year, month, day] = dateOnly.split("-").map((part) => Number(part));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + deltaDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function statusLabel(status: AttendanceStatus): string {
  if (status === "half-day") {
    return "Half Day";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function statusTone(status: AttendanceStatus | null): string {
  if (!status) {
    return "empty";
  }
  if (status === "present") {
    return "present";
  }
  if (status === "half-day") {
    return "halfDay";
  }
  if (status === "leave") {
    return "leave";
  }
  if (status === "holiday") {
    return "holiday";
  }
  return "absent";
}

export function attendanceStatusLabel(status: AttendanceStatus | null, isLate = false): string {
  if (!status) {
    return "Not set";
  }
  if (isLate && (status === "present" || status === "half-day")) {
    return `${statusLabel(status)} (late)`;
  }
  return statusLabel(status);
}
