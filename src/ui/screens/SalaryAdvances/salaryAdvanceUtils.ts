import type { SalaryAdvanceDto } from "../../../shared/pos";
import type { StaffDoc } from "../../../app/db/posRepository";
import { filterStaffBySearch } from "../People/peopleUtils";
import {
  formatMonthLabel,
  formatWeekLabel,
  monthRange,
  type HistoryPeriod,
  weekRange,
} from "../Attendance/historyUtils";
import { todayDateOnly } from "../../../shared/validation";

export type AdvancePeriod = HistoryPeriod;

export type ResolvedAdvanceRange = {
  fromTs: number;
  toTs: number;
  fromDate: string;
  toDate: string;
  scopeLabel: string;
  fileSlug: string;
};

function dateOnlyToStartTs(dateOnly: string) {
  const [year, month, day] = dateOnly.split("-").map((part) => Number(part));
  const d = new Date(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dateOnlyToEndTs(dateOnly: string) {
  const [year, month, day] = dateOnly.split("-").map((part) => Number(part));
  const d = new Date(year, month - 1, day);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function defaultMonthAnchor() {
  const today = todayDateOnly();
  const [year, month] = today.split("-").map((part) => Number(part));
  return { year, month };
}

export function resolveAdvanceRange(input: {
  period: AdvancePeriod;
  monthAnchor: { year: number; month: number };
  weekAnchor: string;
  customFrom: string;
  customTo: string;
}): ResolvedAdvanceRange {
  let fromDate: string;
  let toDate: string;
  let scopeLabel: string;
  let fileSlug: string;

  if (input.period === "week") {
    const range = weekRange(input.weekAnchor);
    fromDate = range.fromDate;
    toDate = range.toDate;
    scopeLabel = formatWeekLabel(fromDate, toDate);
    fileSlug = `${fromDate}_to_${toDate}`;
  } else if (input.period === "custom") {
    fromDate = input.customFrom <= input.customTo ? input.customFrom : input.customTo;
    toDate = input.customFrom <= input.customTo ? input.customTo : input.customFrom;
    scopeLabel = `${fromDate} to ${toDate}`;
    fileSlug = `${fromDate}_to_${toDate}`;
  } else {
    const range = monthRange(input.monthAnchor.year, input.monthAnchor.month);
    fromDate = range.fromDate;
    toDate = range.toDate;
    scopeLabel = formatMonthLabel(input.monthAnchor.year, input.monthAnchor.month);
    fileSlug = scopeLabel.replace(/\s+/g, "_");
  }

  return {
    fromTs: dateOnlyToStartTs(fromDate),
    toTs: dateOnlyToEndTs(toDate),
    fromDate,
    toDate,
    scopeLabel,
    fileSlug,
  };
}

export type EmployeeAdvanceSummary = {
  staffId: string;
  name: string;
  designation: string;
  salary: number | null;
  advanceCount: number;
  totalAdvance: number;
  salaryAfterAdvances: number | null;
};

export function buildEmployeeSummaries(
  advances: SalaryAdvanceDto[],
  staff: StaffDoc[],
  search: string,
  staffFilterId: string | null,
): EmployeeAdvanceSummary[] {
  const byStaff = new Map<string, { count: number; total: number }>();

  for (const row of advances) {
    const entry = byStaff.get(row.staffId) || { count: 0, total: 0 };
    entry.count += 1;
    entry.total += Number(row.amount || 0);
    byStaff.set(row.staffId, entry);
  }

  let members = staff.filter((member) => byStaff.has(member.id));
  if (staffFilterId) {
    members = members.filter((member) => member.id === staffFilterId);
  }
  members = filterStaffBySearch(members, search);

  return members
    .map((member) => {
      const aggregate = byStaff.get(member.id)!;
      const salary = member.salary ?? null;
      return {
        staffId: member.id,
        name: member.name,
        designation: member.designation || "",
        salary,
        advanceCount: aggregate.count,
        totalAdvance: aggregate.total,
        salaryAfterAdvances: salary === null ? null : Math.max(0, salary - aggregate.total),
      };
    })
    .sort((a, b) => b.totalAdvance - a.totalAdvance || a.name.localeCompare(b.name));
}

export function filterAdvanceTransactions(
  advances: SalaryAdvanceDto[],
  staff: StaffDoc[],
  search: string,
  staffFilterId: string | null,
): SalaryAdvanceDto[] {
  let rows = [...advances];
  if (staffFilterId) {
    rows = rows.filter((row) => row.staffId === staffFilterId);
  }
  if (search.trim()) {
    const allowed = new Set(filterStaffBySearch(staff, search).map((member) => member.id));
    rows = rows.filter((row) => allowed.has(row.staffId));
  }
  return rows.sort((a, b) => b.advanceDate - a.advanceDate || b.createdAt - a.createdAt);
}

export function formatExportScope(scopeLabel: string, employeeLabel: string | null) {
  return employeeLabel ? `${scopeLabel} · ${employeeLabel}` : `${scopeLabel} · All Employees`;
}

export function buildExportFileName(scopeSlug: string, employeeSlug?: string | null) {
  const parts = ["Salary_Advances"];
  if (employeeSlug) {
    parts.push(employeeSlug.replace(/\s+/g, "_"));
  }
  parts.push(scopeSlug);
  return `${parts.join("_")}.xlsx`;
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN")}`;
}

export function formatMoneyPlain(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toLocaleString("en-IN");
}
