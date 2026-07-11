import { kotSentLinesNeedPrint } from "./kot";

describe("KOT retry state checks", () => {
  it("skips queued KOT lines that are already marked sent", () => {
    expect(
      kotSentLinesNeedPrint(
        { items: [{ id: "line:1", name: "Dosa", qty: 2, rate: 80, kotPrintedQty: 2 }] },
        [{ id: "line:1", sentQty: 2 }],
      ),
    ).toBe(false);
  });

  it("prints queued KOT lines that still need to be marked sent", () => {
    expect(
      kotSentLinesNeedPrint(
        { items: [{ id: "line:1", name: "Dosa", qty: 2, rate: 80, kotPrintedQty: 0 }] },
        [{ id: "line:1", sentQty: 2 }],
      ),
    ).toBe(true);
  });

  it("skips queued KOT lines that were removed before retry", () => {
    expect(kotSentLinesNeedPrint({ items: [] }, [{ id: "line:1", sentQty: 2 }])).toBe(false);
  });
});
