import type { AttendanceDoc } from "../../../app/db/posRepository";
import { statusLabel } from "./attendanceDisplay";
import type { HistoryMatrix } from "./historyUtils";
import { formatOtHoursTotal } from "./historyUtils";

function csvCell(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadTextFile(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportAttendanceHistoryExcel(input: {
  fileName: string;
  scopeLabel: string;
  matrix: HistoryMatrix;
  records: AttendanceDoc[];
  shiftLabel: string;
}) {
  const summaryHeader = ["Employee", "Present", "Absent", "Leave", "OT Hours"];
  const summaryLines = input.matrix.rows.map((row) =>
    [
      row.employee,
      row.totals.present,
      row.totals.absent,
      row.totals.leave,
      formatOtHoursTotal(row.totals.overtimeMinutes),
    ]
      .map(csvCell)
      .join(","),
  );

  const detailHeader = ["Date", "Employee", "Shift", "Status", "OT Hours", "Note"];
  const detailLines = [...input.records]
    .sort((left, right) => {
      const dateCompare = String(left.attendanceDate).localeCompare(String(right.attendanceDate));
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return String(left.staffName).localeCompare(String(right.staffName));
    })
    .map((record) =>
      [
        record.attendanceDate,
        record.staffName,
        record.shiftId || "—",
        statusLabel(record.status),
        formatOtHoursTotal(record.overtimeMinutes),
        record.remarks || "",
      ]
        .map(csvCell)
        .join(","),
    );

  const content = [
    `Scope,${csvCell(input.scopeLabel)}`,
    `Shift,${csvCell(input.shiftLabel)}`,
    `Employees,${input.matrix.rows.length}`,
    "",
    "Summary",
    summaryHeader.join(","),
    ...summaryLines,
    "",
    "Detailed Attendance",
    detailHeader.join(","),
    ...detailLines,
  ].join("\r\n");

  downloadTextFile(input.fileName, content, "text/csv;charset=utf-8;");
}
