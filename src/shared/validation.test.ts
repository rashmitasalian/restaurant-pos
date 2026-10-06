import { logger } from "../app/utils/logger";
import {
  clipAttendanceQueryRange,
  hasLetter,
  isFutureDateOnly,
  isTechnicalErrorMessage,
  isValidIndianMobile,
  isValidPersonName,
  logSanitizedClientError,
  normalizeClientErrorMessage,
  normalizePhone,
  normalizeText,
  todayDateOnly,
  validationMessage,
} from "./validation";

describe("shared validation", () => {
  it("normalizes repeated whitespace", () => {
    expect(normalizeText("  Priya   Sharma  ")).toBe("Priya Sharma");
  });

  it("requires person names to contain at least one letter", () => {
    expect(isValidPersonName("Priya")).toBe(true);
    expect(isValidPersonName("R. K. Singh")).toBe(true);
    expect(isValidPersonName("Walk-in 1")).toBe(true);
    expect(isValidPersonName("12345")).toBe(false);
    expect(isValidPersonName("--")).toBe(false);
  });

  it("supports unicode letters in person names", () => {
    expect(hasLetter("अजय")).toBe(true);
    expect(isValidPersonName("李 小龙")).toBe(true);
  });

  it("maps person-name validation messages", () => {
    expect(validationMessage("customer-name-invalid")).toContain("include a letter");
    expect(validationMessage("staff-name-invalid")).toContain("include a letter");
    expect(validationMessage("display-name-invalid")).toContain("include a letter");
  });

  it("hides sqlite and ipc internals from the ui", () => {
    const ipcError =
      "Error invoking remote method 'pos:grocery:purchase-headers:list': SqliteError: ambiguous column name: status";
    expect(validationMessage(ipcError, "Could not load purchases")).toBe(
      "Could not load purchases",
    );
    expect(isTechnicalErrorMessage(normalizeClientErrorMessage(ipcError))).toBe(true);
  });

  it("keeps business error codes and user-facing messages", () => {
    expect(validationMessage("grocery-purchase-not-found")).toContain("Purchase entry");
    expect(validationMessage("forbidden")).toContain("permission");
    expect(validationMessage("Password must be at least 8 characters")).toBe(
      "Password must be at least 8 characters",
    );
  });

  it("normalizes common Indian mobile formats to 10 digits", () => {
    expect(normalizePhone("98765 43210")).toBe("9876543210");
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("09876543210")).toBe("9876543210");
  });

  it("treats today as not future in local timezone", () => {
    expect(isFutureDateOnly(todayDateOnly())).toBe(false);
  });

  it("flags tomorrow as future", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const text = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    expect(isFutureDateOnly(text)).toBe(true);
  });

  it("logs an unknown failure without throwing", () => {
    const logs = (logger as unknown as { logs: Array<{ message: string; context?: { errorMsg?: string } }> })
      .logs;
    logs.length = 0;

    expect(() => logSanitizedClientError("printer-offline", "Bill printed but could not record it")).not.toThrow();
    expect(() => logSanitizedClientError(new Error("disk full"), "Could not save")).not.toThrow();

    expect(logs[0]?.message).toBe("[ui] Bill printed but could not record it");
    expect(logs[0]?.context?.errorMsg).toBe("printer-offline");
    expect(logs[1]?.context?.errorMsg).toBe("disk full");
  });

  it("clips attendance history ranges to today", () => {
    const today = todayDateOnly();
    const clipped = clipAttendanceQueryRange(`${today.slice(0, 8)}01`, `${today.slice(0, 8)}31`);
    expect(clipped.toDate).toBe(today);
    expect(clipped.empty).toBe(false);
  });
});
