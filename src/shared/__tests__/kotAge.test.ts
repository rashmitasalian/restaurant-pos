import { formatKotAge, kotAgeTone } from "../kotAge";

describe("formatKotAge", () => {
  const t0 = Date.parse("2026-01-01T00:00:00.000Z");

  it("formats minutes, hours and days", () => {
    expect(formatKotAge(t0, t0 + 4 * 60000)).toBe("4m");
    expect(formatKotAge(t0, t0 + 90 * 60000)).toBe("1h 30m");
    expect(formatKotAge(t0, t0 + 26 * 3600000)).toBe("1d 2h");
  });

  it("maps age to semantic tone", () => {
    expect(kotAgeTone(t0, t0 + 2 * 60000)).toBe("neutral");
    expect(kotAgeTone(t0, t0 + 8 * 60000)).toBe("attention");
    expect(kotAgeTone(t0, t0 + 20 * 60000)).toBe("danger");
  });
});
