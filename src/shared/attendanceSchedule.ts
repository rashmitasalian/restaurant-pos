import { isValidDateOnly, normalizeText } from "./validation";

export const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export function dayOfWeekFromDateOnly(dateOnly: string): number {
  const [year, month, day] = dateOnly.split("-").map((part) => Number(part));
  return new Date(year, month - 1, day).getDay();
}

export function normalizeWeeklyOffDays(value: unknown): number[] {
  if (!Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) {
      try {
        return normalizeWeeklyOffDays(JSON.parse(value));
      } catch {
        return [];
      }
    }
    return [];
  }
  const unique = new Set<number>();
  value.forEach((entry) => {
    const day = Number(entry);
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      unique.add(day);
    }
  });
  return [...unique].sort((left, right) => left - right);
}

export function serializeWeeklyOffDays(days: number[]): string {
  return JSON.stringify(normalizeWeeklyOffDays(days));
}

export function isWeeklyOffDay(
  weeklyOffDays: number[] | null | undefined,
  dateOnly: string,
): boolean {
  if (!weeklyOffDays?.length || !isValidDateOnly(dateOnly)) {
    return false;
  }
  return weeklyOffDays.includes(dayOfWeekFromDateOnly(dateOnly));
}

export function normalizeHolidayDates(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set<string>();
  value.forEach((entry) => {
    const date = normalizeText(entry);
    if (isValidDateOnly(date)) {
      unique.add(date);
    }
  });
  return [...unique].sort();
}

export function isHolidayDate(holidays: string[] | null | undefined, dateOnly: string): boolean {
  if (!holidays?.length || !isValidDateOnly(dateOnly)) {
    return false;
  }
  return holidays.includes(dateOnly);
}

export function weeklyOffLabel(days: number[]): string {
  const normalized = normalizeWeeklyOffDays(days);
  if (normalized.length === 0) {
    return "None";
  }
  return normalized
    .map(
      (day) =>
        WEEKDAY_OPTIONS.find((option) => option.value === day)?.label.slice(0, 3) || String(day),
    )
    .join(", ");
}
