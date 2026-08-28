import {
  applyTimeWindow,
  buildBusinessDateRange,
  buildPresetDateSpan,
  formatBusinessRangeLabel,
  referenceDayForRange,
  suggestInitialTimeWindow,
  supportsTimeFilter,
  timeFilterHint,
  toInputDate,
} from "../businessDateRange";

describe("businessDateRange", () => {
  const noon = new Date(2026, 7, 28, 12, 0, 0, 0);

  it("builds full-day today with exclusive end at next midnight", () => {
    const range = buildBusinessDateRange({ preset: "today", now: noon });
    expect(range.from).toBe(new Date(2026, 7, 28, 0, 0, 0, 0).getTime());
    expect(range.to).toBe(new Date(2026, 7, 29, 0, 0, 0, 0).getTime());
    expect(formatBusinessRangeLabel(range)).toBe("Today");
  });

  it("builds a timed range on today", () => {
    const range = buildBusinessDateRange({
      preset: "today",
      now: noon,
      timeEnabled: true,
      fromTime: "14:00",
      toTime: "18:00",
    });
    expect(range.from).toBe(new Date(2026, 7, 28, 14, 0, 0, 0).getTime());
    expect(range.to).toBe(new Date(2026, 7, 28, 18, 0, 0, 0).getTime());
    expect(formatBusinessRangeLabel(range)).toContain("Today");
    expect(formatBusinessRangeLabel(range)).toMatch(/2:00 pm/i);
    expect(formatBusinessRangeLabel(range)).toMatch(/6:00 pm/i);
  });

  it("suggests a recent window on today", () => {
    const day = new Date(2026, 7, 28, 18, 15, 0, 0);
    const suggested = suggestInitialTimeWindow(day, day);
    expect(suggested.toTime).toBe("18:15");
    expect(suggested.fromTime).toBe("14:15");
  });

  it("suggests a full day on past dates", () => {
    const past = new Date(2026, 7, 24, 0, 0, 0, 0);
    const now = new Date(2026, 7, 28, 23, 30, 0, 0);
    const suggested = suggestInitialTimeWindow(past, now);
    expect(suggested).toEqual({ fromTime: "00:00", toTime: "23:59" });
  });

  it("ignores time on month presets", () => {
    const range = buildBusinessDateRange({
      preset: "thisMonth",
      now: noon,
      timeEnabled: true,
      fromTime: "14:00",
      toTime: "18:00",
    });
    expect(range.timeEnabled).toBe(false);
    expect(range.from).toBe(new Date(2026, 7, 1, 0, 0, 0, 0).getTime());
    expect(range.to).toBe(new Date(2026, 7, 29, 0, 0, 0, 0).getTime());
    expect(formatBusinessRangeLabel(range)).toBe("This Month");
  });

  it("supports overnight ranges by rolling end into the next day", () => {
    const bounds = applyTimeWindow(new Date(2026, 7, 28, 0, 0, 0, 0), "23:00", "01:00");
    expect(bounds.from).toBe(new Date(2026, 7, 28, 23, 0, 0, 0).getTime());
    expect(bounds.to).toBe(new Date(2026, 7, 29, 1, 0, 0, 0).getTime());
  });

  it("builds custom single-day time windows", () => {
    const range = buildBusinessDateRange({
      preset: "custom",
      now: noon,
      customFromDate: "2026-08-28",
      customToDate: "2026-08-28",
      timeEnabled: true,
      fromTime: "14:00",
      toTime: "18:00",
    });
    expect(toInputDate(range.from)).toBe("2026-08-28");
    expect(range.to).toBe(new Date(2026, 7, 28, 18, 0, 0, 0).getTime());
  });

  it("shows a hint for week and month presets", () => {
    expect(timeFilterHint({ preset: "thisWeek" })).toMatch(/individual dates/i);
    expect(timeFilterHint({ preset: "thisMonth" })).toMatch(/individual dates/i);
  });

  it("disables time for multi-day custom ranges", () => {
    expect(
      supportsTimeFilter({
        preset: "custom",
        customFromDate: "2026-08-01",
        customToDate: "2026-08-28",
      }),
    ).toBe(false);

    const range = buildBusinessDateRange({
      preset: "custom",
      now: noon,
      customFromDate: "2026-08-01",
      customToDate: "2026-08-28",
      timeEnabled: true,
      fromTime: "14:00",
      toTime: "18:00",
    });
    expect(range.timeEnabled).toBe(false);
  });

  it("resolves reference day for presets", () => {
    expect(referenceDayForRange({ preset: "today", now: noon }).getDate()).toBe(28);
    expect(referenceDayForRange({ preset: "yesterday", now: noon }).getDate()).toBe(27);
    expect(
      referenceDayForRange({
        preset: "custom",
        customFromDate: "2026-08-24",
        now: noon,
      }).getDate(),
    ).toBe(24);
  });

  it("uses exclusive end for preset week and month spans", () => {
    const week = buildPresetDateSpan("thisWeek", noon);
    expect(week.fromDate.getTime()).toBe(new Date(2026, 7, 23, 0, 0, 0, 0).getTime());
    expect(week.toDateExclusive.getTime()).toBe(new Date(2026, 7, 29, 0, 0, 0, 0).getTime());
  });
});
