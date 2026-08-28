import {
  isHolidayDate,
  isWeeklyOffDay,
  normalizeHolidayDates,
  normalizeWeeklyOffDays,
  weeklyOffLabel,
} from "./attendanceSchedule";

describe("attendanceSchedule", () => {
  it("normalizes weekly off days", () => {
    expect(normalizeWeeklyOffDays([0, 6, 6, 99])).toEqual([0, 6]);
    expect(weeklyOffLabel([0, 6])).toContain("Sun");
  });

  it("detects weekly off for a date", () => {
    expect(isWeeklyOffDay([0], "2026-08-30")).toBe(true);
    expect(isWeeklyOffDay([1], "2026-08-30")).toBe(false);
  });

  it("normalizes and detects holidays", () => {
    const holidays = normalizeHolidayDates(["2026-08-15", "bad", "2026-01-26"]);
    expect(holidays).toEqual(["2026-01-26", "2026-08-15"]);
    expect(isHolidayDate(holidays, "2026-08-15")).toBe(true);
  });
});
