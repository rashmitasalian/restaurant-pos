jest.mock("electron", () => ({
  app: {
    getPath: () => process.env.POS_TEST_USER_DATA_DIR || "",
  },
}));

import fs from "fs";
import os from "os";
import path from "path";
import { closeDb, getDb, initializeDatabase } from "./sqlite";

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

/** Current production grocery_purchase_lines: purchase_id/vendor_id exist, list_line_id does not. */
function createPreListLineIdGroceryDatabase(dbPath: string) {
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
      (16, 'Add grocery_purchases headers without merging uncertain rows', 1),
      (28, 'Customer credit / receivables ledger', 1);

    CREATE TABLE grocery_purchase_lines (
      id TEXT PRIMARY KEY,
      purchase_id TEXT,
      list_id TEXT,
      grocery_item_id TEXT,
      item_name TEXT NOT NULL,
      category TEXT,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      unit_price_paise INTEGER,
      total_paise INTEGER NOT NULL,
      vendor TEXT,
      vendor_id TEXT,
      payment_method TEXT,
      notes TEXT,
      purchased_at INTEGER NOT NULL,
      created_by TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO grocery_purchase_lines (
      id, item_name, quantity, unit, total_paise, purchased_at, created_at, updated_at
    ) VALUES (
      'grocery-purchase:legacy', 'Tomato', 2, 'kg', 185000, 1, 1, 1
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
    expect(columns.some((column) => column.name === "list_line_id")).toBe(true);
  });

  it("adds list_line_id on a current production grocery_purchase_lines table without aborting", async () => {
    createPreListLineIdGroceryDatabase(dbPath);

    await expect(initializeDatabase()).resolves.toBeTruthy();

    const BetterSqlite3 = require("better-sqlite3");
    const db = new BetterSqlite3(dbPath, { readonly: true });
    const columns = db.prepare("PRAGMA table_info(grocery_purchase_lines)").all() as Array<{
      name: string;
    }>;
    const indexes = db
      .prepare("PRAGMA index_list(grocery_purchase_lines)")
      .all() as Array<{ name: string }>;
    const migration = db
      .prepare("SELECT version FROM schema_migrations WHERE version = 29")
      .get() as { version: number } | undefined;
    const preserved = db
      .prepare("SELECT id, item_name, total_paise FROM grocery_purchase_lines WHERE id = ?")
      .get("grocery-purchase:legacy") as { id: string; item_name: string; total_paise: number };
    db.close();
    closeDb();

    expect(columns.some((column) => column.name === "list_line_id")).toBe(true);
    expect(indexes.some((idx) => idx.name === "idx_grocery_purchase_lines_list_line")).toBe(true);
    expect(migration?.version).toBe(29);
    expect(preserved.item_name).toBe("Tomato");
    expect(preserved.total_paise).toBe(185000);
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
      .prepare("SELECT cancelled_at, cancelled_by, cancellation_reason FROM orders WHERE id = ?")
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

function createPreDietMenuDatabase(dbPath: string) {
  const BetterSqlite3 = require("better-sqlite3");
  const legacy = new BetterSqlite3(dbPath);
  legacy.exec(`
    CREATE TABLE menu_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE menu_items (
      id TEXT PRIMARY KEY,
      sku TEXT,
      name TEXT NOT NULL,
      category_id TEXT REFERENCES menu_categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
      price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
      available INTEGER NOT NULL DEFAULT 1,
      favorite INTEGER NOT NULL DEFAULT 0,
      tax_rate_bps INTEGER NOT NULL DEFAULT 1800,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_menu_items_name ON menu_items(name);

    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      order_type TEXT NOT NULL CHECK (order_type IN ('table', 'takeaway', 'delivery')),
      table_id INTEGER,
      customer_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('open', 'held', 'ready', 'assigned', 'paid', 'cancelled')),
      kot_status TEXT NOT NULL DEFAULT 'pending' CHECK (kot_status IN ('pending', 'sent', 'printed', 'failed')),
      subtotal_paise INTEGER NOT NULL DEFAULT 0,
      tax_total_paise INTEGER NOT NULL DEFAULT 0,
      discount_percent REAL NOT NULL DEFAULT 0,
      discount_total_paise INTEGER NOT NULL DEFAULT 0,
      total_paise INTEGER NOT NULL DEFAULT 0,
      invoice_number TEXT,
      paid_at INTEGER,
      cancelled_at INTEGER,
      cancelled_by TEXT,
      cancellation_reason TEXT,
      meta_json TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE order_lines (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id TEXT REFERENCES menu_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
      item_name TEXT NOT NULL,
      category_name TEXT,
      quantity REAL NOT NULL CHECK (quantity > 0),
      rate_paise INTEGER NOT NULL CHECK (rate_paise >= 0),
      tax_rate_bps INTEGER NOT NULL DEFAULT 1800,
      line_total_paise INTEGER NOT NULL DEFAULT 0,
      kot_printed_qty REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_order_lines_order ON order_lines(order_id, sort_order);

    INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
    VALUES ('cat:mains', 'Mains', 1, 1, 1, 1);
    INSERT INTO menu_items (
      id, sku, name, category_id, price_paise, tax_rate_bps, active, created_at, updated_at
    ) VALUES (
      'item:legacy', 'LEG1', 'Legacy Biryani', 'cat:mains', 20000, 1800, 1, 1, 1
    );
    INSERT INTO orders (
      id, order_type, status, total_paise, paid_at, created_at, updated_at
    ) VALUES (
      'order:legacy-paid', 'takeaway', 'paid', 20000, 5, 1, 5
    );
    INSERT INTO order_lines (
      id, order_id, menu_item_id, item_name, quantity, rate_paise, tax_rate_bps,
      line_total_paise, created_at, updated_at
    ) VALUES (
      'line:legacy', 'order:legacy-paid', 'item:legacy', 'Legacy Biryani', 1, 20000, 1800,
      20000, 1, 1
    );
  `);
  legacy.close();
}

describe("sqlite menu tax and diet migration", () => {
  let tempDir = "";
  let dbPath = "";

  beforeEach(() => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-migrate-menu-"));
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

  it("keeps legacy tax values and makes new tax columns nullable", async () => {
    createPreDietMenuDatabase(dbPath);
    await initializeDatabase();
    const database = getDb();
    database
      .prepare(
        `INSERT INTO menu_items (id, name, price_paise, created_at, updated_at)
         VALUES ('item:new', 'New Tea', 2500, 9, 9)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO order_lines (
           id, order_id, item_name, quantity, rate_paise, created_at, updated_at
         ) VALUES ('line:new', 'order:legacy-paid', 'New Tea', 1, 2500, 9, 9)`,
      )
      .run();

    const itemTax = database.prepare("PRAGMA table_info(menu_items)").all() as Array<{
      name: string;
      notnull: number;
      dflt_value: unknown;
    }>;
    const lineTax = database.prepare("PRAGMA table_info(order_lines)").all() as Array<{
      name: string;
      notnull: number;
      dflt_value: unknown;
    }>;
    const legacyItem = database
      .prepare(
        "SELECT name, price_paise, tax_rate_bps, sort_order, diet FROM menu_items WHERE id = ?",
      )
      .get("item:legacy") as {
      name: string;
      price_paise: number;
      tax_rate_bps: number;
      sort_order: number;
      diet: string | null;
    };
    const legacyLine = database
      .prepare("SELECT item_name, rate_paise, tax_rate_bps, menu_item_id FROM order_lines WHERE id = ?")
      .get("line:legacy") as {
      item_name: string;
      rate_paise: number;
      tax_rate_bps: number;
      menu_item_id: string;
    };
    const newItem = database
      .prepare("SELECT tax_rate_bps, sort_order, diet FROM menu_items WHERE id = ?")
      .get("item:new") as { tax_rate_bps: number | null; sort_order: number; diet: string | null };
    const newLine = database
      .prepare("SELECT tax_rate_bps FROM order_lines WHERE id = ?")
      .get("line:new") as { tax_rate_bps: number | null };
    const indexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('menu_items', 'order_lines')")
      .all() as Array<{ name: string }>;
    const violations = database.pragma("foreign_key_check") as unknown[];
    const migration = database
      .prepare("SELECT version FROM schema_migrations WHERE version = 31")
      .get() as { version: number };

    const itemTaxColumn = itemTax.find((column) => column.name === "tax_rate_bps");
    const lineTaxColumn = lineTax.find((column) => column.name === "tax_rate_bps");
    expect(itemTaxColumn?.notnull).toBe(0);
    expect(itemTaxColumn?.dflt_value).toBeNull();
    expect(lineTaxColumn?.notnull).toBe(0);
    expect(lineTaxColumn?.dflt_value).toBeNull();
    expect(itemTax.map((column) => column.name)).toEqual(
      expect.arrayContaining(["sort_order", "diet"]),
    );
    expect(legacyItem).toMatchObject({
      name: "Legacy Biryani",
      price_paise: 20000,
      tax_rate_bps: 1800,
      sort_order: 0,
      diet: null,
    });
    expect(legacyLine).toMatchObject({
      item_name: "Legacy Biryani",
      rate_paise: 20000,
      tax_rate_bps: 1800,
      menu_item_id: "item:legacy",
    });
    expect(newItem.tax_rate_bps).toBeNull();
    expect(newLine.tax_rate_bps).toBeNull();
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(["idx_menu_items_name", "idx_order_lines_order"]),
    );
    expect(violations).toEqual([]);
    expect(migration.version).toBe(31);
  });
});
