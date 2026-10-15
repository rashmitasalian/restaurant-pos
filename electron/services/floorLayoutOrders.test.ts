jest.mock("electron", () => ({
  app: {
    getPath: () => process.env.POS_TEST_USER_DATA_DIR || "",
  },
}));

import fs from "fs";
import os from "os";
import path from "path";
import { closeDb, getDb, initializeDatabase } from "../db/sqlite";
import { createCredentialHash } from "./credentials";
import { posService } from "./posService";

function area(id: string, name: string, tableCount: number, prefix: string, order: number) {
  return {
    id,
    name,
    active: true,
    order,
    tableCount,
    namingMode: "prefix" as const,
    prefix,
    defaultSeats: 4,
  };
}

function floor(groundCount: number) {
  return posService.applyFloorLayout(
    {
      areas: [
        area("area:first", "First Floor", 1, "F", 1),
        area("area:ground", "Ground Floor", groundCount, "G", 2),
        area("area:main", "Main Dining", 1, "MD", 3),
      ],
    },
    "admin",
  );
}

describe("floor layout and empty table orders", () => {
  let tempDir = "";

  beforeEach(async () => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-floor-orders-"));
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = path.join(tempDir, "restaurant-pos.sqlite");
    await initializeDatabase();
    const credential = createCredentialHash("TestPass123!");
    const at = Date.now();
    getDb()
      .prepare(
        `INSERT INTO users (
           username, display_name, role, password_hash, salt, hash_algo,
           active, require_password_change, created_at, updated_at
         ) VALUES ('admin', 'Admin', 'admin', ?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(credential.hash, credential.salt, credential.hashAlgo, at, at);
    floor(2);
  });

  afterEach(() => {
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("lets a ground-floor count change through when the only order has no dishes", () => {
    const empty = posService.createOrder({ tableId: 4, createdBy: "admin" });
    const saved = floor(1);

    expect(saved.tableCount).toBe(3);
    expect(posService.getOrderById(empty._id)?.status).toBe("cancelled");
    expect(posService.getTables().map((table) => table.name)).toEqual(["F1", "G1", "MD1"]);
  });

  it("keeps an empty order on a table the new floor still uses", () => {
    const kept = posService.createOrder({ tableId: 1, createdBy: "admin" });
    floor(1);
    expect(posService.getOrderById(kept._id)?.status).toBe("open");
  });

  it("blocks the change when a table being removed still has dishes", () => {
    const order = posService.createOrder({ tableId: 4, createdBy: "admin" });
    posService.addItemToOrder(order._id, { name: "Tea", qty: 1, rate: 80 }, "admin");

    expect(() => floor(1)).toThrow("tables-have-open-orders");
    expect(posService.getTables()).toHaveLength(4);
    expect(posService.getOrderById(order._id)?.status).toBe("open");
  });

  it("ignores an old order on a table that is already off the floor", () => {
    const at = Date.now();
    const database = getDb();
    database
      .prepare(
        `INSERT INTO tables (id, name, seats, area_id, sort_order, active, created_at, updated_at)
         VALUES (40, 'OLD', 4, 'area:ground', 40, 0, ?, ?)`,
      )
      .run(at, at);
    database
      .prepare(
        `INSERT INTO orders (
           id, order_type, table_id, status, kot_status, subtotal_paise, tax_total_paise,
           discount_percent, discount_total_paise, total_paise, meta_json, created_at, updated_at
         ) VALUES ('order:old', 'table', 40, 'open', 'pending', 0, 0, 0, 0, 0, '{}', ?, ?)`,
      )
      .run(at, at);
    database
      .prepare(
        `INSERT INTO order_lines (
           id, order_id, item_name, quantity, rate_paise, line_total_paise, kot_printed_qty,
           sort_order, created_at, updated_at
         ) VALUES ('line:old', 'order:old', 'Tea', 1, 8000, 8000, 0, 0, ?, ?)`,
      )
      .run(at, at);

    expect(floor(1).tableCount).toBe(3);
  });
});
