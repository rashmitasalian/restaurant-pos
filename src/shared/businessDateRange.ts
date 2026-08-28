export type BusinessRangePreset = "today" | "yesterday" | "thisWeek" | "thisMonth" | "custom";

export type BusinessDateRange = {
  preset: BusinessRangePreset;
  /** Inclusive lower bound (epoch ms). */
  from: number;
  /** Exclusive upper bound (epoch ms). */
  to: number;
  timeEnabled: boolean;
  /** "HH:mm" in 24h form when timeEnabled. */
  fromTime: string;
  /** "HH:mm" in 24h form when timeEnabled. */
  toTime: string;
  /** IANA timezone; defaults to device timezone until business settings exist. */
  timezone: string;
  /** YYYY-MM-DD for custom preset date pickers. */
  customFromDate: string;
  customToDate: string;
};

export const BUSINESS_RANGE_PRESETS: { key: BusinessRangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "This Week" },
  { key: "thisMonth", label: "This Month" },
  { key: "custom", label: "Custom" },
];

export const BUSINESS_RANGE_SEMANTICS = {
  reports: {
    shortLabel: "Sales (paid)",
    description: "Totals reflect when payment was received.",
  },
  history: {
    shortLabel: "Bills created",
    description: "Orders shown by when the bill was opened.",
  },
} as const;

/** Format a local Date as HH:mm for `<input type="time">`. */
export function formatTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Suggested window when the user first adds a time filter:
 * from 4 hours ago (same day) through the current local time.
 */
export function suggestInitialTimeWindow(now = new Date()): { fromTime: string; toTime: string } {
  const end = new Date(now);
  const start = new Date(now);
  start.setHours(start.getHours() - 4, start.getMinutes(), 0, 0);
  const dayStart = startOfDay(now);
  if (start.getTime() < dayStart.getTime()) {
    start.setTime(dayStart.getTime());
  }
  return {
    fromTime: formatTimeInput(start),
    toTime: formatTimeInput(end),
  };
}

/** Central hook for future business timezone from settings. */
export function resolveBusinessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function toInputDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseTimeValue(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null;
  }
  return { hours, minutes };
}

export function timeToMinutes(value: string): number | null {
  const parsed = parseTimeValue(value);
  if (!parsed) {
    return null;
  }
  return parsed.hours * 60 + parsed.minutes;
}

export function dateFromInput(value: string): Date | null {
  if (!value) {
    return null;
  }
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Time windows only make sense for a single calendar day. */
export function supportsTimeFilter(input: {
  preset: BusinessRangePreset;
  customFromDate?: string;
  customToDate?: string;
}): boolean {
  if (input.preset === "today" || input.preset === "yesterday") {
    return true;
  }
  if (input.preset === "custom") {
    const from = input.customFromDate?.trim();
    const to = input.customToDate?.trim();
    return Boolean(from && to && from === to);
  }
  return false;
}

export function timeFilterHint(input: {
  preset: BusinessRangePreset;
  customFromDate?: string;
  customToDate?: string;
}): string | null {
  if (supportsTimeFilter(input)) {
    return null;
  }
  if (input.preset === "custom") {
    return "Time filter is available for a single day. Set the same From and To date, or choose Today.";
  }
  return "Time filter is available for Today, Yesterday, or a single custom day.";
}

export function buildPresetDateSpan(
  preset: Exclude<BusinessRangePreset, "custom">,
  now = new Date(),
): { fromDate: Date; toDateExclusive: Date } {
  const todayStart = startOfDay(now);

  switch (preset) {
    case "yesterday": {
      const day = addDays(todayStart, -1);
      return { fromDate: day, toDateExclusive: todayStart };
    }
    case "thisWeek": {
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      return { fromDate: weekStart, toDateExclusive: addDays(todayStart, 1) };
    }
    case "thisMonth": {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { fromDate: startOfDay(monthStart), toDateExclusive: addDays(todayStart, 1) };
    }
    case "today":
    default:
      return { fromDate: todayStart, toDateExclusive: addDays(todayStart, 1) };
  }
}

export function applyTimeWindow(
  day: Date,
  fromTime: string,
  toTime: string,
): { from: number; to: number } {
  const fromMinutes = timeToMinutes(fromTime);
  const toMinutes = timeToMinutes(toTime);
  const dayStart = startOfDay(day);

  if (fromMinutes === null || toMinutes === null) {
    return {
      from: dayStart.getTime(),
      to: addDays(dayStart, 1).getTime(),
    };
  }

  const rangeStart = new Date(dayStart);
  rangeStart.setHours(Math.floor(fromMinutes / 60), fromMinutes % 60, 0, 0);

  let rangeEndDay = dayStart;
  if (toMinutes <= fromMinutes) {
    rangeEndDay = addDays(rangeEndDay, 1);
  }
  const rangeEnd = new Date(rangeEndDay);
  rangeEnd.setHours(Math.floor(toMinutes / 60), toMinutes % 60, 0, 0);

  return { from: rangeStart.getTime(), to: rangeEnd.getTime() };
}

export function buildBusinessDateRange(input: {
  preset: BusinessRangePreset;
  timeEnabled?: boolean;
  fromTime?: string;
  toTime?: string;
  customFromDate?: string;
  customToDate?: string;
  now?: Date;
  timezone?: string;
}): BusinessDateRange {
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? resolveBusinessTimezone();
  const fromTime = input.fromTime ?? suggestInitialTimeWindow(now).fromTime;
  const toTime = input.toTime ?? suggestInitialTimeWindow(now).toTime;

  let fromDate: Date;
  let toDateInclusive: Date;
  let customFromDate = input.customFromDate;
  let customToDate = input.customToDate;

  if (input.preset === "custom") {
    const customFrom = dateFromInput(customFromDate ?? toInputDate(now.getTime()));
    const customTo = dateFromInput(customToDate ?? toInputDate(now.getTime()));
    fromDate = customFrom ?? startOfDay(now);
    toDateInclusive = customTo ?? fromDate;
    if (toDateInclusive.getTime() < fromDate.getTime()) {
      toDateInclusive = fromDate;
    }
    customFromDate = toInputDate(fromDate.getTime());
    customToDate = toInputDate(toDateInclusive.getTime());
  } else {
    const span = buildPresetDateSpan(input.preset, now);
    fromDate = span.fromDate;
    toDateInclusive = addDays(span.toDateExclusive, -1);
    customFromDate = toInputDate(fromDate.getTime());
    customToDate = toInputDate(toDateInclusive.getTime());
  }

  const timeAllowed = supportsTimeFilter({
    preset: input.preset,
    customFromDate,
    customToDate,
  });
  const timeEnabled = timeAllowed && Boolean(input.timeEnabled);

  const bounds = timeEnabled
    ? applyTimeWindow(fromDate, fromTime, toTime)
    : {
        from: fromDate.getTime(),
        to: addDays(startOfDay(toDateInclusive), 1).getTime(),
      };

  return {
    preset: input.preset,
    from: bounds.from,
    to: bounds.to,
    timeEnabled,
    fromTime,
    toTime,
    timezone,
    customFromDate,
    customToDate,
  };
}

export function createDefaultBusinessDateRange(now = new Date()): BusinessDateRange {
  return buildBusinessDateRange({ preset: "today", now });
}

export function formatTimeLabel(value: string): string {
  const parsed = parseTimeValue(value);
  if (!parsed) {
    return value;
  }
  const date = new Date();
  date.setHours(parsed.hours, parsed.minutes, 0, 0);
  return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export function formatBusinessRangeLabel(range: BusinessDateRange): string {
  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  let datePart: string;
  switch (range.preset) {
    case "today":
      datePart = "Today";
      break;
    case "yesterday":
      datePart = "Yesterday";
      break;
    case "thisWeek":
      datePart = "This Week";
      break;
    case "thisMonth":
      datePart = "This Month";
      break;
    case "custom": {
      const fromLabel = fmtDate(range.from);
      const toExclusive = new Date(range.to);
      toExclusive.setMilliseconds(toExclusive.getMilliseconds() - 1);
      const toLabel = fmtDate(toExclusive.getTime());
      datePart = fromLabel === toLabel ? fromLabel : `${fromLabel} – ${toLabel}`;
      break;
    }
    default:
      datePart = fmtDate(range.from);
  }

  if (!range.timeEnabled) {
    return datePart;
  }

  return `${datePart}, ${formatTimeLabel(range.fromTime)}–${formatTimeLabel(range.toTime)}`;
}
