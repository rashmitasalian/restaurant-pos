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

/**
 * Text-field payloads must stay data. A successful injection would drop a table,
 * or make a search return rows that do not contain the payload.
 */
const PAYLOADS = [
  "Tea'); DROP TABLE menu_items;--",
  "' OR '1'='1",
  "\" OR 1=1 --",
  "admin'--",
  "%' OR 1=1 --",
  "1; ATTACH DATABASE 'x' AS evil;--",
  "') OR ('1'='1",
] as const;

const REQUIRED_TABLES = ["menu_items", "orders", "order_lines", "customers", "users", "audit_logs"];

function tableNames() {
  return new Set(
    (
      getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}

describe("SQL injection resistance", () => {
  let tempDir = "";

  beforeEach(async () => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-sqli-"));
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

  it("stores text-field payloads as data and keeps the schema intact", () => {
    const before = tableNames();
    for (const name of REQUIRED_TABLES) {
      expect(before.has(name)).toBe(true);
    }

    const itemName = PAYLOADS[0];
    const item = posService.createItem({
      name: itemName,
      category: "Sides' OR 1=1",
      sku: "SKU'); DROP--",
      price: 40,
    });
    const storedItem = getDb()
      .prepare(
        `SELECT mi.name, mi.sku, mc.name AS category
         FROM menu_items mi
         LEFT JOIN menu_categories mc ON mc.id = mi.category_id
         WHERE mi.id = ?`,
      )
      .get(item._id) as { name: string; category: string; sku: string };
    expect(storedItem.name).toBe(itemName);
    expect(storedItem.category).toBe("Sides' OR 1=1");
    expect(storedItem.sku).toBe("SKU'); DROP--");

    const customer = posService.createCustomer({
      name: "Anita Sharma",
      phone: "9876543210",
      address: "12 MG Road'); DROP TABLE customers;--",
      notes: "note'); DELETE FROM users;--",
    });
    const storedCustomer = getDb()
      .prepare("SELECT address, notes FROM customers WHERE id = ?")
      .get(customer.id) as { address: string; notes: string };
    expect(storedCustomer.address).toBe("12 MG Road'); DROP TABLE customers;--");
    expect(storedCustomer.notes).toBe("note'); DELETE FROM users;--");

    const order = posService.createOrder({
      orderType: "takeaway",
      meta: { customerName: "Rider'); DROP TABLE orders;--" },
    });
    posService.addItemToOrder(order._id, {
      name: itemName,
      qty: 1,
      rate: 40,
      menuItemId: item._id,
      kitchenNote: "no onion'); DROP TABLE order_lines;--",
    });
    const line = getDb()
      .prepare("SELECT item_name, kitchen_note FROM order_lines WHERE order_id = ?")
      .get(order._id) as { item_name: string; kitchen_note: string };
    expect(line.item_name).toBe(itemName);
    expect(line.kitchen_note).toContain("DROP TABLE order_lines");

    const paid = posService.setOrderPaid(order._id, {
      method: "upi",
      amount: 40,
      txnRef: "UTR'); DROP TABLE payments;--",
    });
    expect(paid.status).toBe("paid");
    const payment = getDb()
      .prepare("SELECT txn_ref FROM payments WHERE order_id = ?")
      .get(order._id) as { txn_ref: string };
    expect(payment.txn_ref).toContain("DROP TABLE payments");

    const after = tableNames();
    for (const name of REQUIRED_TABLES) {
      expect(after.has(name)).toBe(true);
    }
    expect(
      (getDb().prepare("SELECT COUNT(*) AS count FROM menu_items").get() as { count: number }).count,
    ).toBeGreaterThan(0);
    expect(
      (getDb().prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count,
    ).toBe(0);
  });

  it("does not turn search text into a query that returns every row", () => {
    const plain = posService.createItem({ name: "Masala Dosa", price: 80 });
    const order = posService.createOrder({ orderType: "dine-in" });
    posService.addItemToOrder(order._id, {
      name: "Masala Dosa",
      qty: 1,
      rate: 80,
      menuItemId: plain._id,
    });
    posService.setOrderPaid(order._id, { method: "cash", amount: 80 });

    for (const payload of PAYLOADS) {
      const paid = posService.listPaidOrders({ search: payload });
      expect(paid.map((row: { _id: string }) => row._id)).not.toContain(order._id);

      expect(posService.listGroceryPurchases({ search: payload })).toEqual([]);

      expect(() => posService.getAudits({ search: payload, limit: 20 })).not.toThrow();
    }

    const byDish = posService.listPaidOrders({ search: "masala dosa" });
    expect(byDish.map((row: { _id: string }) => row._id)).toContain(order._id);

    for (const name of REQUIRED_TABLES) {
      expect(tableNames().has(name)).toBe(true);
    }
  });
});
