/**
 * Demo day for website screenshots. No guest names, phones, or credit accounts.
 * The caller must already have an initialized plaintext database.
 */
const { randomBytes, scryptSync } = require("crypto");

const GSTIN = "29ABCDE1234F1Z5";
const GST_RATE_BPS = 500;
const ADMIN_PASSWORD = "Demo1234!";
const CAPTAIN_PASSWORD = "Captain1!";

const GST = {
  enabled: true,
  gstin: GSTIN,
    legalName: "Saffron House",
  registeredAddress: "12, Residency Road, Bengaluru, Karnataka 560025",
  stateCode: "29",
  stateName: "Karnataka",
  gstRateBps: GST_RATE_BPS,
  priceIncludesTax: false,
};

const MENU = [
  { id: "shot:item:misal", name: "Misal Pav", category: "Snacks", price: 90 },
  { id: "shot:item:vada", name: "Vada Pav", category: "Snacks", price: 40 },
  { id: "shot:item:thali", name: "Veg Thali", category: "Mains", price: 180 },
  { id: "shot:item:paneer", name: "Paneer Butter Masala", category: "Mains", price: 220 },
  { id: "shot:item:naan", name: "Butter Naan", category: "Mains", price: 45 },
  { id: "shot:item:rice", name: "Jeera Rice", category: "Mains", price: 90 },
  { id: "shot:item:chai", name: "Masala Chai", category: "Drinks", price: 25 },
  { id: "shot:item:lime", name: "Fresh Lime Soda", category: "Drinks", price: 40 },
  { id: "shot:item:jamun", name: "Gulab Jamun", category: "Sweets", price: 60 },
];

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

function roundHalfUpDiv(numerator, denominator) {
  const top = Math.trunc(numerator);
  const bottom = Math.trunc(denominator);
  const sign = top < 0 ? -1 : 1;
  const abs = Math.abs(top);
  return sign * Math.floor((abs + Math.floor(bottom / 2)) / bottom);
}

function roundToNearestRupee(paise) {
  const safe = Math.max(0, Math.trunc(paise));
  const remainder = safe % 100;
  if (remainder === 0) return safe;
  if (remainder < 50) return safe - remainder;
  return safe + (100 - remainder);
}

function billTotals(lines) {
  const subtotalPaise = lines.reduce((sum, line) => sum + line.qty * line.pricePaise, 0);
  const taxPaise = roundHalfUpDiv(subtotalPaise * GST_RATE_BPS, 10000);
  const preRound = subtotalPaise + taxPaise;
  const totalPaise = roundToNearestRupee(preRound);
  return {
    subtotalPaise,
    taxPaise,
    totalPaise,
    roundOffPaise: totalPaise - preRound,
  };
}

function upsertSetting(db, key, value, now) {
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), now);
}

function fiscalYearLabel(timestamp) {
  const date = new Date(timestamp);
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function startOfLocalDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function itemById(id) {
  const item = MENU.find((entry) => entry.id === id);
  if (!item) throw new Error(`missing menu item ${id}`);
  return item;
}

function linesFrom(spec) {
  return spec.map(([id, qty]) => {
    const item = itemById(id);
    return {
      id,
      name: item.name,
      category: item.category,
      qty,
      pricePaise: item.price * 100,
    };
  });
}

function seed(db) {
  const now = Date.now();
  const dayStart = startOfLocalDay(now);
  const fiscalYear = fiscalYearLabel(now);

  const admin = hashPassword(ADMIN_PASSWORD);
  const captain = hashPassword(CAPTAIN_PASSWORD);
  db.prepare(
    `INSERT INTO users (
       username, display_name, role, password_hash, salt, hash_algo, active,
       require_password_change, staff_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)`,
  ).run("admin", "Owner", "admin", admin.password_hash, admin.salt, admin.hash_algo, now, now);
  db.prepare(
    `INSERT INTO users (
       username, display_name, role, password_hash, salt, hash_algo, active,
       require_password_change, staff_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)`,
  ).run(
    "captain",
    "Captain",
    "captain",
    captain.password_hash,
    captain.salt,
    captain.hash_algo,
    now,
    now,
  );

  upsertSetting(
    db,
    "config:branding",
    {
      hotelName: "Saffron House",
      hotelInitials: "SH",
      tagline: "Bengaluru",
      phone: "+91 90000 00000",
      email: "",
      address: "12, Residency Road, Bengaluru",
      logoDataUrl: null,
      receiptLogoRaster: null,
      logoUpdatedAt: 0,
      receiptQr: { mode: "off" },
    },
    now,
  );
  upsertSetting(db, "config:gst", GST, now);
  upsertSetting(
    db,
    "config:tables",
    {
      tableCount: 20,
      defaultSeats: 4,
      layout: [
        {
          id: "area:main",
          name: "Ground Floor",
          tableCount: 12,
          namingMode: "prefix",
          prefix: "G",
          defaultSeats: 4,
        },
        {
          id: "area:first",
          name: "First Floor",
          tableCount: 8,
          namingMode: "prefix",
          prefix: "F",
          defaultSeats: 4,
        },
      ],
    },
    now,
  );
  db.prepare("UPDATE seating_areas SET name = ?, sort_order = 1, updated_at = ? WHERE id = ?").run(
    "Ground Floor",
    now,
    "area:main",
  );
  db.prepare(
    `INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
     VALUES ('area:first', 'First Floor', 2, 1, ?, ?)`,
  ).run(now, now);

  const insertTable = db.prepare(
    `INSERT INTO tables (id, name, seats, area_id, sort_order, active, created_at, updated_at)
     VALUES (?, ?, 4, ?, ?, 1, ?, ?)`,
  );
  for (let index = 0; index < 12; index += 1) {
    const id = index + 1;
    insertTable.run(id, `G${id}`, "area:main", index + 1, now, now);
  }
  for (let index = 0; index < 8; index += 1) {
    const id = index + 13;
    insertTable.run(id, `F${index + 1}`, "area:first", index + 1, now, now);
  }

  const insertCategory = db.prepare(
    `INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  );
  const categories = ["Snacks", "Mains", "Drinks", "Sweets"];
  categories.forEach((name, index) => {
    insertCategory.run(`shot:cat:${name.toLowerCase()}`, name, index + 1, now, now);
  });

  const insertItem = db.prepare(
    `INSERT INTO menu_items (
       id, sku, name, category_id, price_paise, available, favorite, tax_rate_bps,
       sort_order, diet, active, created_at, updated_at
     ) VALUES (?, NULL, ?, ?, ?, 1, 0, ?, ?, 'veg', 1, ?, ?)`,
  );
  MENU.forEach((item, index) => {
    insertItem.run(
      item.id,
      item.name,
      `shot:cat:${item.category.toLowerCase()}`,
      item.price * 100,
      GST_RATE_BPS,
      index + 1,
      now,
      now,
    );
  });

  const insertOrder = db.prepare(
    `INSERT INTO orders (
       id, order_type, table_id, customer_id, status, kot_status,
       subtotal_paise, tax_total_paise, discount_percent, discount_mode, discount_amount_paise,
       discount_total_paise, total_paise, invoice_number, paid_at, meta_json, created_by,
       created_at, updated_at
     ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 0, 'percent', 0, 0, ?, ?, ?, ?, 'admin', ?, ?)`,
  );
  const insertLine = db.prepare(
    `INSERT INTO order_lines (
       id, order_id, menu_item_id, item_name, category_name, quantity, rate_paise,
       tax_rate_bps, line_total_paise, kot_printed_qty, sort_order, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPayment = db.prepare(
    `INSERT INTO payments (
       id, order_id, method, amount_paise, amount_paid_paise, change_paise, status, received_by, received_at
     ) VALUES (?, ?, ?, ?, ?, 0, 'completed', 'admin', ?)`,
  );

  function writeOrder({ id, orderType, tableId, status, sent, lines, at, invoiceNumber, method }) {
    const totals = billTotals(lines);
    const meta = { gstSnapshot: GST };
    insertOrder.run(
      id,
      orderType,
      tableId,
      status,
      sent ? "printed" : "pending",
      totals.subtotalPaise,
      totals.taxPaise,
      totals.totalPaise,
      invoiceNumber,
      status === "paid" ? at : null,
      JSON.stringify(meta),
      at,
      at,
    );
    lines.forEach((line, index) => {
      insertLine.run(
        `${id}:line:${index + 1}`,
        id,
        line.id,
        line.name,
        line.category,
        line.qty,
        line.pricePaise,
        GST_RATE_BPS,
        line.qty * line.pricePaise,
        sent ? line.qty : 0,
        index + 1,
        at,
        at,
      );
    });
    if (status === "paid" && method) {
      insertPayment.run(
        `${id}:pay`,
        id,
        method,
        totals.totalPaise,
        totals.totalPaise,
        at,
      );
    }
    return totals;
  }

  const openAt = now - 20 * 60 * 1000;
  const openTables = [
    { id: 2, name: "G2", sent: false, lines: [["shot:item:misal", 2], ["shot:item:chai", 2]] },
    { id: 3, name: "G3", sent: true, lines: [["shot:item:thali", 1], ["shot:item:naan", 2]] },
    { id: 5, name: "G5", sent: false, lines: [["shot:item:paneer", 1], ["shot:item:naan", 2], ["shot:item:rice", 1]] },
    { id: 6, name: "G6", sent: true, lines: [["shot:item:misal", 1], ["shot:item:jamun", 1]] },
    { id: 8, name: "G8", sent: false, lines: [["shot:item:vada", 3]] },
    { id: 9, name: "G9", sent: true, lines: [["shot:item:paneer", 1], ["shot:item:rice", 1]] },
    { id: 11, name: "G11", sent: false, lines: [["shot:item:thali", 2], ["shot:item:lime", 2]] },
    { id: 12, name: "G12", sent: true, lines: [["shot:item:naan", 4], ["shot:item:chai", 2]] },
    { id: 14, name: "F2", sent: false, lines: [["shot:item:misal", 1], ["shot:item:lime", 1]] },
    { id: 15, name: "F3", sent: true, lines: [["shot:item:thali", 2], ["shot:item:jamun", 2]] },
    { id: 17, name: "F5", sent: false, lines: [["shot:item:vada", 2], ["shot:item:chai", 2]] },
    { id: 18, name: "F6", sent: true, lines: [["shot:item:paneer", 1], ["shot:item:naan", 2]] },
    { id: 20, name: "F8", sent: false, lines: [["shot:item:rice", 1], ["shot:item:lime", 2]] },
  ];
  openTables.forEach((table, index) => {
    writeOrder({
      id: `shot:open:${table.name}`,
      orderType: "table",
      tableId: table.id,
      status: "open",
      sent: table.sent,
      at: openAt - index * 3 * 60 * 1000,
      lines: linesFrom(table.lines),
    });
  });

  const paidSpecs = [
    [["shot:item:thali", 2], ["shot:item:naan", 4], ["shot:item:lime", 2]],
    [["shot:item:paneer", 1], ["shot:item:rice", 1], ["shot:item:naan", 2]],
    [["shot:item:misal", 2], ["shot:item:chai", 2]],
    [["shot:item:vada", 4], ["shot:item:chai", 2]],
    [["shot:item:thali", 1], ["shot:item:lime", 1]],
    [["shot:item:paneer", 2], ["shot:item:naan", 4], ["shot:item:rice", 2]],
    [["shot:item:misal", 1], ["shot:item:jamun", 2]],
    [["shot:item:thali", 3], ["shot:item:lime", 3]],
    [["shot:item:vada", 2], ["shot:item:chai", 2], ["shot:item:jamun", 1]],
    [["shot:item:paneer", 1], ["shot:item:naan", 3]],
    [["shot:item:misal", 3], ["shot:item:lime", 2]],
    [["shot:item:thali", 1], ["shot:item:naan", 2], ["shot:item:chai", 2]],
    [["shot:item:rice", 2], ["shot:item:paneer", 1], ["shot:item:jamun", 2]],
  ];
  const featured = [["shot:item:thali", 2], ["shot:item:naan", 4], ["shot:item:lime", 2]];
  const methods = ["upi", "upi", "cash", "upi", "card", "upi", "cash", "upi", "card", "upi", "cash", "upi", "card"];
  const lastAt = Math.max(dayStart + 60 * 60 * 1000, now - 60 * 1000);
  const firstAt = Math.min(dayStart + 9 * 60 * 60 * 1000, lastAt - paidSpecs.length * 60 * 1000);
  const span = Math.max(1, lastAt - firstAt);

  paidSpecs.forEach((spec, index) => {
    const at = Math.round(firstAt + (span * index) / paidSpecs.length);
    const number = String(index + 1).padStart(6, "0");
    writeOrder({
      id: `shot:paid:${number}`,
      orderType: index % 3 === 0 ? "takeaway" : "table",
      tableId: null,
      status: "paid",
      sent: true,
      at,
      invoiceNumber: `INV-${fiscalYear}-${number}`,
      method: methods[index % methods.length],
      lines: linesFrom(spec),
    });
  });

  const featuredNumber = String(paidSpecs.length + 1).padStart(6, "0");
  const featuredInvoice = `INV-${fiscalYear}-${featuredNumber}`;
  const featuredTotals = writeOrder({
    id: `shot:paid:${featuredNumber}`,
    orderType: "table",
    tableId: null,
    status: "paid",
    sent: true,
    at: lastAt,
    invoiceNumber: featuredInvoice,
    method: "upi",
    lines: linesFrom(featured),
  });

  upsertSetting(
    db,
    "config:invoice",
    { prefix: "INV", fiscalYear, lastNumber: paidSpecs.length + 1 },
    now,
  );
  upsertSetting(
    db,
    "config:operations",
    {
      liveStartedAt: dayStart,
      liveStartedBy: "admin",
      liveStartOperationId: "screenshot-demo-live",
      backupId: "",
    },
    now,
  );

  return {
    featuredInvoice,
    featuredTotalPaise: featuredTotals.totalPaise,
    billCount: paidSpecs.length + 1,
    adminPassword: ADMIN_PASSWORD,
    captainPassword: CAPTAIN_PASSWORD,
  };
}

module.exports = { seed, GSTIN };
