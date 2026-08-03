import React from "react";
import type { AttendanceStatus } from "../../../../shared/pos";

function badgeClass(status: AttendanceStatus) {
  if (status === "present") {
    return "pos-badge pos-badge-green";
  }
  if (status === "late") {
    return "pos-badge pos-badge-amber";
  }
  if (status === "half-day") {
    return "pos-badge pos-badge-blue";
  }
  if (status === "leave") {
    return "pos-badge pos-badge-cyan";
  }
  if (status === "holiday") {
    return "pos-badge pos-badge-purple";
  }
  if (status === "week-off") {
    return "pos-badge pos-badge-gray";
  }
  return "pos-badge pos-badge-red";
}

function label(status: AttendanceStatus) {
  if (status === "half-day") {
    return "Half Day";
  }
  if (status === "week-off") {
    return "Week Off";
  }
  if (status === "late") {
    return "Late";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function StatusBadge({ status }: { status: AttendanceStatus }) {
  return <span className={badgeClass(status)}>{label(status)}</span>;
}
