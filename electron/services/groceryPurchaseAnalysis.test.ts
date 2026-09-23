jest.mock("electron", () => ({
  app: {
    getPath: () => process.env.POS_TEST_USER_DATA_DIR || "",
  },
}));

import fs from "fs";
import os from "os";
import path from "path";
import { closeDb, getDb, initializeDatabase } from "../db/sqlite";
import type { GroceryUnit } from "../../src/shared/pos";
import { posService } from "./posService";

const DAY = 24 * 60 * 60 * 1000;

function midnight(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function noon(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

function paise(rupees: number) {
  return Math.round(rupees * 100);
}

type ItemSpec = {
  itemName: string;
  quantity?: number;
  unit?: GroceryUnit;
  groceryItemId?: string;
  lineTotal?: number | null;
  received?: number;
};

function recordPurchase(opts: {
  items: ItemSpec[];
  total: number;
  date: number;
  vendorName?: string;
  listDate?: number;
}) {
  const list = posService.createGroceryList(
    {
      title: "Buying list",
      listDate: opts.listDate || opts.date,
      lines: opts.items.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity ?? 1,
        unit: item.unit || "kg",
        groceryItemId: item.groceryItemId,
      })),
    },
    null,
  );
  const byName = new Map(list.lines.map((line) => [line.itemName.toLowerCase(), line]));
  const lines = opts.items.flatMap((item) => {
    const row = byName.get(item.itemName.trim().toLowerCase());
    if (!row) {
      throw new Error(`missing list line ${item.itemName}`);
    }
    const entry: { listLineId: string; lineTotal?: number | null; quantity?: number } = {
      listLineId: row.id,
    };
    let include = false;
    if (item.lineTotal !== undefined) {
      entry.lineTotal = item.lineTotal;
      include = true;
    }
    if (item.received !== undefined) {
      entry.quantity = item.received as number;
      include = true;
    }
    return include ? [entry] : [];
  });
  const purchase = posService.createGroceryPurchaseHeader(
    {
      buyingListId: list.id,
      total: opts.total,
      purchaseDate: opts.date,
      vendorName: opts.vendorName,
      coverage: "pending",
      lines: lines.length ? lines : undefined,
    },
    null,
  );
  return { list, purchase };
}

function setCreatedAt(purchaseId: string, createdAt: number) {
  getDb().prepare("UPDATE grocery_purchases SET created_at = ? WHERE id = ?").run(createdAt, purchaseId);
}

function analysis(from: number, to: number) {
  return posService.getGroceryPurchaseAnalysis({ from, to });
}

function assertReconciles(from: number, to: number) {
  const report = analysis(from, to);
  const profit = posService.getProfitabilitySummary({ from, to });
  const itemPaise = report.purchaseRows.reduce((sum, row) => sum + paise(row.purchaseValue), 0);
  expect(itemPaise + paise(report.summary.unallocatedTotal)).toBe(paise(report.summary.purchaseTotal));
  expect(report.summary.purchaseTotal).toBe(profit.foodCost.amount);
  expect(report.summary.purchaseTotal).toBe(profit.foodCost.purchases);
  return report;
}

function insertOrphan(opts: {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  totalPaise: number;
  purchasedAt: number;
  createdAt: number;
  vendor?: string | null;
  groceryItemId?: string | null;
  active?: number;
}) {
  getDb()
    .prepare(
      `INSERT INTO grocery_purchase_lines (
         id, purchase_id, list_id, list_line_id, grocery_item_id, item_name, category,
         quantity, unit, unit_price_paise, total_paise, vendor, vendor_id, payment_method, notes,
         purchased_at, created_by, active, created_at, updated_at
       ) VALUES (?, NULL, NULL, NULL, ?, ?, NULL, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?, ?)`,
    )
    .run(
      opts.id,
      opts.groceryItemId || null,
      opts.itemName,
      opts.quantity,
      opts.unit,
      opts.totalPaise,
      opts.vendor || null,
      opts.purchasedAt,
      opts.active ?? 1,
      opts.createdAt,
      opts.createdAt,
    );
}

describe("grocery purchase analysis", () => {
  let tempDir = "";

  beforeEach(async () => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-grocery-analysis-"));
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = path.join(tempDir, "restaurant-pos.sqlite");
    await initializeDatabase();
  });

  afterEach(() => {
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const from = midnight(2026, 1, 20);
  const to = midnight(2026, 1, 21);
  const onDay = noon(2026, 1, 20);

  it("combines purchases, keeps incompatible units apart, and normalises only g and ml", () => {
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 2, unit: "kg" }], total: 80, date: onDay });
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 3, unit: "kg" }], total: 90, date: onDay });
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 4, unit: "packet" }], total: 40, date: onDay });
    recordPurchase({ items: [{ itemName: "Jeera", quantity: 250, unit: "g" }], total: 20, date: onDay });
    recordPurchase({ items: [{ itemName: "Jeera", quantity: 250, unit: "g" }], total: 20, date: onDay });
    recordPurchase({ items: [{ itemName: "Oil", quantity: 500, unit: "ml" }], total: 50, date: onDay });
    recordPurchase({ items: [{ itemName: "Oil", quantity: 1, unit: "L" }], total: 90, date: onDay });
    recordPurchase({ items: [{ itemName: "Egg", quantity: 2, unit: "dozen" }], total: 120, date: onDay });
    recordPurchase({ items: [{ itemName: "Egg", quantity: 6, unit: "unit" }], total: 30, date: onDay });

    const report = assertReconciles(from, to);
    const tomatoKg = report.purchaseRows.find((row) => row.key === "name:tomato|kg");
    const tomatoPacket = report.purchaseRows.find((row) => row.key === "name:tomato|packet");
    const jeera = report.purchaseRows.find((row) => row.key === "name:jeera|kg");
    const oil = report.purchaseRows.find((row) => row.key === "name:oil|L");
    const eggDozen = report.purchaseRows.find((row) => row.key === "name:egg|dozen");
    const eggUnit = report.purchaseRows.find((row) => row.key === "name:egg|unit");
    expect(tomatoKg).toMatchObject({ purchasedQuantity: 5, purchaseValue: 170, billCount: 2, avgPurchasedPerDay: 5 });
    expect(tomatoPacket).toMatchObject({ purchasedQuantity: 4, unit: "packet" });
    expect(jeera).toMatchObject({ purchasedQuantity: 0.5, unit: "kg", purchaseValue: 40 });
    expect(oil).toMatchObject({ purchasedQuantity: 1.5, unit: "L", purchaseValue: 140 });
    expect(eggDozen?.unit).toBe("dozen");
    expect(eggUnit?.unit).toBe("unit");
    expect(eggDozen?.purchasedQuantity).toBe(2);
    expect(eggUnit?.purchasedQuantity).toBe(6);
  });

  it("identifies catalog items by id and custom items by normalised name only", () => {
    const catalog = posService.createGroceryItem({ name: "Tomato", defaultUnit: "kg" }, null);
    const first = recordPurchase({
      items: [{ itemName: "Tomato", groceryItemId: catalog.id, quantity: 2 }],
      total: 100,
      date: onDay,
    });
    recordPurchase({
      items: [{ itemName: "Tomato", groceryItemId: catalog.id, quantity: 3 }],
      total: 150,
      date: onDay,
    });
    getDb()
      .prepare("UPDATE grocery_purchase_lines SET item_name = ? WHERE purchase_id = ?")
      .run("Old label", first.purchase.id);
    posService.updateGroceryItem(catalog.id, { name: "Ripe Tomato" }, null);
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1 }], total: 10, date: onDay });
    recordPurchase({ items: [{ itemName: "tomato", quantity: 1 }], total: 12, date: onDay });
    recordPurchase({ items: [{ itemName: "Tomatoes", quantity: 1 }], total: 15, date: onDay });

    const report = assertReconciles(from, to);
    const catalogRow = report.purchaseRows.find((row) => row.key === `item:${catalog.id}|kg`);
    expect(catalogRow).toMatchObject({ itemName: "Ripe Tomato", purchasedQuantity: 5, purchaseValue: 250 });
    expect(report.purchaseRows.find((row) => row.key === "name:tomato|kg")).toMatchObject({
      purchasedQuantity: 2,
      purchaseValue: 22,
    });
    expect(report.purchaseRows.find((row) => row.key === "name:tomatoes|kg")?.purchasedQuantity).toBe(1);
    expect(report.purchaseRows.filter((row) => row.itemName.toLowerCase().includes("tomato"))).toHaveLength(3);
  });

  it("uses the equal-length window before the range, including a 15-day custom range", () => {
    const start = midnight(2026, 1, 16);
    const end = start + 15 * DAY;
    const previousStart = start - 15 * DAY;
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 15 }], total: 150, date: start + 12 * 60 * 60 * 1000 });
    recordPurchase({
      items: [{ itemName: "Tomato", quantity: 15 }],
      total: 120,
      date: previousStart + 12 * 60 * 60 * 1000,
    });
    recordPurchase({
      items: [{ itemName: "Tomato", quantity: 9 }],
      total: 90,
      date: previousStart - DAY,
    });

    const report = assertReconciles(start, end);
    expect(report.purchaseRows[0]).toMatchObject({
      purchasedQuantity: 15,
      previousQuantity: 15,
      quantityChangePct: 0,
      avgPurchasedPerDay: 1,
    });
  });

  it("keeps lump-sum money in the bill total and out of item prices", () => {
    recordPurchase({
      items: [
        { itemName: "Tomato", quantity: 2, lineTotal: 500 },
        { itemName: "Onion", quantity: 1, lineTotal: 300 },
        { itemName: "Potato", quantity: 50 },
      ],
      total: 2000,
      date: onDay,
    });
    recordPurchase({
      items: [
        { itemName: "Potato", quantity: 10 },
        { itemName: "Cabbage", quantity: 1 },
      ],
      total: 400,
      date: onDay,
    });

    const report = assertReconciles(from, to);
    expect(report.summary.purchaseTotal).toBe(2400);
    expect(report.summary.unallocatedTotal).toBe(1600);
    expect(report.summary.billCount).toBe(2);
    const potato = report.purchaseRows.find((row) => row.key === "name:potato|kg");
    expect(potato).toMatchObject({ purchasedQuantity: 60, purchaseValue: 0 });
    expect(report.priceRows.find((row) => row.key === "name:potato|kg")).toBeUndefined();
    expect(report.purchaseRows.find((row) => row.key === "name:tomato|kg")?.purchaseValue).toBe(500);
    expect(report.priceRows.find((row) => row.key === "name:tomato|kg")?.latest.unitPrice).toBe(250);
    expect(report.itemDetails["name:potato|kg"].avgRecordedPrice).toBeNull();
    expect(report.itemDetails["name:potato|kg"].recentPurchases[0].unitPrice).toBeNull();
  });

  it("never reports a negative unallocated amount when old lines exceed the bill", () => {
    const { purchase } = recordPurchase({
      items: [
        { itemName: "Tomato", quantity: 1, lineTotal: 500 },
        { itemName: "Onion", quantity: 1, lineTotal: 300 },
      ],
      total: 2000,
      date: onDay,
    });
    getDb().prepare("UPDATE grocery_purchases SET total_paise = ? WHERE id = ?").run(10000, purchase.id);
    const report = analysis(from, to);
    expect(report.summary.unallocatedTotal).toBe(0);
    expect(report.summary.purchaseTotal).toBe(100);
    expect(report.summary.unallocatedTotal).toBeGreaterThanOrEqual(0);
  });

  it("reports latest and previous prices, including a previous price from before the period", () => {
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1 }], total: 40, date: noon(2026, 1, 10) });
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1 }], total: 48, date: onDay });
    const report = assertReconciles(from, to);
    const price = report.priceRows.find((row) => row.key === "name:tomato|kg");
    expect(price?.latest).toMatchObject({ unitPrice: 48, date: onDay });
    expect(price?.previous).toMatchObject({ unitPrice: 40, date: noon(2026, 1, 10) });
    expect(price?.changePct).toBe(20);
    expect(report.summary.priceIncreaseCount).toBe(1);
    expect(price?.periodLow).toBe(48);
    expect(price?.periodHigh).toBe(48);
  });

  it("counts only a strictly positive price change, and returns the real percentage", () => {
    recordPurchase({ items: [{ itemName: "Rise", quantity: 1 }], total: 100, date: noon(2026, 1, 10) });
    recordPurchase({ items: [{ itemName: "Rise", quantity: 1 }], total: 103, date: onDay });
    recordPurchase({ items: [{ itemName: "Same", quantity: 1 }], total: 100, date: noon(2026, 1, 10) });
    recordPurchase({ items: [{ itemName: "Same", quantity: 1 }], total: 100, date: onDay });
    recordPurchase({ items: [{ itemName: "Fall", quantity: 1 }], total: 100, date: noon(2026, 1, 10) });
    recordPurchase({ items: [{ itemName: "Fall", quantity: 1 }], total: 90, date: onDay });
    recordPurchase({ items: [{ itemName: "Ten", quantity: 1 }], total: 100, date: noon(2026, 1, 10) });
    recordPurchase({ items: [{ itemName: "Ten", quantity: 1 }], total: 110, date: onDay });
    recordPurchase({ items: [{ itemName: "High", quantity: 1 }], total: 100, date: noon(2026, 1, 10) });
    recordPurchase({ items: [{ itemName: "High", quantity: 1 }], total: 125, date: onDay });

    const report = assertReconciles(from, to);
    expect(report.priceRows.find((row) => row.itemName === "Rise")?.changePct).toBe(3);
    expect(report.priceRows.find((row) => row.itemName === "Same")?.changePct).toBe(0);
    expect(report.priceRows.find((row) => row.itemName === "Fall")?.changePct).toBe(-10);
    expect(report.priceRows.find((row) => row.itemName === "Ten")?.changePct).toBe(10);
    expect(report.priceRows.find((row) => row.itemName === "High")?.changePct).toBe(25);
    expect(report.summary.priceIncreaseCount).toBe(3);
  });

  it("omits a price row when the only priced lines are before the period", () => {
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1 }], total: 40, date: noon(2026, 1, 10) });
    recordPurchase({
      items: [
        { itemName: "Tomato", quantity: 2 },
        { itemName: "Onion", quantity: 1 },
      ],
      total: 200,
      date: onDay,
    });
    const report = assertReconciles(from, to);
    expect(report.purchaseRows.find((row) => row.key === "name:tomato|kg")?.purchaseValue).toBe(0);
    expect(report.priceRows.find((row) => row.key === "name:tomato|kg")).toBeUndefined();
    expect(report.summary.priceIncreaseCount).toBe(0);
  });

  it("orders same-day bills by creation time, including an orphan line", () => {
    const earlier = recordPurchase({
      items: [{ itemName: "Tomato", quantity: 1 }],
      total: 40,
      date: onDay,
    });
    const later = recordPurchase({
      items: [{ itemName: "Tomato", quantity: 1 }],
      total: 55,
      date: onDay,
    });
    setCreatedAt(later.purchase.id, 1_000);
    setCreatedAt(earlier.purchase.id, 3_000);
    let report = analysis(from, to);
    expect(report.priceRows.find((row) => row.key === "name:tomato|kg")?.latest.unitPrice).toBe(40);

    insertOrphan({
      id: "grocery-purchase:orphan-tomato",
      itemName: "Tomato",
      quantity: 1,
      unit: "kg",
      totalPaise: 8000,
      purchasedAt: onDay,
      createdAt: 4_000,
      vendor: "Market",
    });
    report = assertReconciles(from, to);
    expect(report.priceRows.find((row) => row.key === "name:tomato|kg")?.latest.unitPrice).toBe(80);
    const legacy = getDb()
      .prepare("SELECT COUNT(*) AS count FROM grocery_purchases WHERE id LIKE 'legacy-line:%'")
      .get() as { count: number };
    expect(legacy.count).toBe(0);
    const stillOrphan = getDb()
      .prepare("SELECT purchase_id FROM grocery_purchase_lines WHERE id = ?")
      .get("grocery-purchase:orphan-tomato") as { purchase_id: string | null };
    expect(stillOrphan.purchase_id).toBeNull();
  });

  it("limits period low and high to the selected period and weights the average price by quantity", () => {
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1 }], total: 30, date: noon(2026, 1, 10) });
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1 }], total: 48, date: onDay });
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1 }], total: 42, date: onDay + 1000 });
    recordPurchase({ items: [{ itemName: "Onion", quantity: 1 }], total: 100, date: onDay });
    recordPurchase({ items: [{ itemName: "Onion", quantity: 10 }], total: 800, date: onDay });

    const report = assertReconciles(from, to);
    const tomato = report.priceRows.find((row) => row.key === "name:tomato|kg");
    expect(tomato?.periodLow).toBe(42);
    expect(tomato?.periodHigh).toBe(48);
    expect(report.itemDetails["name:onion|kg"].avgRecordedPrice).toBe(81.82);
  });

  it("does not compare prices across units", () => {
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1, unit: "kg" }], total: 40, date: onDay });
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1, unit: "packet" }], total: 15, date: onDay });
    const report = assertReconciles(from, to);
    const kg = report.priceRows.find((row) => row.key === "name:tomato|kg");
    const packet = report.priceRows.find((row) => row.key === "name:tomato|packet");
    expect(kg?.previous).toBeNull();
    expect(kg?.latest.unitPrice).toBe(40);
    expect(packet?.latest.unitPrice).toBe(15);
    expect(kg?.changePct).toBeNull();
  });

  it("returns no quantity change when nothing was bought in the previous period", () => {
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 4 }], total: 80, date: onDay });
    const report = assertReconciles(from, to);
    expect(report.purchaseRows[0]).toMatchObject({ previousQuantity: 0, quantityChangePct: null });
  });

  it("excludes a voided bill from value, quantity, price history and bill count", () => {
    const kept = recordPurchase({ items: [{ itemName: "Tomato", quantity: 2 }], total: 80, date: onDay });
    const voided = recordPurchase({ items: [{ itemName: "Tomato", quantity: 9 }], total: 900, date: onDay });
    posService.voidGroceryPurchaseHeader(voided.purchase.id, null);
    const report = assertReconciles(from, to);
    expect(report.summary.purchaseTotal).toBe(80);
    expect(report.summary.billCount).toBe(1);
    expect(report.purchaseRows[0]).toMatchObject({ purchasedQuantity: 2, purchaseValue: 80 });
    expect(report.priceRows[0].latest.unitPrice).toBe(40);
    expect(report.itemDetails["name:tomato|kg"].recentPurchases).toHaveLength(1);
    expect(kept.purchase.id).not.toBe(voided.purchase.id);
  });

  it("reconciles one bill, several bills, and a bill tied to an older list", () => {
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1 }], total: 40, date: onDay });
    let report = assertReconciles(from, to);
    expect(report.summary).toMatchObject({ purchaseTotal: 40, billCount: 1 });

    recordPurchase({ items: [{ itemName: "Onion", quantity: 2 }], total: 60, date: onDay });
    report = assertReconciles(from, to);
    expect(report.summary).toMatchObject({ purchaseTotal: 100, billCount: 2 });

    recordPurchase({
      items: [{ itemName: "Potato", quantity: 3 }],
      total: 70,
      date: onDay,
      listDate: noon(2025, 12, 1),
    });
    report = assertReconciles(from, to);
    expect(report.summary.purchaseTotal).toBe(170);
    const december = assertReconciles(midnight(2025, 12, 1), midnight(2025, 12, 2));
    expect(december.summary.purchaseTotal).toBe(0);
  });

  it("reconciles a mixed bill and a voided bill", () => {
    recordPurchase({
      items: [
        { itemName: "Tomato", quantity: 1, lineTotal: 500 },
        { itemName: "Onion", quantity: 1 },
      ],
      total: 800,
      date: onDay,
    });
    const voided = recordPurchase({ items: [{ itemName: "Cabbage", quantity: 1 }], total: 50, date: onDay });
    posService.voidGroceryPurchaseHeader(voided.purchase.id, null);
    const report = assertReconciles(from, to);
    expect(report.summary.purchaseTotal).toBe(800);
    expect(report.summary.unallocatedTotal).toBe(300);
    expect(report.purchaseRows.find((row) => row.itemName === "Cabbage")).toBeUndefined();
  });

  it("includes a bill at the start of the range and excludes one at the end", () => {
    recordPurchase({ items: [{ itemName: "Start", quantity: 1 }], total: 10, date: from });
    recordPurchase({ items: [{ itemName: "End", quantity: 1 }], total: 99, date: to });
    const report = assertReconciles(from, to);
    expect(report.summary.purchaseTotal).toBe(10);
    expect(report.summary.billCount).toBe(1);
    expect(report.purchaseRows.map((row) => row.itemName)).toEqual(["Start"]);
  });

  it("counts a purchase on its bill date, not the list date or the day it was typed", () => {
    recordPurchase({
      items: [{ itemName: "Tomato", quantity: 1 }],
      total: 40,
      date: noon(2026, 1, 21),
      listDate: noon(2026, 1, 20),
    });
    const typedLater = recordPurchase({
      items: [{ itemName: "Onion", quantity: 1 }],
      total: 30,
      date: noon(2026, 1, 20),
    });
    setCreatedAt(typedLater.purchase.id, noon(2026, 1, 21));

    const today = assertReconciles(midnight(2026, 1, 21), midnight(2026, 1, 22));
    expect(today.purchaseRows.map((row) => row.itemName)).toEqual(["Tomato"]);
    const yesterday = assertReconciles(midnight(2026, 1, 20), midnight(2026, 1, 21));
    expect(yesterday.purchaseRows.map((row) => row.itemName)).toEqual(["Onion"]);
  });

  it("includes an active orphan line in both this report and profitability food cost", () => {
    insertOrphan({
      id: "grocery-purchase:orphan-live",
      itemName: "Potato",
      quantity: 2,
      unit: "kg",
      totalPaise: 8000,
      purchasedAt: onDay,
      createdAt: onDay,
    });
    insertOrphan({
      id: "grocery-purchase:orphan-inactive",
      itemName: "Potato",
      quantity: 9,
      unit: "kg",
      totalPaise: 99999,
      purchasedAt: onDay,
      createdAt: onDay,
      active: 0,
    });
    const report = assertReconciles(from, to);
    expect(report.summary).toMatchObject({ purchaseTotal: 80, billCount: 1, unallocatedTotal: 0 });
    expect(report.purchaseRows[0]).toMatchObject({ purchasedQuantity: 2, purchaseValue: 80 });
    expect(
      getDb().prepare("SELECT COUNT(*) AS count FROM grocery_purchases WHERE id LIKE 'legacy-line:%'").get(),
    ).toMatchObject({ count: 0 });
  });

  it("keeps money and the weighted price exact across mixed units", () => {
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 500, unit: "g" }], total: 100, date: onDay });
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1, unit: "kg" }], total: 180, date: onDay });
    const report = assertReconciles(from, to);
    expect(report.purchaseRows[0]).toMatchObject({ purchasedQuantity: 1.5, purchaseValue: 280, unit: "kg" });
    expect(report.itemDetails["name:tomato|kg"].avgRecordedPrice).toBe(186.67);
    expect(report.priceRows[0].latest.unitPrice).toBe(180);
  });

  it("rejects a future purchase date on create and on edit", () => {
    expect(() =>
      recordPurchase({
        items: [{ itemName: "Tomato", quantity: 1 }],
        total: 10,
        date: Date.now() + 3 * DAY,
      }),
    ).toThrow("grocery-purchase-date-future");
    const { purchase } = recordPurchase({
      items: [{ itemName: "Tomato", quantity: 1 }],
      total: 10,
      date: onDay,
    });
    expect(() =>
      posService.updateGroceryPurchaseHeader(purchase.id, { purchaseDate: Date.now() + 3 * DAY }, null),
    ).toThrow("grocery-purchase-date-future");
    expect(posService.getGroceryPurchaseAnalysis({ from, to }).summary.purchaseTotal).toBe(10);
  });

  it("shows each vendor's latest comparable price up to the end of the period", () => {
    recordPurchase({
      items: [{ itemName: "Tomato", quantity: 1 }],
      total: 30,
      date: noon(2026, 1, 18),
      vendorName: "Supplier A",
    });
    recordPurchase({
      items: [{ itemName: "Tomato", quantity: 1 }],
      total: 48,
      date: onDay,
      vendorName: "Local Market",
    });
    recordPurchase({
      items: [{ itemName: "Tomato", quantity: 1 }],
      total: 99,
      date: noon(2026, 1, 22),
      vendorName: "Local Market",
    });
    recordPurchase({ items: [{ itemName: "Tomato", quantity: 1 }], total: 36, date: noon(2026, 1, 19) });
    recordPurchase({
      items: [{ itemName: "Tomato", quantity: 1, unit: "packet" }],
      total: 12,
      date: onDay,
      vendorName: "Packet Stall",
    });

    const report = assertReconciles(from, to);
    const vendors = report.itemDetails["name:tomato|kg"].vendorPrices;
    expect(vendors).toEqual([
      { vendorName: "Local Market", unitPrice: 48, date: onDay },
      { vendorName: "Vendor not specified", unitPrice: 36, date: noon(2026, 1, 19) },
      { vendorName: "Supplier A", unitPrice: 30, date: noon(2026, 1, 18) },
    ]);
    expect(report.itemDetails["name:tomato|packet"].vendorPrices).toEqual([
      { vendorName: "Packet Stall", unitPrice: 12, date: onDay },
    ]);
    expect(report.priceRows.find((row) => row.key === "name:tomato|kg")?.latest.unitPrice).toBe(48);
  });

  it("stores a received quantity, keeps the planned quantity when it is omitted, and rejects invalid values", () => {
    const received = recordPurchase({
      items: [{ itemName: "Tomato", quantity: 10, received: 8 }],
      total: 400,
      date: onDay,
    });
    expect(received.purchase.lines[0].quantity).toBe(8);
    const report = assertReconciles(from, to);
    expect(report.purchaseRows[0]).toMatchObject({ purchasedQuantity: 8, purchaseValue: 400 });
    expect(report.priceRows[0].latest.unitPrice).toBe(50);

    const planned = recordPurchase({
      items: [{ itemName: "Onion", quantity: 10 }],
      total: 100,
      date: onDay,
    });
    expect(planned.purchase.lines[0].quantity).toBe(10);

    for (const quantity of [0, -2, Number.NaN, "abc"]) {
      expect(() =>
        recordPurchase({
          items: [{ itemName: "Cabbage", quantity: 4, received: quantity as number }],
          total: 40,
          date: onDay,
        }),
      ).toThrow("grocery-received-quantity-invalid");
      expect(() =>
        posService.updateGroceryPurchaseHeader(
          planned.purchase.id,
          { lines: [{ purchaseLineId: planned.purchase.lines[0].id, quantity: quantity as number }] },
          null,
        ),
      ).toThrow("grocery-received-quantity-invalid");
    }
    expect(
      (getDb().prepare("SELECT quantity FROM grocery_purchase_lines WHERE id = ?").get(planned.purchase.lines[0].id) as {
        quantity: number;
      }).quantity,
    ).toBe(10);

    const edited = posService.updateGroceryPurchaseHeader(
      planned.purchase.id,
      { lines: [{ purchaseLineId: planned.purchase.lines[0].id, quantity: 8 }] },
      null,
    );
    expect(edited.lines[0].quantity).toBe(8);
    const stored = getDb()
      .prepare("SELECT quantity, unit_price_paise, total_paise FROM grocery_purchase_lines WHERE id = ?")
      .get(planned.purchase.lines[0].id) as { quantity: number; unit_price_paise: number; total_paise: number };
    expect(stored).toMatchObject({ quantity: 8, total_paise: 10000, unit_price_paise: 1250 });
    const list = posService.getGroceryList(planned.list.id);
    expect(list?.status).toBe("completed");
    expect(list?.lines[0].lineStatus).toBe("purchased");
    expect(list?.lines[0].purchasedQuantity).toBe(8);
  });
});
