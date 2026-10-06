import { formatWrappedColumnRows, wrapFixedWidth } from "./printColumns";

describe("wrapFixedWidth", () => {
  it("keeps a short value on one line and splits only past the column", () => {
    expect(wrapFixedWidth("Tea", 20)).toEqual(["Tea"]);
    expect(wrapFixedWidth("Paneer Butter Masala", 20)).toEqual(["Paneer Butter Masala"]);
    expect(wrapFixedWidth("Paneer Butter Masala Special", 20)).toEqual([
      "Paneer Butter Masala",
      "Special",
    ]);
  });

  it("splits a token that is longer than the column", () => {
    expect(wrapFixedWidth("A".repeat(25), 10)).toEqual(["A".repeat(10), "A".repeat(10), "AAAAA"]);
  });
});

describe("formatWrappedColumnRows", () => {
  it("pads every line to the same width and puts the tail on the first line only", () => {
    const rows = formatWrappedColumnRows("LEFT:", "Alpha Beta Gamma", 6, "  1");
    expect(rows).toEqual(["LEFT:Alpha   1", "LEFT:Beta     ", "LEFT:Gamma    "]);
    expect(new Set(rows.map((row) => row.length))).toEqual(new Set(["LEFT:".length + 6 + 3]));
  });
});
