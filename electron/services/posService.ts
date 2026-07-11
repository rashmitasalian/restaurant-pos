import "../env";
import fs from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
import type Database from "better-sqlite3";
import { backupDatabase, getDb, inTransaction, restoreDatabaseFromBackup } from "../db/sqlite";
import { destroySessionsForUser } from "./sessionManager";
import {
  createCredentialHash,
  generateRecoveryCode,
  normalizeRecoveryCode,
  verifyCredential,
} from "./credentials";
import type {
  AuditArchiveDto,
  AuditDto,
  ConfigDto,
  CustomerDto,
  FoodCostSummaryDto,
  GroceryItemDto,
  GroceryListDto,
  GroceryListLineDto,
  GroceryPurchaseLineDto,
  GroceryUnit,
  MenuItemDto,
  OrderDto,
  OrderLineDto,
  OrderStatus,
  PaidOrderQueryDto,
  PaymentDto,
  PrintJobDto,
  ProductSalesReportDto,
  Role,
  SalesSummaryDto,
  StaffDto,
  TableDto,
  UserDto,
} from "../../src/shared/pos";
import {
  STAFF_TEXT_LIMITS,
  isValidDateOnly,
  isValidIndianMobile,
  isValidPersonName,
  normalizeCategoryName,
  normalizePhone,
  normalizeSku,
  normalizeText,
  parseNonNegativeMoney,
  parsePositiveMoney,
} from "../../src/shared/validation";
import {
  DEFAULT_GST_CONFIG,
  calculateGstTotalsPaise,
  isValidGstin,
  normalizeGstConfig,
  type GstConfig,
} from "../../src/shared/gst";
import { RECOVERY_CODE_COUNT } from "../../src/shared/auth";

const TAX_RATE_BPS = 1800;
const MAX_ATTEMPTS = Number(process.env.VITE_AUTH_MAX_ATTEMPTS || 5);
const LOCKOUT_MS = Number(process.env.VITE_AUTH_LOCKOUT_MS || 30_000);
const INVOICE_CONFIG_KEY = "config:invoice";
const ORDER_SEQ_KEY = "config:order-seq";
const KOT_SEQ_KEY = "config:kot-seq";
const GROCERY_LIST_TOTAL_ITEM_NAME = "Buying List Total";
const GROCERY_LIST_TOTAL_CATEGORY = "List Total";
const GROCERY_UNITS = new Set<GroceryUnit>([
  "g",
  "kg",
  "ml",
  "L",
  "unit",
  "packet",
  "box",
  "dozen",
  "bunch",
]);

const loginAttempts: Record<string, { count: number; lockedUntil: number }> = {};
const recoveryAttempts: Record<string, { count: number; lockedUntil: number }> = {};

function now() {
  return Date.now();
}

function rupeesToPaise(value: number | null | undefined) {
  return Math.round((Number(value) || 0) * 100);
}

function assertUniqueActiveSku(database: Database.Database, sku: string, excludeId?: string) {
  if (!sku) {
    return;
  }
  const row = excludeId
    ? database
        .prepare(
          "SELECT id FROM menu_items WHERE sku IS NOT NULL AND lower(sku) = lower(?) AND id <> ? LIMIT 1",
        )
        .get(sku, excludeId)
    : database
        .prepare(
          "SELECT id FROM menu_items WHERE sku IS NOT NULL AND lower(sku) = lower(?) LIMIT 1",
        )
        .get(sku);
  if (row) {
    throw new Error("item-sku-duplicate");
  }
}

function assertUniqueActiveCustomerPhone(
  database: Database.Database,
  phone: string,
  excludeId?: string,
) {
  const row = excludeId
    ? database
        .prepare("SELECT id FROM customers WHERE active = 1 AND phone = ? AND id <> ? LIMIT 1")
        .get(phone, excludeId)
    : database
        .prepare("SELECT id FROM customers WHERE active = 1 AND phone = ? LIMIT 1")
        .get(phone);
  if (row) {
    throw new Error("customer-phone-duplicate");
  }
}

function resolveActiveCustomerId(database: Database.Database, customerId?: string | null) {
  const id = String(customerId || "").trim();
  if (!id) {
    return null;
  }
  const row = database
    .prepare("SELECT id FROM customers WHERE id = ? AND active = 1 LIMIT 1")
    .get(id);
  if (!row) {
    throw new Error("customer-not-found");
  }
  return id;
}

function assertUniqueActiveStaffPhone(
  database: Database.Database,
  phone: string,
  excludeId?: string,
) {
  const row = excludeId
    ? database
        .prepare("SELECT id FROM staff WHERE active = 1 AND phone = ? AND id <> ? LIMIT 1")
        .get(phone, excludeId)
    : database.prepare("SELECT id FROM staff WHERE active = 1 AND phone = ? LIMIT 1").get(phone);
  if (row) {
    throw new Error("staff-phone-duplicate");
  }
}

function paiseToRupees(value: number | null | undefined) {
  return Math.round(Number(value) || 0) / 100;
}

function normalizeGroceryUnit(value: unknown): GroceryUnit {
  const unit = String(value || "").trim();
  if (unit === "l") {
    return "L";
  }
  if (GROCERY_UNITS.has(unit as GroceryUnit)) {
    return unit as GroceryUnit;
  }
  throw new Error("grocery-unit-invalid");
}

function normalizeQuantity(value: unknown, errorCode = "grocery-quantity-invalid") {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(errorCode);
  }
  return Math.round(qty * 1000) / 1000;
}

function optionalGroceryText(value: unknown, limit: number, errorCode: string) {
  const text = normalizeText(value);
  if (text && text.length > limit) {
    throw new Error(errorCode);
  }
  return text || null;
}

function unitGroup(unit: GroceryUnit) {
  if (unit === "g" || unit === "kg") {
    return "weight";
  }
  if (unit === "ml" || unit === "L") {
    return "volume";
  }
  return unit;
}

function convertQuantityBetween(quantity: number, fromUnit: GroceryUnit, toUnit: GroceryUnit) {
  if (fromUnit === toUnit) {
    return quantity;
  }
  if (unitGroup(fromUnit) !== unitGroup(toUnit)) {
    return null;
  }
  if (fromUnit === "g" && toUnit === "kg") {
    return quantity / 1000;
  }
  if (fromUnit === "kg" && toUnit === "g") {
    return quantity * 1000;
  }
  if (fromUnit === "ml" && toUnit === "L") {
    return quantity / 1000;
  }
  if (fromUnit === "L" && toUnit === "ml") {
    return quantity * 1000;
  }
  return null;
}

function prepareGroceryItemInput(input: {
  name?: unknown;
  category?: unknown;
  defaultUnit?: unknown;
  defaultQuantity?: unknown;
  vendorHint?: unknown;
}) {
  const name = normalizeText(input.name);
  if (!name) {
    throw new Error("grocery-item-name-required");
  }
  if (name.length > 120) {
    throw new Error("grocery-item-name-too-long");
  }
  return {
    name,
    category: optionalGroceryText(input.category, 80, "grocery-category-too-long"),
    defaultUnit: normalizeGroceryUnit(input.defaultUnit || "kg"),
    defaultQuantity: normalizeQuantity(input.defaultQuantity ?? 1),
    vendorHint: optionalGroceryText(input.vendorHint, 120, "grocery-vendor-too-long"),
  };
}

function prepareGroceryListLineInput(
  input: Partial<GroceryListLineDto>,
  index = 0,
): GroceryListLineDto {
  const itemName = normalizeText(input.itemName);
  if (!itemName) {
    throw new Error("grocery-item-name-required");
  }
  return {
    id: input.id || `grocery-list-line:${randomUUID()}`,
    groceryItemId: input.groceryItemId || null,
    itemName,
    category: optionalGroceryText(input.category, 80, "grocery-category-too-long"),
    quantity: normalizeQuantity(input.quantity ?? 1),
    unit: normalizeGroceryUnit(input.unit || "unit"),
    vendorHint: optionalGroceryText(input.vendorHint, 120, "grocery-vendor-too-long"),
    sortOrder: Number.isFinite(Number(input.sortOrder))
      ? Math.trunc(Number(input.sortOrder))
      : index,
  };
}

function prepareGroceryPurchaseInput(
  input: Partial<GroceryPurchaseLineDto> & {
    unitPrice?: unknown;
    totalAmount?: unknown;
  },
) {
  const itemName = normalizeText(input.itemName);
  if (!itemName) {
    throw new Error("grocery-item-name-required");
  }
  const quantity = normalizeQuantity(input.quantity ?? 1);
  const unit = normalizeGroceryUnit(input.unit || "unit");
  const unitPrice =
    input.unitPrice === null ||
    input.unitPrice === undefined ||
    String(input.unitPrice).trim() === ""
      ? null
      : parseNonNegativeMoney(input.unitPrice);
  if (
    unitPrice === null &&
    input.unitPrice !== null &&
    input.unitPrice !== undefined &&
    String(input.unitPrice).trim() !== ""
  ) {
    throw new Error("grocery-unit-price-invalid");
  }
  const explicitTotal =
    input.totalAmount === null ||
    input.totalAmount === undefined ||
    String(input.totalAmount).trim() === ""
      ? null
      : parsePositiveMoney(input.totalAmount);
  if (
    explicitTotal === null &&
    input.totalAmount !== null &&
    input.totalAmount !== undefined &&
    String(input.totalAmount).trim() !== ""
  ) {
    throw new Error("grocery-total-invalid");
  }
  const totalAmount =
    explicitTotal !== null ? explicitTotal : unitPrice !== null ? unitPrice * quantity : null;
  if (totalAmount === null || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error("grocery-total-invalid");
  }
  const purchasedAt = Number(input.purchasedAt || now());
  if (!Number.isFinite(purchasedAt) || purchasedAt <= 0) {
    throw new Error("grocery-date-invalid");
  }
  return {
    listId: input.listId || null,
    groceryItemId: input.groceryItemId || null,
    itemName,
    category: optionalGroceryText(input.category, 80, "grocery-category-too-long"),
    quantity,
    unit,
    unitPrice,
    totalAmount,
    vendor: optionalGroceryText(input.vendor, 120, "grocery-vendor-too-long"),
    paymentMethod:
      optionalGroceryText(input.paymentMethod, 40, "grocery-payment-method-too-long") || "cash",
    notes: optionalGroceryText(input.notes, 500, "grocery-notes-too-long"),
    purchasedAt,
  };
}

function isWholeListGroceryPurchase(
  input: Pick<GroceryPurchaseLineDto, "groceryItemId" | "itemName" | "category">,
) {
  return (
    !input.groceryItemId &&
    normalizeText(input.itemName).toLowerCase() === GROCERY_LIST_TOTAL_ITEM_NAME.toLowerCase() &&
    normalizeText(input.category).toLowerCase() === GROCERY_LIST_TOTAL_CATEGORY.toLowerCase()
  );
}

function assertGroceryPurchaseModeAvailable(
  database: Database.Database,
  purchase: Pick<GroceryPurchaseLineDto, "listId" | "groceryItemId" | "itemName" | "category">,
  excludeId?: string,
) {
  if (!purchase.listId) {
    return;
  }
  const excludeSql = excludeId ? " AND id <> ?" : "";
  if (isWholeListGroceryPurchase(purchase)) {
    const params = excludeId ? [purchase.listId, excludeId] : [purchase.listId];
    const existing = database
      .prepare(
        `SELECT id FROM grocery_purchase_lines
         WHERE list_id = ?${excludeSql}
         LIMIT 1`,
      )
      .get(...params);
    if (existing) {
      throw new Error("grocery-list-purchase-mode-conflict");
    }
    return;
  }
  const params = excludeId
    ? [purchase.listId, GROCERY_LIST_TOTAL_ITEM_NAME, GROCERY_LIST_TOTAL_CATEGORY, excludeId]
    : [purchase.listId, GROCERY_LIST_TOTAL_ITEM_NAME, GROCERY_LIST_TOTAL_CATEGORY];
  const existingTotal = database
    .prepare(
      `SELECT id FROM grocery_purchase_lines
       WHERE list_id = ?
         AND grocery_item_id IS NULL
         AND lower(item_name) = lower(?)
         AND lower(COALESCE(category, '')) = lower(?)
         ${excludeSql}
       LIMIT 1`,
    )
    .get(...params);
  if (existingTotal) {
    throw new Error("grocery-list-purchase-mode-conflict");
  }
}

function parseJson<T>(value: string | null | undefined, defaultValue: T, label = "stored-json"): T {
  if (!value) {
    return defaultValue;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label}-invalid`);
  }
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {});
}

function slugId(prefix: string, value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}:${slug || randomUUID()}`;
}

function assertPassword(password: string) {
  if (!password) {
    throw new Error("Password is required");
  }
  if (password.length < 8) {
    throw new Error(`Password must be at least 8 characters`);
  }
  if (!/[A-Z]/.test(password)) {
    throw new Error("Password must contain at least 1 uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    throw new Error("Password must contain at least 1 lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    throw new Error("Password must contain at least 1 digit");
  }
}

function assertUsername(username: string) {
  if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
    throw new Error("invalid-username");
  }
}

function userFromRow(row: any, includeSensitive = false): UserDto {
  return {
    _id: `user:${row.username}`,
    type: "user",
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    passwordHash: includeSensitive ? row.password_hash : undefined,
    salt: includeSensitive ? row.salt : undefined,
    hashAlgo: includeSensitive ? row.hash_algo : undefined,
    active: Boolean(row.active),
    requirePasswordChange: Boolean(row.require_password_change),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function tableFromRow(row: any): TableDto {
  return {
    _id: `table:${row.id}`,
    type: "table",
    id: row.id,
    name: row.name || `Table ${row.id}`,
    seats: row.seats,
    order: row.sort_order,
    active: Boolean(row.active),
  };
}

function itemFromRow(row: any): MenuItemDto {
  return {
    _id: row.id,
    type: "item",
    sku: row.sku || undefined,
    name: row.name,
    category: row.category_name || undefined,
    price: paiseToRupees(row.price_paise),
    available: Boolean(row.available),
    favorite: Boolean(row.favorite),
    taxRateBps: row.tax_rate_bps,
  };
}

function lineFromRow(row: any): OrderLineDto {
  return {
    id: row.id,
    menuItemId: row.menu_item_id || null,
    categoryName: row.category_name || null,
    name: row.item_name,
    qty: Number(row.quantity),
    rate: paiseToRupees(row.rate_paise),
    taxRateBps: row.tax_rate_bps,
    kotPrintedQty: Number(row.kot_printed_qty || 0),
  };
}

function paymentFromRow(row: any): PaymentDto {
  return {
    id: row.id,
    method: row.method,
    amount: paiseToRupees(row.amount_paise),
    amountPaid:
      row.amount_paid_paise === null || row.amount_paid_paise === undefined
        ? undefined
        : paiseToRupees(row.amount_paid_paise),
    change:
      row.change_paise === null || row.change_paise === undefined
        ? undefined
        : paiseToRupees(row.change_paise),
    txnRef: row.txn_ref || undefined,
    splitBreakdown: parseJson(row.split_json, undefined),
    status: row.status,
    receivedAt: row.received_at,
    receivedBy: row.received_by || null,
  };
}

function getGstSettingFromDb(database: Database.Database = getDb()): GstConfig {
  const row = database
    .prepare("SELECT value_json FROM settings WHERE key = ?")
    .get("config:gst") as { value_json?: string } | undefined;
  return normalizeGstConfig(parseJson(row?.value_json, DEFAULT_GST_CONFIG));
}

function assertGstConfig(input: Partial<GstConfig>) {
  const cfg = normalizeGstConfig(input);
  if (cfg.enabled && !cfg.gstin) {
    throw new Error("gstin-required");
  }
  if (cfg.enabled && cfg.gstin && !isValidGstin(cfg.gstin)) {
    throw new Error("gstin-invalid");
  }
  if (cfg.enabled && cfg.gstRateBps <= 0) {
    throw new Error("gst-rate-invalid");
  }
  return cfg;
}

function buildGstSnapshot(config: GstConfig) {
  return normalizeGstConfig(config);
}

function getFiscalYearLabel(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth();
  const startYear = month >= 3 ? year : year - 1;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

function nextInvoiceSnapshot(database: Database.Database, issuedAt: number) {
  const row = database
    .prepare("SELECT value_json FROM settings WHERE key = ?")
    .get(INVOICE_CONFIG_KEY) as { value_json?: string } | undefined;
  const current = parseJson(row?.value_json, {
    prefix: "INV",
    fiscalYear: "",
    lastNumber: 0,
  }) as { prefix?: string; fiscalYear?: string; lastNumber?: number };
  const fiscalYear = getFiscalYearLabel(issuedAt);
  const prefix =
    String(current.prefix || "INV")
      .trim()
      .replace(/[^A-Za-z0-9/-]/g, "") || "INV";
  const lastNumber = current.fiscalYear === fiscalYear ? Number(current.lastNumber || 0) : 0;
  const nextNumber = lastNumber + 1;
  const invoiceNumber = `${prefix}-${fiscalYear}-${String(nextNumber).padStart(6, "0")}`;

  database
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(
      INVOICE_CONFIG_KEY,
      stringifyJson({ ...current, prefix, fiscalYear, lastNumber: nextNumber }),
      issuedAt,
    );

  return {
    number: invoiceNumber,
    fiscalYear,
    sequence: nextNumber,
    issuedAt,
  };
}

function nextOrderSeq(database: Database.Database): number {
  const row = database
    .prepare("SELECT value_json FROM settings WHERE key = ?")
    .get(ORDER_SEQ_KEY) as { value_json?: string } | undefined;
  const lastNumber = Number(parseJson(row?.value_json, { lastNumber: 0 })?.lastNumber || 0);
  const nextNumber = lastNumber + 1;
  database
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(ORDER_SEQ_KEY, stringifyJson({ lastNumber: nextNumber }), now());
  return nextNumber;
}

function nextKotSeq(database: Database.Database): number {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const row = database.prepare("SELECT value_json FROM settings WHERE key = ?").get(KOT_SEQ_KEY) as
    | { value_json?: string }
    | undefined;
  const current = parseJson(row?.value_json, { day: "", lastNumber: 0 }) as {
    day?: string;
    lastNumber?: number;
  };
  const lastNumber = current.day === today ? Number(current.lastNumber || 0) : 0;
  const nextNumber = lastNumber + 1;
  database
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(KOT_SEQ_KEY, stringifyJson({ day: today, lastNumber: nextNumber }), now());
  return nextNumber;
}

function computeOrderTotals(
  lines: OrderLineDto[],
  discountPercent = 0,
  gstConfig?: Partial<GstConfig> | null,
) {
  const totals = calculateGstTotalsPaise(
    lines,
    discountPercent,
    gstConfig || getGstSettingFromDb(),
  );
  return {
    subtotalPaise: totals.taxableSubtotalPaise,
    taxTotalPaise: totals.taxTotalPaise,
    discountTotalPaise: totals.discountTotalPaise,
    totalPaise: totals.totalPaise,
  };
}

function orderFromRow(database: Database.Database, row: any): OrderDto {
  const lines = database
    .prepare("SELECT * FROM order_lines WHERE order_id = ? ORDER BY sort_order ASC, created_at ASC")
    .all(row.id)
    .map(lineFromRow);
  const payments = database
    .prepare("SELECT * FROM payments WHERE order_id = ? ORDER BY received_at ASC")
    .all(row.id)
    .map(paymentFromRow);
  return {
    _id: row.id,
    type: "order",
    orderType: row.order_type,
    tableId: row.table_id === null || row.table_id === undefined ? null : Number(row.table_id),
    customerId: row.customer_id || null,
    status: row.status,
    kotStatus: row.kot_status,
    kotSent: row.kot_status === "sent" || row.kot_status === "printed",
    kotPrinted: row.kot_status === "printed",
    items: lines,
    payments,
    discountPercent: Number(row.discount_percent || 0),
    subtotal: paiseToRupees(row.subtotal_paise),
    taxTotal: paiseToRupees(row.tax_total_paise),
    discountTotal: paiseToRupees(row.discount_total_paise),
    total: paiseToRupees(row.total_paise),
    invoiceNumber: row.invoice_number || null,
    paidAt: row.paid_at || null,
    meta: parseJson(row.meta_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || null,
  };
}

function paidOrderTimeExpression() {
  return "COALESCE(o.paid_at, o.updated_at, o.created_at)";
}

function normalizePaidOrderQuery(opts: PaidOrderQueryDto = {}) {
  const from = Number(opts.from);
  const to = Number(opts.to);
  const limit = Number(opts.limit);
  const offset = Number(opts.offset);
  return {
    from: Number.isFinite(from) ? from : undefined,
    to: Number.isFinite(to) ? to : undefined,
    search: String(opts.search || "")
      .trim()
      .toLowerCase(),
    limit: Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined,
    offset: Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0,
  };
}

function buildPaidOrderWhere(opts: PaidOrderQueryDto = {}) {
  const query = normalizePaidOrderQuery(opts);
  const clauses = ["o.status = 'paid'"];
  const params: unknown[] = [];
  const paidAt = paidOrderTimeExpression();

  if (query.from !== undefined) {
    clauses.push(`${paidAt} >= ?`);
    params.push(query.from);
  }
  if (query.to !== undefined) {
    clauses.push(`${paidAt} <= ?`);
    params.push(query.to);
  }
  if (query.search) {
    const like = `%${query.search}%`;
    clauses.push(`(
      lower(o.id) LIKE ?
      OR lower(COALESCE(o.invoice_number, '')) LIKE ?
      OR lower(o.order_type) LIKE ?
      OR CAST(o.table_id AS TEXT) LIKE ?
      OR lower(COALESCE(o.meta_json, '')) LIKE ?
      OR EXISTS (
        SELECT 1 FROM payments p
        WHERE p.order_id = o.id
          AND (lower(p.method) LIKE ? OR lower(COALESCE(p.txn_ref, '')) LIKE ?)
      )
      OR EXISTS (
        SELECT 1 FROM order_lines l
        WHERE l.order_id = o.id AND lower(l.item_name) LIKE ?
      )
    )`);
    params.push(like, like, like, like, like, like, like, like);
  }

  return {
    whereSql: clauses.join(" AND "),
    params,
    limit: query.limit,
    offset: query.offset,
  };
}

function normalizeAuditQuery(
  opts: { from?: number; to?: number; search?: string; limit?: number; offset?: number } = {},
) {
  const from = Number(opts.from);
  const to = Number(opts.to);
  const limit = Number(opts.limit);
  const offset = Number(opts.offset);
  return {
    from: Number.isFinite(from) ? from : undefined,
    to: Number.isFinite(to) ? to : undefined,
    search: String(opts.search || "")
      .trim()
      .toLowerCase(),
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(100, Math.trunc(limit)) : 25,
    offset: Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0,
  };
}

function buildAuditWhere(
  opts: { from?: number; to?: number; search?: string; limit?: number; offset?: number } = {},
) {
  const query = normalizeAuditQuery(opts);
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.from !== undefined) {
    clauses.push("timestamp >= ?");
    params.push(query.from);
  }
  if (query.to !== undefined) {
    clauses.push("timestamp <= ?");
    params.push(query.to);
  }
  if (query.search) {
    const like = `%${query.search}%`;
    clauses.push(`(
      lower(action) LIKE ?
      OR lower(COALESCE(entity_type, '')) LIKE ?
      OR lower(COALESCE(entity_id, '')) LIKE ?
      OR lower(COALESCE(user, '')) LIKE ?
      OR lower(COALESCE(detail_json, '')) LIKE ?
    )`);
    params.push(like, like, like, like, like);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
    limit: query.limit,
    offset: query.offset,
  };
}

function appendPaidOrderLimit(sql: string, params: unknown[], limit?: number, offset = 0) {
  if (limit !== undefined) {
    params.push(limit, offset);
    return `${sql} LIMIT ? OFFSET ?`;
  }
  if (offset > 0) {
    params.push(offset);
    return `${sql} LIMIT -1 OFFSET ?`;
  }
  return sql;
}

function createAuditRow(
  database: Database.Database,
  action: string,
  entityType?: string | null,
  entityId?: string | null,
  user?: string | null,
  detail?: unknown,
) {
  const id = `audit:${randomUUID()}`;
  database
    .prepare(
      `INSERT INTO audit_logs (id, action, entity_type, entity_id, user, detail_json, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      action,
      entityType || null,
      entityId || null,
      user || null,
      stringifyJson(detail),
      now(),
    );
  return id;
}

function upsertOrderLines(database: Database.Database, orderId: string, lines: OrderLineDto[]) {
  database.prepare("DELETE FROM order_lines WHERE order_id = ?").run(orderId);
  const insert = database.prepare(`
    INSERT INTO order_lines (
      id, order_id, menu_item_id, item_name, category_name, quantity, rate_paise, tax_rate_bps,
      line_total_paise, kot_printed_qty, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const at = now();
  lines.forEach((line, index) => {
    const ratePaise = rupeesToPaise(line.rate);
    const qty = Number(line.qty) || 1;
    insert.run(
      line.id || `line:${randomUUID()}`,
      orderId,
      line.menuItemId || null,
      line.name,
      normalizeCategoryName(line.categoryName) || null,
      qty,
      ratePaise,
      line.taxRateBps ?? TAX_RATE_BPS,
      Math.round(qty * ratePaise),
      Number(line.kotPrintedQty || 0),
      index,
      at,
      at,
    );
  });
}

function updateOrderTotals(
  database: Database.Database,
  orderId: string,
  lines: OrderLineDto[],
  discountPercent = 0,
  gstConfig?: Partial<GstConfig> | null,
) {
  const totals = computeOrderTotals(lines, discountPercent, gstConfig);
  database
    .prepare(
      `UPDATE orders
       SET subtotal_paise = ?, tax_total_paise = ?, discount_percent = ?,
           discount_total_paise = ?, total_paise = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      totals.subtotalPaise,
      totals.taxTotalPaise,
      discountPercent,
      totals.discountTotalPaise,
      totals.totalPaise,
      now(),
      orderId,
    );
  return totals;
}

function recalculateOpenOrderTotals(database: Database.Database, gstConfig: GstConfig) {
  const rows = database
    .prepare("SELECT * FROM orders WHERE status NOT IN ('paid', 'cancelled')")
    .all() as any[];
  rows.forEach((row) => {
    const lines = database
      .prepare(
        "SELECT * FROM order_lines WHERE order_id = ? ORDER BY sort_order ASC, created_at ASC",
      )
      .all(row.id)
      .map(lineFromRow);
    updateOrderTotals(database, row.id, lines, Number(row.discount_percent || 0), gstConfig);
  });
}

function insertUserRow(
  database: Database.Database,
  input: {
    username: string;
    password: string;
    role: Role;
    displayName?: string;
    requirePasswordChange?: boolean;
  },
) {
  const at = now();
  const credential = createCredentialHash(input.password);
  const displayName = normalizeDisplayName(input.displayName, input.username);
  database
    .prepare(
      `INSERT INTO users (
        username, display_name, role, password_hash, salt, hash_algo, active,
        require_password_change, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      input.username,
      displayName,
      input.role,
      credential.hash,
      credential.salt,
      credential.hashAlgo,
      input.requirePasswordChange ? 1 : 0,
      at,
      at,
    );
}

function updateUserPasswordRow(
  database: Database.Database,
  username: string,
  password: string,
  requirePasswordChange = false,
) {
  const credential = createCredentialHash(password);
  database
    .prepare(
      `UPDATE users
       SET password_hash = ?, salt = ?, hash_algo = ?, require_password_change = ?, updated_at = ?
       WHERE username = ?`,
    )
    .run(
      credential.hash,
      credential.salt,
      credential.hashAlgo,
      requirePasswordChange ? 1 : 0,
      now(),
      username,
    );
}

function assertActiveAdminPassword(
  database: Database.Database,
  username?: string | null,
  password?: string | null,
) {
  const key = username?.trim().toLowerCase() || "";
  if (!key || !password) {
    throw new Error("admin-verification-required");
  }
  const attempt = loginAttempts[key];
  if (attempt && Date.now() < attempt.lockedUntil) {
    createAuditRow(database, "admin.verify.failed", "user", key, null, { reason: "locked" });
    throw new Error("admin-verification-failed");
  }
  if (attempt && Date.now() >= attempt.lockedUntil) {
    delete loginAttempts[key];
  }
  const row = database.prepare("SELECT * FROM users WHERE username = ?").get(key) as any;
  if (!row || row.role !== "admin" || !row.active) {
    createAuditRow(database, "admin.verify.failed", "user", key, null, {
      reason: "not-active-admin",
    });
    throw new Error("admin-verification-failed");
  }
  const verified = verifyCredential(password, row);
  if (!verified.ok) {
    recordFailedLogin(key);
    createAuditRow(database, "admin.verify.failed", "user", key, null, {});
    throw new Error("admin-verification-failed");
  }
  delete loginAttempts[key];
  return key;
}

function normalizeDisplayName(value: unknown, fallback: string) {
  const displayName = normalizeText(value);
  if (!displayName) {
    return fallback;
  }
  if (!isValidPersonName(displayName)) {
    throw new Error("display-name-invalid");
  }
  return displayName;
}

function insertRecoveryCodes(
  database: Database.Database,
  username: string,
  createdBy: string | null,
) {
  const insert = database.prepare(`
    INSERT INTO admin_recovery_codes (
      id, username, hash_algo, salt, code_hash, used_at, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  const at = now();
  recoveryCodes.forEach((code) => {
    const credential = createCredentialHash(normalizeRecoveryCode(code));
    insert.run(
      `recovery:${randomUUID()}`,
      username,
      credential.hashAlgo,
      credential.salt,
      credential.hash,
      at,
      createdBy,
    );
  });
  return recoveryCodes;
}

function assertOrderCanBeEdited(order: OrderDto | null): asserts order is OrderDto {
  if (!order) {
    throw new Error("order-not-found");
  }
  if (order.status === "paid" || order.status === "cancelled") {
    throw new Error("order-closed");
  }
}

function sanitizeOrderLines(lines: OrderLineDto[]) {
  return (lines || [])
    .map((line) => {
      const qty = Math.max(1, Number(line.qty) || 1);
      const printedQty = Math.min(qty, Math.max(0, Number(line.kotPrintedQty || 0)));
      return {
        id: line.id || `line:${randomUUID()}`,
        menuItemId: line.menuItemId || null,
        categoryName: normalizeCategoryName(line.categoryName) || null,
        name: String(line.name || "").trim(),
        qty,
        rate: Math.max(0, Number(line.rate) || 0),
        taxRateBps: line.taxRateBps ?? TAX_RATE_BPS,
        kotPrintedQty: printedQty,
      };
    })
    .filter((line) => line.name.length > 0);
}

function getUnsentKotLines(lines: OrderLineDto[]) {
  return (lines || []).filter((line) => Number(line.qty || 0) > Number(line.kotPrintedQty || 0));
}

function assertNoSentKotReduction(order: OrderDto, nextLines: OrderLineDto[]) {
  const nextById = new Map(nextLines.map((line) => [line.id, line]));
  for (const current of order.items || []) {
    const sentQty = Math.max(0, Number(current.kotPrintedQty || 0));
    if (sentQty <= 0) {
      continue;
    }
    const next = nextById.get(current.id);
    if (!next || Number(next.qty || 0) < sentQty) {
      throw new Error("kot-sent-item-requires-void");
    }
  }
}

function kotStatusAfterLineChange(order: OrderDto, nextLines: OrderLineDto[]) {
  if (!nextLines.length) {
    return "pending";
  }
  const hasSentQty = nextLines.some((line) => Number(line.kotPrintedQty || 0) > 0);
  const hasUnsentQty = getUnsentKotLines(nextLines).length > 0;
  if (order.kotStatus === "failed") {
    if (hasUnsentQty) {
      return "failed";
    }
    return hasSentQty ? "sent" : "pending";
  }
  if (order.kotStatus === "printed" && hasUnsentQty) {
    return "pending";
  }
  if (hasSentQty && order.kotStatus === "pending") {
    return "sent";
  }
  return order.kotStatus || "pending";
}

function assertOperationalStatus(status: OrderStatus) {
  const allowed: OrderStatus[] = ["open", "held", "ready", "assigned"];
  if (!allowed.includes(status)) {
    throw new Error("invalid-order-status");
  }
}

function normalizePaymentMethod(method: unknown): PaymentDto["method"] {
  const value = String(method || "cash")
    .trim()
    .toLowerCase();
  const allowed = new Set(["cash", "upi", "card", "voucher", "online", "split", "other"]);
  return allowed.has(value) ? value : "other";
}

function normalizeSplitBreakdown(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((entry) => ({
      method: normalizePaymentMethod((entry as any)?.method),
      amountPaise: rupeesToPaise((entry as any)?.amount),
    }))
    .filter((entry) => entry.amountPaise > 0);
}

function preparePaymentForTotal(payment: PaymentDto, expectedAmountPaise: number) {
  const method = normalizePaymentMethod(payment.method);
  const amountPaidPaise =
    payment.amountPaid === null || payment.amountPaid === undefined
      ? expectedAmountPaise
      : rupeesToPaise(payment.amountPaid);
  const splitBreakdown =
    method === "split" ? normalizeSplitBreakdown(payment.splitBreakdown) : undefined;

  if (method === "split") {
    const splitTotalPaise = (splitBreakdown || []).reduce(
      (sum, entry) => sum + entry.amountPaise,
      0,
    );
    if (!splitBreakdown?.length || splitTotalPaise !== expectedAmountPaise) {
      throw new Error("payment-split-total-mismatch");
    }
  } else if (amountPaidPaise < expectedAmountPaise) {
    throw new Error("payment-amount-too-low");
  }

  const changePaise =
    method === "cash"
      ? Math.max(0, amountPaidPaise - expectedAmountPaise)
      : payment.change === null || payment.change === undefined
        ? 0
        : Math.max(0, rupeesToPaise(payment.change));

  return {
    method,
    amountPaise: expectedAmountPaise,
    amountPaidPaise,
    changePaise,
    splitJson: splitBreakdown
      ? stringifyJson(
          splitBreakdown.map((entry) => ({
            method: entry.method,
            amount: paiseToRupees(entry.amountPaise),
          })),
        )
      : null,
  };
}

function getOrderInvoiceNumber(order: Partial<OrderDto> | any) {
  return String(order?.invoiceNumber || order?.meta?.invoice?.number || "").trim() || null;
}

function getOrderPaidAt(order: Partial<OrderDto> | any) {
  const paidAt = Number(order?.paidAt || order?.meta?.invoice?.issuedAt || 0);
  if (Number.isFinite(paidAt) && paidAt > 0) {
    return paidAt;
  }
  const paymentAt = (order?.payments || [])
    .map((payment: PaymentDto) => Number(payment.receivedAt || 0))
    .filter((value: number) => Number.isFinite(value) && value > 0)
    .sort((a: number, b: number) => a - b)[0];
  if (paymentAt) {
    return paymentAt;
  }
  return order?.status === "paid" ? Number(order?.updatedAt || now()) : null;
}

export const posService = {
  ensureReady() {
    getDb();
    return { ok: true };
  },

  hasUsers() {
    const row = getDb().prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    return row.count > 0;
  },

  createFirstAdmin(input: { username: string; password: string; displayName?: string }) {
    const username = input.username.trim().toLowerCase();
    assertUsername(username);
    assertPassword(input.password);
    return inTransaction((database) => {
      const existing = database.prepare("SELECT COUNT(*) AS count FROM users").get() as {
        count: number;
      };
      if (existing.count > 0) {
        throw new Error("setup-already-complete");
      }
      insertUserRow(database, {
        username,
        password: input.password,
        role: "admin",
        displayName: input.displayName,
        requirePasswordChange: false,
      });
      const recoveryCodes = insertRecoveryCodes(database, username, username);
      createAuditRow(database, "setup.first_admin.created", "user", username, username, {});
      return {
        user: userFromRow(database.prepare("SELECT * FROM users WHERE username = ?").get(username)),
        recoveryCodes,
      };
    });
  },

  createUser(input: {
    username: string;
    password: string;
    role?: Role;
    displayName?: string;
    requirePasswordChange?: boolean;
    actorUsername?: string | null;
    actorPassword?: string | null;
  }) {
    const username = input.username.trim().toLowerCase();
    assertUsername(username);
    assertPassword(input.password);
    const role = input.role || "cashier";
    return inTransaction((database) => {
      const actor = assertActiveAdminPassword(database, input.actorUsername, input.actorPassword);
      const existing = database
        .prepare("SELECT username FROM users WHERE username = ?")
        .get(username);
      if (existing) {
        throw new Error("username-taken");
      }
      insertUserRow(database, {
        username,
        password: input.password,
        role,
        displayName: input.displayName,
        requirePasswordChange: input.requirePasswordChange,
      });
      createAuditRow(database, "user.created", "user", username, actor, { role });
      return userFromRow(database.prepare("SELECT * FROM users WHERE username = ?").get(username));
    });
  },

  getUserByUsername(username: string): UserDto | null {
    const row = getDb()
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username.trim().toLowerCase());
    return row ? userFromRow(row) : null;
  },

  listUsers(): UserDto[] {
    return getDb()
      .prepare("SELECT * FROM users ORDER BY created_at ASC")
      .all()
      .map((row: any) => userFromRow(row));
  },

  verifyUser(username: string, password: string) {
    const key = username.trim().toLowerCase();
    const attempt = loginAttempts[key];
    if (attempt && Date.now() < attempt.lockedUntil) {
      return {
        ok: false,
        reason: "locked",
        lockedSeconds: Math.ceil((attempt.lockedUntil - Date.now()) / 1000),
      };
    }
    if (attempt && Date.now() >= attempt.lockedUntil) {
      delete loginAttempts[key];
    }

    const row = getDb().prepare("SELECT * FROM users WHERE username = ?").get(key) as any;
    if (!row) {
      recordFailedLogin(key);
      return { ok: false, reason: "not-found" };
    }
    if (!row.active) {
      createAuditRow(getDb(), "auth.login.blocked", "user", key, null, { reason: "inactive" });
      return { ok: false, reason: "inactive" };
    }
    const verified = verifyCredential(password, row);
    if (!verified.ok) {
      recordFailedLogin(key);
      createAuditRow(getDb(), "auth.login.failed", "user", key, null, {
        attempt: loginAttempts[key]?.count ?? 1,
      });
      return { ok: false, reason: "wrong-password" };
    }
    delete loginAttempts[key];
    const user = userFromRow(row);
    createAuditRow(getDb(), "auth.login.success", "user", key, key, { role: user.role });
    return { ok: true, user };
  },

  login(username: string, password: string) {
    const res = this.verifyUser(username, password) as any;
    if (!res.ok || !res.user) {
      const reason =
        res.reason === "inactive"
          ? "inactive"
          : res.reason === "locked"
            ? "locked"
            : "invalid-credentials";
      return { ok: false, reason, lockedSeconds: res.lockedSeconds };
    }
    return {
      ok: true,
      user: {
        username: res.user.username,
        role: res.user.role,
        displayName: res.user.displayName,
        requirePasswordChange: res.user.requirePasswordChange,
      },
    };
  },

  updateUser(
    username: string,
    updates: Partial<Pick<UserDto, "displayName" | "role" | "active">>,
    actorUsername?: string | null,
    actorPassword?: string | null,
  ) {
    const key = username.trim().toLowerCase();
    return inTransaction((database) => {
      const actor = assertActiveAdminPassword(database, actorUsername, actorPassword);
      const current = database.prepare("SELECT * FROM users WHERE username = ?").get(key) as any;
      if (!current) {
        throw new Error("user-not-found");
      }
      if ((updates.role && updates.role !== "admin") || updates.active === false) {
        ensureNotLastActiveAdmin(database, key);
      }
      database
        .prepare(
          `UPDATE users
           SET display_name = ?, role = ?, active = ?, updated_at = ?
           WHERE username = ?`,
        )
        .run(
          updates.displayName === undefined
            ? current.display_name
            : normalizeDisplayName(updates.displayName, current.username),
          updates.role ?? current.role,
          updates.active === undefined ? current.active : updates.active ? 1 : 0,
          now(),
          key,
        );
      createAuditRow(database, "user.updated", "user", key, actor, updates);
      if (updates.active === false || (updates.role && updates.role !== current.role)) {
        destroySessionsForUser(key);
      }
      return userFromRow(database.prepare("SELECT * FROM users WHERE username = ?").get(key));
    });
  },

  changeOwnPassword(username: string, currentPassword: string, newPassword: string) {
    const key = username.trim().toLowerCase();
    assertPassword(newPassword);
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM users WHERE username = ?").get(key) as any;
      if (!current || !current.active) {
        throw new Error("user-not-found");
      }
      const verified = verifyCredential(currentPassword, current);
      if (!verified.ok) {
        recordFailedLogin(key);
        createAuditRow(database, "user.password.change.failed", "user", key, key, {});
        throw new Error("invalid-current-password");
      }
      updateUserPasswordRow(database, key, newPassword, false);
      delete loginAttempts[key];
      createAuditRow(database, "user.password.changed", "user", key, key, {});
      return { ok: true };
    });
  },

  resetUserPassword(
    username: string,
    newPassword: string,
    actorUsername?: string | null,
    actorPassword?: string | null,
  ) {
    const key = username.trim().toLowerCase();
    assertPassword(newPassword);
    return inTransaction((database) => {
      const actor = assertActiveAdminPassword(database, actorUsername, actorPassword);
      const current = database.prepare("SELECT * FROM users WHERE username = ?").get(key);
      if (!current) {
        throw new Error("user-not-found");
      }
      updateUserPasswordRow(database, key, newPassword, actor !== key);
      delete loginAttempts[key];
      destroySessionsForUser(key);
      createAuditRow(database, "user.password.reset", "user", key, actor, {
        requirePasswordChange: actor !== key,
      });
      return { ok: true };
    });
  },

  logout(username: string) {
    createAuditRow(getDb(), "auth.logout", "user", username, username, {});
    return { ok: true };
  },

  recoveryStatus() {
    const database = getDb();
    const row = database
      .prepare(
        "SELECT username FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at ASC",
      )
      .all() as any[];
    const username = row.length === 1 ? row[0].username : null;
    const codeCount =
      username === null
        ? 0
        : (
            database
              .prepare(
                "SELECT COUNT(*) AS count FROM admin_recovery_codes WHERE username = ? AND used_at IS NULL",
              )
              .get(username) as { count: number }
          ).count;
    return {
      available: row.length === 1 && codeCount > 0,
      activeAdminCount: row.length,
      unusedCodeCount: codeCount,
    };
  },

  recoverLastAdmin(input: { username: string; recoveryCode: string; newPassword: string }) {
    const username = input.username.trim().toLowerCase();
    assertUsername(username);
    assertPassword(input.newPassword);
    const attemptKey = `recovery:${username}`;
    const attempt = recoveryAttempts[attemptKey];
    if (attempt && Date.now() < attempt.lockedUntil) {
      return {
        ok: false,
        reason: "locked",
        lockedSeconds: Math.ceil((attempt.lockedUntil - Date.now()) / 1000),
      };
    }
    if (attempt && Date.now() >= attempt.lockedUntil) {
      delete recoveryAttempts[attemptKey];
    }

    return inTransaction((database) => {
      const admins = database
        .prepare("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at ASC")
        .all() as any[];
      if (admins.length !== 1 || admins[0].username !== username) {
        recordFailedRecovery(attemptKey);
        createAuditRow(database, "auth.recovery.failed", "user", username, null, {
          reason: "not-last-admin",
        });
        return { ok: false, reason: "recovery-failed" };
      }

      const normalizedCode = normalizeRecoveryCode(input.recoveryCode);
      const codes = database
        .prepare("SELECT * FROM admin_recovery_codes WHERE username = ? AND used_at IS NULL")
        .all(username) as any[];
      const matched = codes.find(
        (code) =>
          verifyCredential(normalizedCode, {
            hash_algo: code.hash_algo,
            salt: code.salt,
            code_hash: code.code_hash,
          }).ok,
      );

      if (!matched) {
        recordFailedRecovery(attemptKey);
        createAuditRow(database, "auth.recovery.failed", "user", username, null, {
          reason: "invalid-code",
        });
        return { ok: false, reason: "recovery-failed" };
      }

      database
        .prepare(
          "UPDATE admin_recovery_codes SET used_at = ? WHERE username = ? AND used_at IS NULL",
        )
        .run(now(), username);
      updateUserPasswordRow(database, username, input.newPassword, false);
      delete loginAttempts[username];
      delete recoveryAttempts[attemptKey];
      destroySessionsForUser(username);
      createAuditRow(database, "auth.recovery.success", "user", username, username, {});
      return { ok: true };
    });
  },

  regenerateRecoveryCodes(input: { actorUsername: string; actorPassword: string }) {
    const actorUsername = input.actorUsername.trim().toLowerCase();
    return inTransaction((database) => {
      const actor = assertActiveAdminPassword(database, actorUsername, input.actorPassword);
      database
        .prepare(
          "UPDATE admin_recovery_codes SET used_at = ? WHERE username = ? AND used_at IS NULL",
        )
        .run(now(), actor);
      const recoveryCodes = insertRecoveryCodes(database, actor, actor);
      createAuditRow(database, "auth.recovery_codes.regenerated", "user", actor, actor, {
        count: recoveryCodes.length,
      });
      return { recoveryCodes };
    });
  },

  seedTables(count = 12, actor?: string | null) {
    const at = now();
    return inTransaction((database) => {
      const insert = database.prepare(`
        INSERT INTO tables (id, name, seats, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET active = 1, updated_at = excluded.updated_at
      `);
      for (let i = 1; i <= count; i++) {
        insert.run(i, `Table ${i}`, i % 4 === 0 ? 6 : 4, i, at, at);
      }
      database.prepare("UPDATE tables SET active = 0, updated_at = ? WHERE id > ?").run(at, count);
      const tableConfig = this.getSetting("config:tables") as any;
      if (Number(tableConfig?.tableCount || 0) !== count) {
        this.setSetting("config:tables", { tableCount: count }, actor);
      }
      return this.getTables();
    });
  },

  ensureConfiguredTables() {
    return this.seedTables(this.getConfiguredTableCount());
  },

  getTables(): TableDto[] {
    return getDb()
      .prepare("SELECT * FROM tables WHERE active = 1 ORDER BY sort_order ASC, id ASC")
      .all()
      .map(tableFromRow);
  },

  getConfiguredTableCount() {
    const cfg = this.getSetting("config:tables") as any;
    const tableCount = Number(cfg?.tableCount);
    if (!Number.isInteger(tableCount) || tableCount < 1) {
      throw new Error("table-count-not-configured");
    }
    return tableCount;
  },

  seedItems() {
    return this.getItems();
  },

  getItems(): MenuItemDto[] {
    return getDb()
      .prepare(
        `SELECT mi.*, mc.name AS category_name
         FROM menu_items mi
         LEFT JOIN menu_categories mc ON mc.id = mi.category_id
         ORDER BY mi.name COLLATE NOCASE ASC`,
      )
      .all()
      .map(itemFromRow);
  },

  getItemById(id: string): MenuItemDto | null {
    const row = getDb()
      .prepare(
        `SELECT mi.*, mc.name AS category_name
         FROM menu_items mi
         LEFT JOIN menu_categories mc ON mc.id = mi.category_id
         WHERE mi.id = ?`,
      )
      .get(id);
    return row ? itemFromRow(row) : null;
  },

  createItem(
    input: {
      sku?: string;
      name: string;
      price: number;
      category?: string;
      available?: boolean;
      favorite?: boolean;
      taxRateBps?: number;
    },
    actor?: string | null,
  ) {
    const name = normalizeText(input.name);
    const sku = normalizeSku(input.sku);
    const price = parsePositiveMoney(input.price);
    const category = normalizeCategoryName(input.category);
    if (!name) {
      throw new Error("item-name-required");
    }
    if (price === null) {
      throw new Error("item-price-invalid");
    }
    const at = now();
    const id = slugId("item", sku || name);
    return inTransaction((database) => {
      assertUniqueActiveSku(database, sku);
      const categoryId = ensureCategory(database, category);
      database
        .prepare(
          `INSERT INTO menu_items (
            id, sku, name, category_id, price_paise, available, favorite, tax_rate_bps, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          sku || null,
          name,
          categoryId,
          rupeesToPaise(price),
          input.available === false ? 0 : 1,
          input.available === false ? 0 : input.favorite ? 1 : 0,
          input.taxRateBps ?? TAX_RATE_BPS,
          at,
          at,
        );
      createAuditRow(database, "menu.item.created", "item", id, actor || null, { name });
      return this.getItemById(id)!;
    });
  },

  updateItem(item: MenuItemDto, actor?: string | null) {
    const name = normalizeText(item.name);
    const sku = normalizeSku(item.sku);
    const price = parsePositiveMoney(item.price);
    const category = normalizeCategoryName(item.category);
    if (!name) {
      throw new Error("item-name-required");
    }
    if (price === null) {
      throw new Error("item-price-invalid");
    }
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM menu_items WHERE id = ?").get(item._id);
      if (!current) {
        throw new Error("item-not-found");
      }
      assertUniqueActiveSku(database, sku, item._id);
      const categoryId = ensureCategory(database, category);
      database
        .prepare(
          `UPDATE menu_items
           SET sku = ?, name = ?, category_id = ?, price_paise = ?, available = ?,
               favorite = ?, tax_rate_bps = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          sku || null,
          name,
          categoryId,
          rupeesToPaise(price),
          item.available === false ? 0 : 1,
          item.available === false ? 0 : item.favorite ? 1 : 0,
          item.taxRateBps ?? TAX_RATE_BPS,
          now(),
          item._id,
        );
      createAuditRow(database, "menu.item.updated", "item", item._id, actor || null, {});
      return this.getItemById(item._id)!;
    });
  },

  deleteItem(id: string, actor?: string | null) {
    getDb().prepare("DELETE FROM menu_items WHERE id = ?").run(id);
    createAuditRow(getDb(), "menu.item.deleted", "item", id, actor || null, {});
    return { ok: true };
  },

  getCategories(): string[] {
    return getDb()
      .prepare(
        "SELECT name FROM menu_categories WHERE active = 1 ORDER BY sort_order ASC, name ASC",
      )
      .all()
      .map((row: any) => row.name);
  },

  setCategories(categories: string[], actor?: string | null) {
    return inTransaction((database) => {
      database.prepare("UPDATE menu_categories SET active = 0, updated_at = ?").run(now());
      const upsert = database.prepare(`
        INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order,
          active = 1, updated_at = excluded.updated_at
      `);
      categories.forEach((category, index) => {
        const name = category.trim();
        if (name) {
          upsert.run(slugId("cat", name), name, index + 1, now(), now());
        }
      });
      this.setSetting("config:categories", { categories }, actor);
      createAuditRow(
        database,
        "menu.categories.updated",
        "config",
        "config:categories",
        actor || null,
        {
          count: categories.length,
        },
      );
      return { ok: true };
    });
  },

  createOrder(
    input: {
      tableId?: number | null;
      orderType?: "table" | "takeaway" | "delivery";
      customerId?: string | null;
      meta?: Record<string, unknown>;
      createdBy?: string | null;
    } = {},
  ) {
    const at = now();
    const orderType =
      input.orderType ||
      (input.tableId !== null && input.tableId !== undefined ? "table" : "takeaway");
    const id = `order:${randomUUID()}`;
    return inTransaction((database) => {
      const customerId = resolveActiveCustomerId(database, input.customerId);
      const orderSeq = nextOrderSeq(database);
      const meta = { ...(input.meta || {}), orderSeq };
      database
        .prepare(
          `INSERT INTO orders (
            id, order_type, table_id, customer_id, status, kot_status, subtotal_paise,
            tax_total_paise, discount_percent, discount_total_paise, total_paise,
            meta_json, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'open', 'pending', 0, 0, 0, 0, 0, ?, ?, ?, ?)`,
        )
        .run(
          id,
          orderType,
          input.tableId ?? null,
          customerId,
          stringifyJson(meta),
          input.createdBy || null,
          at,
          at,
        );
      createAuditRow(database, "order.created", "order", id, input.createdBy || null, {
        orderType,
        tableId: input.tableId ?? null,
        customerId,
      });
      return this.getOrderById(id)!;
    });
  },

  getNextKotSeq(): number {
    return inTransaction((database) => nextKotSeq(database));
  },

  getOrderById(id: string): OrderDto | null {
    const database = getDb();
    const row = database.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    return row ? orderFromRow(database, row) : null;
  },

  getOpenOrderForTable(tableId: number): OrderDto | null {
    const database = getDb();
    const row = database
      .prepare(
        `SELECT * FROM orders
         WHERE table_id = ? AND status = 'open'
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get(tableId);
    return row ? orderFromRow(database, row) : null;
  },

  getOpenOrders(): OrderDto[] {
    const database = getDb();
    return database
      .prepare("SELECT * FROM orders WHERE status = 'open' ORDER BY created_at ASC")
      .all()
      .map((row: any) => orderFromRow(database, row));
  },

  getActiveOrders(): OrderDto[] {
    const database = getDb();
    return database
      .prepare(
        "SELECT * FROM orders WHERE status NOT IN ('paid', 'cancelled') ORDER BY created_at ASC",
      )
      .all()
      .map((row: any) => orderFromRow(database, row));
  },

  getOrCreateOrderForTable(tableId: number, createdBy?: string | null) {
    return (
      this.getOpenOrderForTable(tableId) ||
      this.createOrder({ tableId, orderType: "table", createdBy })
    );
  },

  addItemToOrder(
    orderId: string,
    item: {
      name: string;
      qty: number;
      rate: number;
      menuItemId?: string | null;
      categoryName?: string | null;
    },
  ) {
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const existing = order.items.find(
        (line) => line.name.toLowerCase() === item.name.toLowerCase(),
      );
      if (existing) {
        existing.qty += Number(item.qty || 1);
        if (!existing.menuItemId && item.menuItemId) {
          existing.menuItemId = item.menuItemId;
        }
        if (!existing.categoryName && item.categoryName) {
          existing.categoryName = normalizeCategoryName(item.categoryName) || null;
        }
      } else {
        order.items.push({
          id: `line:${randomUUID()}`,
          menuItemId: item.menuItemId || null,
          categoryName: normalizeCategoryName(item.categoryName) || null,
          name: item.name,
          qty: Number(item.qty || 1),
          rate: Number(item.rate || 0),
          taxRateBps: TAX_RATE_BPS,
          kotPrintedQty: 0,
        });
      }
      upsertOrderLines(database, orderId, order.items);
      database
        .prepare("UPDATE orders SET kot_status = ?, updated_at = ? WHERE id = ?")
        .run(kotStatusAfterLineChange(order, order.items), now(), orderId);
      updateOrderTotals(database, orderId, order.items, order.discountPercent || 0);
      createAuditRow(database, "item.added", "order", orderId, order.createdBy || null, { item });
      return this.getOrderById(orderId)!;
    });
  },

  updateOrderLines(orderId: string, lines: OrderLineDto[], actor?: string | null) {
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const sanitized = sanitizeOrderLines(lines);
      assertNoSentKotReduction(order, sanitized);
      upsertOrderLines(database, orderId, sanitized);
      database
        .prepare("UPDATE orders SET kot_status = ?, updated_at = ? WHERE id = ?")
        .run(kotStatusAfterLineChange(order, sanitized), now(), orderId);
      updateOrderTotals(database, orderId, sanitized, Number(order.discountPercent || 0));
      createAuditRow(
        database,
        "order.lines.updated",
        "order",
        orderId,
        actor || order.createdBy || null,
        {
          lineCount: sanitized.length,
        },
      );
      return this.getOrderById(orderId)!;
    });
  },

  voidKotLine(
    orderId: string,
    input: { lineId: string; finalQty: number; reason: string },
    actor?: string | null,
  ) {
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const lineId = String(input?.lineId || "").trim();
      const reason = normalizeText(input?.reason);
      const finalQty = Math.max(0, Number(input?.finalQty) || 0);
      if (!reason) {
        throw new Error("kot-void-reason-required");
      }
      const line = order.items.find((candidate) => candidate.id === lineId);
      if (!line) {
        throw new Error("order-line-not-found");
      }
      const sentQty = Math.max(0, Number(line.kotPrintedQty || 0));
      if (sentQty <= 0 || finalQty >= sentQty) {
        throw new Error("kot-void-not-required");
      }
      const nextLines = order.items
        .map((candidate) =>
          candidate.id === lineId
            ? {
                ...candidate,
                qty: finalQty,
                kotPrintedQty: finalQty,
              }
            : candidate,
        )
        .filter((candidate) => Number(candidate.qty || 0) > 0);
      upsertOrderLines(database, orderId, nextLines);
      database
        .prepare("UPDATE orders SET kot_status = ?, updated_at = ? WHERE id = ?")
        .run(kotStatusAfterLineChange(order, nextLines), now(), orderId);
      updateOrderTotals(database, orderId, nextLines, Number(order.discountPercent || 0));
      createAuditRow(
        database,
        "order.kot.void",
        "order",
        orderId,
        actor || order.createdBy || null,
        {
          lineId,
          name: line.name,
          voidQty: sentQty - finalQty,
          finalQty,
          reason,
        },
      );
      return this.getOrderById(orderId)!;
    });
  },

  setOrderDiscount(orderId: string, discountPercent: number, actor?: string | null) {
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const safeDiscount = Math.max(0, Math.min(100, Number(discountPercent) || 0));
      updateOrderTotals(database, orderId, order.items || [], safeDiscount);
      createAuditRow(
        database,
        "order.discount.updated",
        "order",
        orderId,
        actor || order.createdBy || null,
        {
          discountPercent: safeDiscount,
        },
      );
      return this.getOrderById(orderId)!;
    });
  },

  setOrderStatus(
    orderId: string,
    status: OrderStatus,
    input: { meta?: Record<string, unknown> | null } = {},
    actor?: string | null,
  ) {
    assertOperationalStatus(status);
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const nextMeta = input.meta === undefined ? order.meta || {} : input.meta || {};
      database
        .prepare("UPDATE orders SET status = ?, meta_json = ?, updated_at = ? WHERE id = ?")
        .run(status, stringifyJson(nextMeta), now(), orderId);
      createAuditRow(
        database,
        "order.status.updated",
        "order",
        orderId,
        actor || order.createdBy || null,
        {
          status,
        },
      );
      return this.getOrderById(orderId)!;
    });
  },

  markKotSent(
    orderId: string,
    sentLines: Array<{ id: string; sentQty: number }> = [],
    actor?: string | null,
  ) {
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const requested = new Map(
        (sentLines || [])
          .map((line) => [String(line.id || ""), Math.max(0, Number(line.sentQty) || 0)] as const)
          .filter(([id, qty]) => Boolean(id) && qty > 0),
      );
      const targets =
        requested.size > 0
          ? order.items.filter((line) => requested.has(line.id))
          : getUnsentKotLines(order.items).map((line) => ({ ...line, sentQty: line.qty }));

      if (!targets.length) {
        throw new Error("kot-no-unsent-items");
      }

      const at = now();
      const updateLine = database.prepare(
        "UPDATE order_lines SET kot_printed_qty = ?, updated_at = ? WHERE order_id = ? AND id = ?",
      );
      const auditLines: Array<{ id: string; name: string; sentQty: number }> = [];
      for (const line of targets) {
        const finalSentQty =
          requested.size > 0
            ? (requested.get(line.id) ?? Number(line.kotPrintedQty || 0))
            : Number(line.qty || 0);
        const safeSentQty = Math.min(
          Number(line.qty || 0),
          Math.max(Number(line.kotPrintedQty || 0), finalSentQty),
        );
        updateLine.run(safeSentQty, at, orderId, line.id);
        auditLines.push({ id: line.id, name: line.name, sentQty: safeSentQty });
      }

      database
        .prepare("UPDATE orders SET kot_status = 'sent', updated_at = ? WHERE id = ?")
        .run(at, orderId);
      createAuditRow(
        database,
        "order.kot.sent",
        "order",
        orderId,
        actor || order.createdBy || null,
        {
          lines: auditLines,
        },
      );
      return this.getOrderById(orderId)!;
    });
  },

  markKotFailed(orderId: string, error?: string | null, actor?: string | null) {
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const at = now();
      database
        .prepare("UPDATE orders SET kot_status = 'failed', updated_at = ? WHERE id = ?")
        .run(at, orderId);
      createAuditRow(
        database,
        "order.kot.failed",
        "order",
        orderId,
        actor || order.createdBy || null,
        {
          error: error ? String(error).slice(0, 300) : undefined,
        },
      );
      return this.getOrderById(orderId)!;
    });
  },

  markKotDone(orderId: string, actor?: string | null) {
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      if (!order.items.some((line) => Number(line.kotPrintedQty || 0) > 0)) {
        throw new Error("kot-not-sent");
      }
      if (getUnsentKotLines(order.items).length > 0) {
        throw new Error("kot-has-unsent-items");
      }
      const at = now();
      database
        .prepare("UPDATE orders SET kot_status = 'printed', updated_at = ? WHERE id = ?")
        .run(at, orderId);
      createAuditRow(
        database,
        "order.kot.done",
        "order",
        orderId,
        actor || order.createdBy || null,
        {},
      );
      return this.getOrderById(orderId)!;
    });
  },

  markKotPrinted(orderId: string, actor?: string | null) {
    const order = this.getOrderById(orderId);
    assertOrderCanBeEdited(order);
    if (getUnsentKotLines(order.items).length > 0) {
      this.markKotSent(orderId, [], actor);
    }
    return this.markKotDone(orderId, actor);
  },

  updateOrder(order: OrderDto) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM orders WHERE id = ?").get(order._id) as any;
      if (!current) {
        throw new Error("order-not-found");
      }
      const kotStatus =
        order.kotStatus ||
        (order.kotPrinted ? "printed" : order.kotSent ? "sent" : current.kot_status || "pending");
      database
        .prepare(
          `UPDATE orders
           SET order_type = ?, table_id = ?, customer_id = ?, status = ?, kot_status = ?,
               discount_percent = ?, meta_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          order.orderType || current.order_type,
          order.tableId ?? null,
          order.customerId || null,
          order.status || current.status,
          kotStatus,
          Number(order.discountPercent || 0),
          stringifyJson(order.meta || {}),
          now(),
          order._id,
        );
      upsertOrderLines(database, order._id, order.items || []);
      const gstConfig =
        order.meta && (order.meta as any).gstSnapshot
          ? normalizeGstConfig((order.meta as any).gstSnapshot)
          : getGstSettingFromDb(database);
      updateOrderTotals(
        database,
        order._id,
        order.items || [],
        Number(order.discountPercent || 0),
        gstConfig,
      );
      return this.getOrderById(order._id)!;
    });
  },

  setOrderPaid(orderId: string, payment: PaymentDto) {
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const rawPayment = (payment || {}) as any;
      const discountPercent =
        rawPayment.discountPercent !== undefined
          ? Number(rawPayment.discountPercent || 0)
          : Number(order.discountPercent || 0);
      const gstConfig = getGstSettingFromDb(database);
      const totals = updateOrderTotals(
        database,
        orderId,
        order.items || [],
        discountPercent,
        gstConfig,
      );
      const safePayment =
        payment || ({ method: "cash", amount: paiseToRupees(totals.totalPaise) } as PaymentDto);
      const preparedPayment = preparePaymentForTotal(safePayment, totals.totalPaise);
      const paymentId = `payment:${randomUUID()}`;
      const receivedAt = now();
      const invoice = nextInvoiceSnapshot(database, receivedAt);
      const nextMeta = {
        ...(order.meta || {}),
        gstSnapshot: buildGstSnapshot(gstConfig),
        invoice,
      };
      database
        .prepare(
          `INSERT INTO payments (
            id, order_id, method, amount_paise, amount_paid_paise, change_paise,
            txn_ref, split_json, status, received_by, received_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
        )
        .run(
          paymentId,
          orderId,
          preparedPayment.method,
          preparedPayment.amountPaise,
          preparedPayment.amountPaidPaise,
          preparedPayment.changePaise,
          safePayment.txnRef || null,
          preparedPayment.splitJson,
          safePayment.receivedBy || order.createdBy || null,
          receivedAt,
        );
      database
        .prepare(
          `UPDATE orders
           SET status = 'paid', invoice_number = ?, paid_at = ?, meta_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(invoice.number, receivedAt, stringifyJson(nextMeta), receivedAt, orderId);
      createAuditRow(
        database,
        "order.paid",
        "order",
        orderId,
        safePayment.receivedBy || order.createdBy || null,
        {
          payment: {
            id: paymentId,
            method: preparedPayment.method,
            amount: paiseToRupees(preparedPayment.amountPaise),
            amountPaid: paiseToRupees(preparedPayment.amountPaidPaise),
            change: paiseToRupees(preparedPayment.changePaise),
          },
          invoice,
          gstDetailsEnabled: gstConfig.enabled,
        },
      );
      return this.getOrderById(orderId)!;
    });
  },

  cancelOrder(orderId: string, actor?: string | null) {
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      if (!order) {
        throw new Error("order-not-found");
      }
      database
        .prepare("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(now(), orderId);
      createAuditRow(
        database,
        "order.cancelled",
        "order",
        orderId,
        actor || order.createdBy || null,
        {},
      );
      return this.getOrderById(orderId)!;
    });
  },

  deleteOrder(orderId: string, actor?: string | null) {
    return this.deleteClosedOrders([orderId], actor);
  },

  deleteClosedOrders(orderIds: string[], actor?: string | null) {
    const ids = Array.from(
      new Set((orderIds || []).map((id) => String(id || "").trim()).filter(Boolean)),
    );
    if (!ids.length) {
      return { ok: true, deleted: 0 };
    }
    return inTransaction((database) => {
      let deleted = 0;
      for (const id of ids) {
        const order = this.getOrderById(id);
        if (!order) {
          continue;
        }
        if (order.status !== "paid" && order.status !== "cancelled") {
          throw new Error("cannot-delete-active-order");
        }
        database.prepare("DELETE FROM orders WHERE id = ?").run(id);
        createAuditRow(database, "order.deleted", "order", id, actor || null, {
          status: order.status,
        });
        deleted += 1;
      }
      return { ok: true, deleted };
    });
  },

  restoreOrderSnapshot(order: OrderDto, actor?: string | null) {
    if (!order || order.type !== "order" || !order._id) {
      throw new Error("invalid-order");
    }
    if (order.status !== "paid" && order.status !== "cancelled") {
      throw new Error("cannot-restore-active-order");
    }
    return inTransaction((database) => {
      const existing = this.getOrderById(order._id);
      if (existing) {
        throw new Error("order-already-exists");
      }
      const createdAt = Number(order.createdAt || now());
      const paidAt = getOrderPaidAt(order);
      database
        .prepare(
          `INSERT INTO orders (
            id, order_type, table_id, customer_id, status, kot_status, subtotal_paise,
            tax_total_paise, discount_percent, discount_total_paise, total_paise,
            invoice_number, paid_at, meta_json, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          order._id,
          order.orderType ||
            (order.tableId !== null && order.tableId !== undefined ? "table" : "takeaway"),
          order.tableId ?? null,
          order.customerId || null,
          order.status,
          order.kotPrinted ? "printed" : order.kotSent ? "sent" : order.kotStatus || "pending",
          Number(order.discountPercent || 0),
          getOrderInvoiceNumber(order),
          paidAt,
          stringifyJson(order.meta || {}),
          order.createdBy || actor || null,
          createdAt,
          Number(order.updatedAt || createdAt),
        );
      const lines = sanitizeOrderLines(order.items || []);
      upsertOrderLines(database, order._id, lines);
      const gstConfig =
        order.meta && (order.meta as any).gstSnapshot
          ? normalizeGstConfig((order.meta as any).gstSnapshot)
          : getGstSettingFromDb(database);
      updateOrderTotals(database, order._id, lines, Number(order.discountPercent || 0), gstConfig);
      (order.payments || []).forEach((payment) => {
        const paymentId = payment.id || `payment:${randomUUID()}`;
        database
          .prepare(
            `INSERT INTO payments (
              id, order_id, method, amount_paise, amount_paid_paise, change_paise,
              txn_ref, split_json, status, received_by, received_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            paymentId,
            order._id,
            payment.method || "cash",
            rupeesToPaise(payment.amount),
            payment.amountPaid === null || payment.amountPaid === undefined
              ? null
              : rupeesToPaise(payment.amountPaid),
            payment.change === null || payment.change === undefined
              ? null
              : rupeesToPaise(payment.change),
            payment.txnRef || null,
            payment.splitBreakdown === null || payment.splitBreakdown === undefined
              ? null
              : stringifyJson(payment.splitBreakdown),
            payment.status || "completed",
            payment.receivedBy || order.createdBy || actor || null,
            payment.receivedAt || order.updatedAt || now(),
          );
      });
      createAuditRow(database, "order.restored", "order", order._id, actor || null, {});
      return this.getOrderById(order._id)!;
    });
  },

  listPaidOrders(opts: PaidOrderQueryDto = {}) {
    const database = getDb();
    const query = buildPaidOrderWhere(opts);
    const params = [...query.params];
    const sql = appendPaidOrderLimit(
      `SELECT o.*
       FROM orders o
       WHERE ${query.whereSql}
       ORDER BY ${paidOrderTimeExpression()} DESC, o.id DESC`,
      params,
      query.limit,
      query.offset,
    );
    return database
      .prepare(sql)
      .all(...params)
      .map((row: any) => orderFromRow(database, row));
  },

  countPaidOrders(opts: PaidOrderQueryDto = {}) {
    const query = buildPaidOrderWhere(opts);
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS count FROM orders o WHERE ${query.whereSql}`)
      .get(...query.params) as { count?: number } | undefined;
    return Number(row?.count || 0);
  },

  listPaidOrderIds(opts: PaidOrderQueryDto = {}) {
    const query = buildPaidOrderWhere(opts);
    const params = [...query.params];
    const sql = appendPaidOrderLimit(
      `SELECT o.id
       FROM orders o
       WHERE ${query.whereSql}
       ORDER BY ${paidOrderTimeExpression()} DESC, o.id DESC`,
      params,
      query.limit,
      query.offset,
    );
    return getDb()
      .prepare(sql)
      .all(...params)
      .map((row: any) => String(row.id));
  },

  getSalesSummary(opts: { from?: number; to?: number } = {}): SalesSummaryDto {
    const payments = this.getPaymentsInRange(opts);
    const orderIds = new Set(payments.map((payment: any) => payment.order_id));
    const totalPaise = payments.reduce(
      (sum: number, payment: any) => sum + Number(payment.amount_paise || 0),
      0,
    );
    let subtotalPaise = 0;
    let taxTotalPaise = 0;
    let discountTotalPaise = 0;
    orderIds.forEach((orderId) => {
      const row = getDb()
        .prepare(
          "SELECT subtotal_paise, tax_total_paise, discount_total_paise, total_paise FROM orders WHERE id = ?",
        )
        .get(orderId) as any | undefined;
      if (row) {
        subtotalPaise += Number(row.subtotal_paise || 0);
        taxTotalPaise += Number(row.tax_total_paise || 0);
        discountTotalPaise += Number(row.discount_total_paise || 0);
      }
    });
    return {
      total: paiseToRupees(totalPaise),
      subtotal: paiseToRupees(subtotalPaise),
      taxTotal: paiseToRupees(taxTotalPaise),
      discountTotal: paiseToRupees(discountTotalPaise),
      orders: orderIds.size,
      payments: payments.length,
    };
  },

  getPaymentBreakdown(opts: { from?: number; to?: number } = {}) {
    const payments = this.getPaymentsInRange(opts);
    return payments.reduce((acc: Record<string, number>, payment: any) => {
      const method = normalizePaymentMethod(payment.method);
      if (method === "split") {
        const split = parseJson<any[]>(payment.split_json, []);
        if (Array.isArray(split) && split.length) {
          split.forEach((entry) => {
            const splitMethod = normalizePaymentMethod(entry?.method);
            const key = splitMethod === "split" ? "other" : splitMethod;
            const amountPaise =
              entry?.amountPaise !== undefined
                ? Number(entry.amountPaise)
                : rupeesToPaise(entry?.amount);
            if (Number.isFinite(amountPaise) && amountPaise > 0) {
              acc[key] = (acc[key] || 0) + paiseToRupees(amountPaise);
            }
          });
          return acc;
        }
      }
      acc[method] = (acc[method] || 0) + paiseToRupees(payment.amount_paise);
      return acc;
    }, {});
  },

  getProductSalesReport(opts: { from?: number; to?: number } = {}): ProductSalesReportDto {
    const payments = this.getPaymentsInRange(opts);
    const orderIds: string[] = Array.from(
      new Set<string>(
        payments.map((payment: any) => String(payment.order_id || "")).filter(Boolean),
      ),
    );
    if (!orderIds.length) {
      return {
        categorySales: [],
        itemSales: [],
        totals: { totalSales: 0, totalUnits: 0 },
      };
    }

    const placeholders = orderIds.map(() => "?").join(", ");
    const rows = getDb()
      .prepare(
        `SELECT
           o.id AS order_id,
           o.total_paise,
           l.item_name,
           l.category_name,
           l.quantity,
           l.rate_paise,
           l.line_total_paise
         FROM orders o
         JOIN order_lines l ON l.order_id = o.id
         WHERE o.id IN (${placeholders})
         ORDER BY o.id, l.sort_order ASC, l.created_at ASC`,
      )
      .all(...orderIds) as any[];

    const rowsByOrder = new Map<string, any[]>();
    rows.forEach((row) => {
      const orderId = String(row.order_id || "");
      rowsByOrder.set(orderId, [...(rowsByOrder.get(orderId) || []), row]);
    });

    const categoryMap = new Map<string, { salesPaise: number; units: number }>();
    const itemMap = new Map<
      string,
      { itemName: string; category: string; salesPaise: number; units: number }
    >();
    let totalSalesPaise = 0;
    let totalUnits = 0;

    orderIds.forEach((orderId) => {
      const lines = rowsByOrder.get(orderId) || [];
      if (!lines.length) {
        return;
      }
      const orderTotalPaise = Math.max(0, Number(lines[0].total_paise || 0));
      const grossValues = lines.map((line) => {
        const storedGross = Number(line.line_total_paise);
        if (Number.isFinite(storedGross) && storedGross >= 0) {
          return storedGross;
        }
        return Math.max(0, Number(line.quantity || 0) * Number(line.rate_paise || 0));
      });
      const grossTotalPaise = grossValues.reduce((sum, gross) => sum + gross, 0);
      let remainingPaise = orderTotalPaise;

      lines.forEach((line, index) => {
        const units = Math.max(0, Number(line.quantity || 0));
        let allocatedPaise = 0;
        if (grossTotalPaise > 0 && orderTotalPaise > 0) {
          allocatedPaise =
            index === lines.length - 1
              ? remainingPaise
              : Math.round((orderTotalPaise * grossValues[index]) / grossTotalPaise);
          remainingPaise -= allocatedPaise;
        }

        const category = normalizeCategoryName(line.category_name) || "Uncategorized";
        const itemName = normalizeText(line.item_name) || "Unknown Item";
        const categoryCurrent = categoryMap.get(category) || { salesPaise: 0, units: 0 };
        categoryCurrent.salesPaise += allocatedPaise;
        categoryCurrent.units += units;
        categoryMap.set(category, categoryCurrent);

        const itemKey = `${category}\u0000${itemName}`;
        const itemCurrent = itemMap.get(itemKey) || {
          itemName,
          category,
          salesPaise: 0,
          units: 0,
        };
        itemCurrent.salesPaise += allocatedPaise;
        itemCurrent.units += units;
        itemMap.set(itemKey, itemCurrent);

        totalSalesPaise += allocatedPaise;
        totalUnits += units;
      });
    });

    const categorySales = Array.from(categoryMap.entries())
      .map(([category, value]) => ({
        category,
        sales: paiseToRupees(value.salesPaise),
        units: value.units,
      }))
      .sort(
        (a, b) => b.sales - a.sales || b.units - a.units || a.category.localeCompare(b.category),
      );

    const itemSales = Array.from(itemMap.values())
      .map((value) => ({
        itemName: value.itemName,
        category: value.category,
        sales: paiseToRupees(value.salesPaise),
        units: value.units,
      }))
      .sort(
        (a, b) => b.units - a.units || b.sales - a.sales || a.itemName.localeCompare(b.itemName),
      );

    return {
      categorySales,
      itemSales,
      totals: {
        totalSales: paiseToRupees(totalSalesPaise),
        totalUnits,
      },
    };
  },

  getPaymentsInRange(opts: { from?: number; to?: number } = {}) {
    const clauses = ["p.status = 'completed'"];
    const params: unknown[] = [];
    if (opts.from !== null && opts.from !== undefined) {
      clauses.push("p.received_at >= ?");
      params.push(opts.from);
    }
    if (opts.to !== null && opts.to !== undefined) {
      clauses.push("p.received_at <= ?");
      params.push(opts.to);
    }
    return getDb()
      .prepare(
        `SELECT p.*
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE ${clauses.join(" AND ")} AND o.status = 'paid'
         ORDER BY p.received_at DESC`,
      )
      .all(...params);
  },

  getSetting(key: string): Record<string, unknown> | null {
    const row = getDb().prepare("SELECT * FROM settings WHERE key = ?").get(key) as any;
    return row ? parseJson(row.value_json, {}) : null;
  },

  setSetting(key: string, value: Record<string, unknown>, actor?: string | null) {
    const existing = this.getSetting(key) || {};
    const merged = { ...existing, ...value };
    const normalized =
      key === "config:gst" ? assertGstConfig(merged as Partial<GstConfig>) : merged;
    const at = now();
    const database = getDb();
    database
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, stringifyJson(normalized), at);
    if (key === "config:gst") {
      recalculateOpenOrderTotals(database, normalized as GstConfig);
    }
    createAuditRow(database, "settings.updated", "config", key, actor || null, {
      key,
      fields: Object.keys(value || {}).sort(),
    });
    return { _id: key, type: "config", ...normalized, updatedAt: at } as ConfigDto;
  },

  getConfigDoc(key: string): ConfigDto | null {
    const value = this.getSetting(key);
    return value ? ({ _id: key, type: "config", ...value } as ConfigDto) : null;
  },

  pruneAuditLogs() {
    const cfg = this.getSetting("config:audit") as any;
    const retentionDays = cfg?.retentionDays === undefined ? 90 : cfg.retentionDays;
    if (retentionDays === null || Number(retentionDays) <= 0) {
      return 0;
    }
    const cutoff = now() - Number(retentionDays) * 24 * 60 * 60 * 1000;
    const result = getDb().prepare("DELETE FROM audit_logs WHERE timestamp < ?").run(cutoff);
    return result.changes;
  },

  pruneOrderHistory() {
    const cfg = this.getSetting("config:history") as any;
    const retentionDays = cfg?.retentionDays ?? null;
    if (retentionDays === null || Number(retentionDays) <= 0) {
      return 0;
    }
    const cutoff = now() - Number(retentionDays) * 24 * 60 * 60 * 1000;
    const rows = getDb()
      .prepare("SELECT id FROM orders WHERE status = 'paid' AND COALESCE(paid_at, updated_at) < ?")
      .all(cutoff) as any[];
    rows.forEach((row) => this.deleteOrder(row.id));
    return rows.length;
  },

  createAudit(action: string, orderId?: string | null, user?: string | null, detail?: unknown) {
    const id = createAuditRow(
      getDb(),
      action,
      orderId ? "order" : null,
      orderId || null,
      user || null,
      detail,
    );
    return this.getAuditById(id)!;
  },

  getAuditById(id: string): AuditDto | null {
    const row = getDb().prepare("SELECT * FROM audit_logs WHERE id = ?").get(id) as any;
    return row ? auditFromRow(row) : null;
  },

  getAudits(
    opts: { from?: number; to?: number; search?: string; limit?: number; offset?: number } = {},
  ) {
    const query = buildAuditWhere(opts);
    const params = [...query.params, query.limit, query.offset];
    return getDb()
      .prepare(
        `SELECT * FROM audit_logs ${query.whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      )
      .all(...params)
      .map(auditFromRow);
  },

  countAudits(opts: { from?: number; to?: number; search?: string } = {}) {
    const query = buildAuditWhere(opts);
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS count FROM audit_logs ${query.whereSql}`)
      .get(...query.params) as { count?: number } | undefined;
    return Number(row?.count || 0);
  },

  listGroceryItems(_opts: { includeInactive?: boolean } = {}): GroceryItemDto[] {
    const database = getDb();
    const rows = database.prepare("SELECT * FROM grocery_items ORDER BY lower(name) ASC").all();
    return rows.map((row: any) => groceryItemFromRow(database, row));
  },

  getGroceryItem(id: string): GroceryItemDto | null {
    const database = getDb();
    const row = database.prepare("SELECT * FROM grocery_items WHERE id = ?").get(id) as any;
    return row ? groceryItemFromRow(database, row) : null;
  },

  createGroceryItem(input: Parameters<typeof prepareGroceryItemInput>[0], actor?: string | null) {
    const prepared = prepareGroceryItemInput(input);
    const id = `grocery-item:${randomUUID()}`;
    const at = now();
    return inTransaction((database) => {
      database
        .prepare(
          `INSERT INTO grocery_items (
            id, name, category, default_unit, default_quantity, vendor_hint, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          prepared.name,
          prepared.category,
          prepared.defaultUnit,
          prepared.defaultQuantity,
          prepared.vendorHint,
          at,
          at,
        );
      createAuditRow(database, "grocery.item.created", "grocery-item", id, actor || null, {
        name: prepared.name,
      });
      return groceryItemFromRow(
        database,
        database.prepare("SELECT * FROM grocery_items WHERE id = ?").get(id),
      );
    });
  },

  updateGroceryItem(id: string, updates: Partial<GroceryItemDto>, actor?: string | null) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM grocery_items WHERE id = ?").get(id) as any;
      if (!current) {
        throw new Error("grocery-item-not-found");
      }
      const prepared = prepareGroceryItemInput({
        name: updates.name === undefined ? current.name : updates.name,
        category: updates.category === undefined ? current.category : updates.category,
        defaultUnit: updates.defaultUnit === undefined ? current.default_unit : updates.defaultUnit,
        defaultQuantity:
          updates.defaultQuantity === undefined
            ? current.default_quantity
            : updates.defaultQuantity,
        vendorHint: updates.vendorHint === undefined ? current.vendor_hint : updates.vendorHint,
      });
      const active = updates.active === undefined ? Number(current.active) : updates.active ? 1 : 0;
      database
        .prepare(
          `UPDATE grocery_items
           SET name = ?, category = ?, default_unit = ?, default_quantity = ?, vendor_hint = ?,
               active = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          prepared.name,
          prepared.category,
          prepared.defaultUnit,
          prepared.defaultQuantity,
          prepared.vendorHint,
          active,
          now(),
          id,
        );
      createAuditRow(database, "grocery.item.updated", "grocery-item", id, actor || null, {
        fields: Object.keys(updates || {}).sort(),
      });
      return groceryItemFromRow(
        database,
        database.prepare("SELECT * FROM grocery_items WHERE id = ?").get(id),
      );
    });
  },

  deleteGroceryItem(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT id FROM grocery_items WHERE id = ?").get(id);
      if (!current) {
        throw new Error("grocery-item-not-found");
      }
      database.prepare("DELETE FROM grocery_items WHERE id = ?").run(id);
      createAuditRow(database, "grocery.item.deleted", "grocery-item", id, actor || null, {});
      return { ok: true };
    });
  },

  listGroceryLists(opts: { from?: number; to?: number; limit?: number } = {}): GroceryListDto[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.from !== undefined && opts.from !== null) {
      clauses.push("list_date >= ?");
      params.push(opts.from);
    }
    if (opts.to !== undefined && opts.to !== null) {
      clauses.push("list_date <= ?");
      params.push(opts.to);
    }
    const limit = Math.min(100, Math.max(1, Number(opts.limit || 30)));
    params.push(limit);
    const database = getDb();
    const rows = database
      .prepare(
        `SELECT * FROM grocery_lists ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
         ORDER BY list_date DESC, created_at DESC
         LIMIT ?`,
      )
      .all(...params);
    return rows.map((row: any) => groceryListFromRow(database, row));
  },

  getGroceryList(id: string): GroceryListDto | null {
    const database = getDb();
    const row = database.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(id) as any;
    return row ? groceryListFromRow(database, row) : null;
  },

  createGroceryList(
    input: { title?: string; listDate?: number; lines?: Partial<GroceryListLineDto>[] },
    actor?: string | null,
  ) {
    const at = now();
    const listDate = Number(input.listDate || at);
    if (!Number.isFinite(listDate) || listDate <= 0) {
      throw new Error("grocery-date-invalid");
    }
    const id = `grocery-list:${randomUUID()}`;
    const title =
      normalizeText(input.title) ||
      `Grocery List ${new Date(listDate).toLocaleDateString("en-IN")}`;
    return inTransaction((database) => {
      const sourceLines =
        input.lines && input.lines.length
          ? input.lines
          : (
              database
                .prepare("SELECT * FROM grocery_items ORDER BY lower(name) ASC")
                .all() as any[]
            ).map((item) => ({
              groceryItemId: item.id,
              itemName: item.name,
              category: item.category,
              quantity: item.default_quantity,
              unit: item.default_unit,
              vendorHint: item.vendor_hint,
            }));
      const lines = sourceLines.map((line, index) => prepareGroceryListLineInput(line, index));
      database
        .prepare(
          `INSERT INTO grocery_lists (id, title, list_date, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
        )
        .run(id, title, listDate, actor || null, at, at);
      const insertLine = database.prepare(
        `INSERT INTO grocery_list_lines (
          id, list_id, grocery_item_id, item_name, category, quantity, unit, vendor_hint,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      lines.forEach((line, index) => {
        insertLine.run(
          line.id,
          id,
          line.groceryItemId || null,
          line.itemName,
          line.category || null,
          line.quantity,
          line.unit,
          line.vendorHint || null,
          index,
          at,
          at,
        );
      });
      createAuditRow(database, "grocery.list.created", "grocery-list", id, actor || null, {
        lineCount: lines.length,
      });
      return groceryListFromRow(
        database,
        database.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(id),
      );
    });
  },

  updateGroceryList(
    id: string,
    updates: {
      title?: string;
      listDate?: number;
      status?: GroceryListDto["status"];
      lines?: Partial<GroceryListLineDto>[];
    },
    actor?: string | null,
  ) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(id) as any;
      if (!current) {
        throw new Error("grocery-list-not-found");
      }
      const title =
        updates.title === undefined ? current.title : normalizeText(updates.title) || current.title;
      const listDate =
        updates.listDate === undefined ? current.list_date : Number(updates.listDate);
      if (!Number.isFinite(listDate) || listDate <= 0) {
        throw new Error("grocery-date-invalid");
      }
      const status = updates.status || current.status;
      if (!["draft", "printed", "purchased"].includes(status)) {
        throw new Error("grocery-list-status-invalid");
      }
      database
        .prepare(
          "UPDATE grocery_lists SET title = ?, list_date = ?, status = ?, updated_at = ? WHERE id = ?",
        )
        .run(title, listDate, status, now(), id);
      if (updates.lines) {
        database.prepare("DELETE FROM grocery_list_lines WHERE list_id = ?").run(id);
        const insertLine = database.prepare(
          `INSERT INTO grocery_list_lines (
            id, list_id, grocery_item_id, item_name, category, quantity, unit, vendor_hint,
            sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const at = now();
        updates.lines
          .map((line, index) => prepareGroceryListLineInput(line, index))
          .forEach((line, index) => {
            insertLine.run(
              line.id,
              id,
              line.groceryItemId || null,
              line.itemName,
              line.category || null,
              line.quantity,
              line.unit,
              line.vendorHint || null,
              index,
              at,
              at,
            );
          });
      }
      createAuditRow(database, "grocery.list.updated", "grocery-list", id, actor || null, {
        fields: Object.keys(updates || {}).sort(),
      });
      return groceryListFromRow(
        database,
        database.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(id),
      );
    });
  },

  deleteGroceryList(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT id FROM grocery_lists WHERE id = ?").get(id);
      if (!current) {
        throw new Error("grocery-list-not-found");
      }
      database.prepare("DELETE FROM grocery_lists WHERE id = ?").run(id);
      createAuditRow(database, "grocery.list.deleted", "grocery-list", id, actor || null, {});
      return { ok: true };
    });
  },

  listGroceryPurchases(
    opts: {
      from?: number;
      to?: number;
      listId?: string;
      itemId?: string;
      search?: string;
      limit?: number | null;
      offset?: number;
    } = {},
  ): GroceryPurchaseLineDto[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.from !== undefined && opts.from !== null) {
      clauses.push("purchased_at >= ?");
      params.push(opts.from);
    }
    if (opts.to !== undefined && opts.to !== null) {
      clauses.push("purchased_at <= ?");
      params.push(opts.to);
    }
    if (opts.listId) {
      clauses.push("list_id = ?");
      params.push(opts.listId);
    }
    if (opts.itemId) {
      clauses.push("grocery_item_id = ?");
      params.push(opts.itemId);
    }
    const search = normalizeText(opts.search).toLowerCase();
    if (search) {
      const like = `%${search}%`;
      clauses.push(`(
        lower(item_name) LIKE ?
        OR lower(COALESCE(category, '')) LIKE ?
        OR lower(COALESCE(vendor, '')) LIKE ?
        OR lower(COALESCE(notes, '')) LIKE ?
      )`);
      params.push(like, like, like, like);
    }
    const shouldLimit = opts.limit !== null;
    let limitSql = "";
    if (shouldLimit) {
      const limit = Math.min(5000, Math.max(1, Number(opts.limit || 100)));
      const offset = Math.max(0, Number(opts.offset || 0));
      params.push(limit, offset);
      limitSql = "LIMIT ? OFFSET ?";
    }
    return getDb()
      .prepare(
        `SELECT * FROM grocery_purchase_lines
         WHERE ${clauses.join(" AND ")}
         ORDER BY purchased_at DESC, created_at DESC
         ${limitSql}`,
      )
      .all(...params)
      .map(groceryPurchaseFromRow);
  },

  createGroceryPurchase(input: Partial<GroceryPurchaseLineDto>, actor?: string | null) {
    const prepared = prepareGroceryPurchaseInput(input);
    const id = `grocery-purchase:${randomUUID()}`;
    const at = now();
    return inTransaction((database) => {
      assertGroceryPurchaseModeAvailable(database, prepared);
      database
        .prepare(
          `INSERT INTO grocery_purchase_lines (
            id, list_id, grocery_item_id, item_name, category, quantity, unit, unit_price_paise,
            total_paise, vendor, payment_method, notes, purchased_at, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          prepared.listId,
          prepared.groceryItemId,
          prepared.itemName,
          prepared.category,
          prepared.quantity,
          prepared.unit,
          prepared.unitPrice === null ? null : rupeesToPaise(prepared.unitPrice),
          rupeesToPaise(prepared.totalAmount),
          prepared.vendor,
          prepared.paymentMethod,
          prepared.notes,
          prepared.purchasedAt,
          actor || null,
          at,
          at,
        );
      createAuditRow(database, "grocery.purchase.created", "grocery-purchase", id, actor || null, {
        itemName: prepared.itemName,
        totalAmount: prepared.totalAmount,
      });
      return groceryPurchaseFromRow(
        database.prepare("SELECT * FROM grocery_purchase_lines WHERE id = ?").get(id),
      );
    });
  },

  updateGroceryPurchase(
    id: string,
    updates: Partial<GroceryPurchaseLineDto>,
    actor?: string | null,
  ) {
    return inTransaction((database) => {
      const current = database
        .prepare("SELECT * FROM grocery_purchase_lines WHERE id = ?")
        .get(id) as any;
      if (!current) {
        throw new Error("grocery-purchase-not-found");
      }
      const prepared = prepareGroceryPurchaseInput({
        listId: updates.listId === undefined ? current.list_id : updates.listId,
        groceryItemId:
          updates.groceryItemId === undefined ? current.grocery_item_id : updates.groceryItemId,
        itemName: updates.itemName === undefined ? current.item_name : updates.itemName,
        category: updates.category === undefined ? current.category : updates.category,
        quantity: updates.quantity === undefined ? current.quantity : updates.quantity,
        unit: updates.unit === undefined ? current.unit : updates.unit,
        unitPrice:
          updates.unitPrice === undefined
            ? current.unit_price_paise === null || current.unit_price_paise === undefined
              ? null
              : paiseToRupees(current.unit_price_paise)
            : updates.unitPrice,
        totalAmount:
          updates.totalAmount === undefined
            ? paiseToRupees(current.total_paise)
            : updates.totalAmount,
        vendor: updates.vendor === undefined ? current.vendor : updates.vendor,
        paymentMethod:
          updates.paymentMethod === undefined ? current.payment_method : updates.paymentMethod,
        notes: updates.notes === undefined ? current.notes : updates.notes,
        purchasedAt: updates.purchasedAt === undefined ? current.purchased_at : updates.purchasedAt,
      });
      assertGroceryPurchaseModeAvailable(database, prepared, id);
      database
        .prepare(
          `UPDATE grocery_purchase_lines
           SET list_id = ?, grocery_item_id = ?, item_name = ?, category = ?, quantity = ?, unit = ?,
               unit_price_paise = ?, total_paise = ?, vendor = ?, payment_method = ?, notes = ?,
               purchased_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          prepared.listId,
          prepared.groceryItemId,
          prepared.itemName,
          prepared.category,
          prepared.quantity,
          prepared.unit,
          prepared.unitPrice === null ? null : rupeesToPaise(prepared.unitPrice),
          rupeesToPaise(prepared.totalAmount),
          prepared.vendor,
          prepared.paymentMethod,
          prepared.notes,
          prepared.purchasedAt,
          now(),
          id,
        );
      createAuditRow(database, "grocery.purchase.updated", "grocery-purchase", id, actor || null, {
        fields: Object.keys(updates || {}).sort(),
      });
      return groceryPurchaseFromRow(
        database.prepare("SELECT * FROM grocery_purchase_lines WHERE id = ?").get(id),
      );
    });
  },

  deleteGroceryPurchase(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database
        .prepare("SELECT id FROM grocery_purchase_lines WHERE id = ?")
        .get(id);
      if (!current) {
        throw new Error("grocery-purchase-not-found");
      }
      database.prepare("DELETE FROM grocery_purchase_lines WHERE id = ?").run(id);
      createAuditRow(
        database,
        "grocery.purchase.deleted",
        "grocery-purchase",
        id,
        actor || null,
        {},
      );
      return { ok: true };
    });
  },

  getFoodCostSummary(opts: { from?: number; to?: number } = {}): FoodCostSummaryDto {
    const sales = this.getSalesSummary(opts);
    const purchases = this.listGroceryPurchases({ from: opts.from, to: opts.to, limit: null });
    const grocerySpend = purchases.reduce(
      (sum, purchase) => sum + Number(purchase.totalAmount || 0),
      0,
    );
    const netSales = Number(
      sales.subtotal ?? Math.max(0, (sales.total || 0) - (sales.taxTotal || 0)),
    );
    const grossSales = Number(sales.total || 0);
    const itemMap = new Map<
      string,
      {
        itemName: string;
        category?: string | null;
        amount: number;
        quantity: number;
        unit?: GroceryUnit | null;
      }
    >();
    const vendorMap = new Map<string, { vendor: string; amount: number; purchaseCount: number }>();
    purchases.forEach((purchase) => {
      const itemKey = `${purchase.category || ""}\u0000${purchase.itemName}`;
      const item = itemMap.get(itemKey) || {
        itemName: purchase.itemName,
        category: purchase.category || null,
        amount: 0,
        quantity: 0,
        unit: purchase.unit,
      };
      item.amount += purchase.totalAmount;
      if (item.unit === purchase.unit) {
        item.quantity += purchase.quantity;
      }
      itemMap.set(itemKey, item);
      const vendorName = normalizeText(purchase.vendor) || "Unspecified";
      const vendor = vendorMap.get(vendorName) || {
        vendor: vendorName,
        amount: 0,
        purchaseCount: 0,
      };
      vendor.amount += purchase.totalAmount;
      vendor.purchaseCount += 1;
      vendorMap.set(vendorName, vendor);
    });
    return {
      netSales,
      grossSales,
      grocerySpend,
      estimatedGrossProfit: +(netSales - grocerySpend).toFixed(2),
      foodCostPercent: netSales > 0 ? +((grocerySpend / netSales) * 100).toFixed(1) : null,
      purchaseCount: purchases.length,
      topItems: Array.from(itemMap.values())
        .sort((a, b) => b.amount - a.amount || a.itemName.localeCompare(b.itemName))
        .slice(0, 10)
        .map((row) => ({
          ...row,
          amount: +row.amount.toFixed(2),
          quantity: +row.quantity.toFixed(3),
        })),
      topVendors: Array.from(vendorMap.values())
        .sort((a, b) => b.amount - a.amount || a.vendor.localeCompare(b.vendor))
        .slice(0, 10)
        .map((row) => ({ ...row, amount: +row.amount.toFixed(2) })),
    };
  },

  createAuditArchive(retentionDays = 90): AuditArchiveDto | null {
    const safeRetentionDays = Math.max(1, Number(retentionDays) || 90);
    const cutoff = now() - safeRetentionDays * 24 * 60 * 60 * 1000;
    const rows = getDb()
      .prepare("SELECT * FROM audit_logs WHERE timestamp < ? ORDER BY timestamp ASC")
      .all(cutoff) as any[];

    if (!rows.length) {
      return null;
    }

    const archivedAudits = rows.map(auditFromRow);
    const payloadJson = stringifyJson(archivedAudits);
    const timestamps = archivedAudits.map((audit) => Number(audit.timestamp));
    const id = `archive:${randomUUID()}`;
    const at = now();

    return inTransaction((database) => {
      database
        .prepare(
          `INSERT INTO audit_archives (
            id, start_date, end_date, count, archived_at, compressed, file_size, payload_json
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          id,
          Math.min(...timestamps),
          Math.max(...timestamps),
          archivedAudits.length,
          at,
          Buffer.byteLength(payloadJson, "utf8"),
          payloadJson,
        );
      createAuditRow(database, "audit.archive.created", "audit-archive", id, null, {
        count: archivedAudits.length,
        retentionDays: safeRetentionDays,
      });
      return auditArchiveFromRow(
        database.prepare("SELECT * FROM audit_archives WHERE id = ?").get(id),
      );
    });
  },

  getAuditArchive(id: string): AuditArchiveDto | null {
    const row = getDb().prepare("SELECT * FROM audit_archives WHERE id = ?").get(id) as any;
    return row ? auditArchiveFromRow(row) : null;
  },

  listAuditArchives(): AuditArchiveDto[] {
    return getDb()
      .prepare("SELECT * FROM audit_archives ORDER BY archived_at DESC")
      .all()
      .map(auditArchiveFromRow);
  },

  exportAuditArchive(id: string): { data: AuditDto[]; metadata: AuditArchiveDto } {
    const row = getDb().prepare("SELECT * FROM audit_archives WHERE id = ?").get(id) as any;
    if (!row) {
      throw new Error("audit-archive-not-found");
    }
    return {
      data: parseJson<AuditDto[]>(row.payload_json, []),
      metadata: auditArchiveFromRow(row),
    };
  },

  deleteAuditArchive(id: string) {
    return inTransaction((database) => {
      const archive = database.prepare("SELECT id FROM audit_archives WHERE id = ?").get(id);
      if (!archive) {
        throw new Error("audit-archive-not-found");
      }
      database.prepare("DELETE FROM audit_archives WHERE id = ?").run(id);
      createAuditRow(database, "audit.archive.deleted", "audit-archive", id, null, {});
      return { ok: true };
    });
  },

  cleanupOldAuditArchives(ageMonths = 12) {
    const cutoff = now() - Math.max(1, Number(ageMonths) || 12) * 30 * 24 * 60 * 60 * 1000;
    return inTransaction((database) => {
      const result = database
        .prepare("DELETE FROM audit_archives WHERE archived_at < ?")
        .run(cutoff);
      if (result.changes) {
        createAuditRow(database, "audit.archive.cleanup", "audit-archive", null, null, {
          deletedCount: result.changes,
          ageMonths,
        });
      }
      return result.changes;
    });
  },

  listCustomers(): CustomerDto[] {
    return getDb()
      .prepare("SELECT * FROM customers WHERE active = 1 ORDER BY created_at DESC")
      .all()
      .map(customerFromRow);
  },

  createCustomer(input: { name: string; phone: string; address?: string; notes?: string }) {
    const name = normalizeText(input.name);
    const phone = normalizePhone(input.phone);
    if (!isValidPersonName(name)) {
      throw new Error("customer-name-invalid");
    }
    if (!isValidIndianMobile(phone)) {
      throw new Error("customer-phone-invalid");
    }
    const id = `customer:${randomUUID()}`;
    const at = now();
    const database = getDb();
    assertUniqueActiveCustomerPhone(database, phone);
    database
      .prepare(
        `INSERT INTO customers (id, name, phone, address, notes, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, name, phone, input.address || null, input.notes || null, at, at);
    return this.listCustomers().find((customer) => customer.id === id)!;
  },

  updateCustomer(id: string, updates: Partial<CustomerDto>) {
    const current = getDb().prepare("SELECT * FROM customers WHERE id = ?").get(id) as any;
    if (!current) {
      throw new Error("customer-not-found");
    }
    const name = updates.name === undefined ? current.name : normalizeText(updates.name);
    const phone = updates.phone === undefined ? current.phone : normalizePhone(updates.phone);
    if (!isValidPersonName(name)) {
      throw new Error("customer-name-invalid");
    }
    if (!isValidIndianMobile(phone)) {
      throw new Error("customer-phone-invalid");
    }
    const database = getDb();
    assertUniqueActiveCustomerPhone(database, phone, id);
    database
      .prepare(
        `UPDATE customers SET name = ?, phone = ?, address = ?, notes = ?, active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        name,
        phone,
        updates.address ?? current.address,
        updates.notes ?? current.notes,
        updates.active === undefined ? current.active : updates.active ? 1 : 0,
        now(),
        id,
      );
    return this.listCustomers().find((customer) => customer.id === id) || null;
  },

  deleteCustomer(id: string) {
    getDb().prepare("UPDATE customers SET active = 0, updated_at = ? WHERE id = ?").run(now(), id);
    return { ok: true };
  },

  listStaff(opts: { includeInactive?: boolean } = {}): StaffDto[] {
    const sql = opts.includeInactive
      ? "SELECT * FROM staff ORDER BY active DESC, created_at DESC"
      : "SELECT * FROM staff WHERE active = 1 ORDER BY created_at DESC";
    return getDb().prepare(sql).all().map(staffFromRow);
  },

  createStaff(input: {
    name: string;
    phone: string;
    designation?: string | null;
    joiningDate?: string | null;
    salary?: number | string | null;
    address?: string | null;
    notes?: string | null;
    photoMime?: string | null;
    photoBase64?: string | null;
  }) {
    const prepared = prepareStaffInput(input);
    const id = `staff:${randomUUID()}`;
    const at = now();
    const database = getDb();
    assertUniqueActiveStaffPhone(database, prepared.phone);
    database
      .prepare(
        `INSERT INTO staff (
          id, name, phone, designation, joining_date, salary_paise, address, notes,
          photo_mime, photo_base64, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        prepared.name,
        prepared.phone,
        prepared.designation,
        prepared.joiningDate,
        prepared.salary === null ? null : rupeesToPaise(prepared.salary),
        prepared.address,
        prepared.notes,
        prepared.photoMime,
        prepared.photoBase64,
        at,
        at,
      );
    return this.listStaff().find((staff) => staff.id === id)!;
  },

  updateStaff(id: string, updates: Partial<StaffDto>, actor?: string | null) {
    const database = getDb();
    const current = database.prepare("SELECT * FROM staff WHERE id = ?").get(id) as any;
    if (!current) {
      throw new Error("staff-not-found");
    }
    const prepared = prepareStaffInput({
      name: updates.name === undefined ? current.name : updates.name,
      phone: updates.phone === undefined ? current.phone : updates.phone,
      designation: updates.designation === undefined ? current.designation : updates.designation,
      joiningDate: updates.joiningDate === undefined ? current.joining_date : updates.joiningDate,
      salary:
        updates.salary === undefined
          ? current.salary_paise === null || current.salary_paise === undefined
            ? null
            : paiseToRupees(current.salary_paise)
          : updates.salary,
      address: updates.address === undefined ? current.address : updates.address,
      notes: updates.notes === undefined ? current.notes : updates.notes,
      photoMime: updates.photoMime === undefined ? current.photo_mime : updates.photoMime,
      photoBase64: updates.photoBase64 === undefined ? current.photo_base64 : updates.photoBase64,
    });
    assertUniqueActiveStaffPhone(database, prepared.phone, id);
    const nextActive =
      updates.active === undefined ? Number(current.active) : updates.active ? 1 : 0;
    database
      .prepare(
        `UPDATE staff
         SET name = ?, phone = ?, designation = ?, joining_date = ?, salary_paise = ?,
             address = ?, notes = ?, photo_mime = ?, photo_base64 = ?, active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        prepared.name,
        prepared.phone,
        prepared.designation,
        prepared.joiningDate,
        prepared.salary === null ? null : rupeesToPaise(prepared.salary),
        prepared.address,
        prepared.notes,
        prepared.photoMime,
        prepared.photoBase64,
        nextActive,
        now(),
        id,
      );
    const changedFields = Object.keys(updates || {})
      .filter((field) => field !== "photoBase64")
      .sort();
    const action =
      changedFields.length === 1 &&
      changedFields[0] === "active" &&
      Number(current.active) !== nextActive
        ? nextActive
          ? "staff.restored"
          : "staff.marked_left"
        : "staff.updated";
    createAuditRow(database, action, "staff", id, actor || null, { fields: changedFields });
    return this.listStaff({ includeInactive: true }).find((staff) => staff.id === id) || null;
  },

  deleteStaff(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT id, active FROM staff WHERE id = ?").get(id) as any;
      if (!current) {
        throw new Error("staff-not-found");
      }
      database.prepare("DELETE FROM staff WHERE id = ?").run(id);
      createAuditRow(database, "staff.deleted", "staff", id, actor || null, {
        active: Boolean(current.active),
      });
      return { ok: true };
    });
  },

  addPrintJob(input: {
    printerName: string;
    jobType: PrintJobDto["jobType"];
    content: unknown;
    maxRetries?: number;
  }) {
    const id = `print-job:${randomUUID()}`;
    const at = now();
    getDb()
      .prepare(
        `INSERT INTO print_jobs (
          id, printer_key, job_type, payload_json, status, attempts, max_attempts, created_at
        ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(
        id,
        input.printerName,
        input.jobType,
        stringifyJson(input.content),
        input.maxRetries || 3,
        at,
      );
    return this.getPrintJob(id)!;
  },

  getPrintJob(id: string): PrintJobDto | null {
    const row = getDb().prepare("SELECT * FROM print_jobs WHERE id = ?").get(id) as any;
    return row ? printJobFromRow(row) : null;
  },

  listPrintJobs(status?: PrintJobDto["status"]) {
    const sql = status
      ? "SELECT * FROM print_jobs WHERE status = ? ORDER BY created_at ASC"
      : "SELECT * FROM print_jobs ORDER BY created_at ASC";
    const rows = status ? getDb().prepare(sql).all(status) : getDb().prepare(sql).all();
    return rows.map(printJobFromRow);
  },

  markPrintJobCompleted(id: string) {
    getDb()
      .prepare(
        "UPDATE print_jobs SET status = 'completed', completed_at = ?, error = NULL WHERE id = ?",
      )
      .run(now(), id);
    return this.getPrintJob(id);
  },

  retryPrintJob(id: string) {
    return inTransaction((database) => {
      const row = database.prepare("SELECT * FROM print_jobs WHERE id = ?").get(id) as any;
      if (!row) {
        return false;
      }
      const attempts = Number(row.attempts || 0) + 1;
      const failed = attempts >= Number(row.max_attempts || 3);
      database
        .prepare(
          "UPDATE print_jobs SET attempts = ?, last_retry_at = ?, status = ?, error = ? WHERE id = ?",
        )
        .run(
          attempts,
          now(),
          failed ? "failed" : "pending",
          failed ? "Max retries exceeded" : null,
          id,
        );
      return !failed;
    });
  },

  clearOldPrintJobs(ageHours = 24) {
    const cutoff = now() - ageHours * 60 * 60 * 1000;
    const result = getDb()
      .prepare("DELETE FROM print_jobs WHERE status IN ('completed', 'failed') AND created_at < ?")
      .run(cutoff);
    return result.changes;
  },

  async createLocalBackup(targetPath: string, actor?: string | null) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    await backupDatabase(targetPath);
    const bytes = fs.statSync(targetPath).size;
    const checksum = createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
    const id = `backup:${randomUUID()}`;
    getDb()
      .prepare(
        `INSERT INTO backup_records (
          id, destination, path_or_provider, status, checksum, size_bytes, created_by, created_at
        ) VALUES (?, 'local', ?, 'completed', ?, ?, ?, ?)`,
      )
      .run(id, targetPath, checksum, bytes, actor || null, now());
    return { ok: true, id, path: targetPath, checksum, sizeBytes: bytes };
  },

  async restoreLocalBackup(sourcePath: string, actor?: string | null) {
    const restored = await restoreDatabaseFromBackup(sourcePath);
    const id = `backup-restore:${randomUUID()}`;
    const restoredActor =
      actor && getDb().prepare("SELECT 1 FROM users WHERE username = ?").get(actor) ? actor : null;
    getDb()
      .prepare(
        `INSERT INTO backup_records (
          id, destination, path_or_provider, status, checksum, size_bytes, created_by, created_at
        ) VALUES (?, 'local-restore', ?, 'completed', NULL, NULL, ?, ?)`,
      )
      .run(id, sourcePath, restoredActor, now());
    createAuditRow(getDb(), "backup.restored", "backup", id, restoredActor, {
      sourcePath,
      preRestoreBackupPath: restored.preRestoreBackupPath,
    });
    return { ...restored, id };
  },

  listBackups() {
    return getDb().prepare("SELECT * FROM backup_records ORDER BY created_at DESC").all();
  },
};

function recordFailedLogin(key: string) {
  if (!loginAttempts[key]) {
    loginAttempts[key] = { count: 0, lockedUntil: 0 };
  }
  loginAttempts[key].count += 1;
  if (loginAttempts[key].count >= MAX_ATTEMPTS) {
    loginAttempts[key].lockedUntil = Date.now() + LOCKOUT_MS;
  }
}

function recordFailedRecovery(key: string) {
  if (!recoveryAttempts[key]) {
    recoveryAttempts[key] = { count: 0, lockedUntil: 0 };
  }
  recoveryAttempts[key].count += 1;
  if (recoveryAttempts[key].count >= MAX_ATTEMPTS) {
    recoveryAttempts[key].lockedUntil = Date.now() + LOCKOUT_MS;
  }
}

function ensureNotLastActiveAdmin(database: Database.Database, username: string) {
  const row = database
    .prepare(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND username <> ?",
    )
    .get(username) as { count: number };
  if (!row.count) {
    throw new Error("cannot-change-last-active-admin");
  }
}

function ensureCategory(database: Database.Database, category?: string | null) {
  const name = category?.trim();
  if (!name) {
    return null;
  }
  const id = slugId("cat", name);
  const at = now();
  database
    .prepare(
      `INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
       VALUES (?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM menu_categories), 1), 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = 1, updated_at = excluded.updated_at`,
    )
    .run(id, name, at, at);
  return id;
}

const STAFF_PHOTO_MAX_BYTES = 500 * 1024;
const STAFF_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STAFF_PHOTO_MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

function optionalText(value: unknown) {
  const text = normalizeText(value);
  return text || null;
}

function optionalLimitedText(value: unknown, limit: number, errorCode: string) {
  const text = optionalText(value);
  if (text && text.length > limit) {
    throw new Error(errorCode);
  }
  return text;
}

function optionalDateOnly(value: unknown) {
  const text = optionalText(value);
  if (!text) {
    return null;
  }
  if (!isValidDateOnly(text)) {
    throw new Error("staff-joining-date-invalid");
  }
  return text;
}

function optionalSalary(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const parsed = parseNonNegativeMoney(value);
  if (parsed === null) {
    throw new Error("staff-salary-invalid");
  }
  return parsed;
}

function base64ByteLength(value: string) {
  const clean = value.replace(/\s/g, "");
  if (!clean) {
    return 0;
  }
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function prepareStaffPhoto(inputMime: unknown, inputBase64: unknown) {
  let photoMime = optionalText(inputMime)?.toLowerCase() || null;
  let photoBase64 = String(inputBase64 ?? "").trim() || null;
  const dataUrlMatch = photoBase64?.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    photoMime = dataUrlMatch[1].toLowerCase();
    photoBase64 = dataUrlMatch[2];
  }
  if (!photoBase64) {
    return { photoMime: null, photoBase64: null };
  }
  const normalizedMime = photoMime ? STAFF_PHOTO_MIME_ALIASES[photoMime] || photoMime : null;
  const cleanBase64 = photoBase64.replace(/\s/g, "");
  if (!cleanBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64) || cleanBase64.length % 4 === 1) {
    throw new Error("staff-photo-invalid");
  }
  if (!normalizedMime || !STAFF_PHOTO_MIME_TYPES.has(normalizedMime)) {
    throw new Error("staff-photo-invalid");
  }
  if (base64ByteLength(cleanBase64) > STAFF_PHOTO_MAX_BYTES) {
    throw new Error("staff-photo-too-large");
  }
  return { photoMime: normalizedMime, photoBase64: cleanBase64 };
}

function prepareStaffInput(input: {
  name?: unknown;
  phone?: unknown;
  designation?: unknown;
  joiningDate?: unknown;
  salary?: unknown;
  address?: unknown;
  notes?: unknown;
  photoMime?: unknown;
  photoBase64?: unknown;
}) {
  const name = normalizeText(input.name);
  const phone = normalizePhone(input.phone);
  if (!isValidPersonName(name, { max: STAFF_TEXT_LIMITS.name })) {
    throw new Error("staff-name-invalid");
  }
  if (!isValidIndianMobile(phone)) {
    throw new Error("staff-phone-invalid");
  }
  return {
    name,
    phone,
    designation:
      optionalLimitedText(
        input.designation,
        STAFF_TEXT_LIMITS.designation,
        "staff-designation-too-long",
      ) || "",
    joiningDate: optionalDateOnly(input.joiningDate),
    salary: optionalSalary(input.salary),
    address: optionalLimitedText(
      input.address,
      STAFF_TEXT_LIMITS.address,
      "staff-address-too-long",
    ),
    notes: optionalLimitedText(input.notes, STAFF_TEXT_LIMITS.notes, "staff-notes-too-long"),
    ...prepareStaffPhoto(input.photoMime, input.photoBase64),
  };
}

function auditFromRow(row: any): AuditDto {
  return {
    _id: row.id,
    type: "audit",
    action: row.action,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    orderId: row.entity_type === "order" ? row.entity_id : null,
    user: row.user || null,
    detail: parseJson(row.detail_json, {}),
    timestamp: row.timestamp,
  };
}

function auditArchiveFromRow(row: any): AuditArchiveDto {
  return {
    _id: row.id,
    type: "audit-archive",
    startDate: row.start_date,
    endDate: row.end_date,
    count: row.count,
    archivedAt: row.archived_at,
    compressed: Boolean(row.compressed),
    fileSize: row.file_size,
  };
}

function customerFromRow(row: any): CustomerDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address || undefined,
    notes: row.notes || undefined,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function staffFromRow(row: any): StaffDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    designation: row.designation,
    joiningDate: row.joining_date || null,
    salary:
      row.salary_paise === null || row.salary_paise === undefined
        ? null
        : paiseToRupees(row.salary_paise),
    address: row.address || null,
    notes: row.notes || null,
    photoMime: row.photo_mime || null,
    photoBase64: row.photo_base64 || null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function groceryPurchaseFromRow(row: any): GroceryPurchaseLineDto {
  return {
    _id: row.id,
    id: row.id,
    type: "grocery-purchase",
    listId: row.list_id || null,
    groceryItemId: row.grocery_item_id || null,
    itemName: row.item_name,
    category: row.category || null,
    quantity: Number(row.quantity || 0),
    unit: normalizeGroceryUnit(row.unit),
    unitPrice:
      row.unit_price_paise === null || row.unit_price_paise === undefined
        ? null
        : paiseToRupees(row.unit_price_paise),
    totalAmount: paiseToRupees(row.total_paise),
    vendor: row.vendor || null,
    paymentMethod: row.payment_method || null,
    notes: row.notes || null,
    purchasedAt: row.purchased_at,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    active: Boolean(row.active),
  };
}

function groceryListLineFromRow(row: any): GroceryListLineDto {
  return {
    id: row.id,
    groceryItemId: row.grocery_item_id || null,
    itemName: row.item_name,
    category: row.category || null,
    quantity: Number(row.quantity || 0),
    unit: normalizeGroceryUnit(row.unit),
    vendorHint: row.vendor_hint || null,
    sortOrder: Number(row.sort_order || 0),
  };
}

function groceryListFromRow(database: Database.Database, row: any): GroceryListDto {
  const lines = database
    .prepare(
      "SELECT * FROM grocery_list_lines WHERE list_id = ? ORDER BY sort_order ASC, created_at ASC",
    )
    .all(row.id)
    .map(groceryListLineFromRow);
  return {
    _id: row.id,
    id: row.id,
    type: "grocery-list",
    title: row.title,
    listDate: row.list_date,
    status: row.status,
    lines,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function groceryPriceHint(database: Database.Database, row: any): GroceryItemDto["priceHint"] {
  const defaultUnit = normalizeGroceryUnit(row.default_unit);
  const purchases = database
    .prepare(
      `SELECT *
       FROM grocery_purchase_lines
       WHERE grocery_item_id = ?
       ORDER BY purchased_at DESC, created_at DESC
       LIMIT 100`,
    )
    .all(row.id) as any[];
  const last = purchases[0];
  const cutoff = now() - 30 * 24 * 60 * 60 * 1000;
  let totalPaise = 0;
  let totalQty = 0;
  purchases
    .filter((purchase) => Number(purchase.purchased_at || 0) >= cutoff)
    .forEach((purchase) => {
      const purchaseUnit = normalizeGroceryUnit(purchase.unit);
      const convertedQty = convertQuantityBetween(
        Number(purchase.quantity || 0),
        purchaseUnit,
        defaultUnit,
      );
      if (convertedQty !== null && convertedQty > 0) {
        totalQty += convertedQty;
        totalPaise += Number(purchase.total_paise || 0);
      }
    });
  return {
    lastUnitPrice:
      last?.unit_price_paise === null || last?.unit_price_paise === undefined
        ? null
        : paiseToRupees(last.unit_price_paise),
    lastUnit: last ? normalizeGroceryUnit(last.unit) : null,
    lastVendor: last?.vendor || null,
    lastPurchasedAt: last?.purchased_at || null,
    averageUnitPrice30d: totalQty > 0 ? paiseToRupees(Math.round(totalPaise / totalQty)) : null,
    averageUnit: totalQty > 0 ? defaultUnit : null,
  };
}

function groceryItemFromRow(
  database: Database.Database,
  row: any,
  includePriceHint = true,
): GroceryItemDto {
  return {
    _id: row.id,
    id: row.id,
    type: "grocery-item",
    name: row.name,
    category: row.category || null,
    defaultUnit: normalizeGroceryUnit(row.default_unit),
    defaultQuantity: Number(row.default_quantity || 1),
    vendorHint: row.vendor_hint || null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    priceHint: includePriceHint ? groceryPriceHint(database, row) : undefined,
  };
}

function printJobFromRow(row: any): PrintJobDto {
  return {
    _id: row.id,
    type: "print-job",
    printerName: row.printer_key,
    jobType: row.job_type,
    content: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
    retryCount: row.attempts,
    maxRetries: row.max_attempts,
    lastRetryAt: row.last_retry_at || undefined,
    completedAt: row.completed_at || undefined,
    status: row.status,
    error: row.error || undefined,
  };
}
