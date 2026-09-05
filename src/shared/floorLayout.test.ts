import {
  buildAreaTableName,
  FLOOR_LAYOUT_LIMITS,
  formatTableLabel,
  formatTableTileLabel,
  inferNamingFromTables,
  normalizeTablePrefix,
  planTablesFromAreas,
  suggestPrefixFromAreaName,
} from "./floorLayout";

describe("floorLayout", () => {
  it("plans prefixed names per area", () => {
    const planned = planTablesFromAreas([
      {
        id: "area:garden",
        name: "Garden",
        order: 1,
        active: true,
        tableCount: 2,
        namingMode: "prefix",
        prefix: "G",
        defaultSeats: 4,
      },
      {
        id: "area:bar",
        name: "Bar",
        order: 2,
        active: true,
        tableCount: 1,
        namingMode: "prefix",
        prefix: "B",
        defaultSeats: 2,
      },
    ]);
    expect(planned.error).toBeUndefined();
    expect(planned.total).toBe(3);
    expect(planned.tables.map((table) => table.name)).toEqual(["G1", "G2", "B1"]);
    expect(planned.tables[2].seats).toBe(2);
  });

  it("plans number-only names per area", () => {
    const planned = planTablesFromAreas([
      {
        id: "area:garden",
        name: "Garden",
        tableCount: 3,
        namingMode: "number",
        prefix: "",
        defaultSeats: 4,
      },
    ]);
    expect(planned.tables.map((table) => table.name)).toEqual(["1", "2", "3"]);
  });

  it("rejects missing prefix when prefix mode has tables", () => {
    const planned = planTablesFromAreas([
      {
        id: "area:garden",
        name: "Garden",
        tableCount: 2,
        namingMode: "prefix",
        prefix: "  ",
        defaultSeats: 4,
      },
    ]);
    expect(planned.error).toMatch(/prefix/i);
  });

  it("normalizes and builds names", () => {
    expect(normalizeTablePrefix("g f!")).toBe("GF");
    expect(buildAreaTableName(3, "prefix", "gf")).toBe("GF3");
    expect(suggestPrefixFromAreaName("Ground Floor")).toBe("GF");
    expect(suggestPrefixFromAreaName("Bar")).toBe("B");
    expect(suggestPrefixFromAreaName("Garden")).toBe("G");
  });

  it("infers naming from existing table names", () => {
    expect(inferNamingFromTables(["1", "2", "10"])).toEqual({
      namingMode: "number",
      prefix: "",
    });
    expect(inferNamingFromTables(["G1", "G2", "G10"])).toEqual({
      namingMode: "prefix",
      prefix: "G",
    });
  });

  it("exposes layout limits", () => {
    expect(FLOOR_LAYOUT_LIMITS.MAX_TOTAL_TABLES).toBeGreaterThanOrEqual(100);
  });

  it("formats table labels from configured names", () => {
    expect(formatTableLabel(3, "G1")).toBe("G1");
    expect(formatTableLabel(5, "Table 5")).toBe("Table 5");
    expect(formatTableLabel(7, "")).toBe("Table 7");
    expect(formatTableLabel(null)).toBe("");
  });

  it("formats compact tile labels for floor grids", () => {
    expect(formatTableTileLabel(1, "FF1")).toBe("FF1");
    expect(formatTableTileLabel(3, "Table 3")).toBe("3");
    expect(formatTableTileLabel(7, "")).toBe("7");
    expect(formatTableTileLabel(null)).toBe("");
  });
});
