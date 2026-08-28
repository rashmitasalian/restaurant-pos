import type { AttendanceStatus } from "../../../../shared/pos";

function badgeClass(status: AttendanceStatus) {
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

function label(status: AttendanceStatus) {
  if (status === "half-day") {
    return "Half Day";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function StatusBadge({ status }: { status: AttendanceStatus }) {
  return <span className={badgeClass(status)}>{label(status)}</span>;
}
