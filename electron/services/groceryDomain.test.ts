jest.mock("electron", () => ({
  app: {
    getPath: () => process.env.POS_TEST_USER_DATA_DIR || "",
  },
}));

import fs from "fs";
import os from "os";
import path from "path";
import { closeDb, getDb, initializeDatabase } from "../db/sqlite";
import { posService } from "./posService";

describe("grocery v2 domain", () => {
  let tempDir = "";
  let dbPath = "";

  beforeEach(async () => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-grocery-v2-"));
    dbPath = path.join(tempDir, "restaurant-pos.sqlite");
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = dbPath;
    await initializeDatabase();
  });

  afterEach(() => {
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createList(lines: Array<{ itemName: string; quantity?: number }>) {
    return posService.createGroceryList(
      {
        title: "Morning Procurement",
        lines: lines.map((line) => ({
          itemName: line.itemName,
          quantity: line.quantity || 1,
          unit: "kg",
        })),
      },
      null,
    );
  }

  it("adds list_line_id through the versioned grocery purchase migration", () => {
    const BetterSqlite3 = require("better-sqlite3");
    const db = new BetterSqlite3(dbPath, { readonly: true });
    const columns = db.prepare("PRAGMA table_info(grocery_purchase_lines)").all() as Array<{
      name: string;
    }>;
    const migration = db.prepare("SELECT version FROM schema_migrations WHERE version = 29").get();
    db.close();
    expect(columns.some((column) => column.name === "list_line_id")).toBe(true);
    expect(migration).toBeTruthy();
  });

  it("derives Open → In progress → Completed from covered lines, not purchase headers", () => {
    const list = createList([{ itemName: "Tomato" }, { itemName: "Cabbage" }]);
    expect(list.status).toBe("open");
    expect(list.pendingCount).toBe(2);
    expect(list.spentTotal).toBe(0);

    const purchase = posService.createGroceryPurchaseHeader(
      {
        buyingListId: list.id,
        total: 1850,
        coverage: "pending",
      },
      null,
    );
    expect(purchase.total).toBe(1850);
    expect(purchase.lines.every((line) => line.totalAmount === 0)).toBe(true);
    expect(purchase.lines.every((line) => line.listLineId)).toBe(true);

    const completed = posService.getGroceryList(list.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.spentTotal).toBe(1850);
    expect(completed?.purchasedCount).toBe(2);
    expect(completed?.pendingCount).toBe(0);
    expect(completed?.lines.every((line) => line.purchasedTotal == null)).toBe(true);
  });

  it("stores optional per-item amounts and rejects items that exceed the bill", () => {
    const list = createList([{ itemName: "Tomato" }, { itemName: "Cabbage" }]);
    const [tomato, cabbage] = list.lines;
    expect(() =>
      posService.createGroceryPurchaseHeader(
        {
          buyingListId: list.id,
          total: 100,
          coverage: "pending",
          lines: [
            { listLineId: tomato.id, lineTotal: 80 },
            { listLineId: cabbage.id, lineTotal: 40 },
          ],
        },
        null,
      ),
    ).toThrow("grocery-purchase-lines-exceed-total");
    expect(posService.getGroceryList(list.id)?.pendingCount).toBe(2);

    posService.createGroceryPurchaseHeader(
      {
        buyingListId: list.id,
        total: 130,
        coverage: "pending",
        lines: [{ listLineId: tomato.id, lineTotal: 80 }],
      },
      null,
    );
    const after = posService.getGroceryList(list.id);
    expect(after?.spentTotal).toBe(130);
    expect(after?.lines.find((line) => line.id === tomato.id)?.purchasedTotal).toBe(80);
    expect(after?.lines.find((line) => line.id === cabbage.id)?.purchasedTotal ?? null).toBeNull();
  });

  it("gives a one-item bill its total and edits bill money without changing coverage", async () => {
    const list = createList([{ itemName: "Groundnut" }, { itemName: "Oil" }, { itemName: "Salt" }]);
    const [groundnut, oil, salt] = list.lines;
    const single = posService.createGroceryPurchaseHeader(
      { buyingListId: list.id, total: 30, coverage: "selected", lines: [{ listLineId: groundnut.id }] },
      null,
    );
    expect(single.lines[0].totalAmount).toBe(30);
    expect(
      posService.getGroceryList(list.id)?.lines.find((line) => line.id === groundnut.id)?.purchasedTotal,
    ).toBe(30);
    posService.updateGroceryPurchaseHeader(
      single.id,
      { total: 260, lines: [{ purchaseLineId: single.lines[0].id, lineTotal: 120 }] },
      null,
    );
    expect(
      posService.getGroceryList(list.id)?.lines.find((line) => line.id === groundnut.id)?.purchasedTotal,
    ).toBe(260);

    getDb()
      .prepare(`UPDATE grocery_purchase_lines SET total_paise = 12000 WHERE purchase_id = ?`)
      .run(single.id);
    getDb()
      .prepare(`UPDATE grocery_list_lines SET purchased_total_paise = 12000 WHERE id = ?`)
      .run(groundnut.id);
    getDb().prepare(`DELETE FROM schema_migrations WHERE version = 30`).run();
    closeDb();
    await initializeDatabase();
    const repaired = posService.getGroceryList(list.id);
    expect(repaired?.lines.find((line) => line.id === groundnut.id)?.purchasedTotal).toBe(260);

    const pair = posService.createGroceryPurchaseHeader(
      {
        buyingListId: list.id,
        total: 100,
        coverage: "pending",
        lines: [{ listLineId: oil.id, lineTotal: 60 }],
      },
      null,
    );
    const oilLine = pair.lines.find((line) => line.listLineId === oil.id)!;
    const saltLine = pair.lines.find((line) => line.listLineId === salt.id)!;

    expect(() =>
      posService.updateGroceryPurchaseHeader(
        pair.id,
        { total: 50, lines: [{ purchaseLineId: oilLine.id, lineTotal: 60 }] },
        null,
      ),
    ).toThrow("grocery-purchase-lines-exceed-total");

    const edited = posService.updateGroceryPurchaseHeader(
      pair.id,
      {
        total: 110,
        vendorName: "Metro Foods",
        lines: [
          { purchaseLineId: oilLine.id, lineTotal: 70 },
          { purchaseLineId: saltLine.id, lineTotal: 40 },
        ],
      },
      null,
    );
    expect(edited.total).toBe(110);
    expect(edited.vendorName).toBe("Metro Foods");
    expect(edited.lines).toHaveLength(2);
    const after = posService.getGroceryList(list.id);
    expect(after?.spentTotal).toBe(370);
    expect(after?.status).toBe("completed");
    expect(after?.lines.find((line) => line.id === oil.id)?.purchasedTotal).toBe(70);
    expect(after?.lines.find((line) => line.id === salt.id)?.purchasedTotal).toBe(40);

    posService.voidGroceryPurchaseHeader(pair.id, null);
    expect(() => posService.updateGroceryPurchaseHeader(pair.id, { total: 10 }, null)).toThrow(
      "grocery-purchase-voided",
    );
  });

  it("changes only the lines sent and protects bought lines", () => {
    const list = createList([{ itemName: "Tomato" }, { itemName: "Cabbage" }]);
    const [tomato, cabbage] = list.lines;
    const added = posService.changeGroceryListLines(
      list.id,
      {
        add: [{ itemName: "Oil", quantity: 10, unit: "L" }],
        update: [{ id: tomato.id, quantity: 2.5, unit: "kg" }],
        remove: [cabbage.id],
      },
      null,
    );
    expect(added.lines.map((line) => line.itemName)).toEqual(["Tomato", "Oil"]);
    expect(added.lines.find((line) => line.id === tomato.id)?.quantity).toBe(2.5);
    expect(added.lines.find((line) => line.itemName === "Oil")?.unit).toBe("L");
    expect(() =>
      posService.changeGroceryListLines(list.id, { add: [{ itemName: "oil", quantity: 1, unit: "L" }] }, null),
    ).toThrow("grocery-list-line-duplicate");

    posService.createGroceryPurchaseHeader(
      { buyingListId: list.id, total: 50, coverage: "selected", lines: [{ listLineId: tomato.id }] },
      null,
    );
    expect(() =>
      posService.changeGroceryListLines(list.id, { update: [{ id: tomato.id, quantity: 3 }] }, null),
    ).toThrow("grocery-list-line-covered");
    expect(() =>
      posService.changeGroceryListLines(list.id, { remove: [tomato.id] }, null),
    ).toThrow("grocery-list-line-covered");
    const partial = posService.getGroceryList(list.id);
    expect(partial?.status).toBe("partial");
    expect(partial?.lines).toHaveLength(2);
  });

  it("reopens a completed list when a pending item is added and rejects derived status", () => {
    const list = createList([{ itemName: "Tomato" }, { itemName: "Cabbage" }]);
    posService.createGroceryPurchaseHeader(
      { buyingListId: list.id, total: 500, coverage: "pending" },
      null,
    );
    expect(() =>
      posService.updateGroceryList(list.id, { status: "partial" }, null),
    ).toThrow("grocery-list-status-derived");
    expect(() =>
      posService.updateGroceryList(list.id, { status: "completed" }, null),
    ).toThrow("grocery-list-status-derived");

    const reopened = posService.updateGroceryList(
      list.id,
      {
        lines: [
          ...list.lines,
          { itemName: "Onion", quantity: 1, unit: "kg" },
        ],
      },
      null,
    );
    expect(reopened.status).toBe("partial");
    expect(reopened.pendingCount).toBe(1);
    expect(reopened.purchasedCount).toBe(2);
    expect(reopened.spentTotal).toBe(500);
  });

  it("merges list lines so a stale snapshot cannot delete covered items", () => {
    const list = createList([{ itemName: "Tomato" }, { itemName: "Cabbage" }]);
    posService.createGroceryPurchaseHeader(
      { buyingListId: list.id, total: 200, coverage: "pending" },
      null,
    );
    const stale = posService.updateGroceryList(
      list.id,
      {
        lines: [{ itemName: "Onion", quantity: 1, unit: "kg" }],
      },
      null,
    );
    expect(stale.lines.map((line) => line.itemName).sort()).toEqual(["Cabbage", "Onion", "Tomato"]);
    expect(stale.lines.filter((line) => line.lineStatus === "purchased")).toHaveLength(2);
    expect(stale.status).toBe("partial");
  });

  it("rejects changing qty on a covered line", () => {
    const list = createList([{ itemName: "Tomato", quantity: 2 }]);
    posService.createGroceryPurchaseHeader(
      { buyingListId: list.id, total: 80, coverage: "pending" },
      null,
    );
    expect(() =>
      posService.updateGroceryList(
        list.id,
        { lines: [{ ...list.lines[0], quantity: 9 }] },
        null,
      ),
    ).toThrow("grocery-list-line-covered");
  });

  it("rejects linked coverage=none, empty pending, and mixed vendor fields", () => {
    const list = createList([{ itemName: "Tomato" }]);
    posService.createGroceryPurchaseHeader(
      { buyingListId: list.id, total: 40, coverage: "pending" },
      null,
    );
    expect(() =>
      posService.createGroceryPurchaseHeader(
        { buyingListId: list.id, total: 10, coverage: "none" },
        null,
      ),
    ).toThrow("grocery-purchase-linked-none");
    expect(() =>
      posService.createGroceryPurchaseHeader(
        { buyingListId: list.id, total: 10, coverage: "pending" },
        null,
      ),
    ).toThrow("grocery-purchase-empty-coverage");
    expect(() =>
      posService.createGroceryPurchaseHeader(
        {
          buyingListId: list.id,
          total: 10,
          coverage: "pending",
          vendorId: "vendor:missing",
          vendorName: "Someone",
        },
        null,
      ),
    ).toThrow("grocery-vendor-id-and-name");
  });

  it("rolls back selected coverage when any line is already purchased", () => {
    const list = createList([{ itemName: "Tomato" }, { itemName: "Cabbage" }, { itemName: "Oil" }]);
    posService.createGroceryPurchaseHeader(
      {
        buyingListId: list.id,
        total: 850,
        coverage: "selected",
        vendorName: "Vegetable Vendor",
        lines: [{ listLineId: list.lines[0].id }, { listLineId: list.lines[1].id }],
      },
      null,
    );
    expect(() =>
      posService.createGroceryPurchaseHeader(
        {
          buyingListId: list.id,
          total: 600,
          coverage: "selected",
          lines: [{ listLineId: list.lines[0].id }, { listLineId: list.lines[2].id }],
        },
        null,
      ),
    ).toThrow("grocery-purchase-selected-invalid");
    const after = posService.getGroceryList(list.id);
    expect(after?.pendingCount).toBe(1);
    expect(after?.spentTotal).toBe(850);
    expect(posService.listGroceryPurchaseHeaders({ listId: list.id, includeVoided: false })).toHaveLength(
      1,
    );
  });

  it("records multiple vendor purchases and voids without deleting the header", () => {
    const list = createList([
      { itemName: "Tomato" },
      { itemName: "Chicken" },
      { itemName: "Oil" },
    ]);
    posService.createGroceryPurchaseHeader(
      {
        buyingListId: list.id,
        total: 850,
        coverage: "selected",
        vendorName: "Vegetable Vendor",
        lines: [{ listLineId: list.lines[0].id }],
      },
      null,
    );
    posService.createGroceryPurchaseHeader(
      {
        buyingListId: list.id,
        total: 2400,
        coverage: "selected",
        vendorName: "Chicken Supplier",
        lines: [{ listLineId: list.lines[1].id }],
      },
      null,
    );
    const last = posService.createGroceryPurchaseHeader(
      {
        buyingListId: list.id,
        total: 600,
        coverage: "pending",
      },
      null,
    );
    const done = posService.getGroceryList(list.id);
    expect(done?.status).toBe("completed");
    expect(done?.spentTotal).toBe(3850);

    posService.voidGroceryPurchaseHeader(last.id, null);
    const reopened = posService.getGroceryList(list.id);
    expect(reopened?.status).toBe("partial");
    expect(reopened?.pendingCount).toBe(1);
    expect(reopened?.spentTotal).toBe(3250);
    const headers = posService.listGroceryPurchaseHeaders({ listId: list.id, includeVoided: true });
    expect(headers.some((header) => header.id === last.id && header.status === "voided")).toBe(true);
  });

  it("allows an unlinked purchase with coverage none", () => {
    const purchase = posService.createGroceryPurchaseHeader(
      { total: 2450, coverage: "none", vendorName: "" },
      null,
    );
    expect(purchase.buyingListId).toBeFalsy();
    expect(purchase.total).toBe(2450);
    expect(purchase.vendorId).toBeFalsy();
  });

  it("marks the list completed when the last pending line is deleted", () => {
    const list = createList([{ itemName: "Tomato" }, { itemName: "Onion" }]);
    posService.createGroceryPurchaseHeader(
      {
        buyingListId: list.id,
        total: 80,
        coverage: "selected",
        lines: [{ listLineId: list.lines[0].id }],
      },
      null,
    );
    const done = posService.updateGroceryList(
      list.id,
      { lines: [{ id: list.lines[0].id, itemName: "Tomato", quantity: 1, unit: "kg" }] },
      null,
    );
    expect(done.status).toBe("completed");
    expect(done.pendingCount).toBe(0);
    expect(done.purchasedCount).toBe(1);
    expect(done.lines.some((line) => line.itemName === "Onion")).toBe(false);
  });
});
