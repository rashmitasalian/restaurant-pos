import {
  addSeatingAreaDraft,
  buildSeatingAreaId,
  computeTableAreaUpdates,
  computeTableSeatsUpdates,
  moveSeatingAreaByDirection,
  reorderSeatingAreasByDrag,
} from "./seatingAreaUtils";

describe("seatingAreaUtils", () => {
  it("builds stable ids from names", () => {
    expect(buildSeatingAreaId("First Floor")).toBe("area:first-floor");
  });

  it("adds a new area draft", () => {
    const result = addSeatingAreaDraft([], "Rooftop", 1000);
    expect(result.error).toBeUndefined();
    expect(result.areas).toEqual([
      { id: "area:rooftop", name: "Rooftop", order: 1, active: true },
    ]);
  });

  it("blocks duplicate area names", () => {
    const result = addSeatingAreaDraft([{ id: "area:main", name: "Main Dining" }], "Main Dining");
    expect(result.error).toBe("Area already exists");
  });

  it("moves area up/down by direction", () => {
    const areas = [
      { id: "area:ground", name: "Ground" },
      { id: "area:first", name: "First" },
      { id: "area:roof", name: "Roof" },
    ];
    const moved = moveSeatingAreaByDirection(areas, "area:roof", -1);
    expect(moved.map((entry) => entry.id)).toEqual(["area:ground", "area:roof", "area:first"]);
    expect(moved.map((entry) => entry.order)).toEqual([1, 2, 3]);
  });

  it("reorders areas via drag-drop ids", () => {
    const areas = [
      { id: "area:ground", name: "Ground" },
      { id: "area:first", name: "First" },
      { id: "area:roof", name: "Roof" },
    ];
    const moved = reorderSeatingAreasByDrag(areas, "area:first", "area:ground");
    expect(moved.map((entry) => entry.id)).toEqual(["area:first", "area:ground", "area:roof"]);
  });

  it("computes only valid changed table-area assignments", () => {
    const updates = computeTableAreaUpdates(
      [
        { id: 1, areaId: "area:main" },
        { id: 2, areaId: "area:first" },
      ],
      {
        1: "area:first",
        2: "area:first",
        3: "area:main",
      },
      new Set(["area:main", "area:first"]),
    );
    expect(updates).toEqual([{ tableId: 1, areaId: "area:first" }]);
  });

  it("computes only changed seat counts", () => {
    const updates = computeTableSeatsUpdates(
      [
        { id: 1, areaId: "area:main", seats: 4 },
        { id: 2, areaId: "area:main", seats: 6 },
      ],
      {
        1: 4,
        2: 8,
        3: 2,
      },
    );
    expect(updates).toEqual([{ tableId: 2, seats: 8 }]);
  });
});
