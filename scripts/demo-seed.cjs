/**
 * Opt-in demo seed for the Captain / two-floor client walkthrough.
 *
 * Usage (POS closed):
 *   node scripts/demo-seed.cjs
 *
 * Seeds seating areas Floor 1 / Floor 2, tables T01–T20, demo menu items,
 * and captain users (password: Captain1!). Does not wipe existing users/orders.
 *
 * better-sqlite3 is built for Electron, so this script re-runs itself under
 * Electron's Node ABI when started with system Node.
 */
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { randomBytes, scryptSync } = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const dbPath =
  process.env.POS_DEMO_DB ||
  path.join(ROOT_DIR, ".user-data", "data", "restaurant-pos.sqlite");

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
    throw new Error("Unable to locate Electron executable for demo seed.");
  }
  const result = spawnSync(electronPath, [__filename, ...process.argv.slice(2)], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      POS_DEMO_ELECTRON_CHILD: "1",
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

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const password_hash = scryptSync(password, Buffer.from(salt, "hex"), 64, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 160 * 1024 * 1024,
  }).toString("hex");
  return { salt, password_hash, hash_algo: "SCRYPT-N131072-R8-P1" };
}

function runSeed(Database) {
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    console.error("Start the app once first, or set POS_DEMO_DB.");
    process.exit(1);
  }

  const db = new Database(dbPath);
  const now = Date.now();

  db.exec("BEGIN");
  try {
    const areas = [
      { id: "area:floor-1", name: "Floor 1", sort: 1 },
      { id: "area:floor-2", name: "Floor 2", sort: 2 },
    ];
    for (const area of areas) {
      db.prepare(
        `INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order, active = 1, updated_at = excluded.updated_at`,
      ).run(area.id, area.name, area.sort, now, now);
    }

    for (let i = 1; i <= 20; i += 1) {
      const areaId = i <= 10 ? "area:floor-1" : "area:floor-2";
      const name = `T${String(i).padStart(2, "0")}`;
      const existing = db.prepare("SELECT id FROM tables WHERE id = ?").get(i);
      if (existing) {
        db.prepare(
          "UPDATE tables SET name = ?, area_id = ?, seats = 4, sort_order = ?, active = 1, updated_at = ? WHERE id = ?",
        ).run(name, areaId, i, now, i);
      } else {
        db.prepare(
          `INSERT INTO tables (id, name, seats, area_id, sort_order, active, created_at, updated_at)
           VALUES (?, ?, 4, ?, ?, 1, ?, ?)`,
        ).run(i, name, areaId, i, now, now);
      }
    }

    const categories = [
      { id: "cat:mains", name: "Mains", sort: 1 },
      { id: "cat:beverages", name: "Beverages", sort: 2 },
      { id: "cat:sides", name: "Sides", sort: 3 },
    ];
    for (const cat of categories) {
      db.prepare(
        `INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = 1, updated_at = excluded.updated_at`,
      ).run(cat.id, cat.name, cat.sort, now, now);
    }

    const items = [
      { id: "item:paneer-tikka", name: "Paneer Tikka", cat: "cat:mains", price: 22000, fav: 1 },
      { id: "item:veg-biryani", name: "Veg Biryani", cat: "cat:mains", price: 18000, fav: 1 },
      { id: "item:fresh-lime", name: "Fresh Lime", cat: "cat:beverages", price: 6000, fav: 1 },
      { id: "item:masala-chai", name: "Masala Chai", cat: "cat:beverages", price: 4000, fav: 0 },
      { id: "item:butter-naan", name: "Butter Naan", cat: "cat:sides", price: 5000, fav: 0 },
    ];
    for (const item of items) {
      db.prepare(
        `INSERT INTO menu_items (
           id, sku, name, category_id, price_paise, available, favorite, tax_rate_bps, active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, 1800, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           category_id = excluded.category_id,
           price_paise = excluded.price_paise,
           available = 1,
           favorite = excluded.favorite,
           active = 1,
           updated_at = excluded.updated_at`,
      ).run(item.id, null, item.name, item.cat, item.price, item.fav, now, now);
    }

    const captains = [
      { username: "rahul", display: "Captain Rahul" },
      { username: "priya", display: "Captain Priya" },
      { username: "amit", display: "Captain Amit" },
    ];
    for (const captain of captains) {
      const existing = db.prepare("SELECT username FROM users WHERE username = ?").get(captain.username);
      if (existing) {
        db.prepare(
          "UPDATE users SET role = 'captain', display_name = ?, active = 1, updated_at = ? WHERE username = ?",
        ).run(captain.display, now, captain.username);
      } else {
        const cred = hashPassword("Captain1!");
        db.prepare(
          `INSERT INTO users (
             username, display_name, role, password_hash, salt, hash_algo, active, require_password_change, created_at, updated_at
           ) VALUES (?, ?, 'captain', ?, ?, ?, 1, 0, ?, ?)`,
        ).run(
          captain.username,
          captain.display,
          cred.password_hash,
          cred.salt,
          cred.hash_algo,
          now,
          now,
        );
      }
    }

    db.prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES ('config:branding', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).run(
      JSON.stringify({
        hotelName: "Green Leaf Kitchen",
        hotelInitials: "GL",
        tagline: "Eco-friendly dining",
        phone: "",
        email: "",
      }),
      now,
    );

    db.exec("COMMIT");
    console.log("Demo seed applied:");
    console.log(`  DB: ${dbPath}`);
    console.log("  Floors: Floor 1 (T01–T10), Floor 2 (T11–T20)");
    console.log("  Captains: rahul / priya / amit  password: Captain1!");
    console.log("  Branding: Green Leaf Kitchen");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

try {
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch (error) {
    const message = String(error?.message || error || "");
    if (
      !process.env.POS_DEMO_ELECTRON_CHILD &&
      /NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(message)
    ) {
      rerunWithElectron();
    }
    throw error;
  }
  runSeed(Database);
} catch (error) {
  const message = String(error?.message || error || "");
  if (
    !process.env.POS_DEMO_ELECTRON_CHILD &&
    /NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(message)
  ) {
    try {
      rerunWithElectron();
    } catch (fallbackError) {
      console.error(fallbackError);
      process.exit(1);
    }
  } else {
    console.error(error);
    process.exit(1);
  }
}
