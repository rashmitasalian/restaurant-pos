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
