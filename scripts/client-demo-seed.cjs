/**
 * Client demo seed for the installed RestoNiti desktop app.
 *
 * Theme: Maharashtra Misal restaurant with supporting Indian / Indo-Chinese menu.
 * Seeds: floors/tables, menu, staff + ~30 days attendance, ~1 month paid orders,
 *        3 grocery lists, captains, branding.
 *
 * Usage (POS fully closed):
 *   npm run demo:seed
 *
 * Or explicitly:
 *   $env:POS_DEMO_DB = "$env:APPDATA\Restaurant POS\data\restaurant-pos.sqlite"
 *   node scripts/client-demo-seed.cjs
 *
 * Safe to re-run: removes previous demo:* rows first. Does not delete your admin user.
 */
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { randomBytes, scryptSync } = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const DAY_MS = 24 * 60 * 60 * 1000;
const TAX_BPS = 500; // 5% restaurant GST
const DEMO_PREFIX = "demo:";
const CAPTAIN_PASSWORD = "Captain1!";
const CASHIER_PASSWORD = "Cashier1!";
const MANAGER_PASSWORD = "Manager1!";

const dbPath =
  process.env.POS_DEMO_DB ||
  path.join(process.env.APPDATA || "", "Restaurant POS", "data", "restaurant-pos.sqlite");

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

function rupeesToPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

function pad(value, width) {
  return String(value).padStart(width, "0");
}

function createRng(seedText) {
  let state = 2166136261;
  const text = String(seedText || "misal-demo-2026");
  for (let i = 0; i < text.length; i += 1) {
    state ^= text.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  return function rng() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function startOfLocalDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function localDateFromMs(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1, 2);
  const day = pad(d.getDate(), 2);
  return `${y}-${m}-${day}`;
}

function weekdayFromMs(ms) {
  return new Date(ms).getDay();
}

function clearPreviousDemo(db) {
  db.exec(`
    DELETE FROM payments WHERE id LIKE 'demo:%' OR order_id LIKE 'demo:%';
    DELETE FROM order_lines WHERE id LIKE 'demo:%' OR order_id LIKE 'demo:%';
    DELETE FROM orders WHERE id LIKE 'demo:%';
    DELETE FROM attendance_records WHERE id LIKE 'demo:%' OR staff_id LIKE 'demo:%';
    DELETE FROM grocery_purchase_lines WHERE id LIKE 'demo:%' OR purchase_id LIKE 'demo:%';
    DELETE FROM grocery_purchases WHERE id LIKE 'demo:%';
    DELETE FROM grocery_list_lines WHERE id LIKE 'demo:%' OR list_id LIKE 'demo:%';
    DELETE FROM grocery_lists WHERE id LIKE 'demo:%';
    DELETE FROM grocery_items WHERE id LIKE 'demo:%';
    DELETE FROM vendors WHERE id LIKE 'demo:%';
    DELETE FROM customers WHERE id LIKE 'demo:%';
    DELETE FROM users WHERE username IN ('rahul', 'priya', 'amit', 'neha', 'suresh', 'anita') AND role IN ('captain', 'cashier', 'manager');
    DELETE FROM staff WHERE id LIKE 'demo:%';
    DELETE FROM menu_items WHERE id LIKE 'demo:%';
  `);
}

function slugId(prefix, value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}:${slug || "item"}`;
}

function seedMenu(db, now) {
  // Clean slate for demo menu: remove first-run/sample items and rebuild categories.
  // Category names are UNIQUE across active+inactive rows, so wipe categories after
  // detaching items (FK is ON DELETE SET NULL).
  db.prepare(`DELETE FROM menu_items WHERE id NOT LIKE 'demo:%'`).run();
  db.prepare(`UPDATE menu_items SET category_id = NULL WHERE id LIKE 'demo:%'`).run();
  db.prepare(`DELETE FROM menu_categories`).run();

  const categories = [
    { name: "Misal Specials", sort: 1 },
    { name: "Snacks & Breakfast", sort: 2 },
    { name: "Main Course", sort: 3 },
    { name: "Chinese", sort: 4 },
    { name: "Beverages", sort: 5 },
    { name: "Sweets", sort: 6 },
  ];

  const insertCat = db.prepare(
    `INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  );
  const catIdByKey = {};
  for (const cat of categories) {
    const id = slugId("cat", cat.name);
    insertCat.run(id, cat.name, cat.sort, now, now);
    catIdByKey[cat.name] = id;
  }

  // Keep Settings → Categories in sync with what Billing shows.
  upsertSetting(db, "config:categories", { categories: categories.map((c) => c.name) }, now);

  const items = [
    // Misal focus
    { id: "demo:item:kolhapuri-misal", name: "Kolhapuri Misal", cat: "Misal Specials", price: 120, fav: 1 },
    { id: "demo:item:puneri-misal", name: "Puneri Misal", cat: "Misal Specials", price: 110, fav: 1 },
    { id: "demo:item:tarri-misal", name: "Tarri Misal", cat: "Misal Specials", price: 130, fav: 1 },
    { id: "demo:item:matki-misal", name: "Matki Misal", cat: "Misal Specials", price: 100, fav: 0 },
    { id: "demo:item:special-misal", name: "Special Misal Combo", cat: "Misal Specials", price: 160, fav: 1 },
    { id: "demo:item:extra-pav", name: "Extra Pav (2 pcs)", cat: "Misal Specials", price: 20, fav: 0 },
    { id: "demo:item:farsan-bowl", name: "Farsan Bowl", cat: "Misal Specials", price: 40, fav: 0 },
    // Snacks
    { id: "demo:item:poha", name: "Kanda Poha", cat: "Snacks & Breakfast", price: 60, fav: 1 },
    { id: "demo:item:upma", name: "Rava Upma", cat: "Snacks & Breakfast", price: 55, fav: 0 },
    { id: "demo:item:vada-pav", name: "Vada Pav", cat: "Snacks & Breakfast", price: 25, fav: 1 },
    { id: "demo:item:samosa", name: "Samosa (2 pcs)", cat: "Snacks & Breakfast", price: 40, fav: 0 },
    { id: "demo:item:batata-vada", name: "Batata Vada (2 pcs)", cat: "Snacks & Breakfast", price: 35, fav: 0 },
    // Mains
    { id: "demo:item:veg-thali", name: "Maharashtrian Thali", cat: "Main Course", price: 180, fav: 1 },
    { id: "demo:item:paneer-butter", name: "Paneer Butter Masala", cat: "Main Course", price: 220, fav: 0 },
    { id: "demo:item:veg-kolhapuri", name: "Veg Kolhapuri", cat: "Main Course", price: 190, fav: 0 },
    { id: "demo:item:dal-fry", name: "Dal Fry", cat: "Main Course", price: 140, fav: 0 },
    { id: "demo:item:jeera-rice", name: "Jeera Rice", cat: "Main Course", price: 90, fav: 0 },
    { id: "demo:item:butter-naan", name: "Butter Naan", cat: "Main Course", price: 45, fav: 0 },
    // Chinese
    { id: "demo:item:manchurian", name: "Veg Manchurian", cat: "Chinese", price: 160, fav: 0 },
    { id: "demo:item:hakka", name: "Veg Hakka Noodles", cat: "Chinese", price: 150, fav: 1 },
    { id: "demo:item:fried-rice", name: "Veg Fried Rice", cat: "Chinese", price: 140, fav: 0 },
    // Beverages
    { id: "demo:item:cutting-chai", name: "Cutting Chai", cat: "Beverages", price: 15, fav: 1 },
    { id: "demo:item:masala-chai", name: "Masala Chai", cat: "Beverages", price: 25, fav: 1 },
    { id: "demo:item:lassi", name: "Sweet Lassi", cat: "Beverages", price: 50, fav: 0 },
    { id: "demo:item:chaas", name: "Butter Milk (Chaas)", cat: "Beverages", price: 30, fav: 0 },
    { id: "demo:item:lime-soda", name: "Fresh Lime Soda", cat: "Beverages", price: 40, fav: 0 },
    { id: "demo:item:soft-drink", name: "Soft Drink", cat: "Beverages", price: 30, fav: 0 },
    // Sweets
    { id: "demo:item:shrikhand", name: "Shrikhand", cat: "Sweets", price: 70, fav: 0 },
    { id: "demo:item:gulab-jamun", name: "Gulab Jamun (2 pcs)", cat: "Sweets", price: 60, fav: 0 },
    { id: "demo:item:ice-cream", name: "Ice Cream Scoop", cat: "Sweets", price: 50, fav: 0 },
  ];

  const prepared = [];
  for (const item of items) {
    const pricePaise = rupeesToPaise(item.price);
    const categoryId = catIdByKey[item.cat];
    db.prepare(
      `INSERT INTO menu_items (
         id, sku, name, category_id, price_paise, available, favorite, tax_rate_bps, active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         category_id = excluded.category_id,
         price_paise = excluded.price_paise,
         available = 1,
         favorite = excluded.favorite,
         tax_rate_bps = excluded.tax_rate_bps,
         active = 1,
         updated_at = excluded.updated_at`,
    ).run(item.id, null, item.name, categoryId, pricePaise, item.fav, TAX_BPS, now, now);
    prepared.push({
      id: item.id,
      name: item.name,
      categoryId,
      categoryName: item.cat,
      pricePaise,
      fav: item.fav,
    });
  }
  return prepared;
}

function upsertSetting(db, key, value, now) {
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), now);
}

function seedBrandingAndGst(db, now) {
  upsertSetting(
    db,
    "config:branding",
    {
      hotelName: "Green Leaf",
      hotelInitials: "GL",
      tagline: "Fresh Misal · Honest Flavours",
      phone: "020-2445-7788",
      email: "hello@greenleaf.in",
      address: "FC Road, Pune",
    },
    now,
  );
  upsertSetting(
    db,
    "config:gst",
    {
      enabled: true,
      gstin: "27AABCU9603R1ZM",
      cgstRateBps: 250,
      sgstRateBps: 250,
      priceInclusive: false,
    },
    now,
  );
}

function seedFloor(db, now) {
  const areas = [
    { id: "area:ground", name: "Ground Floor", sort: 1 },
    { id: "area:first", name: "First Floor", sort: 2 },
  ];
  for (const area of areas) {
    db.prepare(
      `INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order, active = 1, updated_at = excluded.updated_at`,
    ).run(area.id, area.name, area.sort, now, now);
  }

  // Soft-disable default Main Dining clutter for the demo floor story.
  db.prepare(
    `UPDATE seating_areas SET active = 0, updated_at = ? WHERE id = 'area:main'`,
  ).run(now);

  for (let i = 1; i <= 16; i += 1) {
    const areaId = i <= 8 ? "area:ground" : "area:first";
    const name = i <= 8 ? `GF${i}` : `FF${i - 8}`;
    const existing = db.prepare("SELECT id FROM tables WHERE id = ?").get(i);
    if (existing) {
      db.prepare(
        `UPDATE tables SET name = ?, area_id = ?, seats = ?, sort_order = ?, active = 1, updated_at = ? WHERE id = ?`,
      ).run(name, areaId, i % 2 === 0 ? 6 : 4, i, now, i);
    } else {
      db.prepare(
        `INSERT INTO tables (id, name, seats, area_id, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(i, name, i % 2 === 0 ? 6 : 4, areaId, i, now, now);
    }
  }

  // Hide leftover higher table numbers from first-run seed if present.
  db.prepare(`UPDATE tables SET active = 0, updated_at = ? WHERE id > 16`).run(now);
}

function seedStaffAndUsers(db, now, actor) {
  const staffRows = [
    { id: "demo:staff:manager", name: "Anita Deshmukh", phone: "9876501001", designation: "Manager", salary: 35000, off: [0], shift: "morning" },
    { id: "demo:staff:cashier1", name: "Suresh Patil", phone: "9876501002", designation: "Cashier", salary: 22000, off: [0], shift: "morning" },
    { id: "demo:staff:cashier2", name: "Neha Kulkarni", phone: "9876501003", designation: "Cashier", salary: 22000, off: [1], shift: "evening" },
    { id: "demo:staff:chef", name: "Ramesh Jadhav", phone: "9876501004", designation: "Head Cook", salary: 28000, off: [0], shift: "morning" },
    { id: "demo:staff:kitchen", name: "Sunil More", phone: "9876501005", designation: "Kitchen Assistant", salary: 16000, off: [2], shift: "morning" },
    { id: "demo:staff:server1", name: "Rahul Shinde", phone: "9876501006", designation: "Server", salary: 15000, off: [0], shift: "morning" },
    { id: "demo:staff:server2", name: "Priya Pawar", phone: "9876501007", designation: "Server", salary: 15000, off: [3], shift: "evening" },
    { id: "demo:staff:helper", name: "Amit Gaikwad", phone: "9876501008", designation: "Helper", salary: 12000, off: [0], shift: "morning" },
  ];

  const insertStaff = db.prepare(`
    INSERT INTO staff (
      id, name, phone, designation, joining_date, salary_paise, address, notes,
      photo_mime, photo_base64, weekly_off_days, default_shift_id, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1, ?, ?)
  `);

  for (const row of staffRows) {
    insertStaff.run(
      row.id,
      row.name,
      row.phone,
      row.designation,
      "2025-04-01",
      rupeesToPaise(row.salary),
      "Near FC Road, Pune",
      JSON.stringify(row.off),
      row.shift,
      now,
      now,
    );
  }

  const loginUsers = [
    { username: "anita", display: "Anita Deshmukh", role: "manager", staffId: "demo:staff:manager", password: MANAGER_PASSWORD },
    { username: "suresh", display: "Suresh Patil", role: "cashier", staffId: "demo:staff:cashier1", password: CASHIER_PASSWORD },
    { username: "neha", display: "Neha Kulkarni", role: "cashier", staffId: "demo:staff:cashier2", password: CASHIER_PASSWORD },
    { username: "rahul", display: "Captain Rahul", role: "captain", staffId: "demo:staff:server1", password: CAPTAIN_PASSWORD },
    { username: "priya", display: "Captain Priya", role: "captain", staffId: "demo:staff:server2", password: CAPTAIN_PASSWORD },
    { username: "amit", display: "Captain Amit", role: "captain", staffId: "demo:staff:helper", password: CAPTAIN_PASSWORD },
  ];

  for (const user of loginUsers) {
    const existing = db.prepare("SELECT username FROM users WHERE username = ?").get(user.username);
    if (existing) {
      db.prepare(
        `UPDATE users SET display_name = ?, role = ?, staff_id = ?, active = 1, require_password_change = 0, updated_at = ? WHERE username = ?`,
      ).run(user.display, user.role, user.staffId, now, user.username);
    } else {
      const cred = hashPassword(user.password);
      db.prepare(
        `INSERT INTO users (
           username, display_name, role, password_hash, salt, hash_algo, active, require_password_change, staff_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
      ).run(
        user.username,
        user.display,
        user.role,
        cred.password_hash,
        cred.salt,
        cred.hash_algo,
        user.staffId,
        now,
        now,
      );
    }
  }

  return { staffRows, actor };
}

function seedAttendance(db, staffRows, actor, opsAnchorMs, days) {
  const insert = db.prepare(`
    INSERT INTO attendance_records (
      id, staff_id, attendance_date, shift_id, status, is_late, check_in_time, check_out_time,
      break_minutes, worked_minutes, overtime_minutes, remarks, created_by, created_on, updated_by, updated_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const dayStart = startOfLocalDay(opsAnchorMs);
  let count = 0;
  for (const staff of staffRows) {
    const offs = new Set(staff.off || []);
    for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
      const dateMs = dayStart - dayIndex * DAY_MS;
      const attendanceDate = localDateFromMs(dateMs);
      const weekday = weekdayFromMs(dateMs);
      let status = "present";
      if (offs.has(weekday)) {
        status = "holiday";
      } else {
        const roll = Math.random();
        if (roll < 0.04) status = "absent";
        else if (roll < 0.08) status = "leave";
        else if (roll < 0.12) status = "half-day";
      }
      const isWorking = status === "present" || status === "half-day";
      const isLate = isWorking && Math.random() < 0.1 ? 1 : 0;
      const worked = status === "present" ? 480 : status === "half-day" ? 240 : 0;
      const checkIn = isWorking ? (isLate ? "09:25" : "09:00") : null;
      const checkOut = isWorking ? (status === "half-day" ? "13:00" : "18:00") : null;
      insert.run(
        `demo:attendance:${staff.id.split(":").pop()}:${attendanceDate}`,
        staff.id,
        attendanceDate,
        staff.shift || "morning",
        status,
        isLate,
        checkIn,
        checkOut,
        isWorking ? 30 : 0,
        worked,
        status === "present" && Math.random() < 0.12 ? 30 + Math.floor(Math.random() * 31) : 0,
        status === "leave" ? "Personal leave" : status === "absent" ? "No show" : null,
        actor,
        dateMs,
        actor,
        dateMs,
      );
      count += 1;
    }
  }
  return count;
}

function seedGrocery(db, actor, opsAnchorMs) {
  const now = Date.now();
  const groceryItems = [
    { id: "demo:gitem:matki", name: "Matki (Moth Beans)", category: "Pulses", unit: "kg", qty: 5, price: 120 },
    { id: "demo:gitem:farsan", name: "Misal Farsan Mix", category: "Snacks", unit: "kg", qty: 3, price: 180 },
    { id: "demo:gitem:pav", name: "Pav Bread", category: "Bakery", unit: "packet", qty: 20, price: 40 },
    { id: "demo:gitem:onion", name: "Onion", category: "Vegetables", unit: "kg", qty: 10, price: 30 },
    { id: "demo:gitem:tomato", name: "Tomato", category: "Vegetables", unit: "kg", qty: 8, price: 35 },
    { id: "demo:gitem:potato", name: "Potato", category: "Vegetables", unit: "kg", qty: 10, price: 25 },
    { id: "demo:gitem:oil", name: "Refined Oil", category: "Oil", unit: "L", qty: 5, price: 160 },
    { id: "demo:gitem:mirchi", name: "Red Chilli Powder", category: "Spices", unit: "kg", qty: 2, price: 280 },
    { id: "demo:gitem:goda", name: "Goda Masala", category: "Spices", unit: "kg", qty: 1, price: 350 },
    { id: "demo:gitem:curd", name: "Curd / Dahi", category: "Dairy", unit: "kg", qty: 5, price: 60 },
    { id: "demo:gitem:tea", name: "Tea Leaves", category: "Beverages", unit: "kg", qty: 2, price: 420 },
    { id: "demo:gitem:lemon", name: "Lemon", category: "Vegetables", unit: "dozen", qty: 4, price: 40 },
    { id: "demo:gitem:coriander", name: "Coriander Leaves", category: "Vegetables", unit: "bunch", qty: 10, price: 15 },
    { id: "demo:gitem:sev", name: "Nylon Sev", category: "Snacks", unit: "kg", qty: 2, price: 200 },
  ];

  const insertItem = db.prepare(`
    INSERT INTO grocery_items (
      id, name, category, default_unit, default_quantity, vendor_hint, active, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
  `);
  for (const item of groceryItems) {
    insertItem.run(item.id, item.name, item.category, item.unit, item.qty, "Laxmi Mandai Vendor", now, now);
  }

  db.prepare(
    `INSERT INTO vendors (
       id, name, contact_person, phone, email, address, gstin, notes, active, created_by, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, 1, ?, ?, ?, NULL)`,
  ).run(
    "demo:vendor:mandai",
    "Laxmi Mandai Supplies",
    "Ganesh",
    "9822011122",
    "Mandai, Pune",
    "Morning vegetable & farsan supplier",
    actor,
    now,
    now,
  );

  const insertList = db.prepare(`
    INSERT INTO grocery_lists (
      id, title, list_date, list_type, status, notes, created_by, updated_by,
      completed_at, print_count, last_printed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLine = db.prepare(`
    INSERT INTO grocery_list_lines (
      id, list_id, grocery_item_id, item_name, category, quantity, unit, vendor_hint,
      sort_order, estimated_unit_price_paise, estimated_total_paise, purchased_quantity,
      purchased_unit_price_paise, purchased_total_paise, line_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const lists = [
    {
      id: "demo:glist:weekly-done",
      title: "Weekly Mandai Run",
      offsetDays: 7,
      type: "regular",
      status: "completed",
      notes: "Completed last Sunday market purchase",
      itemIndexes: [0, 1, 2, 3, 4, 6, 10],
    },
    {
      id: "demo:glist:this-week",
      title: "This Week Refill",
      offsetDays: 1,
      type: "refill",
      status: "open",
      notes: "Pending morning purchase",
      itemIndexes: [1, 2, 5, 7, 8, 11, 12],
    },
    {
      id: "demo:glist:emergency-oil",
      title: "Emergency Oil & Sev",
      offsetDays: 0,
      type: "emergency",
      status: "draft",
      notes: "Kitchen running low before dinner rush",
      itemIndexes: [6, 13, 1],
    },
  ];

  for (const list of lists) {
    const listDate = startOfLocalDay(opsAnchorMs) - list.offsetDays * DAY_MS + 9 * 60 * 60 * 1000;
    const completedAt = list.status === "completed" ? listDate + 3 * 60 * 60 * 1000 : null;
    insertList.run(
      list.id,
      list.title,
      listDate,
      list.type,
      list.status,
      list.notes,
      actor,
      actor,
      completedAt,
      list.status === "completed" ? 1 : 0,
      list.status === "completed" ? listDate : null,
      listDate,
      completedAt || listDate,
    );

    list.itemIndexes.forEach((idx, sort) => {
      const item = groceryItems[idx];
      const unitPaise = rupeesToPaise(item.price);
      const qty = item.qty;
      const total = unitPaise * qty;
      const purchased = list.status === "completed";
      insertLine.run(
        `${list.id}:line:${pad(sort + 1, 2)}`,
        list.id,
        item.id,
        item.name,
        item.category,
        qty,
        item.unit,
        "Laxmi Mandai Vendor",
        sort,
        unitPaise,
        total,
        purchased ? qty : null,
        purchased ? unitPaise : null,
        purchased ? total : null,
        purchased ? "purchased" : "pending",
        listDate,
        completedAt || listDate,
      );
    });
  }

  return { groceryItemCount: groceryItems.length, listCount: lists.length };
}

function seedCustomers(db, now) {
  const customers = [
    { id: "demo:cust:1", name: "Sneha Joshi", phone: "9811100001" },
    { id: "demo:cust:2", name: "Vikram Shah", phone: "9811100002" },
    { id: "demo:cust:3", name: "Meera Naik", phone: "9811100003" },
    { id: "demo:cust:4", name: "Ajay Kamble", phone: "9811100004" },
    { id: "demo:cust:5", name: "Pooja Rane", phone: "9811100005" },
  ];
  const insert = db.prepare(`
    INSERT INTO customers (id, name, phone, address, notes, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, 1, ?, ?)
  `);
  for (const c of customers) {
    insert.run(c.id, c.name, c.phone, "Pune", now, now);
  }
  return customers;
}

function weightedMenuPick(rng, items) {
  const favs = items.filter((i) => i.fav);
  if (favs.length && rng() < 0.55) {
    return pick(rng, favs);
  }
  const misal = items.filter((i) => i.categoryName === "Misal Specials");
  if (misal.length && rng() < 0.45) {
    return pick(rng, misal);
  }
  return pick(rng, items);
}

function seedOrders(db, items, customers, actor, opsAnchorMs, days, targetOrders) {
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      id, order_type, table_id, customer_id, status, kot_status, subtotal_paise, tax_total_paise,
      discount_percent, discount_total_paise, total_paise, invoice_number, paid_at, cancelled_at,
      cancelled_by, cancellation_reason, meta_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLine = db.prepare(`
    INSERT INTO order_lines (
      id, order_id, menu_item_id, item_name, category_name, quantity, rate_paise, tax_rate_bps,
      line_total_paise, kot_printed_qty, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPayment = db.prepare(`
    INSERT INTO payments (
      id, order_id, method, amount_paise, amount_paid_paise, change_paise, txn_ref,
      split_json, status, received_by, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
  `);

  const rng = createRng("shree-kolhapuri-misal");
  const dayStart = startOfLocalDay(opsAnchorMs);
  const platforms = ["Swiggy", "Zomato"];
  let invoiceSeq = 0;
  let salesPaise = 0;

  // Spread orders across days with busier weekends.
  for (let orderNumber = 1; orderNumber <= targetOrders; orderNumber += 1) {
    const dayOffset = (orderNumber - 1) % days;
    const dateMs = dayStart - dayOffset * DAY_MS;
    const weekday = weekdayFromMs(dateMs);
    const isWeekend = weekday === 0 || weekday === 6;
    // Service hours: breakfast 8–11, lunch 12–15, evening 17–21
    const slot = pick(rng, isWeekend ? ["breakfast", "lunch", "lunch", "evening", "evening"] : ["breakfast", "lunch", "evening"]);
    let hour;
    if (slot === "breakfast") hour = randomInt(rng, 8, 10);
    else if (slot === "lunch") hour = randomInt(rng, 12, 14);
    else hour = randomInt(rng, 17, 20);
    const createdAt = dateMs + hour * 60 * 60 * 1000 + randomInt(rng, 0, 59) * 60 * 1000;
    const paidAt = createdAt + randomInt(rng, 15 * 60 * 1000, 70 * 60 * 1000);

    const orderType = pick(rng, ["table", "table", "table", "takeaway", "takeaway", "delivery"]);
    const tableId = orderType === "table" ? randomInt(rng, 1, 16) : null;
    const customer = orderType === "table" ? null : pick(rng, customers);
    const cancelled = orderNumber % 97 === 0;
    const lineCount = randomInt(rng, 1, orderType === "table" ? 5 : 3);
    const lines = [];
    let subtotalPaise = 0;
    for (let i = 0; i < lineCount; i += 1) {
      const item = weightedMenuPick(rng, items);
      const quantity = randomInt(rng, 1, item.categoryName === "Misal Specials" ? 3 : 2);
      const lineTotalPaise = quantity * item.pricePaise;
      subtotalPaise += lineTotalPaise;
      lines.push({ item, quantity, lineTotalPaise });
    }
    const discountPercent = pick(rng, [0, 0, 0, 0, 5, 10]);
    const discountTotalPaise = Math.round((subtotalPaise * discountPercent) / 100);
    const taxable = Math.max(0, subtotalPaise - discountTotalPaise);
    const taxTotalPaise = Math.round((taxable * TAX_BPS) / 10000);
    const totalPaise = taxable + taxTotalPaise;
    invoiceSeq += 1;
    const orderId = `demo:order:${pad(orderNumber, 5)}`;
    const invoiceNumber = cancelled ? null : `INV-26-27-${pad(invoiceSeq, 6)}`;

    let meta = { demo: true };
    if (orderType === "delivery") {
      meta = {
        ...meta,
        platform: pick(rng, platforms),
        code: `${pick(rng, ["SW", "ZM"])}${randomInt(rng, 1000, 9999)}`,
        customerName: customer?.name || "",
        customerPhone: customer?.phone || "",
      };
    } else if (orderType === "takeaway") {
      meta = {
        ...meta,
        customerName: customer?.name || "",
        customerPhone: customer?.phone || "",
        parcelName: customer?.name || "",
      };
    }

    insertOrder.run(
      orderId,
      orderType,
      tableId,
      customer?.id || null,
      cancelled ? "cancelled" : "paid",
      "printed",
      subtotalPaise,
      taxTotalPaise,
      discountPercent,
      discountTotalPaise,
      totalPaise,
      invoiceNumber,
      cancelled ? null : paidAt,
      cancelled ? paidAt : null,
      cancelled ? actor : null,
      cancelled ? "Customer cancelled" : null,
      JSON.stringify(meta),
      actor,
      createdAt,
      cancelled ? paidAt : paidAt,
    );

    lines.forEach((line, index) => {
      insertLine.run(
        `${orderId}:line:${pad(index + 1, 2)}`,
        orderId,
        line.item.id,
        line.item.name,
        line.item.categoryName,
        line.quantity,
        line.item.pricePaise,
        TAX_BPS,
        line.lineTotalPaise,
        line.quantity,
        index,
        createdAt,
        paidAt,
      );
    });

    if (!cancelled) {
      const method = pick(rng, ["upi", "upi", "cash", "cash", "card", "online"]);
      const amountPaid =
        method === "cash" ? Math.ceil(totalPaise / 1000) * 1000 : totalPaise;
      insertPayment.run(
        `demo:payment:${pad(orderNumber, 5)}`,
        orderId,
        method === "online" && orderType !== "delivery" ? "upi" : method,
        totalPaise,
        amountPaid,
        method === "cash" ? amountPaid - totalPaise : 0,
        method === "cash" ? null : `UPI${pad(orderNumber, 6)}`,
        null,
        actor,
        paidAt,
      );
      salesPaise += totalPaise;
    }
  }

  // A couple of open dine-in tickets so Billing / Tables look live.
  for (let openIndex = 1; openIndex <= 2; openIndex += 1) {
    const createdAt = Date.now() - openIndex * 25 * 60 * 1000;
    const orderId = `demo:order:open:${openIndex}`;
    const tableId = openIndex;
    const lines = [
      { item: items.find((i) => i.id === "demo:item:kolhapuri-misal"), quantity: 2 },
      { item: items.find((i) => i.id === "demo:item:cutting-chai"), quantity: 2 },
    ].filter((l) => l.item);
    let subtotalPaise = 0;
    const built = lines.map((line) => {
      const lineTotalPaise = line.quantity * line.item.pricePaise;
      subtotalPaise += lineTotalPaise;
      return { ...line, lineTotalPaise };
    });
    const taxTotalPaise = Math.round((subtotalPaise * TAX_BPS) / 10000);
    const totalPaise = subtotalPaise + taxTotalPaise;
    insertOrder.run(
      orderId,
      "table",
      tableId,
      null,
      "open",
      openIndex === 1 ? "pending" : "printed",
      subtotalPaise,
      taxTotalPaise,
      0,
      0,
      totalPaise,
      null,
      null,
      null,
      null,
      null,
      JSON.stringify({ demo: true, live: true }),
      actor,
      createdAt,
      createdAt,
    );
    built.forEach((line, index) => {
      insertLine.run(
        `${orderId}:line:${pad(index + 1, 2)}`,
        orderId,
        line.item.id,
        line.item.name,
        line.item.categoryName,
        line.quantity,
        line.item.pricePaise,
        TAX_BPS,
        line.lineTotalPaise,
        openIndex === 1 ? 0 : line.quantity,
        index,
        createdAt,
        createdAt,
      );
    });
  }

  upsertSetting(
    db,
    "config:invoice",
    { prefix: "INV", fiscalYear: "26-27", lastNumber: invoiceSeq },
    Date.now(),
  );

  return { orderCount: targetOrders + 2, salesPaise, invoiceSeq };
}

function resolveActor(db) {
  const admin = db
    .prepare(`SELECT username FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at ASC LIMIT 1`)
    .get();
  if (admin?.username) {
    return admin.username;
  }
  const any = db.prepare(`SELECT username FROM users WHERE active = 1 LIMIT 1`).get();
  return any?.username || null;
}

function runSeed(Database) {
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    console.error("Install and launch RestoNiti once, create an admin, then quit the app.");
    console.error("Or set POS_DEMO_DB to your restaurant-pos.sqlite path.");
    process.exit(1);
  }

  const db = new Database(dbPath);
  const now = Date.now();
  const days = 30;
  const targetOrders = 900;
  const opsAnchorMs = now;

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("BEGIN");
  try {
    const actor = resolveActor(db);
    if (!actor) {
      throw new Error("No active user found. Launch the app, create an admin account, quit, then re-run.");
    }

    clearPreviousDemo(db);
    seedBrandingAndGst(db, now);
    seedFloor(db, now);
    const menuItems = seedMenu(db, now);
    const { staffRows } = seedStaffAndUsers(db, now, actor);
    const attendanceCount = seedAttendance(db, staffRows, actor, opsAnchorMs, days);
    const grocery = seedGrocery(db, actor, opsAnchorMs);
    const customers = seedCustomers(db, now);
    const orders = seedOrders(db, menuItems, customers, actor, opsAnchorMs, days, targetOrders);

    db.exec("COMMIT");
    console.log("Client demo seed applied successfully.");
    console.log(`  DB: ${dbPath}`);
    console.log("  Restaurant: Green Leaf");
    console.log("  Floors: Ground (GF1–GF8), First (FF1–FF8)");
    console.log(`  Menu: ${menuItems.length} items (Misal-focused + snacks/mains/Chinese/beverages/sweets)`);
    console.log(`  Staff: ${staffRows.length} people · attendance days: ${attendanceCount} rows`);
    console.log(`  Orders: ~${orders.orderCount} over ${days} days (incl. 2 open table tickets)`);
    console.log(`  Sales total (paid): ₹${(orders.salesPaise / 100).toLocaleString("en-IN")}`);
    console.log(`  Grocery: ${grocery.groceryItemCount} catalogue items · ${grocery.listCount} lists`);
    console.log("  Login helpers:");
    console.log(`    manager   anita             password ${MANAGER_PASSWORD}`);
    console.log(`    cashiers  neha / suresh     password ${CASHIER_PASSWORD}`);
    console.log(`    captains  rahul / priya / amit   password ${CAPTAIN_PASSWORD}`);
    console.log(`    admin     (your existing admin account)`);
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
