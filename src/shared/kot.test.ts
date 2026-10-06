import { isKotQueueTicket, kotSentLinesNeedPrint, netKitchenDelta, settleKitchenOverlap, tableKotAppearance } from "./kot";

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

  it("keeps a cancellation on the queue until the kitchen ticket is sent", () => {
    expect(
      isKotQueueTicket({
        kotStatus: "pending",
        items: [],
        meta: {
          pendingKotVoids: [{ id: "void:1", lineId: "line:1", name: "Dosa", qty: 1, reason: "Guest cancelled" }],
        },
      }),
    ).toBe(true);
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

  it("reprints a void-only ticket while the cancel is still waiting", () => {
    expect(
      kotSentLinesNeedPrint(
        {
          items: [],
          meta: {
            pendingKotVoids: [{ id: "void-1", lineId: "line:1", name: "Dosa", qty: 1, reason: "No" }],
          },
        },
        [],
        ["void-1"],
      ),
    ).toBe(true);
  });

  it("skips a void-only retry after those cancels were already cleared", () => {
    expect(kotSentLinesNeedPrint({ items: [], meta: {} }, [], ["void-1"])).toBe(false);
  });
});

describe("kitchen delta", () => {
  it("stops the old size, makes the new size, and leaves untouched dishes off the slip", () => {
    const delta = netKitchenDelta(
      [
        { id: "v1", lineId: "line:half", name: "Paneer Tikka (Half)", qty: 1, reason: "Variant changed" },
        { id: "v2", lineId: "line:naan", name: "Butter Naan", qty: 2, reason: "Not needed" },
      ],
      [{ id: "line:full", name: "Paneer Tikka (Full)", qty: 1, sentQty: 1 }],
    );

    expect(delta.stop).toEqual([
      { name: "Paneer Tikka (Half)", qty: 1 },
      { name: "Butter Naan", qty: 2 },
    ]);
    expect(delta.make).toEqual([
      { id: "line:full", name: "Paneer Tikka (Full)", qty: 1, sentQty: 1, note: null },
    ]);
  });

  it("does not stop and make the same dish", () => {
    const delta = netKitchenDelta(
      [
        { id: "v-half", lineId: "a", name: "Paneer Tikka (Half)", qty: 1, reason: "Variant changed" },
        { id: "v-full", lineId: "b", name: "Paneer Tikka (Full)", qty: 1, reason: "Variant changed" },
      ],
      [{ id: "line:full", name: "Paneer Tikka (Full)", qty: 1, sentQty: 1 }],
    );

    expect(delta.stop.map((row) => row.name)).toEqual(["Paneer Tikka (Half)"]);
    expect(delta.make).toEqual([]);
    expect(delta.sentLines).toEqual([{ id: "line:full", sentQty: 1 }]);
    expect(delta.clearVoidIds).toEqual(["v-half", "v-full"]);
  });

  it("changing full to half stops the full and makes the half", () => {
    const delta = netKitchenDelta(
      [
        { id: "v-naan", lineId: "naan", name: "Butter Naan", qty: 2, reason: "Not needed" },
        { id: "v-full", lineId: "full", name: "Paneer Tikka (Full)", qty: 1, reason: "Variant changed" },
        { id: "v-half", lineId: "half", name: "Paneer Tikka (Half)", qty: 1, reason: "Variant changed" },
      ],
      [
        { id: "line:half", name: "Paneer Tikka (Half)", qty: 1, kotPrintedQty: 1 },
        { id: "line:pizza", name: "Pizza", qty: 1, kotPrintedQty: 0 },
      ],
    );

    expect(delta.stop).toEqual([
      { name: "Butter Naan", qty: 2 },
      { name: "Paneer Tikka (Full)", qty: 1 },
    ]);
    expect(delta.make.map((line) => ({ name: line.name, qty: line.qty }))).toEqual([
      { name: "Paneer Tikka (Half)", qty: 1 },
      { name: "Pizza", qty: 1 },
    ]);
  });

  it("drops a stop when the same dish is added back before the kitchen is told", () => {
    const settled = settleKitchenOverlap(
      [{ name: "Paneer Tikka (Half)", qty: 1, kotPrintedQty: 0 }],
      [{ id: "v1", lineId: "a", name: "Paneer Tikka (Half)", qty: 1, reason: "Variant changed" }],
    );

    expect(settled.voids).toEqual([]);
    expect(settled.lines[0].kotPrintedQty).toBe(1);
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
