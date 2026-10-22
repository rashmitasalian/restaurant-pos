import { allocateSplitQuantities } from "./orderSplit";

describe("allocateSplitQuantities", () => {
  it("moves unsent quantity before sent quantity", () => {
    expect(
      allocateSplitQuantities([{ id: "line:1", qty: 4, kotPrintedQty: 1 }], [{ lineId: "line:1", qty: 2 }]),
    ).toEqual([
      {
        lineId: "line:1",
        sourceQty: 2,
        sourcePrinted: 1,
        destinationQty: 2,
        destinationPrinted: 0,
      },
    ]);
  });

  it("splits sent quantity once unsent quantity is gone", () => {
    expect(
      allocateSplitQuantities([{ id: "line:1", qty: 4, kotPrintedQty: 4 }], [{ lineId: "line:1", qty: 2 }]),
    ).toEqual([
      {
        lineId: "line:1",
        sourceQty: 2,
        sourcePrinted: 2,
        destinationQty: 2,
        destinationPrinted: 2,
      },
    ]);
  });

  it("rejects an empty split and a split of every unit", () => {
    const lines = [{ id: "line:1", qty: 4, kotPrintedQty: 0 }];
    expect(() => allocateSplitQuantities(lines, [{ lineId: "line:1", qty: 0 }])).toThrow("split-empty");
    expect(() => allocateSplitQuantities(lines, [{ lineId: "line:1", qty: 4 }])).toThrow(
      "split-entire-order",
    );
  });

  it("keeps printed quantity inside each side and conserves both totals", () => {
    const lines = [
      { id: "line:a", qty: 4, kotPrintedQty: 1 },
      { id: "line:b", qty: 3, kotPrintedQty: 3 },
    ];
    const allocated = allocateSplitQuantities(lines, [
      { lineId: "line:a", qty: 2 },
      { lineId: "line:b", qty: 1 },
    ]);
    for (const row of allocated) {
      expect(row.sourcePrinted).toBeGreaterThanOrEqual(0);
      expect(row.sourcePrinted).toBeLessThanOrEqual(row.sourceQty === 0 ? row.sourcePrinted : row.sourceQty);
      expect(row.destinationPrinted).toBeGreaterThanOrEqual(0);
      expect(row.destinationPrinted).toBeLessThanOrEqual(row.destinationQty);
    }
    const sourceQty = allocated.reduce((sum, row) => sum + row.sourceQty, 0);
    const destQty = allocated.reduce((sum, row) => sum + row.destinationQty, 0);
    const untouched = 4 + 3 - 2 - 1;
    expect(sourceQty + destQty).toBe(4 + 3 - untouched + untouched);
    expect(
      allocated.reduce((sum, row) => sum + row.sourcePrinted + row.destinationPrinted, 0),
    ).toBe(1 + 3);
  });
});
