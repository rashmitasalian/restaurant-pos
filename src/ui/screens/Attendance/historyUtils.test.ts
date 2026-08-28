import {
  buildAttendanceMatrix,
  enumerateDays,
  formatWeekLabel,
  monthRange,
  statusCode,
  statusCellTitle,
  weekRange,
} from "./historyUtils";

describe("historyUtils", () => {
  it("enumerates inclusive date range", () => {
    expect(enumerateDays("2026-08-01", "2026-08-03")).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("builds a month range", () => {
    const range = monthRange(2026, 8);
    expect(range.fromDate).toBe("2026-08-01");
    expect(range.toDate).toBe("2026-08-31");
    expect(range.days).toHaveLength(31);
  });

  it("builds a Monday-Sunday week range", () => {
    const range = weekRange("2026-08-28");
    expect(range.fromDate).toBe("2026-08-24");
    expect(range.toDate).toBe("2026-08-30");
    expect(range.days).toHaveLength(7);
    expect(formatWeekLabel(range.fromDate, range.toDate)).toContain("24 Aug");
  });

  it("maps status codes", () => {
    expect(statusCode("present")).toBe("P");
    expect(statusCode("week-off")).toBe("WO");
    expect(statusCode(null)).toBe("—");
  });

  it("labels empty cells as not recorded", () => {
    expect(statusCellTitle(null)).toBe("Not recorded");
    expect(statusCellTitle("absent")).toBe("Absent");
  });

  it("builds matrix totals from attendance records", () => {
    const staff = [
      { id: "s1", name: "Bhaskar", phone: "1", designation: "Chef" },
      { id: "s2", name: "Rashmita", phone: "2", designation: "Waiter" },
    ] as any[];
    const records = [
      {
        id: "a1",
        staffId: "s1",
        staffName: "Bhaskar",
        attendanceDate: "2026-08-01",
        status: "present",
        overtimeMinutes: 90,
      },
      {
        id: "a2",
        staffId: "s1",
        staffName: "Bhaskar",
        attendanceDate: "2026-08-02",
        status: "absent",
        overtimeMinutes: 0,
      },
      {
        id: "a3",
        staffId: "s2",
        staffName: "Rashmita",
        attendanceDate: "2026-08-01",
        status: "leave",
        overtimeMinutes: 0,
      },
    ] as any[];
    const matrix = buildAttendanceMatrix(staff, records, ["2026-08-01", "2026-08-02"], "");
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows[0].totals.present).toBe(1);
    expect(matrix.rows[0].totals.absent).toBe(1);
    expect(matrix.rows[0].totals.overtimeMinutes).toBe(90);
    expect(matrix.summary.present).toBe(1);
    expect(matrix.summary.leave).toBe(1);
  });
});
