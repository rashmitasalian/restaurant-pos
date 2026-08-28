import {
  filterStaffBySearch,
  formatOvertimeHours,
  parseOvertimeHours,
  sanitizeAttendanceShifts,
  staffInitials,
} from "./peopleUtils";

describe("peopleUtils", () => {
  it("removes half-day from attendance shifts", () => {
    const result = sanitizeAttendanceShifts([
      { id: "morning", label: "Morning", hours: 8 },
      { id: "half-day", label: "Half Day", hours: 4 },
      { id: "evening", label: "Evening", hours: 8 },
    ]);
    expect(result.map((entry) => entry.id)).toEqual(["morning", "evening"]);
  });

  it("filters staff by name and linked account", () => {
    const staff = [
      { id: "1", name: "Rahul", phone: "9876543210", linkedUsername: "rahul" },
      { id: "2", name: "Priya", phone: "9123456789" },
    ] as any[];
    expect(filterStaffBySearch(staff, "rahul")).toHaveLength(1);
    expect(filterStaffBySearch(staff, "9123")).toHaveLength(1);
  });

  it("formats overtime for display", () => {
    expect(formatOvertimeHours(0)).toBe("—");
    expect(formatOvertimeHours(90)).toBe("1.5h");
    expect(formatOvertimeHours(120)).toBe("2h");
  });

  it("parses overtime hours back to minutes", () => {
    expect(parseOvertimeHours("1.5")).toBe(90);
    expect(parseOvertimeHours("")).toBe(0);
  });

  it("derives staff initials", () => {
    expect(staffInitials("Rahul Kumar")).toBe("RK");
    expect(staffInitials("Priya")).toBe("PR");
  });
});
