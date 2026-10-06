import type { HistoryMatrix, HistoryPeriod } from "./historyUtils";
import { writeXlsxFile, type XlsxSheet } from "../../../shared/xlsxWrite";
import { exportStatusCode, formatDayHeader, formatOtHoursTotal } from "./historyUtils";

const SUMMARY_HEADER = [
  "Employee",
  "Present",
  "Absent",
  "Half Day",
  "Leave",
  "Late",
  "OT Hours",
] as const;

function registerTitle(period: HistoryPeriod) {
  if (period === "month") {
    return "Monthly Register";
  }
  if (period === "week") {
    return "Weekly Register";
  }
  return "Attendance Register";
}

function sanitizeSheetName(name: string) {
  return name.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "Sheet";
}

export function buildSummarySheetRows(input: {
  scopeLabel: string;
  shiftLabel: string;
  matrix: HistoryMatrix;
}) {
  const { matrix } = input;
  return [
    ["Scope", input.scopeLabel],
    ["Shift", input.shiftLabel],
    ["Employees", matrix.rows.length],
    [],
    [...SUMMARY_HEADER],
    ...matrix.rows.map((row) => [
      row.employee,
      row.totals.present,
      row.totals.absent,
      row.totals.halfDay,
      row.totals.leave,
      row.totals.late,
      formatOtHoursTotal(row.totals.overtimeMinutes),
    ]),
  ];
}

export function buildRegisterSheetRows(input: {
  scopeLabel: string;
  shiftLabel: string;
  matrix: HistoryMatrix;
  period: HistoryPeriod;
}) {
  const { matrix, period } = input;
  const dayHeaders = matrix.days.map((day) => formatDayHeader(day, period));
  const registerHeader = [
    "Employee",
    ...dayHeaders,
    "Present",
    "Absent",
    "Half Day",
    "Leave",
    "OT Hours",
  ];

  return [
    ["Scope", input.scopeLabel],
    ["Shift", input.shiftLabel],
    [],
    registerHeader,
    ...matrix.rows.map((row) => [
      row.employee,
      ...matrix.days.map((day) => exportStatusCode(row.cells[day])),
      row.totals.present,
      row.totals.absent,
      row.totals.halfDay,
      row.totals.leave,
      formatOtHoursTotal(row.totals.overtimeMinutes),
    ]),
    [],
    ["Legend"],
    ["P=Present P*=Present (late) A=Absent H=Half Day L=Leave Ho=Holiday -=Not recorded"],
  ];
}

export function exportAttendanceHistoryExcel(input: {
  fileName: string;
  scopeLabel: string;
  matrix: HistoryMatrix;
  shiftLabel: string;
  period?: HistoryPeriod;
}) {
  const period = input.period ?? "month";
  const sheets: XlsxSheet[] = [
    {
      name: "Summary",
      rows: buildSummarySheetRows({
        scopeLabel: input.scopeLabel,
        shiftLabel: input.shiftLabel,
        matrix: input.matrix,
      }),
    },
    {
      name: sanitizeSheetName(registerTitle(period)),
      rows: buildRegisterSheetRows({
        scopeLabel: input.scopeLabel,
        shiftLabel: input.shiftLabel,
        matrix: input.matrix,
        period,
      }),
    },
  ];

  const fileName = input.fileName.replace(/\.csv$/i, ".xlsx");
  writeXlsxFile(fileName, sheets);
}
