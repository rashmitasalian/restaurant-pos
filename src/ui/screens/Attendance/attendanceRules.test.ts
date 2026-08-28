import {
  canMarkLate,
  canRecordOvertime,
  canSetShift,
  isWorkingAttendanceStatus,
} from "./attendanceRules";

describe("attendanceRules", () => {
  it("treats present and half-day as working statuses", () => {
    expect(isWorkingAttendanceStatus("present")).toBe(true);
    expect(isWorkingAttendanceStatus("half-day")).toBe(true);
    expect(isWorkingAttendanceStatus("absent")).toBe(false);
    expect(isWorkingAttendanceStatus("leave")).toBe(false);
    expect(isWorkingAttendanceStatus("holiday")).toBe(false);
    expect(isWorkingAttendanceStatus(null)).toBe(false);
  });

  it("allows ot, late, and shift only for working statuses", () => {
    expect(canRecordOvertime("present")).toBe(true);
    expect(canMarkLate("half-day")).toBe(true);
    expect(canSetShift("present")).toBe(true);
    expect(canRecordOvertime("absent")).toBe(false);
    expect(canMarkLate("leave")).toBe(false);
    expect(canSetShift("holiday")).toBe(false);
  });
});
