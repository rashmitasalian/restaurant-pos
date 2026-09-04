/**
 * Validate the cancelled_at upgrade sequence under Electron's better-sqlite3 ABI.
 * Run: npx electron scripts/verify-cancel-migration.cjs
 */
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

function columnExists(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((row) => row.name === columnName);
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  if (!columnExists(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function main() {
  const BetterSqlite3 = require("better-sqlite3");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-cancel-mig-"));
  const dbPath = path.join(tempDir, "restaurant-pos.sqlite");
  const db = new BetterSqlite3(dbPath);

  // Existing prod-shaped orders table (no cancel columns).
  db.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      order_type TEXT NOT NULL,
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
    INSERT INTO orders (id, order_type, status, kot_status, total_paise, created_by, created_at, updated_at)
    VALUES ('order:1', 'table', 'cancelled', 'sent', 10000, 'cashier', 1000, 2000);
    INSERT INTO audit_logs (id, action, entity_type, entity_id, user, detail_json, timestamp)
    VALUES ('audit:1', 'order.cancelled', 'order', 'order:1', 'cashier', '{}', 2500);
  `);

  // Reproduce the old bug: index before column on an existing table.
  let oldBugCaught = false;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        cancelled_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at
        ON orders(status, cancelled_at DESC);
    `);
  } catch (error) {
    oldBugCaught = String(error.message || error).includes("no such column: cancelled_at");
  }
  if (!oldBugCaught) {
    console.error("Expected old premature-index pattern to fail on legacy orders table");
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    app.exit(1);
    return;
  }

  // Fixed upgrade sequence used by migration 26 + self-heal.
  addColumnIfMissing(db, "orders", "cancelled_at", "INTEGER");
  addColumnIfMissing(db, "orders", "cancelled_by", "TEXT");
  addColumnIfMissing(db, "orders", "cancellation_reason", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at
      ON orders(status, cancelled_at DESC);
  `);
  db.exec(`
    UPDATE orders
    SET
      cancelled_at = COALESCE(
        (
          SELECT a.timestamp FROM audit_logs a
          WHERE a.entity_id = orders.id AND a.action = 'order.cancelled'
          ORDER BY a.timestamp DESC LIMIT 1
        ),
        updated_at
      ),
      cancelled_by = COALESCE(
        (
          SELECT a.user FROM audit_logs a
          WHERE a.entity_id = orders.id AND a.action = 'order.cancelled'
          ORDER BY a.timestamp DESC LIMIT 1
        ),
        created_by
      )
    WHERE status = 'cancelled' AND cancelled_at IS NULL;
  `);

  const columns = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  const indexes = db.prepare("PRAGMA index_list(orders)").all().map((i) => i.name);
  const row = db
    .prepare("SELECT cancelled_at, cancelled_by FROM orders WHERE id = ?")
    .get("order:1");
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });

  const ok =
    columns.includes("cancelled_at") &&
    columns.includes("cancelled_by") &&
    columns.includes("cancellation_reason") &&
    indexes.includes("idx_orders_cancelled_at") &&
    row?.cancelled_at === 2500 &&
    row?.cancelled_by === "cashier";

  if (!ok) {
    console.error("VERIFY FAILED", { columns, indexes, row });
    app.exit(1);
    return;
  }

  console.log("VERIFY OK: premature index was the bug; column-first upgrade succeeds");
  app.exit(0);
}

app.whenReady().then(() => {
  try {
    main();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
