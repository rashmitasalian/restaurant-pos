/**
 * Clear all floor tables and reset seating areas for a fresh Settings setup.
 *
 * Usage (POS closed preferred):
 *   node scripts/clear-tables.cjs
 *
 * Cancels open dine-in orders, deletes every table row, resets seating areas to
 * Main Dining only, and sets config:tables count to 0.
 *
 * better-sqlite3 is built for Electron, so this script re-runs itself under
 * Electron's Node ABI when started with system Node.
 */
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const dbPath =
  process.env.POS_DEMO_DB ||
  path.join(ROOT_DIR, ".user-data", "data", "restaurant-pos.sqlite");

const ACTIVE_ORDER_STATUSES = ["open", "held", "ready", "assigned"];
const DEFAULT_AREA_ID = "area:main";
const DEFAULT_AREA_NAME = "Main Dining";

function filterElectronStderr(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => line && !/crashpad|CreateFile: Access is denied/i.test(line))
    .map((line) => `${line}\n`)
    .join("");
}

function rerunWithElectron() {
  const electronPath = require("electron");
  if (typeof electronPath !== "string") {
    throw new Error("Unable to locate Electron executable for clear-tables.");
  }
  const result = spawnSync(electronPath, [__filename, ...process.argv.slice(2)], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      POS_CLEAR_TABLES_ELECTRON_CHILD: "1",
    },
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

function runClear(Database) {
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    console.error("Start the app once first, or set POS_DEMO_DB.");
    process.exit(1);
  }

  const db = new Database(dbPath);
  const now = Date.now();
  const placeholders = ACTIVE_ORDER_STATUSES.map(() => "?").join(",");

  db.exec("BEGIN");
  try {
    const beforeTables = db.prepare("SELECT COUNT(*) AS count FROM tables").get().count;
    const beforeAreas = db.prepare("SELECT COUNT(*) AS count FROM seating_areas").get().count;

    const cancelResult = db
      .prepare(
        `UPDATE orders
         SET status = 'cancelled', updated_at = ?
         WHERE table_id IS NOT NULL
           AND status IN (${placeholders})`,
      )
      .run(now, ...ACTIVE_ORDER_STATUSES);

    db.prepare("UPDATE orders SET table_id = NULL WHERE table_id IS NOT NULL").run();
    db.prepare("DELETE FROM tables").run();

    db.prepare("DELETE FROM seating_areas WHERE id != ?").run(DEFAULT_AREA_ID);
    db.prepare(
      `INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
       VALUES (?, ?, 1, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         sort_order = 1,
         active = 1,
         updated_at = excluded.updated_at`,
    ).run(DEFAULT_AREA_ID, DEFAULT_AREA_NAME, now, now);

    const tablesConfig = JSON.stringify({
      tableCount: 0,
      defaultSeats: 4,
      layout: [
        {
          id: DEFAULT_AREA_ID,
          tableCount: 0,
          namingMode: "number",
          prefix: "",
          defaultSeats: 4,
        },
      ],
    });
    db.prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES ('config:tables', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).run(tablesConfig, now);

    db.exec("COMMIT");

    console.log("Floor layout cleared.");
    console.log(`  Tables removed: ${beforeTables}`);
    console.log(`  Areas before → after: ${beforeAreas} → 1 (Main Dining)`);
    console.log(`  Open dine-in orders cancelled: ${cancelResult.changes}`);
    console.log("  config:tables → tableCount 0");
    console.log("Add areas and tables from Settings → Operations.");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

function main() {
  if (process.env.POS_CLEAR_TABLES_ELECTRON_CHILD !== "1") {
    try {
      require("better-sqlite3");
    } catch {
      rerunWithElectron();
      return;
    }
  }
  // eslint-disable-next-line import/no-extraneous-dependencies
  const Database = require("better-sqlite3");
  try {
    runClear(Database);
  } catch (error) {
    if (
      process.env.POS_CLEAR_TABLES_ELECTRON_CHILD !== "1" &&
      /NODE_MODULE_VERSION|was compiled against a different Node\.js/i.test(String(error && error.message))
    ) {
      rerunWithElectron();
      return;
    }
    console.error(error);
    process.exit(1);
  }
}

main();
