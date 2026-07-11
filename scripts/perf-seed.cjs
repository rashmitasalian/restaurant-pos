#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { scryptSync, createHash } = require("crypto");
const { spawnSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const PERF_DB_PATH = path.join(ROOT_DIR, "data", "perf", "restaurant-pos-perf.sqlite");
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ANCHOR_MS = Date.UTC(2026, 0, 31, 23, 59, 59, 999);
const PERF_ADMIN_USERNAME = "perfadmin";
const PERF_ADMIN_PASSWORD = "PerfAdmin123!";
const SCRYPT_ALGO = "SCRYPT-N131072-R8-P1";
const SCRYPT_OPTIONS = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 160 * 1024 * 1024,
};

function parseArgs(argv) {
  const parsed = {
    categories: 20,
    items: 200,
    orders: 5000,
    audits: 100000,
    customers: 1000,
    printJobs: 500,
    staff: 100,
    days: 180,
    seed: null,
    anchor: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }

    if (rawKey === "categories") {
      parsed.categories = parsePositiveInt(value, "categories");
    } else if (rawKey === "items") {
      parsed.items = parsePositiveInt(value, "items");
    } else if (rawKey === "orders") {
      parsed.orders = parseNonNegativeInt(value, "orders");
    } else if (rawKey === "audits") {
      parsed.audits = parseNonNegativeInt(value, "audits");
    } else if (rawKey === "customers") {
      parsed.customers = parseNonNegativeInt(value, "customers");
    } else if (rawKey === "print-jobs") {
      parsed.printJobs = parseNonNegativeInt(value, "print-jobs");
    } else if (rawKey === "staff") {
      parsed.staff = parseNonNegativeInt(value, "staff");
    } else if (rawKey === "days") {
      parsed.days = parsePositiveInt(value, "days");
    } else if (rawKey === "seed") {
      parsed.seed = String(value || "").trim();
    } else if (rawKey === "anchor") {
      parsed.anchor = parseAnchorDate(value);
    } else {
      throw new Error(`Unknown option: --${rawKey}`);
    }
  }

  return parsed;
}

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${label} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${label} must be a non-negative integer`);
  }
  return parsed;
}

function parseAnchorDate(value) {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    throw new Error("--anchor must be in YYYY-MM-DD format");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  if (!Number.isFinite(timestamp)) {
    throw new Error("--anchor must be a valid date");
  }
  return timestamp;
}

function registerTsNode() {
  process.env.TS_NODE_TRANSPILE_ONLY = "1";
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
    module: "CommonJS",
    moduleResolution: "Node",
  });
  require("ts-node/register/transpile-only");
}

function isNativeModuleMismatch(error) {
  const message = String(error?.message || error || "");
  return (
    !process.versions.electron &&
    !process.env.POS_PERF_ELECTRON_CHILD &&
    /NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(message)
  );
}

function rerunWithElectron() {
  const electronPath = require("electron");
  if (typeof electronPath !== "string") {
    throw new Error("Unable to locate Electron executable for performance script fallback.");
  }
  const result = spawnSync(electronPath, [__filename, ...process.argv.slice(2)], {
    cwd: ROOT_DIR,
    env: { ...process.env, POS_PERF_ELECTRON_CHILD: "1" },
    encoding: "utf8",
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  const stderr = filterElectronStderr(result.stderr);
  if (stderr) {
    process.stderr.write(stderr);
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status === null ? 1 : result.status);
}

function handleElectronFallback() {
  try {
    rerunWithElectron();
  } catch (fallbackError) {
    console.error(fallbackError instanceof Error ? fallbackError.message : fallbackError);
    finish(1);
  }
}

function filterElectronStderr(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => line && !/crashpad|CreateFile: Access is denied/i.test(line))
    .map((line) => `${line}\n`)
    .join("");
}

function finish(exitCode) {
  if (process.versions.electron) {
    process.exit(exitCode);
  }
  process.exitCode = exitCode;
}

function hashSeed(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  if (!seed) {
    return Math.random;
  }
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, values) {
  return values[randomInt(rng, 0, values.length - 1)];
}

function pad(value, width) {
  return String(value).padStart(width, "0");
}

function rupeesToPaise(value) {
  return Math.round(Number(value) * 100);
}

function removeExistingDatabase() {
  fs.mkdirSync(path.dirname(PERF_DB_PATH), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = `${PERF_DB_PATH}${suffix}`;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

function clearPerfTables(database) {
  database.exec(`
    DELETE FROM payments;
    DELETE FROM order_lines;
    DELETE FROM orders;
    DELETE FROM menu_items;
    DELETE FROM menu_categories;
    DELETE FROM tables;
    DELETE FROM audit_logs;
    DELETE FROM print_jobs;
    DELETE FROM customers;
    DELETE FROM staff;
    DELETE FROM backup_records;
    DELETE FROM admin_recovery_codes;
    DELETE FROM users;
  `);
}

function createDeterministicCredential(secret, seedText) {
  const salt = createHash("sha256").update(seedText).digest("hex").slice(0, 32);
  const hash = scryptSync(secret, Buffer.from(salt, "hex"), 64, SCRYPT_OPTIONS).toString("hex");
  return { salt, hash };
}

function seedPerfAdmin(database, nowMs) {
  const credential = createDeterministicCredential(
    PERF_ADMIN_PASSWORD,
    `${PERF_ADMIN_USERNAME}:restaurant-pos-perf`,
  );
  database
    .prepare(
      `INSERT INTO users (
        username, display_name, role, password_hash, salt, hash_algo, active,
        require_password_change, created_at, updated_at
      ) VALUES (?, ?, 'admin', ?, ?, ?, 1, 0, ?, ?)`,
    )
    .run(
      PERF_ADMIN_USERNAME,
      "Perf Admin",
      credential.hash,
      credential.salt,
      SCRYPT_ALGO,
      nowMs,
      nowMs,
    );
}

function seedTables(database, nowMs) {
  const insertTable = database.prepare(`
    INSERT INTO tables (id, name, seats, sort_order, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);

  for (let id = 1; id <= 24; id += 1) {
    insertTable.run(id, `Table ${id}`, id % 4 === 0 ? 6 : 4, id, nowMs, nowMs);
  }
}

function seedCategories(database, count, nowMs) {
  const insert = database.prepare(`
    INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `);
  const categories = [];

  for (let index = 1; index <= count; index += 1) {
    const category = {
      id: `perf:category:${pad(index, 3)}`,
      name: `Category ${pad(index, 2)}`,
    };
    insert.run(category.id, category.name, index, nowMs, nowMs);
    categories.push(category);
  }

  return categories;
}

function seedItems(database, count, categories, rng, nowMs) {
  const insert = database.prepare(`
    INSERT INTO menu_items (
      id, sku, name, category_id, price_paise, available, favorite, tax_rate_bps, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 500, 1, ?, ?)
  `);
  const items = [];

  for (let index = 1; index <= count; index += 1) {
    const category = categories[(index - 1) % categories.length];
    const pricePaise = rupeesToPaise(randomInt(rng, 40, 450));
    const item = {
      id: `perf:item:${pad(index, 4)}`,
      sku: `PERF${pad(index, 4)}`,
      name: `Item ${pad(index, 3)}`,
      categoryId: category.id,
      categoryName: category.name,
      pricePaise,
      favorite: index <= 20 ? 1 : 0,
    };
    insert.run(
      item.id,
      item.sku,
      item.name,
      item.categoryId,
      item.pricePaise,
      item.favorite,
      nowMs,
      nowMs,
    );
    items.push(item);
  }

  return items;
}

function seedCustomers(database, count, rng, anchorMs) {
  const insert = database.prepare(`
    INSERT INTO customers (id, name, phone, address, notes, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);

  for (let index = 1; index <= count; index += 1) {
    const createdAt = anchorMs - randomInt(rng, 0, 365) * DAY_MS - randomInt(rng, 0, DAY_MS - 1);
    insert.run(
      `perf:customer:${pad(index, 5)}`,
      `Customer ${pad(index, 5)}`,
      phoneNumber(7, index),
      `${randomInt(rng, 1, 250)} Market Street`,
      index % 10 === 0 ? "Prefers takeaway" : null,
      createdAt,
      createdAt,
    );
  }

  return count;
}

function seedStaff(database, count, rng, anchorMs) {
  const insert = database.prepare(`
    INSERT INTO staff (
      id, name, phone, designation, joining_date, salary_paise, address, notes,
      photo_mime, photo_base64, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
  `);
  const designations = ["Cashier", "Server", "Chef", "Manager", "Kitchen Assistant"];

  for (let index = 1; index <= count; index += 1) {
    const createdAt = anchorMs - randomInt(rng, 0, 900) * DAY_MS;
    const joinedAt = new Date(createdAt).toISOString().slice(0, 10);
    insert.run(
      `perf:staff:${pad(index, 4)}`,
      `Staff ${pad(index, 4)}`,
      phoneNumber(8, index),
      pick(rng, designations),
      joinedAt,
      rupeesToPaise(randomInt(rng, 12000, 55000)),
      `${randomInt(rng, 1, 250)} Staff Colony`,
      null,
      index % 12 === 0 ? 0 : 1,
      createdAt,
      createdAt,
    );
  }

  return count;
}

function seedAudits(database, count, rng, anchorMs, orderCount, itemCount, customerCount, staffCount) {
  const insert = database.prepare(`
    INSERT INTO audit_logs (id, action, entity_type, entity_id, user, detail_json, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const actions = [
    ["auth.login.success", "user"],
    ["order.created", "order"],
    ["item.added", "order"],
    ["order.kot.sent", "order"],
    ["order.paid", "order"],
    ["settings.updated", "config"],
    ["menu.item.updated", "item"],
    ["customer.updated", "customer"],
    ["staff.updated", "staff"],
  ];
  const users = ["admin", "cashier", "manager"];

  for (let index = 1; index <= count; index += 1) {
    const [action, entityType] = pick(rng, actions);
    const timestamp = anchorMs - randomInt(rng, 0, 365) * DAY_MS - randomInt(rng, 0, DAY_MS - 1);
    const entityId = entityIdForAudit(entityType, rng, orderCount, itemCount, customerCount, staffCount);
    insert.run(
      `perf:audit:${pad(index, 7)}`,
      action,
      entityType,
      entityId,
      pick(rng, users),
      JSON.stringify({ perf: true, sequence: index, entityId }),
      timestamp,
    );
  }

  return count;
}

function seedPrintJobs(database, count, rng, anchorMs, orderCount) {
  const insert = database.prepare(`
    INSERT INTO print_jobs (
      id, printer_key, job_type, payload_json, status, attempts, max_attempts,
      error, created_at, last_retry_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 3, ?, ?, ?, ?)
  `);
  const printers = ["Kitchen", "Receipt", "Bar"];
  const jobTypes = ["kot", "receipt", "label"];
  const statuses = ["completed", "completed", "completed", "pending", "failed"];

  for (let index = 1; index <= count; index += 1) {
    const status = pick(rng, statuses);
    const createdAt = anchorMs - randomInt(rng, 0, 30) * DAY_MS - randomInt(rng, 0, DAY_MS - 1);
    const attempts = status === "failed" ? 3 : status === "completed" ? 1 : 0;
    const completedAt = status === "completed" ? createdAt + randomInt(rng, 1000, 30000) : null;
    const lastRetryAt = status === "failed" ? createdAt + randomInt(rng, 1000, 60000) : null;
    insert.run(
      `perf:print-job:${pad(index, 6)}`,
      pick(rng, printers),
      pick(rng, jobTypes),
      JSON.stringify({
        perf: true,
        orderId: orderCount > 0 ? `perf:order:${pad(randomInt(rng, 1, orderCount), 6)}` : null,
      }),
      status,
      attempts,
      status === "failed" ? "Printer unavailable" : null,
      createdAt,
      lastRetryAt,
      completedAt,
    );
  }

  return count;
}

function phoneNumber(prefix, index) {
  return `${prefix}${String(index).padStart(9, "0").slice(-9)}`;
}

function entityIdForAudit(entityType, rng, orderCount, itemCount, customerCount, staffCount) {
  if (entityType === "order" && orderCount > 0) {
    return `perf:order:${pad(randomInt(rng, 1, orderCount), 6)}`;
  }
  if (entityType === "customer" && customerCount > 0) {
    return `perf:customer:${pad(randomInt(rng, 1, customerCount), 5)}`;
  }
  if (entityType === "staff" && staffCount > 0) {
    return `perf:staff:${pad(randomInt(rng, 1, staffCount), 4)}`;
  }
  if (entityType === "item") {
    return `perf:item:${pad(randomInt(rng, 1, Math.max(1, itemCount)), 4)}`;
  }
  if (entityType === "config") {
    return "config:perf";
  }
  return "user:perf";
}

function seedOrders(database, opts, items, rng, anchorMs) {
  const insertOrder = database.prepare(`
    INSERT INTO orders (
      id, order_type, table_id, customer_id, status, kot_status, subtotal_paise, tax_total_paise,
      discount_percent, discount_total_paise, total_paise, invoice_number, paid_at, meta_json,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, 'paid', 'printed', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  const insertLine = database.prepare(`
    INSERT INTO order_lines (
      id, order_id, menu_item_id, item_name, category_name, quantity, rate_paise, tax_rate_bps,
      line_total_paise, kot_printed_qty, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 500, ?, ?, ?, ?, ?)
  `);
  const insertPayment = database.prepare(`
    INSERT INTO payments (
      id, order_id, method, amount_paise, amount_paid_paise, change_paise, txn_ref,
      split_json, status, received_by, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', NULL, ?)
  `);

  const orderTypes = ["table", "table", "table", "takeaway", "delivery"];
  const paymentMethods = ["cash", "card", "upi", "upi", "split"];
  const discountPercents = [0, 0, 0, 0, 5, 10];
  const anchorDayStart = Date.UTC(
    new Date(anchorMs).getUTCFullYear(),
    new Date(anchorMs).getUTCMonth(),
    new Date(anchorMs).getUTCDate(),
  );

  let lineCountTotal = 0;
  let salesPaiseTotal = 0;

  for (let orderNumber = 1; orderNumber <= opts.orders; orderNumber += 1) {
    const dayOffset =
      orderNumber <= opts.days ? (orderNumber - 1) % opts.days : randomInt(rng, 0, opts.days - 1);
    const paidAt = anchorDayStart - dayOffset * DAY_MS + randomInt(rng, 10 * 60 * 1000, DAY_MS - 1);
    const createdAt = paidAt - randomInt(rng, 5 * 60 * 1000, 90 * 60 * 1000);
    const orderId = `perf:order:${pad(orderNumber, 6)}`;
    const orderType = pick(rng, orderTypes);
    const tableId = orderType === "table" ? randomInt(rng, 1, 24) : null;
    const lineCount = randomInt(rng, 1, 5);
    const lines = [];

    let subtotalPaise = 0;
    for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
      const item = pick(rng, items);
      const quantity = randomInt(rng, 1, 4);
      const lineTotalPaise = quantity * item.pricePaise;
      subtotalPaise += lineTotalPaise;
      lines.push({ item, quantity, lineTotalPaise });
    }

    const discountPercent = pick(rng, discountPercents);
    const discountTotalPaise = Math.round((subtotalPaise * discountPercent) / 100);
    const taxablePaise = Math.max(0, subtotalPaise - discountTotalPaise);
    const taxTotalPaise = Math.round(taxablePaise * 0.05);
    const totalPaise = taxablePaise + taxTotalPaise;
    const invoiceNumber = `PERF-${pad(orderNumber, 6)}`;

    insertOrder.run(
      orderId,
      orderType,
      tableId,
      subtotalPaise,
      taxTotalPaise,
      discountPercent,
      discountTotalPaise,
      totalPaise,
      invoiceNumber,
      paidAt,
      JSON.stringify({ perf: true }),
      createdAt,
      paidAt,
    );

    lines.forEach((line, index) => {
      insertLine.run(
        `perf:line:${pad(orderNumber, 6)}:${pad(index + 1, 2)}`,
        orderId,
        line.item.id,
        line.item.name,
        line.item.categoryName,
        line.quantity,
        line.item.pricePaise,
        line.lineTotalPaise,
        line.quantity,
        index,
        createdAt,
        paidAt,
      );
    });

    const method = pick(rng, paymentMethods);
    const roundedPaidPaise =
      method === "cash" ? Math.ceil(totalPaise / rupeesToPaise(10)) * rupeesToPaise(10) : null;
    const splitJson = method === "split" ? buildSplitJson(totalPaise) : null;
    insertPayment.run(
      `perf:payment:${pad(orderNumber, 6)}`,
      orderId,
      method,
      totalPaise,
      roundedPaidPaise,
      roundedPaidPaise === null ? null : roundedPaidPaise - totalPaise,
      method === "cash" ? null : `PERF-TXN-${pad(orderNumber, 6)}`,
      splitJson,
      paidAt,
    );

    lineCountTotal += lines.length;
    salesPaiseTotal += totalPaise;
  }

  return { lineCountTotal, salesPaiseTotal };
}

function buildSplitJson(totalPaise) {
  const first = Math.round(totalPaise * 0.6);
  return JSON.stringify([
    { method: "upi", amountPaise: first },
    { method: "card", amountPaise: totalPaise - first },
  ]);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const anchorMs = opts.anchor || (opts.seed ? DEFAULT_ANCHOR_MS : Date.now());
  const rng = createRng(opts.seed);

  removeExistingDatabase();
  process.env.POS_DB_PATH_OVERRIDE = PERF_DB_PATH;
  registerTsNode();

  const { closeDb, getDb, initializeDatabase } = require(path.join(ROOT_DIR, "electron", "db", "sqlite"));
  await initializeDatabase();
  const database = getDb();
  database.pragma("foreign_keys = ON");
  database.pragma("synchronous = NORMAL");

  const startedAt = Date.now();
  const result = database.transaction(() => {
    clearPerfTables(database);
    seedPerfAdmin(database, anchorMs);
    seedTables(database, anchorMs);
    const categories = seedCategories(database, opts.categories, anchorMs);
    const items = seedItems(database, opts.items, categories, rng, anchorMs);
    const customerCount = seedCustomers(database, opts.customers, rng, anchorMs);
    const staffCount = seedStaff(database, opts.staff, rng, anchorMs);
    const orderResult = seedOrders(database, opts, items, rng, anchorMs);
    const auditCount = seedAudits(
      database,
      opts.audits,
      rng,
      anchorMs,
      opts.orders,
      opts.items,
      customerCount,
      staffCount,
    );
    const printJobCount = seedPrintJobs(database, opts.printJobs, rng, anchorMs, opts.orders);
    return { ...orderResult, customerCount, staffCount, auditCount, printJobCount };
  })();

  closeDb();

  console.log(`Seeded performance database: ${PERF_DB_PATH}`);
  console.log(`Categories: ${opts.categories}`);
  console.log(`Menu items: ${opts.items}`);
  console.log(`Orders: ${opts.orders}`);
  console.log(`Order lines: ${result.lineCountTotal}`);
  console.log(`Audit logs: ${result.auditCount}`);
  console.log(`Customers: ${result.customerCount}`);
  console.log(`Staff: ${result.staffCount}`);
  console.log(`Print jobs: ${result.printJobCount}`);
  console.log(`Perf admin: ${PERF_ADMIN_USERNAME} / ${PERF_ADMIN_PASSWORD}`);
  console.log(`Sales: ${formatMoney(result.salesPaiseTotal)}`);
  console.log(`Days: ${opts.days}`);
  console.log(`Anchor: ${new Date(anchorMs).toISOString().slice(0, 10)}`);
  if (opts.seed) {
    console.log(`Seed: ${opts.seed}`);
  }
  console.log(`Completed in ${Date.now() - startedAt}ms`);
  finish(0);
}

function formatMoney(paise) {
  return `₹${(paise / 100).toFixed(2)}`;
}

main().catch((error) => {
  if (isNativeModuleMismatch(error)) {
    handleElectronFallback();
    return;
  }
  console.error(error instanceof Error ? error.message : error);
  finish(1);
});
