import type { AttendanceStatus } from "../../../shared/pos";
import type { AttendanceDoc, StaffDoc } from "../../../app/db/posRepository";
import { filterStaffBySearch } from "../People/peopleUtils";

export type HistoryPeriod = "week" | "month" | "custom";

export type HistoryDayCell = {
  status: AttendanceStatus | null;
  isLate?: boolean;
};

export type HistoryTotals = {
  present: number;
  absent: number;
  leave: number;
  halfDay: number;
  holiday: number;
  late: number;
  overtimeMinutes: number;
};

export type HistoryMatrixRow = {
  staffId: string;
  employee: string;
  role: string;
  cells: Record<string, HistoryDayCell | null>;
  totals: HistoryTotals;
};

export type HistoryMatrix = {
  days: string[];
  rows: HistoryMatrixRow[];
  summary: HistoryTotals;
};

function padDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return new Date(year, month - 1, day);
}

export function enumerateDays(fromDate: string, toDate: string) {
  const days: string[] = [];
  const cursor = parseDateOnly(fromDate);
  const end = parseDateOnly(toDate);
  while (cursor <= end) {
    days.push(padDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function monthRange(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { fromDate: from, toDate: to, days: enumerateDays(from, to) };
}

export function shiftMonth(year: number, month: number, delta: number) {
  const date = new Date(year, month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function weekRange(anchorDate: string) {
  const anchor = parseDateOnly(anchorDate);
  const day = anchor.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fromDate = padDateOnly(monday);
  const toDate = padDateOnly(sunday);
  return { fromDate, toDate, days: enumerateDays(fromDate, toDate) };
}

export function shiftWeek(anchorDate: string, deltaWeeks: number) {
  const anchor = parseDateOnly(anchorDate);
  anchor.setDate(anchor.getDate() + deltaWeeks * 7);
  return padDateOnly(anchor);
}

export function formatMonthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export function formatWeekLabel(fromDate: string, toDate: string) {
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  const fromText = from.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const toText = to.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: from.getFullYear() === to.getFullYear() ? undefined : "numeric",
  });
  return `${fromText} – ${toText}`;
}

export function formatDayHeader(dateOnly: string, period: HistoryPeriod) {
  const date = parseDateOnly(dateOnly);
  if (period === "week") {
    return date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });
  }
  return String(date.getDate());
}

export function statusCode(cell: HistoryDayCell | null | undefined) {
  if (!cell?.status) {
    return "—";
  }
  if (cell.status === "present") {
    return cell.isLate ? "P*" : "P";
  }
  if (cell.status === "absent") {
    return "A";
  }
  if (cell.status === "half-day") {
    return cell.isLate ? "H*" : "H";
  }
  if (cell.status === "leave") {
    return "L";
  }
  if (cell.status === "holiday") {
    return "Ho";
  }
  return "—";
}

export function statusCellTitle(cell: HistoryDayCell | null | undefined) {
  if (!cell?.status) {
    return "Not recorded";
  }
  if (cell.status === "present") {
    return cell.isLate ? "Present (late)" : "Present";
  }
  if (cell.status === "absent") {
    return "Absent";
  }
  if (cell.status === "half-day") {
    return cell.isLate ? "Half Day (late)" : "Half Day";
  }
  if (cell.status === "leave") {
    return "Leave";
  }
  if (cell.status === "holiday") {
    return "Holiday";
  }
  return "Not recorded";
}

function emptyTotals(): HistoryTotals {
  return {
    present: 0,
    absent: 0,
    leave: 0,
    halfDay: 0,
    holiday: 0,
    late: 0,
    overtimeMinutes: 0,
  };
}

function addStatusToTotals(
  totals: HistoryTotals,
  status: AttendanceStatus,
  isLate: boolean,
  overtimeMinutes: number,
) {
  if (status === "present") {
    totals.present += 1;
    if (isLate) {
      totals.late += 1;
    }
  } else if (status === "absent") {
    totals.absent += 1;
  } else if (status === "leave") {
    totals.leave += 1;
  } else if (status === "half-day") {
    totals.halfDay += 1;
    if (isLate) {
      totals.late += 1;
    }
  } else if (status === "holiday") {
    totals.holiday += 1;
  }
  totals.overtimeMinutes += Math.max(0, Number(overtimeMinutes || 0));
}

function pickRecordForDay(records: AttendanceDoc[]) {
  if (records.length === 0) {
    return null;
  }
  if (records.length === 1) {
    return records[0];
  }
  const priority: AttendanceStatus[] = ["present", "half-day", "leave", "holiday", "absent"];
  return [...records].sort((left, right) => {
    const leftIndex = priority.indexOf(left.status);
    const rightIndex = priority.indexOf(right.status);
    return leftIndex - rightIndex;
  })[0];
}

export function buildAttendanceMatrix(
  staff: StaffDoc[],
  records: AttendanceDoc[],
  days: string[],
  search: string,
): HistoryMatrix {
  const visibleStaff = filterStaffBySearch(staff, search);
  const byStaffDate = new Map<string, AttendanceDoc[]>();
  records.forEach((record) => {
    const key = `${record.staffId}|${record.attendanceDate}`;
    const bucket = byStaffDate.get(key) || [];
    bucket.push(record);
    byStaffDate.set(key, bucket);
  });

  const summary = emptyTotals();
  const rows = visibleStaff.map((member) => {
    const cells: Record<string, HistoryDayCell | null> = {};
    const totals = emptyTotals();
    days.forEach((day) => {
      const record = pickRecordForDay(byStaffDate.get(`${member.id}|${day}`) || []);
      if (!record) {
        cells[day] = null;
        return;
      }
      const cell: HistoryDayCell = {
        status: record.status,
        isLate: Boolean(record.isLate),
      };
      cells[day] = cell;
      addStatusToTotals(totals, record.status, Boolean(record.isLate), record.overtimeMinutes || 0);
    });
    summary.present += totals.present;
    summary.absent += totals.absent;
    summary.leave += totals.leave;
    summary.halfDay += totals.halfDay;
    summary.holiday += totals.holiday;
    summary.late += totals.late;
    summary.overtimeMinutes += totals.overtimeMinutes;
    return {
      staffId: member.id,
      employee: member.name,
      role: member.designation || "—",
      cells,
      totals,
    };
  });

  return { days, rows, summary };
}

export function formatOtHoursTotal(minutes: number) {
  const hours = Math.max(0, Number(minutes || 0)) / 60;
  if (hours === 0) {
    return "0";
  }
  return hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1);
}
