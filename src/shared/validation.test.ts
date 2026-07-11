import {
  hasLetter,
  isValidIndianMobile,
  isValidPersonName,
  normalizePhone,
  normalizeText,
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

  it("normalizes common Indian mobile formats to 10 digits", () => {
    expect(normalizePhone("98765 43210")).toBe("9876543210");
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("09876543210")).toBe("9876543210");
  });

  it("validates Indian mobile numbers", () => {
    expect(isValidIndianMobile("9876543210")).toBe(true);
    expect(isValidIndianMobile("+91 9876543210")).toBe(true);
    expect(isValidIndianMobile("09876543210")).toBe(true);
    expect(isValidIndianMobile("1234567890")).toBe(false);
    expect(isValidIndianMobile("987654321")).toBe(false);
  });
});
