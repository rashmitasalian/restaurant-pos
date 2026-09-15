jest.mock("electron", () => ({
  app: {
    getPath: () => process.env.POS_TEST_USER_DATA_DIR || "",
  },
}));

import fs from "fs";
import os from "os";
import path from "path";
import { closeDb, initializeDatabase } from "./sqlite";

function createLegacyGroceryDatabase(dbPath: string) {
  const BetterSqlite3 = require("better-sqlite3");
  const legacy = new BetterSqlite3(dbPath);
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
    INSERT INTO schema_migrations (version, name, applied_at) VALUES (7, 'Add grocery purchasing ledger', 1);

    CREATE TABLE grocery_purchase_lines (
      id TEXT PRIMARY KEY,
      list_id TEXT,
      grocery_item_id TEXT,
      item_name TEXT NOT NULL,
      category TEXT,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      unit_price_paise INTEGER,
      total_paise INTEGER NOT NULL,
      vendor TEXT,
      payment_method TEXT,
      notes TEXT,
      purchased_at INTEGER NOT NULL,
      created_by TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  legacy.close();
}

/** Mimic a production DB that already has orders but never ran migration 26. */
function createPreCancelColumnOrdersDatabase(dbPath: string) {
  const BetterSqlite3 = require("better-sqlite3");
  const legacy = new BetterSqlite3(dbPath);
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
    INSERT INTO schema_migrations (version, name, applied_at) VALUES
      (1, 'Initial SQLite production schema', 1),
      (5, 'Add paid invoice metadata', 1),
      (25, 'client_ops request hash', 1);

    CREATE TABLE users (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      hash_algo TEXT NOT NULL DEFAULT 'scrypt',
      active INTEGER NOT NULL DEFAULT 1,
      require_password_change INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE seating_areas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE tables (
      id INTEGER PRIMARY KEY,
      name TEXT,
      seats INTEGER NOT NULL DEFAULT 4,
      sort_order INTEGER NOT NULL DEFAULT 0,
      area_id TEXT NOT NULL DEFAULT 'area:main',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      order_type TEXT NOT NULL,
      table_id INTEGER,
      customer_id TEXT,
      status TEXT NOT NULL,
      kot_status TEXT NOT NULL DEFAULT 'pending',
      subtotal_paise INTEGER NOT NULL DEFAULT 0,
      tax_total_paise INTEGER NOT NULL DEFAULT 0,
      discount_percent REAL NOT NULL DEFAULT 0,
      discount_total_paise INTEGER NOT NULL DEFAULT 0,
      total_paise INTEGER NOT NULL DEFAULT 0,
      invoice_number TEXT,
      paid_at INTEGER,
      meta_json TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      user TEXT,
      detail_json TEXT,
      timestamp INTEGER NOT NULL
    );

    INSERT INTO orders (
      id, order_type, status, kot_status, total_paise, created_by, created_at, updated_at
    ) VALUES (
      'order:legacy-cancel', 'table', 'cancelled', 'sent', 10000, 'cashier', 1000, 2000
    );

    INSERT INTO audit_logs (id, action, entity_type, entity_id, user, detail_json, timestamp)
    VALUES ('audit:1', 'order.cancelled', 'order', 'order:legacy-cancel', 'cashier', '{}', 2500);
  `);
  legacy.close();
}

describe("sqlite legacy grocery upgrades", () => {
  let tempDir = "";
  let dbPath = "";

  beforeEach(() => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-migrate-"));
    dbPath = path.join(tempDir, "restaurant-pos.sqlite");
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = dbPath;
  });

  afterEach(() => {
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds purchase_id to legacy grocery_purchase_lines and starts cleanly", async () => {
    createLegacyGroceryDatabase(dbPath);

    await expect(initializeDatabase()).resolves.toBeTruthy();

    const BetterSqlite3 = require("better-sqlite3");
    const db = new BetterSqlite3(dbPath, { readonly: true });
    const columns = db.prepare("PRAGMA table_info(grocery_purchase_lines)").all() as Array<{
      name: string;
    }>;
    db.close();
    closeDb();

    expect(columns.some((column) => column.name === "purchase_id")).toBe(true);
    expect(columns.some((column) => column.name === "vendor_id")).toBe(true);
  });
});

describe("sqlite order cancellation column upgrades", () => {
  let tempDir = "";
  let dbPath = "";

  beforeEach(() => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-migrate-cancel-"));
    dbPath = path.join(tempDir, "restaurant-pos.sqlite");
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = dbPath;
  });

  afterEach(() => {
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds cancelled_at/by/reason and index on an existing orders table without aborting", async () => {
    createPreCancelColumnOrdersDatabase(dbPath);

    await expect(initializeDatabase()).resolves.toBeTruthy();

    const BetterSqlite3 = require("better-sqlite3");
    const db = new BetterSqlite3(dbPath, { readonly: true });
    const columns = db.prepare("PRAGMA table_info(orders)").all() as Array<{ name: string }>;
    const indexes = db.prepare("PRAGMA index_list(orders)").all() as Array<{ name: string }>;
    const cancelled = db
      .prepare(
        "SELECT cancelled_at, cancelled_by, cancellation_reason FROM orders WHERE id = ?",
      )
      .get("order:legacy-cancel") as {
      cancelled_at: number | null;
      cancelled_by: string | null;
      cancellation_reason: string | null;
    };
    const migration = db
      .prepare("SELECT version FROM schema_migrations WHERE version = 26")
      .get() as { version: number } | undefined;
    db.close();
    closeDb();

    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["cancelled_at", "cancelled_by", "cancellation_reason"]),
    );
    expect(indexes.some((idx) => idx.name === "idx_orders_cancelled_at")).toBe(true);
    expect(migration?.version).toBe(26);
    expect(cancelled.cancelled_at).toBe(2500);
    expect(cancelled.cancelled_by).toBe("cashier");
  });
});

/** Mimic a production DB with customers but no credit columns (pre-migration 28). */
function createPreCreditCustomersDatabase(dbPath: string) {
  const BetterSqlite3 = require("better-sqlite3");
  const legacy = new BetterSqlite3(dbPath);
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
    INSERT INTO schema_migrations (version, name, applied_at) VALUES
      (1, 'Initial SQLite production schema', 1),
      (27, 'Cloud backup record metadata', 1);

    CREATE TABLE users (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      hash_algo TEXT NOT NULL DEFAULT 'scrypt',
      active INTEGER NOT NULL DEFAULT 1,
      require_password_change INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE seating_areas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
    VALUES ('area:main', 'Main Dining', 1, 1, 1, 1);

    CREATE TABLE tables (
      id INTEGER PRIMARY KEY,
      name TEXT,
      seats INTEGER NOT NULL DEFAULT 4,
      area_id TEXT NOT NULL DEFAULT 'area:main',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO customers (id, name, phone, active, created_at, updated_at)
    VALUES ('customer:legacy', 'Rahul', '9876543210', 1, 1, 1);

    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      order_type TEXT NOT NULL,
      table_id INTEGER,
      customer_id TEXT,
      status TEXT NOT NULL,
      kot_status TEXT NOT NULL DEFAULT 'pending',
      subtotal_paise INTEGER NOT NULL DEFAULT 0,
      tax_total_paise INTEGER NOT NULL DEFAULT 0,
      discount_percent REAL NOT NULL DEFAULT 0,
      discount_total_paise INTEGER NOT NULL DEFAULT 0,
      total_paise INTEGER NOT NULL DEFAULT 0,
      invoice_number TEXT,
      paid_at INTEGER,
      meta_json TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  legacy.close();
}

describe("sqlite customer credit column upgrades", () => {
  let tempDir = "";
  let dbPath = "";

  beforeEach(() => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-migrate-credit-"));
    dbPath = path.join(tempDir, "restaurant-pos.sqlite");
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = dbPath;
  });

  afterEach(() => {
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds outstanding_paise and ledger tables on an existing customers table without aborting", async () => {
    createPreCreditCustomersDatabase(dbPath);

    await expect(initializeDatabase()).resolves.toBeTruthy();

    const BetterSqlite3 = require("better-sqlite3");
    const db = new BetterSqlite3(dbPath, { readonly: true });
    const columns = db.prepare("PRAGMA table_info(customers)").all() as Array<{ name: string }>;
    const entryTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("customer_account_entries") as { name: string } | undefined;
    const allocTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("customer_credit_allocations") as { name: string } | undefined;
    const outstanding = db
      .prepare("SELECT outstanding_paise FROM customers WHERE id = ?")
      .get("customer:legacy") as { outstanding_paise: number };
    const migration = db
      .prepare("SELECT version FROM schema_migrations WHERE version = 28")
      .get() as { version: number } | undefined;
    db.close();
    closeDb();

    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "credit_enabled",
        "credit_blocked",
        "credit_limit_paise",
        "default_credit_days",
        "outstanding_paise",
      ]),
    );
    expect(entryTable?.name).toBe("customer_account_entries");
    expect(allocTable?.name).toBe("customer_credit_allocations");
    expect(outstanding.outstanding_paise).toBe(0);
    expect(migration?.version).toBe(28);
  });
});
