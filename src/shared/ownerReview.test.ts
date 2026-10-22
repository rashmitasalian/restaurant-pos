import {
  REPEATED_CANCELLATION_THRESHOLD,
  buildReviewItems,
  collapseTimelineEvents,
  orderHadKotSent,
  reviewCountForRule,
  reviewHeadline,
  reviewMilestones,
  reviewOrderLabel,
  reviewQueueFact,
  reviewWhatHappened,
  summarizeReviewItems,
  timelineActionLabel,
  timelineEventDetail,
} from "./ownerReview";

function cancelledOrder(overrides: Record<string, unknown> = {}) {
  return {
    _id: "order:1042",
    tableId: 7,
    tableName: "Table 7",
    total: 1850,
    createdAt: 1,
    cancelledAt: 3,
    cancelledBy: "rahul",
    cancellationReason: "Customer changed mind",
    createdBy: "rahul",
    kotStatus: "sent" as const,
    items: [{ kotPrintedQty: 2 }],
    meta: { orderSeq: 1042 },
    kotSentAt: 2,
    ...overrides,
  };
}

describe("owner review rules", () => {
  it("detects kitchen-sent quantity", () => {
    expect(orderHadKotSent({ kotStatus: "pending", items: [{ kotPrintedQty: 0 }] })).toBe(false);
    expect(orderHadKotSent({ kotStatus: "sent", items: [{ kotPrintedQty: 0 }] })).toBe(true);
    expect(orderHadKotSent({ kotStatus: "pending", items: [{ kotPrintedQty: 1 }] })).toBe(true);
  });

  it("labels orders from table and sequence, never a raw id", () => {
    expect(reviewOrderLabel({ _id: "order:abc", meta: { orderSeq: 1042 }, tableName: "FF2" })).toBe(
      "#1042 · FF2",
    );
    expect(reviewOrderLabel({ _id: "order:abc", meta: { orderSeq: 1042 } })).toBe("#1042");
    expect(reviewOrderLabel({ _id: "order:e1a7f05d", tableName: "FF2" })).toBe("FF2");
    expect(reviewOrderLabel({ _id: "order:e1a7f05d" })).toBe("Order");
  });

  it("flags cancellation after KOT and unpaid kitchen tickets", () => {
    const items = buildReviewItems({
      cancelledOrders: [cancelledOrder()],
      voidEvents: [],
      cancelCountsByActor: { rahul: 1 },
    });
    expect(items.map((item) => item.rule)).toEqual(["cancellation_after_kot"]);
    expect(items[0].why).toContain("cancelled after kitchen items");
  });

  it("does not flag an unsent cancellation", () => {
    const items = buildReviewItems({
      cancelledOrders: [
        cancelledOrder({
          kotStatus: "pending",
          items: [{ kotPrintedQty: 0 }],
          kotSentAt: null,
        }),
      ],
      voidEvents: [],
      cancelCountsByActor: { rahul: 1 },
    });
    expect(items).toEqual([]);
  });

  it("flags item voids independently of order status", () => {
    const items = buildReviewItems({
      cancelledOrders: [],
      voidEvents: [
        {
          auditId: "audit:void-1",
          orderId: "order:9",
          timestamp: 50,
          actor: "rahul",
          reason: "Customer changed order",
          itemName: "Paneer Tikka",
          voidQty: 1,
          amount: 250,
          tableId: 4,
          tableName: "Table 4",
        },
      ],
      cancelCountsByActor: {},
    });
    expect(items).toHaveLength(1);
    expect(items[0].rule).toBe("item_void");
    expect(items[0].itemName).toBe("Paneer Tikka");
    expect(items[0].orderLabel).toBe("Table 4");
    expect(items[0].kotSentAt).toBeNull();
    expect(reviewWhatHappened(items[0])).toBe("Paneer Tikka");
    expect(reviewHeadline(items[0], "Captain Rahul")).toBe(
      "Captain Rahul voided Paneer Tikka after KOT was sent.",
    );
    expect(reviewQueueFact(items[0], "Captain Rahul")).toBe(
      "Captain Rahul · Paneer Tikka · Customer changed order",
    );
  });

  it("does not put unsent cancellations in the queue even when the same person cancelled several times", () => {
    const orders = [1, 2, 3].map((n) =>
      cancelledOrder({
        _id: `order:${n}`,
        kotStatus: "pending",
        items: [{ kotPrintedQty: 0 }],
        kotSentAt: null,
        meta: { orderSeq: n },
      }),
    );
    const items = buildReviewItems({
      cancelledOrders: orders,
      voidEvents: [],
      cancelCountsByActor: { rahul: REPEATED_CANCELLATION_THRESHOLD },
    });
    expect(items).toEqual([]);
  });

  it("does not flag repeated cancellations below the threshold", () => {
    const items = buildReviewItems({
      cancelledOrders: [
        cancelledOrder({
          kotStatus: "pending",
          items: [{ kotPrintedQty: 0 }],
          kotSentAt: null,
        }),
      ],
      voidEvents: [],
      cancelCountsByActor: { rahul: REPEATED_CANCELLATION_THRESHOLD - 1 },
    });
    expect(items).toEqual([]);
  });

  it("filters review items by actor", () => {
    const items = buildReviewItems({
      cancelledOrders: [cancelledOrder(), cancelledOrder({ _id: "order:2", cancelledBy: "priya" })],
      voidEvents: [],
      cancelCountsByActor: { rahul: 1, priya: 1 },
      actorFilter: "Rahul",
    });
    expect(items).toHaveLength(1);
    expect(items[0].actor).toBe("rahul");
  });

  it("summarizes rule counts from derived items", () => {
    const items = buildReviewItems({
      cancelledOrders: [cancelledOrder()],
      voidEvents: [
        {
          auditId: "audit:void-1",
          orderId: "order:1042",
          timestamp: 4,
          actor: "rahul",
        },
      ],
      cancelCountsByActor: { rahul: 3 },
    });
    expect(summarizeReviewItems(items)).toEqual({
      needsReview: 2,
      cancellationAfterKot: 1,
      repeatedCancellations: 0,
      itemVoids: 1,
      discountsApplied: 0,
      priceChanges: 0,
    });
    expect(reviewCountForRule(summarizeReviewItems(items), "item_void")).toBe(1);
  });

  it("flags discounts and keeps bill-printed cancels under after KOT when kitchen was sent", () => {
    const billed = cancelledOrder({ billPrintedAt: 2, kotSentAt: 2 });
    const items = buildReviewItems({
      cancelledOrders: [billed],
      voidEvents: [],
      discountEvents: [
        {
          auditId: "audit:disc-1",
          orderId: "order:9",
          timestamp: 40,
          actor: "priya",
          previousDiscountPercent: 0,
          discountPercent: 20,
          amount: 800,
          tableId: 3,
          tableName: "Table 3",
        },
        {
          auditId: "audit:disc-0",
          orderId: "order:9",
          timestamp: 41,
          actor: "priya",
          previousDiscountPercent: 20,
          discountPercent: 0,
          amount: 1000,
        },
      ],
      cancelCountsByActor: { rahul: 1 },
    });
    expect(items.map((item) => item.rule)).toEqual(["discount_applied", "cancellation_after_kot"]);
    expect(items[0].label).toBe("Discount applied");
    expect(reviewQueueFact(items[0], "Captain Priya")).toBe("Captain Priya · 0% → 20%");
    expect(items[1].label).toBe("Cancelled after KOT");
    expect(reviewQueueFact(items[1], "rahul")).toContain("Bill printed");
  });

  it("dedupes discount events to one Needs Review row per order", () => {
    const items = buildReviewItems({
      cancelledOrders: [],
      voidEvents: [],
      discountEvents: [
        {
          auditId: "order-discount:order:1",
          orderId: "order:1",
          timestamp: 10,
          actor: "priya",
          discountPercent: 50,
          amount: 100,
        },
        {
          auditId: "audit:disc-1",
          orderId: "order:1",
          timestamp: 20,
          actor: "admin",
          previousDiscountPercent: 0,
          discountPercent: 50,
          amount: 100,
        },
      ],
      cancelCountsByActor: {},
    });
    expect(items).toHaveLength(1);
    expect(items[0].rule).toBe("discount_applied");
    expect(items[0].actor).toBe("admin");
    expect(items[0].occurredAt).toBe(20);
  });

  it("flags a menu line charged at a different price and drops it when the rate is restored", () => {
    const items = buildReviewItems({
      cancelledOrders: [],
      voidEvents: [],
      rateEvents: [
        {
          auditId: "audit:rate-1",
          orderId: "order:g1",
          lineId: "line:naan",
          timestamp: 10,
          actor: "rahul",
          itemName: "Butter Naan",
          menuPrice: 40,
          chargedRate: 30,
          active: true,
          amount: 30,
          tableName: "G1",
          tableId: 1,
        },
        {
          auditId: "audit:rate-2",
          orderId: "order:g1",
          lineId: "line:naan",
          timestamp: 20,
          actor: "rahul",
          itemName: "Butter Naan",
          menuPrice: 40,
          chargedRate: 40,
          active: false,
          amount: 40,
          tableName: "G1",
        },
        {
          auditId: "audit:rate-3",
          orderId: "order:g2",
          lineId: "line:naan-2",
          timestamp: 15,
          actor: "priya",
          itemName: "Butter Naan",
          menuPrice: 40,
          chargedRate: 40,
          active: true,
          tableName: "G2",
        },
      ],
      cancelCountsByActor: {},
    });
    expect(items).toEqual([]);

    const open = buildReviewItems({
      cancelledOrders: [],
      voidEvents: [],
      rateEvents: [
        {
          auditId: "audit:rate-1",
          orderId: "order:g1",
          lineId: "line:naan",
          timestamp: 10,
          actor: "rahul",
          itemName: "Butter Naan",
          menuPrice: 40,
          chargedRate: 30,
          active: true,
          amount: 30,
          tableName: "G1",
          tableId: 1,
        },
      ],
      cancelCountsByActor: {},
    });
    expect(open).toHaveLength(1);
    expect(open[0].rule).toBe("line_price_changed");
    expect(open[0].orderLabel).toBe("G1");
    expect(reviewWhatHappened(open[0])).toBe("Butter Naan · menu ₹40 · charged ₹30");
    expect(reviewHeadline(open[0], "Rahul")).toBe(
      "Rahul charged Butter Naan at ₹30. The menu price is ₹40.",
    );
    expect(summarizeReviewItems(open).priceChanges).toBe(1);
  });

  it("uses operational timeline labels", () => {
    expect(timelineActionLabel("order.cancelled")).toBe("Order cancelled");
    expect(timelineActionLabel("order.kot.void")).toBe("Item voided");
    expect(timelineActionLabel("order.bill.printed")).toBe("Bill printed");
    expect(timelineActionLabel("order.discount.updated")).toBe("Discount applied");
    expect(timelineActionLabel("order.table.transferred")).toBe("Table transferred");
    expect(
      timelineEventDetail({
        action: "order.table.transferred",
        detail: { fromTableName: "4", toTableName: "9", reason: "Customer requested" },
      }),
    ).toBe("4 → 9 · Customer requested");
  });

  it("collapses repeated item-added events and highlights the void", () => {
    const rows = collapseTimelineEvents(
      [
        {
          timestamp: 1,
          action: "order.created",
          label: "Order created",
          actor: "admin",
          detail: {},
        },
        {
          timestamp: 10,
          action: "item.added",
          label: "Items added",
          actor: "priya",
          detail: { item: { name: "Burger", qty: 1 } },
        },
        {
          timestamp: 11,
          action: "item.added",
          label: "Items added",
          actor: "priya",
          detail: { item: { name: "Fries", qty: 1 } },
        },
        {
          timestamp: 12,
          action: "item.added",
          label: "Items added",
          actor: "priya",
          detail: { item: { name: "Burger", qty: 1 } },
        },
        {
          timestamp: 13,
          action: "order.lines.updated",
          label: "Items changed",
          actor: "priya",
          detail: { lineCount: 3 },
        },
        {
          timestamp: 20,
          action: "order.kot.sent",
          label: "KOT sent",
          actor: "priya",
          detail: {},
        },
        {
          timestamp: 21,
          action: "order.kot.printed",
          label: "KOT printed",
          actor: "priya",
          detail: {},
        },
        {
          timestamp: 30,
          action: "order.kot.void",
          label: "Item voided",
          actor: "priya",
          detail: { name: "Burger", voidQty: 1, reason: "Customer changed order" },
        },
      ],
      { rule: "item_void", occurredAt: 30, itemName: "Burger" },
    );
    expect(rows.map((row) => row.action)).toEqual([
      "order.created",
      "item.added",
      "order.kot.sent",
      "order.kot.void",
    ]);
    expect(timelineEventDetail(rows[1])).toBe("Burger, Fries");
    expect(rows.find((row) => row.action === "order.kot.void")?.highlight).toBe(true);
    expect(timelineEventDetail(rows[3])).toBe("Burger · Customer changed order");
  });

  it("fills KOT sent from the timeline when the void snapshot omitted it", () => {
    expect(
      reviewMilestones(
        {
          rule: "item_void",
          createdAt: 1,
          kotSentAt: null,
          cancelledAt: null,
          occurredAt: 30,
        },
        [{ action: "order.kot.sent", timestamp: 20 }],
      ),
    ).toEqual([
      { label: "Opened", timestamp: 1 },
      { label: "KOT sent", timestamp: 20 },
      { label: "Voided", timestamp: 30 },
    ]);
  });
});
