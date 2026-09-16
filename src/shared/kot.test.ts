import { isKotQueueTicket, kotSentLinesNeedPrint, tableKotAppearance } from "./kot";

describe("KOT queue membership", () => {
  it("keeps never-sent orders off the queue", () => {
    expect(
      isKotQueueTicket({
        kotStatus: "pending",
        items: [{ qty: 2, kotPrintedQty: 0 }],
      }),
    ).toBe(false);
  });

  it("includes fully sent and mixed tickets", () => {
    expect(
      isKotQueueTicket({
        kotStatus: "sent",
        items: [{ qty: 2, kotPrintedQty: 2 }],
      }),
    ).toBe(true);
    expect(
      isKotQueueTicket({
        kotStatus: "pending",
        items: [{ qty: 2, kotPrintedQty: 1 }],
      }),
    ).toBe(true);
  });

  it("skips empty open orders", () => {
    expect(isKotQueueTicket({ kotStatus: "pending", items: [] })).toBe(false);
  });
});

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

describe("table KOT occupancy", () => {
  it("marks a free table Available", () => {
    expect(tableKotAppearance({ occupied: false })).toMatchObject({
      state: "available",
      stateLabel: "Available",
      needsKot: false,
    });
  });

  it("marks occupied unsent tables Send KOT", () => {
    expect(
      tableKotAppearance({ occupied: true, unsentCount: 3, sentCount: 2, itemCount: 5 }),
    ).toMatchObject({
      state: "attention",
      stateLabel: "Send KOT",
      needsKot: true,
      metaLabel: "3 to send",
    });
  });

  it("marks occupied tables with no ticket Send KOT", () => {
    expect(
      tableKotAppearance({ occupied: true, unsentCount: 0, sentCount: 0, itemCount: 2 }),
    ).toMatchObject({
      state: "attention",
      stateLabel: "Send KOT",
      metaLabel: "Not sent",
    });
  });

  it("marks fully sent tables as KOT sent", () => {
    expect(
      tableKotAppearance({
        occupied: true,
        unsentCount: 0,
        sentCount: 4,
        itemCount: 4,
        elapsed: "12m",
      }),
    ).toMatchObject({
      state: "occupied",
      stateLabel: "KOT sent",
      metaLabel: "4 items · 12m",
      elapsed: "12m",
    });
  });

  it("keeps bill-ready as Pending after KOT is sent", () => {
    expect(
      tableKotAppearance({
        occupied: true,
        unsentCount: 0,
        sentCount: 2,
        billPending: true,
        itemCount: 2,
      }),
    ).toMatchObject({
      state: "attention",
      stateLabel: "Pending",
      needsKot: false,
    });
  });

  it("lets unsent KOT win over bill-ready", () => {
    expect(
      tableKotAppearance({
        occupied: true,
        unsentCount: 1,
        sentCount: 2,
        billPending: true,
      }),
    ).toMatchObject({
      stateLabel: "Send KOT",
      needsKot: true,
    });
  });
});
