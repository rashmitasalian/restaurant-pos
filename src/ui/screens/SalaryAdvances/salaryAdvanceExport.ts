import type { SalaryAdvanceDto } from "../../../shared/pos";
import { writeXlsxFile, type XlsxSheet } from "../../../shared/xlsxWrite";
import type { EmployeeAdvanceSummary } from "./salaryAdvanceUtils";
import { formatMoneyPlain } from "./salaryAdvanceUtils";

export type SalaryAdvanceExportMode = "summary" | "transactions" | "both";

function sanitizeSheetName(name: string) {
  return name.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "Sheet";
}

function formatExportDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function buildSummarySheetRows(input: {
  scopeLabel: string;
  summaries: EmployeeAdvanceSummary[];
}) {
  const totalCount = input.summaries.reduce((sum, row) => sum + row.advanceCount, 0);
  const totalAmount = input.summaries.reduce((sum, row) => sum + row.totalAdvance, 0);

  return [
    ["Scope", input.scopeLabel],
    ["Employees with advances", input.summaries.length],
    ["Total advances", totalCount],
    ["Total amount", totalAmount],
    [],
    [
      "Employee",
      "Designation",
      "Monthly Salary",
      "Advance Count",
      "Total Advance",
      "Salary After Advances",
    ],
    ...input.summaries.map((row) => [
      row.name,
      row.designation || "—",
      row.salary ?? "",
      row.advanceCount,
      row.totalAdvance,
      row.salaryAfterAdvances ?? "",
    ]),
    [],
    ["TOTAL", "", "", totalCount, totalAmount, ""],
  ];
}

export function buildTransactionsSheetRows(input: {
  scopeLabel: string;
  transactions: SalaryAdvanceDto[];
}) {
  const totalAmount = input.transactions.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return [
    ["Scope", input.scopeLabel],
    ["Transactions", input.transactions.length],
    [],
    ["Date", "Employee", "Designation", "Amount", "Note"],
    ...input.transactions.map((row) => [
      formatExportDate(row.advanceDate),
      row.staffName || "—",
      row.staffDesignation || "—",
      Number(row.amount || 0),
      row.note || "—",
    ]),
    [],
    ["Total Advances", "", "", totalAmount, ""],
  ];
}

export function exportSalaryAdvancesExcel(input: {
  fileName: string;
  mode: SalaryAdvanceExportMode;
  scopeLabel: string;
  summaries: EmployeeAdvanceSummary[];
  transactions: SalaryAdvanceDto[];
}) {
  const fileName = input.fileName.replace(/\.csv$/i, ".xlsx");
  const sheets: XlsxSheet[] = [];

  if (input.mode === "summary" || input.mode === "both") {
    sheets.push({
      name: sanitizeSheetName("Summary"),
      rows: buildSummarySheetRows({
        scopeLabel: input.scopeLabel,
        summaries: input.summaries,
      }),
    });
  }

  if (input.mode === "transactions" || input.mode === "both") {
    sheets.push({
      name: sanitizeSheetName("Transactions"),
      rows: buildTransactionsSheetRows({
        scopeLabel: input.scopeLabel,
        transactions: input.transactions,
      }),
    });
  }

  writeXlsxFile(fileName, sheets);
}

export { formatMoneyPlain };
