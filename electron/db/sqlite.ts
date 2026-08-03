import "../env";
import { app } from "electron";
import fs from "fs";
import path from "path";

type SqliteDatabase = any;

let db: SqliteDatabase | null = null;
const DEFAULT_SEATING_AREA_ID = "area:main";
const DEFAULT_SEATING_AREA_NAME = "Main Dining";

export function getDatabasePath() {
  const override = process.env.POS_DB_PATH_OVERRIDE?.trim();
  if (override) {
    return path.resolve(override);
  }
  const dataDir = path.join(app.getPath("userData"), "data");
  return path.join(dataDir, "restaurant-pos.sqlite");
}

function ensureDataDir() {
  const dataDir = path.dirname(getDatabasePath());
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

export async function initializeDatabase() {
  if (!db) {
    ensureDataDir();
    db = await openDatabase();
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    runSchema(db);
    seedDatabase(db);
  }
  return db;
}

export function getDb(): SqliteDatabase {
  if (!db) {
    throw new Error("sqlite-not-initialized");
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export async function backupDatabase(targetPath: string) {
  const database = getDb();
  await database.backup(targetPath);
}

export async function restoreDatabaseFromBackup(sourcePath: string) {
  const source = path.resolve(String(sourcePath || ""));
  const target = path.resolve(getDatabasePath());
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error("backup-file-not-found");
  }
  if (source.toLowerCase() === target.toLowerCase()) {
    throw new Error("cannot-restore-active-database");
  }

  validateSqliteBackup(source);

  ensureDataDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const preRestoreBackupPath = path.join(path.dirname(target), `pre-restore-${stamp}.sqlite`);
  const tempRestorePath = `${target}.restore-tmp`;
  await backupDatabase(preRestoreBackupPath);
  if (fs.existsSync(tempRestorePath)) {
    fs.unlinkSync(tempRestorePath);
  }
  fs.copyFileSync(source, tempRestorePath);

  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${target}${suffix}`;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
  fs.renameSync(tempRestorePath, target);
  await initializeDatabase();

  return { ok: true, path: target, preRestoreBackupPath };
}

export function replaceDatabaseFromBackupWithoutReopen(sourcePath: string) {
  const source = path.resolve(String(sourcePath || ""));
  const target = path.resolve(getDatabasePath());
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error("backup-file-not-found");
  }
  if (source.toLowerCase() === target.toLowerCase()) {
    throw new Error("cannot-restore-active-database");
  }

  validateSqliteBackup(source);
  ensureDataDir();
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${target}${suffix}`;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
  fs.copyFileSync(source, target);
  return { ok: true, path: target };
}

export function inTransaction<T>(fn: (database: SqliteDatabase) => T): T {
  const database = getDb();
  return database.transaction(() => fn(database))();
}

async function openDatabase(): Promise<SqliteDatabase> {
  const BetterSqlite3 = require("better-sqlite3");
  return new BetterSqlite3(getDatabasePath());
}

export function validateSqliteBackup(filePath: string) {
  const header = Buffer.alloc(16);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header.toString("utf8") !== "SQLite format 3\0") {
    throw new Error("invalid-sqlite-backup");
  }

  try {
    const BetterSqlite3 = require("better-sqlite3");
    const candidate = new BetterSqlite3(filePath, { readonly: true, fileMustExist: true });
    try {
      const integrity = candidate.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") {
        throw new Error("integrity-check-failed");
      }
      candidate.prepare("SELECT name FROM sqlite_master LIMIT 1").all();
    } finally {
      candidate.close();
    }
  } catch (error: any) {
    if (error?.message === "integrity-check-failed") {
      throw new Error("invalid-sqlite-backup");
    }
    throw new Error("invalid-sqlite-backup");
  }
}

function runSchema(database: SqliteDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'cashier')),
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      hash_algo TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      require_password_change INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_recovery_codes (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
      hash_algo TEXT NOT NULL,
      salt TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_user_unused
      ON admin_recovery_codes(username, used_at);

    CREATE TABLE IF NOT EXISTS seating_areas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_seating_areas_active_sort
      ON seating_areas(active, sort_order, name);

    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY,
      name TEXT,
      seats INTEGER NOT NULL DEFAULT 4,
      area_id TEXT NOT NULL DEFAULT 'area:main' REFERENCES seating_areas(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      sort_order INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS menu_items (
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

    CREATE TABLE IF NOT EXISTS menu_item_variants (
      id TEXT PRIMARY KEY,
      menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(menu_item_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_menu_item_variants_item
      ON menu_item_variants(menu_item_id, sort_order, name);

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_active
      ON customers(phone) WHERE active = 1;

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      designation TEXT NOT NULL,
      joining_date TEXT,
      salary_paise INTEGER,
      address TEXT,
      notes TEXT,
      photo_mime TEXT,
      photo_base64 TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_phone_active
      ON staff(phone) WHERE active = 1;

    CREATE TABLE IF NOT EXISTS attendance_records (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      attendance_date TEXT NOT NULL,
      shift_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'half-day', 'leave', 'holiday', 'week-off', 'late')),
      check_in_time TEXT,
      check_out_time TEXT,
      break_minutes INTEGER NOT NULL DEFAULT 0,
      worked_minutes INTEGER NOT NULL DEFAULT 0,
      overtime_minutes INTEGER NOT NULL DEFAULT 0,
      remarks TEXT,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      created_on INTEGER NOT NULL,
      updated_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      updated_on INTEGER NOT NULL,
      UNIQUE(staff_id, attendance_date)
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_staff
      ON attendance_records(staff_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_date
      ON attendance_records(attendance_date);
    CREATE INDEX IF NOT EXISTS idx_attendance_status
      ON attendance_records(status);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_type TEXT NOT NULL CHECK (order_type IN ('table', 'takeaway', 'delivery')),
      table_id INTEGER REFERENCES tables(id) ON UPDATE CASCADE ON DELETE SET NULL,
      customer_id TEXT REFERENCES customers(id) ON UPDATE CASCADE ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'held', 'ready', 'assigned', 'paid', 'cancelled')),
      kot_status TEXT NOT NULL DEFAULT 'pending' CHECK (kot_status IN ('pending', 'sent', 'printed', 'failed')),
      subtotal_paise INTEGER NOT NULL DEFAULT 0,
      tax_total_paise INTEGER NOT NULL DEFAULT 0,
      discount_percent REAL NOT NULL DEFAULT 0,
      discount_total_paise INTEGER NOT NULL DEFAULT 0,
      total_paise INTEGER NOT NULL DEFAULT 0,
      invoice_number TEXT,
      paid_at INTEGER,
      meta_json TEXT,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status_updated ON orders(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_table_status ON orders(table_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_type_status ON orders(order_type, status);

    CREATE TABLE IF NOT EXISTS order_lines (
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

    CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id, sort_order);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
      amount_paid_paise INTEGER,
      change_paise INTEGER,
      txn_ref TEXT,
      split_json TEXT,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided', 'refunded')),
      received_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      received_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payments_received_at ON payments(received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      user TEXT,
      detail_json TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

    CREATE TABLE IF NOT EXISTS audit_archives (
      id TEXT PRIMARY KEY,
      start_date INTEGER NOT NULL,
      end_date INTEGER NOT NULL,
      count INTEGER NOT NULL,
      archived_at INTEGER NOT NULL,
      compressed INTEGER NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_archives_archived_at
      ON audit_archives(archived_at DESC);

    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      printer_key TEXT NOT NULL,
      job_type TEXT NOT NULL CHECK (job_type IN ('receipt', 'kot', 'label')),
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      error TEXT,
      created_at INTEGER NOT NULL,
      last_retry_at INTEGER,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_print_jobs_status_created ON print_jobs(status, created_at);

    CREATE TABLE IF NOT EXISTS backup_records (
      id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      path_or_provider TEXT,
      status TEXT NOT NULL,
      checksum TEXT,
      size_bytes INTEGER,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_backup_records_created ON backup_records(created_at DESC);

    CREATE TABLE IF NOT EXISTS grocery_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      default_unit TEXT NOT NULL,
      default_quantity REAL NOT NULL CHECK (default_quantity > 0),
      vendor_hint TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_items_active_name
      ON grocery_items(active, name);

    CREATE TABLE IF NOT EXISTS grocery_lists (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      list_date INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'printed', 'purchased')),
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_lists_date
      ON grocery_lists(list_date DESC);

    CREATE TABLE IF NOT EXISTS grocery_list_lines (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
      grocery_item_id TEXT REFERENCES grocery_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
      item_name TEXT NOT NULL,
      category TEXT,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL,
      vendor_hint TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_list_lines_list
      ON grocery_list_lines(list_id, sort_order);

    CREATE TABLE IF NOT EXISTS grocery_purchase_lines (
      id TEXT PRIMARY KEY,
      list_id TEXT REFERENCES grocery_lists(id) ON DELETE SET NULL,
      grocery_item_id TEXT REFERENCES grocery_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
      item_name TEXT NOT NULL,
      category TEXT,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL,
      unit_price_paise INTEGER,
      total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
      vendor TEXT,
      payment_method TEXT,
      notes TEXT,
      purchased_at INTEGER NOT NULL,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_purchase_lines_date
      ON grocery_purchase_lines(active, purchased_at DESC);
    CREATE INDEX IF NOT EXISTS idx_grocery_purchase_lines_item
      ON grocery_purchase_lines(grocery_item_id, active, purchased_at DESC);
  `);

  const existing = database
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(1);
  if (!existing) {
    database
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(1, "Initial SQLite production schema", Date.now());
  }

  const archiveMigration = database
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(2);
  if (!archiveMigration) {
    database
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(2, "Add audit archive snapshots", Date.now());
  }

  const recoveryMigration = database
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(3);
  if (!recoveryMigration) {
    database
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(3, "Add admin recovery codes", Date.now());
  }

  const staffMigration = database
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(4);
  if (!staffMigration) {
    database
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(4, "Add staff roster", Date.now());
  }

  runMigration(database, 5, "Add paid invoice metadata", () => {
    addColumnIfMissing(database, "orders", "invoice_number", "TEXT");
    addColumnIfMissing(database, "orders", "paid_at", "INTEGER");
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number
        ON orders(invoice_number) WHERE invoice_number IS NOT NULL;
    `);
  });

  runMigration(database, 6, "Add order line category snapshot", () => {
    addColumnIfMissing(database, "order_lines", "category_name", "TEXT");
  });

  runMigration(database, 7, "Add grocery purchasing ledger", () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS grocery_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        default_unit TEXT NOT NULL,
        default_quantity REAL NOT NULL CHECK (default_quantity > 0),
        vendor_hint TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_grocery_items_active_name
        ON grocery_items(active, name);

      CREATE TABLE IF NOT EXISTS grocery_lists (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        list_date INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'printed', 'purchased')),
        created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_grocery_lists_date
        ON grocery_lists(list_date DESC);

      CREATE TABLE IF NOT EXISTS grocery_list_lines (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
        grocery_item_id TEXT REFERENCES grocery_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
        item_name TEXT NOT NULL,
        category TEXT,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit TEXT NOT NULL,
        vendor_hint TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_grocery_list_lines_list
        ON grocery_list_lines(list_id, sort_order);

      CREATE TABLE IF NOT EXISTS grocery_purchase_lines (
        id TEXT PRIMARY KEY,
        list_id TEXT REFERENCES grocery_lists(id) ON DELETE SET NULL,
        grocery_item_id TEXT REFERENCES grocery_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
        item_name TEXT NOT NULL,
        category TEXT,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit TEXT NOT NULL,
        unit_price_paise INTEGER,
        total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
        vendor TEXT,
        payment_method TEXT,
        notes TEXT,
        purchased_at INTEGER NOT NULL,
        created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_grocery_purchase_lines_date
        ON grocery_purchase_lines(active, purchased_at DESC);
      CREATE INDEX IF NOT EXISTS idx_grocery_purchase_lines_item
        ON grocery_purchase_lines(grocery_item_id, active, purchased_at DESC);
    `);
  });

  runMigration(database, 8, "Hard-delete soft-deleted menu items", () => {
    database.exec("DELETE FROM menu_items WHERE active = 0");
  });

  runMigration(database, 9, "Hard-delete soft-deleted grocery items and purchases", () => {
    database.exec("DELETE FROM grocery_purchase_lines WHERE active = 0");
    database.exec("DELETE FROM grocery_items WHERE active = 0");
  });

  runMigration(database, 10, "Add menu item variants", () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS menu_item_variants (
        id TEXT PRIMARY KEY,
        menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE,
        price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(menu_item_id, name)
      );

      CREATE INDEX IF NOT EXISTS idx_menu_item_variants_item
        ON menu_item_variants(menu_item_id, sort_order, name);
    `);
  });

  runMigration(database, 11, "Add attendance records", () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES staff(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        attendance_date TEXT NOT NULL,
        shift_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'half-day', 'leave', 'holiday', 'week-off', 'late')),
        check_in_time TEXT,
        check_out_time TEXT,
        break_minutes INTEGER NOT NULL DEFAULT 0,
        worked_minutes INTEGER NOT NULL DEFAULT 0,
        overtime_minutes INTEGER NOT NULL DEFAULT 0,
        remarks TEXT,
        created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
        created_on INTEGER NOT NULL,
        updated_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
        updated_on INTEGER NOT NULL,
        UNIQUE(staff_id, attendance_date)
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_staff
        ON attendance_records(staff_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_date
        ON attendance_records(attendance_date);
      CREATE INDEX IF NOT EXISTS idx_attendance_status
        ON attendance_records(status);
    `);
  });

  runMigration(database, 12, "Add seating areas", () => {
    const at = Date.now();
    database.exec(`
      CREATE TABLE IF NOT EXISTS seating_areas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_seating_areas_active_sort
        ON seating_areas(active, sort_order, name);
    `);
    database
      .prepare(
        `INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
         VALUES (?, ?, 1, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           active = 1,
           updated_at = excluded.updated_at`,
      )
      .run(DEFAULT_SEATING_AREA_ID, DEFAULT_SEATING_AREA_NAME, at, at);
    addColumnIfMissing(
      database,
      "tables",
      "area_id",
      `TEXT NOT NULL DEFAULT '${DEFAULT_SEATING_AREA_ID}'`,
    );
    database
      .prepare("UPDATE tables SET area_id = ? WHERE area_id IS NULL OR trim(area_id) = ''")
      .run(DEFAULT_SEATING_AREA_ID);
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_tables_area_sort
        ON tables(area_id, sort_order, id);
    `);
  });

  // Startup self-healing for pre-existing/partially migrated databases:
  // ensure area_id exists even if migration 12 was marked applied while the column was missing.
  addColumnIfMissing(database, "tables", "area_id", `TEXT NOT NULL DEFAULT '${DEFAULT_SEATING_AREA_ID}'`);
  database
    .prepare("UPDATE tables SET area_id = ? WHERE area_id IS NULL OR trim(area_id) = ''")
    .run(DEFAULT_SEATING_AREA_ID);
  database
    .prepare(
      `INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
       VALUES (?, ?, 1, 1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(DEFAULT_SEATING_AREA_ID, DEFAULT_SEATING_AREA_NAME, Date.now(), Date.now());
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tables_area_sort
      ON tables(area_id, sort_order, id);
  `);
}

function runMigration(
  database: SqliteDatabase,
  version: number,
  name: string,
  migrate: () => void,
) {
  const existing = database
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(version);
  if (existing) {
    return;
  }
  migrate();
  database
    .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
    .run(version, name, Date.now());
}

function columnExists(database: SqliteDatabase, tableName: string, columnName: string) {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function addColumnIfMissing(
  database: SqliteDatabase,
  tableName: string,
  columnName: string,
  definition: string,
) {
  if (!columnExists(database, tableName, columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function seedDatabase(database: SqliteDatabase) {
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
       VALUES (?, ?, 1, 1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(DEFAULT_SEATING_AREA_ID, DEFAULT_SEATING_AREA_NAME, now, now);
  const tableCount = Number(process.env.VITE_TABLE_COUNT || process.env.TABLE_COUNT || 12);
  const currentTables = database.prepare("SELECT COUNT(*) AS count FROM tables").get() as {
    count: number;
  };
  if (!currentTables.count) {
    const insert = database.prepare(`
      INSERT INTO tables (id, name, seats, area_id, sort_order, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const tx = database.transaction(() => {
      for (let i = 1; i <= tableCount; i++) {
        insert.run(i, `Table ${i}`, i % 4 === 0 ? 6 : 4, DEFAULT_SEATING_AREA_ID, i, now, now);
      }
    });
    tx();
  }

  const categoryCount = database.prepare("SELECT COUNT(*) AS count FROM menu_categories").get() as {
    count: number;
  };
  if (!categoryCount.count) {
    const insertCategory = database.prepare(`
      INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);
    const categories = ["Mains", "Beverages", "Sides"];
    categories.forEach((name, index) => {
      insertCategory.run(slugId("cat", name), name, index + 1, now, now);
    });
  }

  const itemCount = database.prepare("SELECT COUNT(*) AS count FROM menu_items").get() as {
    count: number;
  };
  if (!itemCount.count) {
    const insertItem = database.prepare(`
      INSERT INTO menu_items (
        id, sku, name, category_id, price_paise, available, favorite, tax_rate_bps, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, 1800, 1, ?, ?)
    `);
    const items = [
      {
        id: "item:burger",
        sku: "BGR01",
        name: "Burger",
        price: 120,
        category: "Mains",
        favorite: 1,
      },
      { id: "item:tea", sku: "TEA01", name: "Tea", price: 20, category: "Beverages", favorite: 0 },
      { id: "item:fries", sku: "FRY01", name: "Fries", price: 80, category: "Sides", favorite: 1 },
      { id: "item:pizza", sku: "PZ01", name: "Pizza", price: 250, category: "Mains", favorite: 1 },
    ];
    items.forEach((item) => {
      insertItem.run(
        item.id,
        item.sku,
        item.name,
        slugId("cat", item.category),
        rupeesToPaise(item.price),
        item.favorite,
        now,
        now,
      );
    });
  }

  const insertSetting = database.prepare(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  insertSetting.run("config:printers", JSON.stringify({ printerPort: 9100 }), now);
  insertSetting.run("config:audit", JSON.stringify({ retentionDays: 90 }), now);
  insertSetting.run("config:history", JSON.stringify({ retentionDays: null }), now);
  insertSetting.run("config:tables", JSON.stringify({ tableCount }), now);
  insertSetting.run(
    "config:invoice",
    JSON.stringify({ prefix: "INV", fiscalYear: "", lastNumber: 0 }),
    now,
  );
  insertSetting.run(
    "config:gst",
    JSON.stringify({
      enabled: false,
      gstin: "",
      legalName: "",
      registeredAddress: "",
      stateCode: "",
      stateName: "",
      gstRateBps: 1800,
      priceIncludesTax: true,
    }),
    now,
  );
  insertSetting.run(
    "config:branding",
    JSON.stringify({
      hotelName: "",
      hotelInitials: "",
      tagline: "POINT OF SALE",
      phone: "",
      email: "",
      logoDataUrl: null,
      receiptLogoRaster: null,
      logoUpdatedAt: 0,
    }),
    now,
  );
}

function slugId(prefix: string, value: string) {
  return `${prefix}:${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function rupeesToPaise(value: number) {
  return Math.round((Number(value) || 0) * 100);
}
