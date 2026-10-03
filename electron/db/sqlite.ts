import "../env";
import { app } from "electron";
import { randomUUID } from "crypto";
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

/** Snapshots the open SQLite database only. License files under userData/license are not included. */
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
      role TEXT NOT NULL CHECK (role IN ('admin', 'cashier', 'manager', 'captain')),
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      hash_algo TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      require_password_change INTEGER NOT NULL DEFAULT 0,
      staff_id TEXT REFERENCES staff(id) ON UPDATE CASCADE ON DELETE SET NULL,
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
      tax_rate_bps INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      diet TEXT CHECK (diet IS NULL OR diet IN ('veg', 'non-veg', 'egg')),
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
      credit_enabled INTEGER NOT NULL DEFAULT 0,
      credit_blocked INTEGER NOT NULL DEFAULT 0,
      credit_limit_paise INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0),
      default_credit_days INTEGER,
      outstanding_paise INTEGER NOT NULL DEFAULT 0 CHECK (outstanding_paise >= 0),
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
      weekly_off_days TEXT NOT NULL DEFAULT '[]',
      default_shift_id TEXT NOT NULL DEFAULT 'morning',
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
      shift_id TEXT NOT NULL DEFAULT 'morning',
      status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'half-day', 'leave', 'holiday')),
      is_late INTEGER NOT NULL DEFAULT 0,
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
      UNIQUE(staff_id, attendance_date, shift_id)
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
      cancelled_at INTEGER,
      cancelled_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      cancellation_reason TEXT,
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
      tax_rate_bps INTEGER,
      line_total_paise INTEGER NOT NULL DEFAULT 0,
      kot_printed_qty REAL NOT NULL DEFAULT 0,
      kitchen_note TEXT,
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
      created_at INTEGER NOT NULL,
      cloud_backup_id TEXT,
      error TEXT
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
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_items_active_name
      ON grocery_items(active, name);

    CREATE TABLE IF NOT EXISTS grocery_lists (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      list_date INTEGER NOT NULL,
      list_type TEXT NOT NULL DEFAULT 'regular'
        CHECK (list_type IN ('regular', 'refill', 'emergency', 'custom')),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'open', 'partial', 'completed', 'cancelled')),
      notes TEXT,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      updated_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      completed_at INTEGER,
      print_count INTEGER NOT NULL DEFAULT 0,
      last_printed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_lists_date
      ON grocery_lists(list_date DESC);
    CREATE INDEX IF NOT EXISTS idx_grocery_lists_status_date
      ON grocery_lists(status, list_date DESC);

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
      estimated_unit_price_paise INTEGER,
      estimated_total_paise INTEGER,
      purchased_quantity REAL,
      purchased_unit_price_paise INTEGER,
      purchased_total_paise INTEGER,
      line_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (line_status IN ('pending', 'partial', 'purchased', 'skipped')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_list_lines_list
      ON grocery_list_lines(list_id, sort_order);

    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      gstin TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_name_active
      ON vendors(name) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS grocery_purchases (
      id TEXT PRIMARY KEY,
      buying_list_id TEXT REFERENCES grocery_lists(id) ON DELETE SET NULL,
      vendor_id TEXT REFERENCES vendors(id) ON UPDATE CASCADE ON DELETE SET NULL,
      purchase_date INTEGER NOT NULL,
      invoice_number TEXT,
      payment_method TEXT,
      status TEXT NOT NULL DEFAULT 'recorded'
        CHECK (status IN ('recorded', 'voided')),
      payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'partial', 'paid')),
      amount_paid_paise INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_paise >= 0),
      subtotal_paise INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_paise >= 0),
      tax_paise INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
      total_paise INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
      notes TEXT,
      migration_source TEXT,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_purchases_date
      ON grocery_purchases(purchase_date DESC);
    CREATE INDEX IF NOT EXISTS idx_grocery_purchases_list
      ON grocery_purchases(buying_list_id, purchase_date DESC);
    CREATE INDEX IF NOT EXISTS idx_grocery_purchases_vendor
      ON grocery_purchases(vendor_id, purchase_date DESC);

    CREATE TABLE IF NOT EXISTS grocery_purchase_lines (
      id TEXT PRIMARY KEY,
      purchase_id TEXT REFERENCES grocery_purchases(id) ON DELETE CASCADE,
      list_id TEXT REFERENCES grocery_lists(id) ON DELETE SET NULL,
      list_line_id TEXT REFERENCES grocery_list_lines(id) ON DELETE SET NULL,
      grocery_item_id TEXT REFERENCES grocery_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
      item_name TEXT NOT NULL,
      category TEXT,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL,
      unit_price_paise INTEGER,
      total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
      vendor TEXT,
      vendor_id TEXT REFERENCES vendors(id) ON UPDATE CASCADE ON DELETE SET NULL,
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

    CREATE TABLE IF NOT EXISTS expense_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      slug TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_slug
      ON expense_categories(slug) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES expense_categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
      expense_date INTEGER NOT NULL,
      vendor_id TEXT REFERENCES vendors(id) ON UPDATE CASCADE ON DELETE SET NULL,
      description TEXT,
      payment_method TEXT,
      invoice_number TEXT,
      recurring_expense_id TEXT,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_date
      ON expenses(expense_date DESC);
    CREATE INDEX IF NOT EXISTS idx_expenses_category_date
      ON expenses(category_id, expense_date DESC);

    CREATE TABLE IF NOT EXISTS salary_advances (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      advance_date INTEGER NOT NULL,
      note TEXT,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_salary_advances_date
      ON salary_advances(advance_date DESC);
    CREATE INDEX IF NOT EXISTS idx_salary_advances_staff_date
      ON salary_advances(staff_id, advance_date DESC);

    CREATE TABLE IF NOT EXISTS grocery_list_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_list_templates_active_name
      ON grocery_list_templates(active, name);

    CREATE TABLE IF NOT EXISTS grocery_list_template_lines (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES grocery_list_templates(id) ON DELETE CASCADE,
      grocery_item_id TEXT REFERENCES grocery_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
      item_name TEXT NOT NULL,
      category TEXT,
      default_quantity REAL,
      unit TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_list_template_lines_template
      ON grocery_list_template_lines(template_id, sort_order);
  `);

  bootstrapLegacyGroceryColumns(database);

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
        status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'half-day', 'leave', 'holiday')),
        is_late INTEGER NOT NULL DEFAULT 0,
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

  runMigration(database, 13, "Rebuild grocery_lists lifecycle and print counters", () => {
    if (columnExists(database, "grocery_lists", "list_type")) {
      return;
    }
    // Must disable FKs: grocery_list_lines / grocery_purchase_lines reference grocery_lists.
    database.pragma("foreign_keys = OFF");
    try {
      database.exec(`
        CREATE TABLE grocery_lists_new (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          list_date INTEGER NOT NULL,
          list_type TEXT NOT NULL DEFAULT 'regular'
            CHECK (list_type IN ('regular', 'refill', 'emergency', 'custom')),
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft', 'open', 'partial', 'completed', 'cancelled')),
          notes TEXT,
          created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
          updated_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
          completed_at INTEGER,
          print_count INTEGER NOT NULL DEFAULT 0,
          last_printed_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        INSERT INTO grocery_lists_new (
          id, title, list_date, list_type, status, notes, created_by, updated_by,
          completed_at, print_count, last_printed_at, created_at, updated_at
        )
        SELECT
          id,
          title,
          list_date,
          'regular',
          CASE status
            WHEN 'printed' THEN 'open'
            WHEN 'purchased' THEN 'completed'
            ELSE 'draft'
          END,
          NULL,
          created_by,
          NULL,
          CASE WHEN status = 'purchased' THEN updated_at ELSE NULL END,
          CASE WHEN status = 'printed' THEN 1 ELSE 0 END,
          CASE WHEN status = 'printed' THEN updated_at ELSE NULL END,
          created_at,
          updated_at
        FROM grocery_lists;

        DROP TABLE grocery_lists;
        ALTER TABLE grocery_lists_new RENAME TO grocery_lists;

        CREATE INDEX IF NOT EXISTS idx_grocery_lists_date
          ON grocery_lists(list_date DESC);
        CREATE INDEX IF NOT EXISTS idx_grocery_lists_status_date
          ON grocery_lists(status, list_date DESC);
      `);
    } finally {
      database.pragma("foreign_keys = ON");
    }
  });

  runMigration(database, 14, "Add planned vs purchased fields on grocery_list_lines", () => {
    addColumnIfMissing(database, "grocery_list_lines", "estimated_unit_price_paise", "INTEGER");
    addColumnIfMissing(database, "grocery_list_lines", "estimated_total_paise", "INTEGER");
    addColumnIfMissing(database, "grocery_list_lines", "purchased_quantity", "REAL");
    addColumnIfMissing(database, "grocery_list_lines", "purchased_unit_price_paise", "INTEGER");
    addColumnIfMissing(database, "grocery_list_lines", "purchased_total_paise", "INTEGER");
    addColumnIfMissing(
      database,
      "grocery_list_lines",
      "line_status",
      "TEXT NOT NULL DEFAULT 'pending'",
    );
  });

  runMigration(database, 15, "Add vendors master and link purchase lines", () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS vendors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE,
        contact_person TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        gstin TEXT,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_name_active
        ON vendors(name) WHERE deleted_at IS NULL;
    `);
    addColumnIfMissing(database, "grocery_purchase_lines", "vendor_id", "TEXT");
    addColumnIfMissing(database, "grocery_items", "deleted_at", "INTEGER");

    const at = Date.now();
    const vendorRows = database
      .prepare(
        `SELECT DISTINCT trim(vendor) AS vendor_name
         FROM grocery_purchase_lines
         WHERE vendor IS NOT NULL AND trim(vendor) != ''`,
      )
      .all() as Array<{ vendor_name: string }>;

    const insertVendor = database.prepare(
      `INSERT INTO vendors (id, name, active, created_at, updated_at, deleted_at)
       VALUES (?, ?, 1, ?, ?, NULL)
       ON CONFLICT(id) DO NOTHING`,
    );
    const findVendor = database.prepare(
      `SELECT id FROM vendors WHERE deleted_at IS NULL AND name = ? COLLATE NOCASE LIMIT 1`,
    );
    const updateLines = database.prepare(
      `UPDATE grocery_purchase_lines
       SET vendor_id = ?
       WHERE vendor_id IS NULL AND trim(COALESCE(vendor, '')) = ?`,
    );

    for (const row of vendorRows) {
      const name = String(row.vendor_name || "").trim();
      if (!name) {
        continue;
      }
      let existing = findVendor.get(name) as { id: string } | undefined;
      if (!existing) {
        const id = `vendor:${randomUUID()}`;
        insertVendor.run(id, name, at, at);
        existing = { id };
      }
      updateLines.run(existing.id, name);
    }
  });

  runMigration(database, 16, "Add grocery_purchases headers without merging uncertain rows", () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS grocery_purchases (
        id TEXT PRIMARY KEY,
        buying_list_id TEXT REFERENCES grocery_lists(id) ON DELETE SET NULL,
        vendor_id TEXT REFERENCES vendors(id) ON UPDATE CASCADE ON DELETE SET NULL,
        purchase_date INTEGER NOT NULL,
        invoice_number TEXT,
        payment_method TEXT,
        status TEXT NOT NULL DEFAULT 'recorded'
          CHECK (status IN ('recorded', 'voided')),
        payment_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (payment_status IN ('pending', 'partial', 'paid')),
        amount_paid_paise INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_paise >= 0),
        subtotal_paise INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_paise >= 0),
        tax_paise INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
        total_paise INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
        notes TEXT,
        migration_source TEXT,
        created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_grocery_purchases_date
        ON grocery_purchases(purchase_date DESC);
      CREATE INDEX IF NOT EXISTS idx_grocery_purchases_list
        ON grocery_purchases(buying_list_id, purchase_date DESC);
      CREATE INDEX IF NOT EXISTS idx_grocery_purchases_vendor
        ON grocery_purchases(vendor_id, purchase_date DESC);
    `);
    addColumnIfMissing(database, "grocery_purchase_lines", "purchase_id", "TEXT");

    if (!columnExists(database, "grocery_purchase_lines", "purchase_id")) {
      return;
    }

    const at = Date.now();
    const insertPurchase = database.prepare(
      `INSERT INTO grocery_purchases (
         id, buying_list_id, vendor_id, purchase_date, invoice_number, payment_method,
         status, payment_status, amount_paid_paise, subtotal_paise, tax_paise, total_paise,
         notes, migration_source, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, 'recorded', 'paid', ?, ?, 0, ?, NULL, 'legacy_grocery_purchase', ?, ?, ?)`,
    );
    const linkLines = database.prepare(
      `UPDATE grocery_purchase_lines SET purchase_id = ? WHERE id = ? AND purchase_id IS NULL`,
    );

    // Group only by (list_id, vendor_id) when list_id is present — never by date.
    const grouped = database
      .prepare(
        `SELECT list_id, vendor_id,
                MIN(purchased_at) AS purchase_date,
                MAX(payment_method) AS payment_method,
                MAX(created_by) AS created_by,
                SUM(total_paise) AS total_paise,
                GROUP_CONCAT(id) AS line_ids
         FROM grocery_purchase_lines
         WHERE purchase_id IS NULL AND list_id IS NOT NULL
         GROUP BY list_id, COALESCE(vendor_id, '')`,
      )
      .all() as Array<{
      list_id: string;
      vendor_id: string | null;
      purchase_date: number;
      payment_method: string | null;
      created_by: string | null;
      total_paise: number;
      line_ids: string;
    }>;

    for (const group of grouped) {
      const purchaseId = `grocery-purchase-hdr:${randomUUID()}`;
      const total = Number(group.total_paise || 0);
      insertPurchase.run(
        purchaseId,
        group.list_id,
        group.vendor_id || null,
        Number(group.purchase_date || at),
        group.payment_method || null,
        total,
        total,
        total,
        group.created_by || null,
        at,
        at,
      );
      for (const lineId of String(group.line_ids || "").split(",")) {
        if (lineId) {
          linkLines.run(purchaseId, lineId);
        }
      }
    }

    // Orphan lines (no list_id): one header each — never merge.
    const orphans = database
      .prepare(
        `SELECT id, vendor_id, purchased_at, payment_method, created_by, total_paise
         FROM grocery_purchase_lines
         WHERE purchase_id IS NULL`,
      )
      .all() as Array<{
      id: string;
      vendor_id: string | null;
      purchased_at: number;
      payment_method: string | null;
      created_by: string | null;
      total_paise: number;
    }>;

    for (const orphan of orphans) {
      const purchaseId = `grocery-purchase-hdr:${randomUUID()}`;
      const total = Number(orphan.total_paise || 0);
      insertPurchase.run(
        purchaseId,
        null,
        orphan.vendor_id || null,
        Number(orphan.purchased_at || at),
        orphan.payment_method || null,
        total,
        total,
        total,
        orphan.created_by || null,
        at,
        at,
      );
      linkLines.run(purchaseId, orphan.id);
    }

    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_grocery_purchase_lines_purchase
        ON grocery_purchase_lines(purchase_id);
    `);
  });

  runMigration(database, 17, "Add expense categories and expenses", () => {
    const at = Date.now();
    database.exec(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE,
        slug TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_system INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_slug
        ON expense_categories(slug) WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL REFERENCES expense_categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
        expense_date INTEGER NOT NULL,
        vendor_id TEXT REFERENCES vendors(id) ON UPDATE CASCADE ON DELETE SET NULL,
        description TEXT,
        payment_method TEXT,
        invoice_number TEXT,
        recurring_expense_id TEXT,
        created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_expenses_date
        ON expenses(expense_date DESC);
      CREATE INDEX IF NOT EXISTS idx_expenses_category_date
        ON expenses(category_id, expense_date DESC);
    `);

    const seed = [
      ["Staff", "staff", 1],
      ["Rent", "rent", 2],
      ["Electricity", "electricity", 3],
      ["Water", "water", 4],
      ["Gas", "gas", 5],
      ["Maintenance", "maintenance", 6],
      ["Packaging", "packaging", 7],
      ["Cleaning", "cleaning", 8],
      ["Transportation", "transportation", 9],
      ["Internet / Phone", "internet-phone", 10],
      ["Software / Subscription", "software-subscription", 11],
      ["Marketing", "marketing", 12],
      ["Miscellaneous", "miscellaneous", 13],
    ] as const;

    const insertCategory = database.prepare(
      `INSERT INTO expense_categories (id, name, slug, sort_order, is_system, active, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?, NULL)
       ON CONFLICT(id) DO NOTHING`,
    );
    for (const [name, slug, sortOrder] of seed) {
      insertCategory.run(`expense-category:${slug}`, name, slug, sortOrder, at, at);
    }
  });

  runMigration(database, 18, "Add grocery list templates", () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS grocery_list_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE,
        description TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_grocery_list_templates_active_name
        ON grocery_list_templates(active, name);

      CREATE TABLE IF NOT EXISTS grocery_list_template_lines (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES grocery_list_templates(id) ON DELETE CASCADE,
        grocery_item_id TEXT REFERENCES grocery_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
        item_name TEXT NOT NULL,
        category TEXT,
        default_quantity REAL,
        unit TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_grocery_list_template_lines_template
        ON grocery_list_template_lines(template_id, sort_order);
    `);
  });

  runMigration(
    database,
    19,
    "People module: staff-account link and attendance shift uniqueness",
    () => {
      addColumnIfMissing(
        database,
        "users",
        "staff_id",
        "TEXT REFERENCES staff(id) ON UPDATE CASCADE ON DELETE SET NULL",
      );
      database.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_staff_id ON users(staff_id) WHERE staff_id IS NOT NULL;
    `);

      database.exec(`
      CREATE TABLE IF NOT EXISTS attendance_records_v19 (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES staff(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        attendance_date TEXT NOT NULL,
        shift_id TEXT NOT NULL DEFAULT 'morning',
        status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'half-day', 'leave', 'holiday')),
        is_late INTEGER NOT NULL DEFAULT 0,
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
        UNIQUE(staff_id, attendance_date, shift_id)
      );

      INSERT INTO attendance_records_v19 (
        id, staff_id, attendance_date, shift_id, status, check_in_time, check_out_time,
        break_minutes, worked_minutes, overtime_minutes, remarks,
        created_by, created_on, updated_by, updated_on
      )
      SELECT
        id, staff_id, attendance_date, COALESCE(NULLIF(trim(shift_id), ''), 'morning'), status,
        check_in_time, check_out_time, break_minutes, worked_minutes, overtime_minutes, remarks,
        created_by, created_on, updated_by, updated_on
      FROM attendance_records;

      DROP TABLE attendance_records;
      ALTER TABLE attendance_records_v19 RENAME TO attendance_records;

      CREATE INDEX IF NOT EXISTS idx_attendance_staff ON attendance_records(staff_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);
      CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_records(status);
    `);
    },
  );

  runMigration(
    database,
    20,
    "Attendance model: is_late, staff schedule, remove week-off/late status",
    () => {
      addColumnIfMissing(database, "staff", "weekly_off_days", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(database, "staff", "default_shift_id", "TEXT NOT NULL DEFAULT 'morning'");
      database
        .prepare(
          "UPDATE staff SET default_shift_id = 'morning' WHERE default_shift_id IS NULL OR trim(default_shift_id) = ''",
        )
        .run();
      database
        .prepare(
          "UPDATE staff SET weekly_off_days = '[]' WHERE weekly_off_days IS NULL OR trim(weekly_off_days) = ''",
        )
        .run();

      database.exec(`
      CREATE TABLE IF NOT EXISTS attendance_records_v20 (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES staff(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        attendance_date TEXT NOT NULL,
        shift_id TEXT NOT NULL DEFAULT 'morning',
        status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'half-day', 'leave', 'holiday')),
        is_late INTEGER NOT NULL DEFAULT 0,
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
        UNIQUE(staff_id, attendance_date, shift_id)
      );

      INSERT INTO attendance_records_v20 (
        id, staff_id, attendance_date, shift_id, status, is_late, check_in_time, check_out_time,
        break_minutes, worked_minutes, overtime_minutes, remarks,
        created_by, created_on, updated_by, updated_on
      )
      SELECT
        id,
        staff_id,
        attendance_date,
        COALESCE(NULLIF(trim(shift_id), ''), 'morning'),
        CASE
          WHEN status = 'late' THEN 'present'
          WHEN status = 'week-off' THEN 'absent'
          ELSE status
        END,
        CASE WHEN status = 'late' THEN 1 ELSE 0 END,
        check_in_time,
        check_out_time,
        break_minutes,
        worked_minutes,
        overtime_minutes,
        remarks,
        created_by,
        created_on,
        updated_by,
        updated_on
      FROM attendance_records
      WHERE status IN ('present', 'absent', 'half-day', 'leave', 'holiday', 'late');

      DROP TABLE attendance_records;
      ALTER TABLE attendance_records_v20 RENAME TO attendance_records;

      CREATE INDEX IF NOT EXISTS idx_attendance_staff ON attendance_records(staff_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);
      CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_records(status);
    `);
    },
  );

  runMigration(database, 21, "Add salary advances ledger", () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS salary_advances (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES staff(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
        advance_date INTEGER NOT NULL,
        note TEXT,
        created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_salary_advances_date
        ON salary_advances(advance_date DESC);
      CREATE INDEX IF NOT EXISTS idx_salary_advances_staff_date
        ON salary_advances(staff_id, advance_date DESC);
    `);
  });

  runMigration(database, 22, "Allow manager login role", () => {
    database.exec(`
      CREATE TABLE users_v22 (
        username TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'cashier', 'manager')),
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        hash_algo TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        require_password_change INTEGER NOT NULL DEFAULT 0,
        staff_id TEXT REFERENCES staff(id) ON UPDATE CASCADE ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO users_v22 (
        username, display_name, role, password_hash, salt, hash_algo,
        active, require_password_change, staff_id, created_at, updated_at
      )
      SELECT
        username, display_name, role, password_hash, salt, hash_algo,
        active, require_password_change, staff_id, created_at, updated_at
      FROM users;

      DROP TABLE users;
      ALTER TABLE users_v22 RENAME TO users;
    `);
  });

  runMigration(database, 23, "Add audit log full-text search index", () => {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS audit_logs_fts USING fts5(
        audit_id UNINDEXED,
        action,
        entity_type,
        entity_id,
        user,
        detail_json,
        tokenize='unicode61'
      );

      INSERT INTO audit_logs_fts(audit_id, action, entity_type, entity_id, user, detail_json)
      SELECT
        id,
        action,
        COALESCE(entity_type, ''),
        COALESCE(entity_id, ''),
        COALESCE(user, ''),
        COALESCE(detail_json, '')
      FROM audit_logs;

      CREATE TRIGGER IF NOT EXISTS audit_logs_fts_ai AFTER INSERT ON audit_logs BEGIN
        INSERT INTO audit_logs_fts(audit_id, action, entity_type, entity_id, user, detail_json)
        VALUES (
          new.id,
          new.action,
          COALESCE(new.entity_type, ''),
          COALESCE(new.entity_id, ''),
          COALESCE(new.user, ''),
          COALESCE(new.detail_json, '')
        );
      END;

      CREATE TRIGGER IF NOT EXISTS audit_logs_fts_ad AFTER DELETE ON audit_logs BEGIN
        DELETE FROM audit_logs_fts WHERE audit_id = old.id;
      END;
    `);
  });

  runMigration(database, 24, "Captain role, client_ops idempotency", () => {
    database.exec(`
      CREATE TABLE users_v24 (
        username TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'cashier', 'manager', 'captain')),
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        hash_algo TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        require_password_change INTEGER NOT NULL DEFAULT 0,
        staff_id TEXT REFERENCES staff(id) ON UPDATE CASCADE ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO users_v24 (
        username, display_name, role, password_hash, salt, hash_algo,
        active, require_password_change, staff_id, created_at, updated_at
      )
      SELECT
        username, display_name, role, password_hash, salt, hash_algo,
        active, require_password_change, staff_id, created_at, updated_at
      FROM users;

      DROP TABLE users;
      ALTER TABLE users_v24 RENAME TO users;

      CREATE INDEX IF NOT EXISTS idx_users_staff_id ON users(staff_id) WHERE staff_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS client_ops (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_id TEXT,
        result_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_client_ops_created
        ON client_ops(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_client_ops_user_action
        ON client_ops(username, action, created_at DESC);
    `);
  });

  runMigration(database, 25, "client_ops request hash", () => {
    addColumnIfMissing(database, "client_ops", "request_hash", "TEXT");
  });

  runMigration(database, 26, "Order cancellation actor time and reason", () => {
    addColumnIfMissing(database, "orders", "cancelled_at", "INTEGER");
    addColumnIfMissing(database, "orders", "cancelled_by", "TEXT");
    addColumnIfMissing(database, "orders", "cancellation_reason", "TEXT");
    if (!columnExists(database, "orders", "cancelled_at")) {
      throw new Error("migration-26-cancelled-at-missing");
    }
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at
        ON orders(status, cancelled_at DESC);
    `);
    // Backfill only after columns exist. Safe on restaurants with no cancelled rows.
    database.exec(`
      UPDATE orders
      SET
        cancelled_at = COALESCE(
          (
            SELECT a.timestamp
            FROM audit_logs a
            WHERE a.entity_id = orders.id AND a.action = 'order.cancelled'
            ORDER BY a.timestamp DESC
            LIMIT 1
          ),
          updated_at
        ),
        cancelled_by = COALESCE(
          (
            SELECT a.user
            FROM audit_logs a
            WHERE a.entity_id = orders.id AND a.action = 'order.cancelled'
            ORDER BY a.timestamp DESC
            LIMIT 1
          ),
          created_by
        )
      WHERE status = 'cancelled' AND cancelled_at IS NULL;
    `);
  });

  runMigration(database, 27, "Cloud backup record metadata", () => {
    addColumnIfMissing(database, "backup_records", "cloud_backup_id", "TEXT");
    addColumnIfMissing(database, "backup_records", "error", "TEXT");
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_backup_records_destination_status
        ON backup_records(destination, status, created_at DESC);
    `);
  });

  runMigration(database, 28, "Customer credit / receivables ledger", () => {
    ensureCustomerCreditSchema(database);
    if (!columnExists(database, "customers", "outstanding_paise")) {
      throw new Error("migration-28-outstanding-paise-missing");
    }
    if (!tableExists(database, "customer_account_entries")) {
      throw new Error("migration-28-customer-account-entries-missing");
    }
  });

  runMigration(database, 29, "Link grocery purchase lines to buying-list lines", () => {
    ensureGroceryPurchaseListLineId(database);
  });

  runMigration(database, 30, "Single-item grocery bills: item amount equals bill total", () => {
    if (
      !tableExists(database, "grocery_purchases") ||
      !tableExists(database, "grocery_purchase_lines") ||
      !columnExists(database, "grocery_purchase_lines", "list_line_id")
    ) {
      return;
    }
    const at = Date.now();
    database.exec(`
      CREATE TEMP TABLE single_item_bills AS
        SELECT p.total_paise, l.id AS line_id, l.list_line_id,
               ROUND(p.total_paise * 1.0 / CASE WHEN l.quantity > 0 THEN l.quantity ELSE 1 END) AS unit_paise
        FROM grocery_purchases p
        JOIN grocery_purchase_lines l ON l.purchase_id = p.id
        WHERE p.status = 'recorded'
          AND l.total_paise != p.total_paise
          AND (SELECT COUNT(*) FROM grocery_purchase_lines x WHERE x.purchase_id = p.id) = 1;

      UPDATE grocery_purchase_lines
      SET total_paise = (SELECT total_paise FROM single_item_bills s WHERE s.line_id = grocery_purchase_lines.id),
          unit_price_paise = (SELECT unit_paise FROM single_item_bills s WHERE s.line_id = grocery_purchase_lines.id),
          updated_at = ${at}
      WHERE id IN (SELECT line_id FROM single_item_bills);

      UPDATE grocery_list_lines
      SET purchased_total_paise = (SELECT total_paise FROM single_item_bills s WHERE s.list_line_id = grocery_list_lines.id),
          purchased_unit_price_paise = (SELECT unit_paise FROM single_item_bills s WHERE s.list_line_id = grocery_list_lines.id),
          updated_at = ${at}
      WHERE line_status = 'purchased'
        AND id IN (SELECT list_line_id FROM single_item_bills WHERE list_line_id IS NOT NULL);

      DROP TABLE single_item_bills;
    `);
  });

  runMigration(database, 31, "Menu sort, diet, and nullable legacy tax rates", () => {
    const apply = database.transaction(() => {
      relaxLegacyTaxColumn(database, "order_lines");
      relaxLegacyTaxColumn(database, "menu_items", [
        "sort_order INTEGER NOT NULL DEFAULT 0",
        "diet TEXT CHECK (diet IS NULL OR diet IN ('veg', 'non-veg', 'egg'))",
      ]);
    });
    database.pragma("foreign_keys = OFF");
    try {
      apply();
    } finally {
      database.pragma("foreign_keys = ON");
    }
    const violations = database.pragma("foreign_key_check") as unknown[];
    if (violations.length) {
      throw new Error("migration-31-foreign-key-check-failed");
    }
  });

  runMigration(database, 32, "Kitchen note on order lines", () => {
    addColumnIfMissing(database, "order_lines", "kitchen_note", "TEXT");
  });

  // Startup self-healing for pre-existing/partially migrated databases:
  // ensure area_id exists even if migration 12 was marked applied while the column was missing.
  addColumnIfMissing(
    database,
    "tables",
    "area_id",
    `TEXT NOT NULL DEFAULT '${DEFAULT_SEATING_AREA_ID}'`,
  );
  addColumnIfMissing(database, "client_ops", "request_hash", "TEXT");
  // Self-heal cancel columns even if migration 26 was skipped / partially applied.
  addColumnIfMissing(database, "orders", "cancelled_at", "INTEGER");
  addColumnIfMissing(database, "orders", "cancelled_by", "TEXT");
  addColumnIfMissing(database, "orders", "cancellation_reason", "TEXT");
  addColumnIfMissing(database, "order_lines", "kitchen_note", "TEXT");
  if (columnExists(database, "orders", "cancelled_at")) {
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at
        ON orders(status, cancelled_at DESC);
    `);
  }
  // Self-heal customer credit even if migration 28 was skipped / partially applied,
  // or if an older bootstrap tried to index outstanding_paise before the column existed.
  ensureCustomerCreditSchema(database);
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

  // Grocery procurement columns: if migration 13 failed under FK constraints, later
  // migrations never ran while base CREATE IF NOT EXISTS already added empty vendor/purchase tables.
  if (tableExists(database, "grocery_purchase_lines")) {
    addColumnIfMissing(database, "grocery_purchase_lines", "vendor_id", "TEXT");
    addColumnIfMissing(database, "grocery_purchase_lines", "purchase_id", "TEXT");
    ensureGroceryPurchaseListLineId(database);
    createIndexIfColumnExists(
      database,
      "grocery_purchase_lines",
      "purchase_id",
      "idx_grocery_purchase_lines_purchase",
      "ON grocery_purchase_lines(purchase_id)",
    );
  }
  addColumnIfMissing(database, "grocery_items", "deleted_at", "INTEGER");
  addColumnIfMissing(database, "grocery_list_lines", "estimated_unit_price_paise", "INTEGER");
  addColumnIfMissing(database, "grocery_list_lines", "estimated_total_paise", "INTEGER");
  addColumnIfMissing(database, "grocery_list_lines", "purchased_quantity", "REAL");
  addColumnIfMissing(database, "grocery_list_lines", "purchased_unit_price_paise", "INTEGER");
  addColumnIfMissing(database, "grocery_list_lines", "purchased_total_paise", "INTEGER");
  addColumnIfMissing(
    database,
    "grocery_list_lines",
    "line_status",
    "TEXT NOT NULL DEFAULT 'pending'",
  );
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

function tableExists(database: SqliteDatabase, tableName: string) {
  const row = database
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

function columnExists(database: SqliteDatabase, tableName: string, columnName: string) {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

/**
 * Idempotent customer-credit schema upgrade.
 * Safe on fresh DBs and on client machines that already have an older customers table.
 * Must not be referenced from the initial CREATE TABLE bootstrap indexes, or legacy DBs
 * fail before migrations can add the columns.
 */
function ensureCustomerCreditSchema(database: SqliteDatabase) {
  if (!tableExists(database, "customers")) {
    return;
  }

  addColumnIfMissing(database, "customers", "credit_enabled", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "customers", "credit_blocked", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "customers", "credit_limit_paise", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "customers", "default_credit_days", "INTEGER");
  addColumnIfMissing(database, "customers", "outstanding_paise", "INTEGER NOT NULL DEFAULT 0");

  if (!columnExists(database, "customers", "outstanding_paise")) {
    throw new Error("customer-credit-outstanding-paise-missing");
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_customers_outstanding
      ON customers(outstanding_paise DESC) WHERE active = 1 AND outstanding_paise > 0;

    CREATE TABLE IF NOT EXISTS customer_account_entries (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      entry_type TEXT NOT NULL CHECK (
        entry_type IN ('credit_sale', 'payment_received', 'void', 'adjustment')
      ),
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      running_balance_paise INTEGER NOT NULL,
      order_id TEXT REFERENCES orders(id) ON UPDATE CASCADE ON DELETE SET NULL,
      invoice_number TEXT,
      description TEXT,
      due_date TEXT,
      remaining_paise INTEGER,
      payment_method TEXT,
      reference TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL,
      created_by TEXT REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_customer_account_entries_customer
      ON customer_account_entries(customer_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_customer_account_entries_due
      ON customer_account_entries(due_date, remaining_paise)
      WHERE entry_type = 'credit_sale' AND remaining_paise > 0;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_account_entries_order
      ON customer_account_entries(order_id)
      WHERE order_id IS NOT NULL AND entry_type = 'credit_sale';

    CREATE TABLE IF NOT EXISTS customer_credit_allocations (
      id TEXT PRIMARY KEY,
      payment_entry_id TEXT NOT NULL REFERENCES customer_account_entries(id) ON DELETE CASCADE,
      credit_entry_id TEXT NOT NULL REFERENCES customer_account_entries(id) ON DELETE CASCADE,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_customer_credit_allocations_payment
      ON customer_credit_allocations(payment_entry_id);
    CREATE INDEX IF NOT EXISTS idx_customer_credit_allocations_credit
      ON customer_credit_allocations(credit_entry_id);
  `);
}

function bootstrapLegacyGroceryColumns(database: SqliteDatabase) {
  if (!tableExists(database, "grocery_purchase_lines")) {
    return;
  }
  addColumnIfMissing(database, "grocery_purchase_lines", "vendor_id", "TEXT");
  addColumnIfMissing(database, "grocery_purchase_lines", "purchase_id", "TEXT");
  ensureGroceryPurchaseListLineId(database);
}

function ensureGroceryPurchaseListLineId(database: SqliteDatabase) {
  if (!tableExists(database, "grocery_purchase_lines")) {
    return;
  }
  addColumnIfMissing(database, "grocery_purchase_lines", "list_line_id", "TEXT");
  createIndexIfColumnExists(
    database,
    "grocery_purchase_lines",
    "list_line_id",
    "idx_grocery_purchase_lines_list_line",
    "ON grocery_purchase_lines(list_line_id)",
  );
}

/**
 * CREATE INDEX in the initial schema blob must not name columns added later with
 * ALTER TABLE. Existing restaurants skip CREATE TABLE IF NOT EXISTS, then the
 * index fails with "no such column" before migrations can run.
 */
function createIndexIfColumnExists(
  database: SqliteDatabase,
  tableName: string,
  columnName: string,
  indexName: string,
  indexSqlAfterName: string,
) {
  if (!tableExists(database, tableName) || !columnExists(database, tableName, columnName)) {
    return;
  }
  database.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ${indexSqlAfterName}`);
}

function quoteIdent(name: string) {
  return `"${String(name).replace(/"/g, "\"\"")}"`;
}

function relaxLegacyTaxColumn(
  database: SqliteDatabase,
  tableName: string,
  extraColumnSql: string[] = [],
) {
  if (!tableExists(database, tableName)) {
    return;
  }
  const columns = database.pragma(`table_info(${tableName})`) as Array<{
    name: string;
    notnull: number;
    dflt_value: unknown;
  }>;
  const tax = columns.find((column) => column.name === "tax_rate_bps");
  const missingExtras = extraColumnSql
    .map((definition) => definition.trim().split(/\s+/)[0])
    .filter((name) => name && !columns.some((column) => column.name === name));
  const taxNeedsRelax = Boolean(tax && (tax.notnull === 1 || tax.dflt_value != null));
  if (!taxNeedsRelax && missingExtras.length === 0) {
    return;
  }
  if (!taxNeedsRelax) {
    for (const definition of extraColumnSql) {
      const name = definition.trim().split(/\s+/)[0];
      addColumnIfMissing(database, tableName, name, definition.replace(new RegExp(`^${name}\\s+`), ""));
    }
    return;
  }

  const createRow = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: string } | undefined;
  const createSql = String(createRow?.sql || "");
  if (!/tax_rate_bps/i.test(createSql)) {
    throw new Error(`migration-31-missing-tax-column:${tableName}`);
  }
  const indexRows = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
    )
    .all(tableName) as Array<{ sql: string }>;
  const triggerRows = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL",
    )
    .all(tableName) as Array<{ sql: string }>;

  let nextSql = createSql.replace(
    /tax_rate_bps\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+1800/i,
    "tax_rate_bps INTEGER",
  );
  if (nextSql === createSql) {
    nextSql = createSql.replace(/tax_rate_bps\s+INTEGER\s+NOT\s+NULL/i, "tax_rate_bps INTEGER");
  }
  if (/tax_rate_bps\s+INTEGER\s+NOT\s+NULL/i.test(nextSql)) {
    throw new Error(`migration-31-tax-column-unchanged:${tableName}`);
  }
  nextSql = nextSql.replace(
    new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"${tableName}"|${tableName})`, "i"),
    `CREATE TABLE ${quoteIdent(`${tableName}_new`)}`,
  );
  if (missingExtras.length) {
    const extras = extraColumnSql
      .filter((definition) => missingExtras.includes(definition.trim().split(/\s+/)[0]))
      .join(",\n");
    const closeAt = nextSql.lastIndexOf(")");
    nextSql = `${nextSql.slice(0, closeAt)},\n${extras}${nextSql.slice(closeAt)}`;
  }

  const columnList = columns.map((column) => quoteIdent(column.name)).join(", ");
  database.exec(nextSql);
  database.exec(
    `INSERT INTO ${quoteIdent(`${tableName}_new`)} (${columnList}) SELECT ${columnList} FROM ${quoteIdent(tableName)}`,
  );
  database.exec(`DROP TABLE ${quoteIdent(tableName)}`);
  database.exec(
    `ALTER TABLE ${quoteIdent(`${tableName}_new`)} RENAME TO ${quoteIdent(tableName)}`,
  );
  for (const index of indexRows) {
    if (index.sql) {
      database.exec(index.sql);
    }
  }
  for (const trigger of triggerRows) {
    if (trigger.sql) {
      database.exec(trigger.sql);
    }
  }
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

/** First-run scaffolding only — no sample tables, menu, or demo data. */
function seedDatabase(database: SqliteDatabase) {
  const now = Date.now();
  // Schema expects a default seating area for tables.area_id.
  database
    .prepare(
      `INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
       VALUES (?, ?, 1, 1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(DEFAULT_SEATING_AREA_ID, DEFAULT_SEATING_AREA_NAME, now, now);

  const tableCount = Number(process.env.VITE_TABLE_COUNT || process.env.TABLE_COUNT || 12);
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
    "config:credit",
    JSON.stringify({ enabled: false, defaultCreditDays: 15 }),
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
      gstRateBps: 500,
      priceIncludesTax: false,
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
      receiptQr: { mode: "off" },
    }),
    now,
  );
}
