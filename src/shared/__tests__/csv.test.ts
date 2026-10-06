import { csvCell, restoreSpreadsheetText } from "../csv";

describe("csv cells", () => {
  it("prefixes spreadsheet formulas so they open as text", () => {
    expect(csvCell("=cmd()")).toBe("'=cmd()");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@sum")).toBe("'@sum");
  });

  it("still quotes commas and embedded quotes", () => {
    expect(csvCell('Tea, "special"')).toBe('"Tea, ""special"""');
  });

  it("restores a formula marker without touching a normal apostrophe", () => {
    expect(restoreSpreadsheetText("'=cmd()")).toBe("=cmd()");
    expect(restoreSpreadsheetText("'O'Brien")).toBe("'O'Brien");
  });
});
