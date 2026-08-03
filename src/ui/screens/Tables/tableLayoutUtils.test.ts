import { getFloorTileSpan, normalizeLayoutMode } from "./tableLayoutUtils";

describe("tableLayoutUtils", () => {
  it("normalizes layout mode safely", () => {
    expect(normalizeLayoutMode("floor")).toBe("floor");
    expect(normalizeLayoutMode("grid")).toBe("grid");
    expect(normalizeLayoutMode("anything-else")).toBe("grid");
  });

  it("returns deterministic tile spans for floor plan rhythm", () => {
    expect(getFloorTileSpan(0)).toBe(2);
    expect(getFloorTileSpan(1)).toBe(1);
    expect(getFloorTileSpan(3)).toBe(2);
    expect(getFloorTileSpan(8)).toBe(2);
  });
});
