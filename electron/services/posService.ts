import "../env";
import fs from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
import type Database from "better-sqlite3";
import { backupDatabase, getDb, inTransaction, restoreDatabaseFromBackup } from "../db/sqlite";
import { buildGroceryPurchaseAnalysis, loadRecordedGroceryBills } from "./groceryPurchaseAnalysis";
import { buildSalesFacts, type SalesBillInput } from "./salesReport";
import { publishDomainEvent } from "./domainEvents";
import { destroyLanSessionsForUser } from "./lanSessionManager";
import { destroySessionsForUser } from "./sessionManager";
import {
  createCredentialHash,
  generateRecoveryCode,
  normalizeRecoveryCode,
  verifyCredential,
  verifyCredentialAgainstStored,
} from "./credentials";
import type {
  AuditArchiveDto,
  AuditDto,
  AttendanceDto,
  AttendanceStatus,
  BuyingListTemplateDto,
  BuyingListTemplateLineDto,
  ConfigDto,
  CustomerDto,
  ExpenseCategoryDto,
  ExpenseDto,
  FoodCostSummaryDto,
  GroceryItemDto,
  GroceryListDto,
  GroceryListLineDto,
  GroceryListStatus,
  GroceryListType,
  GroceryPurchaseDto,
  GroceryPurchaseAnalysisDto,
  GroceryPurchaseHeaderCreateInput,
  GroceryPurchaseHeaderUpdateInput,
  GroceryListLinesChange,
  GroceryPurchaseLineDto,
  GroceryPaymentStatus,
  GroceryPurchaseStatus,
  GroceryUnit,
  MenuItemDto,
  MenuItemVariantDto,
  OrderDto,
  OrderLineDto,
  OrderStatus,
  PaidOrderQueryDto,
  PaidOrdersSummaryDto,
  PaymentDto,
  PrintJobDto,
  ProductSalesReportDto,
  ProfitabilitySummaryDto,
  SalesFactsDto,
  Role,
  SalesSummaryDto,
  SalaryAdvanceDto,
  SeatingAreaDto,
  StaffDto,
  TableDto,
  UserDto,
  VendorDto,
} from "../../src/shared/pos";
import { getUnsentKotLines, isKotQueueTicket, kotLineCounts } from "../../src/shared/kot";
import { normalizeKitchenNote } from "../../src/shared/kitchenNote";
import {
  FLOOR_LAYOUT_LIMITS,
  formatTableLabel,
  planTablesFromAreas,
  type AreaTablePlan,
  type TableNamingMode,
} from "../../src/shared/floorLayout";
import { ROLE_KEYS, isDesktopLoginRole, LIVE_ACTIVITY_ACTIONS } from "../../src/shared/permissions";
import {
  ORDER_LIFECYCLE_AUDIT_ACTIONS,
  REPEATED_CANCELLATION_THRESHOLD,
  actorKey,
  buildReviewItems,
  orderHadKotSent,
  summarizeReviewItems,
  timelineActionLabel,
  type OrderTimelineEventDto,
  type ReviewItemDto,
  type ReviewRangeQuery,
  type ReviewSummaryDto,
  type ReviewDiscountEvent,
  type ReviewVoidEvent,
  type StaffActivityRowDto,
} from "../../src/shared/ownerReview";
import { publishOrdersChanged } from "./domainEvents";
import { TEXT_LIMITS } from "../../src/shared/textLimits";
import {
  CUSTOMER_NAME_LIMIT,
  PAYMENT_TXN_REF_LIMIT,
  STAFF_TEXT_LIMITS,
  isValidDateOnly,
  isFutureDateOnly,
  todayDateOnly,
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
  assertCreditConfig,
  buildCreditSaleDescription,
  CREDIT_CONFIG_KEY,
  normalizeCreditConfig,
  resolveCreditDueDate,
  type CustomerAccountEntryDto,
  type CustomerAccountSummaryDto,
  type CustomerAccountEntriesPageDto,
  type CustomerOpenBillDto,
  type ReceiveCustomerPaymentInput,
  type ReceiveCustomerPaymentResultDto,
  type VoidCustomerCreditSaleInput,
  type VoidCustomerCreditSaleResultDto,
} from "../../src/shared/customerCredit";
import {
  normalizeHolidayDates,
  normalizeWeeklyOffDays,
  serializeWeeklyOffDays,
} from "../../src/shared/attendanceSchedule";
import {
  calculateGstTotalsPaise,
  isValidGstin,
  normalizeGstConfig,
  normalizeOrderDiscount,
  orderDiscountsEqual,
  type GstConfig,
  type OrderDiscount,
} from "../../src/shared/gst";
import {
  menuMatchKey,
  normalizeMenuImportMode,
  validateMenuCsv,
  type MenuImportMode,
} from "../../src/shared/menuImport";
import {
  SERVICE_MODE_CONFIG_KEY,
  findServiceModeById,
  normalizeServiceModes,
  toLegacyOrderType,
  toServiceModeConfigDoc,
} from "../../src/shared/serviceModes";
import { resolveBusinessTimezone } from "../../src/shared/businessDateRange";
import { RECOVERY_CODE_COUNT } from "../../src/shared/auth";

const MAX_ATTEMPTS = Number(process.env.VITE_AUTH_MAX_ATTEMPTS || 5);
const LOCKOUT_MS = Number(process.env.VITE_AUTH_LOCKOUT_MS || 900_000);
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
const ATTENDANCE_STATUSES = new Set<AttendanceStatus>([
  "present",
  "absent",
  "half-day",
  "leave",
  "holiday",
]);
const DEFAULT_SHIFT_MINUTES = 8 * 60;
const DEFAULT_SEATING_AREA_ID = "area:main";
const DEFAULT_SEATING_AREA_NAME = "Main Dining";
const ACTIVE_ORDER_STATUSES = ["open", "held", "ready", "assigned"] as const;

const loginAttempts: Record<string, { count: number; lockedUntil: number }> = {};
const recoveryAttempts: Record<string, { count: number; lockedUntil: number }> = {};

function revokeLanUser(username: string, reason: "password-reset" | "signed-out") {
  const key = username.trim().toLowerCase();
  destroyLanSessionsForUser(key);
  publishDomainEvent("lan-sessions-revoked", { username: key, reason });
}

function normalizeModeId(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

function normalizeSeatingAreaId(value: unknown, fallback?: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9:_-]/g, "");
  if (normalized) {
    return normalized.startsWith("area:") ? normalized : `area:${normalized}`;
  }
  if (fallback) {
    return fallback;
  }
  return DEFAULT_SEATING_AREA_ID;
}

function normalizeSeatingAreaName(value: unknown, fallback?: string) {
  const name = normalizeText(value).slice(0, TEXT_LIMITS.areaName);
  return name || fallback || DEFAULT_SEATING_AREA_NAME;
}

function resolveServiceModeIdFromOrderLike(orderLike: any) {
  return normalizeModeId(orderLike?.meta?.serviceModeId || orderLike?.orderType || "");
}

function resolveLegacyOrderTypeForWrite(
  modeConfig: unknown,
  serviceModeId: string,
  tableId: number | null | undefined,
) {
  const resolvedMode = findServiceModeById(modeConfig, serviceModeId);
  if (resolvedMode) {
    return toLegacyOrderType(resolvedMode);
  }
  if (serviceModeId === "table" || serviceModeId === "takeaway" || serviceModeId === "delivery") {
    return serviceModeId;
  }
  if (tableId !== null && tableId !== undefined) {
    return "table";
  }
  return "takeaway";
}

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

function normalizeMenuVariants(input: unknown): MenuItemVariantDto[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  return input.map((raw, index) => {
    const name = normalizeText((raw as any)?.name);
    if (!name) {
      throw new Error("item-variant-name-required");
    }
    if (name.length > TEXT_LIMITS.menuVariant) {
      throw new Error("menu-variant-name-too-long");
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new Error("item-variant-duplicate");
    }
    seen.add(key);
    const price = parsePositiveMoney((raw as any)?.price);
    if (price === null) {
      throw new Error("item-variant-price-invalid");
    }
    const sortOrderRaw = Number((raw as any)?.sortOrder);
    return {
      id: String((raw as any)?.id || `item-variant:${randomUUID()}`),
      name,
      price,
      sortOrder: Number.isFinite(sortOrderRaw) ? Math.trunc(sortOrderRaw) : index,
    };
  });
}

function getItemVariantsMap(database: Database.Database, itemIds: string[]) {
  const map = new Map<string, MenuItemVariantDto[]>();
  if (!itemIds.length) {
    return map;
  }
  const placeholders = itemIds.map(() => "?").join(",");
  const rows = database
    .prepare(
      `SELECT id, menu_item_id, name, price_paise, sort_order
       FROM menu_item_variants
       WHERE menu_item_id IN (${placeholders})
       ORDER BY menu_item_id ASC, sort_order ASC, name COLLATE NOCASE ASC`,
    )
    .all(...itemIds) as any[];
  for (const row of rows) {
    const list = map.get(row.menu_item_id) || [];
    list.push({
      id: row.id,
      name: row.name,
      price: paiseToRupees(row.price_paise),
      sortOrder: Number(row.sort_order || 0),
    });
    map.set(row.menu_item_id, list);
  }
  return map;
}

function writeItemVariants(
  database: Database.Database,
  menuItemId: string,
  variants: MenuItemVariantDto[],
) {
  database.prepare("DELETE FROM menu_item_variants WHERE menu_item_id = ?").run(menuItemId);
  if (!variants.length) {
    return;
  }
  const insert = database.prepare(`
    INSERT INTO menu_item_variants (
      id, menu_item_id, name, price_paise, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const at = now();
  variants.forEach((variant, index) => {
    insert.run(
      variant.id,
      menuItemId,
      variant.name,
      rupeesToPaise(variant.price),
      Number.isFinite(Number(variant.sortOrder)) ? Math.trunc(Number(variant.sortOrder)) : index,
      at,
      at,
    );
  });
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

function parseExplicitReceivedQuantity(value: unknown) {
  const qty = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("grocery-received-quantity-invalid");
  }
  return Math.round(qty * 1000) / 1000;
}

function assertGroceryPurchaseDate(purchaseDate: number) {
  if (!Number.isFinite(purchaseDate) || purchaseDate <= 0) {
    throw new Error("grocery-date-invalid");
  }
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (purchaseDate > endOfToday.getTime()) {
    throw new Error("grocery-purchase-date-future");
  }
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
  const estimatedUnitPrice =
    input.estimatedUnitPrice === null ||
    input.estimatedUnitPrice === undefined ||
    String(input.estimatedUnitPrice).trim() === ""
      ? null
      : parseNonNegativeMoney(input.estimatedUnitPrice);
  const quantity = normalizeQuantity(input.quantity ?? 1);
  return {
    id: input.id || `grocery-list-line:${randomUUID()}`,
    groceryItemId: input.groceryItemId || null,
    itemName,
    category: optionalGroceryText(input.category, 80, "grocery-category-too-long"),
    quantity,
    unit: normalizeGroceryUnit(input.unit || "unit"),
    vendorHint: optionalGroceryText(input.vendorHint, 120, "grocery-vendor-too-long"),
    sortOrder: Number.isFinite(Number(input.sortOrder))
      ? Math.trunc(Number(input.sortOrder))
      : index,
    estimatedUnitPrice,
    estimatedTotal:
      estimatedUnitPrice !== null ? +(estimatedUnitPrice * quantity).toFixed(2) : null,
    purchasedQuantity:
      input.purchasedQuantity === null || input.purchasedQuantity === undefined
        ? null
        : Number(input.purchasedQuantity),
    purchasedUnitPrice:
      input.purchasedUnitPrice === null || input.purchasedUnitPrice === undefined
        ? null
        : parseNonNegativeMoney(input.purchasedUnitPrice),
    purchasedTotal:
      input.purchasedTotal === null || input.purchasedTotal === undefined
        ? null
        : parseNonNegativeMoney(input.purchasedTotal),
    lineStatus: (input.lineStatus as GroceryListLineDto["lineStatus"]) || "pending",
  };
}

function normalizeGroceryListStatus(value: unknown): GroceryListStatus {
  const status = String(value || "draft");
  if (status === "printed") {
    return "open";
  }
  if (status === "purchased") {
    return "completed";
  }
  if (
    status === "draft" ||
    status === "open" ||
    status === "partial" ||
    status === "completed" ||
    status === "cancelled"
  ) {
    return status;
  }
  return "draft";
}

function normalizeGroceryListType(value: unknown): GroceryListType {
  const type = String(value || "regular");
  if (type === "refill" || type === "emergency" || type === "custom" || type === "regular") {
    return type;
  }
  return "regular";
}

/**
 * Buying-list status is derived from covered list lines (except cancelled).
 * Call inside the same transaction as purchase create/void/line updates.
 */
function recalcGroceryListStatus(database: Database.Database, listId: string | null | undefined) {
  if (!listId) {
    return;
  }
  const list = database.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(listId) as any;
  if (!list) {
    return;
  }
  const current = normalizeGroceryListStatus(list.status);
  if (current === "cancelled") {
    return;
  }

  const lines = database
    .prepare(`SELECT line_status FROM grocery_list_lines WHERE list_id = ? ORDER BY sort_order ASC`)
    .all(listId) as Array<{ line_status: string }>;

  const actionable = lines.filter((line) => line.line_status !== "skipped");
  const coveredCount = actionable.filter((line) => line.line_status === "purchased").length;
  const pendingCount = actionable.length - coveredCount;

  let next: GroceryListStatus;
  if (actionable.length === 0) {
    next = "draft";
  } else if (coveredCount === 0) {
    next = "open";
  } else if (pendingCount === 0) {
    next = "completed";
  } else {
    next = "partial";
  }

  if (next === current) {
    if (next === "completed" && !list.completed_at) {
      database
        .prepare(`UPDATE grocery_lists SET completed_at = ?, updated_at = ? WHERE id = ?`)
        .run(now(), now(), listId);
    }
    return;
  }
  const at = now();
  const completedAt = next === "completed" ? list.completed_at || at : null;
  database
    .prepare(`UPDATE grocery_lists SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
    .run(next, completedAt, at, listId);
  if (next === "completed" && current !== "completed") {
    createAuditRow(database, "grocery.list.completed", "grocery-list", listId, null, {
      derived: true,
    });
  }
}

function groceryLineCounts(lines: Array<{ lineStatus?: string | null }>) {
  const actionable = lines.filter((line) => line.lineStatus !== "skipped");
  const purchasedCount = actionable.filter((line) => line.lineStatus === "purchased").length;
  return {
    itemCount: lines.length,
    purchasedCount,
    pendingCount: Math.max(0, actionable.length - purchasedCount),
  };
}

function groceryListSpendPaise(database: Database.Database, listId: string) {
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(total_paise), 0) AS total_paise
       FROM grocery_purchases
       WHERE buying_list_id = ? AND status = 'recorded'`,
    )
    .get(listId) as { total_paise: number };
  return Number(row?.total_paise || 0);
}

function batchGroceryListSpend(
  database: Database.Database,
  listIds: string[],
): Map<string, number> {
  const spend = new Map<string, number>();
  if (!listIds.length) {
    return spend;
  }
  const placeholders = listIds.map(() => "?").join(",");
  const rows = database
    .prepare(
      `SELECT buying_list_id AS list_id, COALESCE(SUM(total_paise), 0) AS total_paise
       FROM grocery_purchases
       WHERE buying_list_id IN (${placeholders}) AND status = 'recorded'
       GROUP BY buying_list_id`,
    )
    .all(...listIds) as Array<{ list_id: string; total_paise: number }>;
  for (const row of rows) {
    spend.set(row.list_id, Number(row.total_paise || 0));
  }
  return spend;
}

function isCoveredGroceryListLine(line: { line_status?: string | null }) {
  return line.line_status === "purchased";
}

function pendingGroceryListLines(database: Database.Database, listId: string) {
  return database
    .prepare(
      `SELECT * FROM grocery_list_lines
       WHERE list_id = ?
         AND line_status != 'purchased'
         AND line_status != 'skipped'
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(listId) as any[];
}

function coverGroceryListLine(
  database: Database.Database,
  line: any,
  at: number,
  purchased: { quantity: number; unitPricePaise: number | null; totalPaise: number },
) {
  database
    .prepare(
      `UPDATE grocery_list_lines
       SET line_status = 'purchased',
           purchased_quantity = ?,
           purchased_unit_price_paise = ?,
           purchased_total_paise = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      purchased.quantity,
      purchased.unitPricePaise,
      purchased.totalPaise > 0 ? purchased.totalPaise : null,
      at,
      line.id,
    );
}

function insertGroceryPurchaseLine(
  database: Database.Database,
  row: {
    id: string;
    purchaseId: string;
    listId: string | null;
    listLineId: string | null;
    groceryItemId: string | null;
    itemName: string;
    category: string | null;
    quantity: number;
    unit: string;
    unitPricePaise: number | null;
    totalPaise: number;
    vendor: string | null;
    vendorId: string | null;
    paymentMethod: string | null;
    notes: string | null;
    purchasedAt: number;
    actor: string | null;
    at: number;
  },
) {
  database
    .prepare(
      `INSERT INTO grocery_purchase_lines (
        id, purchase_id, list_id, list_line_id, grocery_item_id, item_name, category, quantity, unit,
        unit_price_paise, total_paise, vendor, vendor_id, payment_method, notes, purchased_at,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.purchaseId,
      row.listId,
      row.listLineId,
      row.groceryItemId,
      row.itemName,
      row.category,
      row.quantity,
      row.unit,
      row.unitPricePaise,
      row.totalPaise,
      row.vendor,
      row.vendorId,
      row.paymentMethod,
      row.notes,
      row.purchasedAt,
      row.actor,
      row.at,
      row.at,
    );
}

function resolvePurchaseVendor(
  database: Database.Database,
  input: { vendorId?: string | null; vendorName?: string | null },
  actor: string | null,
  at: number,
) {
  const vendorId = normalizeText(input.vendorId);
  const vendorName = normalizeText(input.vendorName);
  if (vendorId && vendorName) {
    throw new Error("grocery-vendor-id-and-name");
  }
  if (vendorId) {
    const existing = database
      .prepare(`SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL`)
      .get(vendorId) as { id: string } | undefined;
    if (!existing) {
      throw new Error("grocery-vendor-not-found");
    }
    return vendorId;
  }
  if (vendorName) {
    return ensureVendorId(database, vendorName, actor, at);
  }
  return null;
}

function mergeGroceryListLines(
  database: Database.Database,
  listId: string,
  proposed: Partial<GroceryListLineDto>[],
  at: number,
) {
  const existing = database
    .prepare(`SELECT * FROM grocery_list_lines WHERE list_id = ?`)
    .all(listId) as any[];
  const existingById = new Map(existing.map((row) => [row.id as string, row]));
  const seen = new Set<string>();

  proposed.forEach((raw, index) => {
    const prepared = prepareGroceryListLineInput(raw, index);
    const current = existingById.get(prepared.id);
    if (current && isCoveredGroceryListLine(current)) {
      if (Number(current.quantity) !== Number(prepared.quantity) || current.unit !== prepared.unit) {
        throw new Error("grocery-list-line-covered");
      }
      database
        .prepare(`UPDATE grocery_list_lines SET sort_order = ?, updated_at = ? WHERE id = ?`)
        .run(index, at, current.id);
      seen.add(current.id);
      return;
    }
    if (current) {
      database
        .prepare(
          `UPDATE grocery_list_lines
           SET grocery_item_id = ?, item_name = ?, category = ?, quantity = ?, unit = ?, vendor_hint = ?,
               sort_order = ?, estimated_unit_price_paise = ?, estimated_total_paise = ?,
               line_status = 'pending', updated_at = ?
           WHERE id = ?`,
        )
        .run(
          prepared.groceryItemId || null,
          prepared.itemName,
          prepared.category || null,
          prepared.quantity,
          prepared.unit,
          prepared.vendorHint || null,
          index,
          prepared.estimatedUnitPrice == null ? null : rupeesToPaise(prepared.estimatedUnitPrice),
          prepared.estimatedTotal == null ? null : rupeesToPaise(prepared.estimatedTotal),
          at,
          current.id,
        );
      seen.add(current.id);
      return;
    }
    const id = prepared.id.startsWith("grocery-list-line:")
      ? prepared.id
      : `grocery-list-line:${randomUUID()}`;
    database
      .prepare(
        `INSERT INTO grocery_list_lines (
          id, list_id, grocery_item_id, item_name, category, quantity, unit, vendor_hint,
          sort_order, estimated_unit_price_paise, estimated_total_paise,
          purchased_quantity, purchased_unit_price_paise, purchased_total_paise, line_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'pending', ?, ?)`,
      )
      .run(
        id,
        listId,
        prepared.groceryItemId || null,
        prepared.itemName,
        prepared.category || null,
        prepared.quantity,
        prepared.unit,
        prepared.vendorHint || null,
        index,
        prepared.estimatedUnitPrice == null ? null : rupeesToPaise(prepared.estimatedUnitPrice),
        prepared.estimatedTotal == null ? null : rupeesToPaise(prepared.estimatedTotal),
        at,
        at,
      );
    seen.add(id);
  });

  for (const row of existing) {
    if (seen.has(row.id)) {
      continue;
    }
    if (isCoveredGroceryListLine(row)) {
      continue;
    }
    database.prepare(`DELETE FROM grocery_list_lines WHERE id = ?`).run(row.id);
  }
}

function derivePaymentStatus(totalPaise: number, amountPaidPaise: number): GroceryPaymentStatus {
  if (amountPaidPaise <= 0) {
    return "pending";
  }
  if (amountPaidPaise >= totalPaise) {
    return "paid";
  }
  return "partial";
}

function assertAmountPaidValid(totalPaise: number, amountPaidPaise: number) {
  if (amountPaidPaise < 0) {
    throw new Error("grocery-amount-paid-invalid");
  }
  if (amountPaidPaise > totalPaise) {
    throw new Error("grocery-amount-paid-exceeds-total");
  }
}

function ensureVendorId(
  database: Database.Database,
  vendorName: string | null | undefined,
  actor: string | null,
  at: number,
): string | null {
  const name = normalizeText(vendorName);
  if (!name) {
    return null;
  }
  const existing = database
    .prepare(`SELECT id FROM vendors WHERE deleted_at IS NULL AND name = ? COLLATE NOCASE LIMIT 1`)
    .get(name) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }
  const id = `vendor:${randomUUID()}`;
  database
    .prepare(
      `INSERT INTO vendors (id, name, active, created_by, created_at, updated_at, deleted_at)
       VALUES (?, ?, 1, ?, ?, ?, NULL)`,
    )
    .run(id, name, actor, at, at);
  createAuditRow(database, "vendor.created", "vendor", id, actor, { name, source: "auto" });
  return id;
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
  if (password.length > TEXT_LIMITS.password) {
    throw new Error("password-too-long");
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

function assertValidRole(role: Role) {
  if (!ROLE_KEYS.includes(role)) {
    throw new Error("invalid-role");
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
    staffId: row.staff_id || null,
    linkedStaffName: row.linked_staff_name || null,
  };
}

function tableFromRow(row: any): TableDto {
  return {
    _id: `table:${row.id}`,
    type: "table",
    id: row.id,
    name: row.name || `Table ${row.id}`,
    seats: row.seats,
    areaId: String(row.area_id || DEFAULT_SEATING_AREA_ID),
    areaName: String(row.area_name || ""),
    order: row.sort_order,
    active: Boolean(row.active),
  };
}

function seatingAreaFromRow(row: any): SeatingAreaDto {
  return {
    _id: `seating-area:${row.id}`,
    type: "seating-area",
    id: String(row.id),
    name: String(row.name || DEFAULT_SEATING_AREA_NAME),
    order: Number(row.sort_order || 0),
    active: Boolean(row.active),
  };
}

function normalizeMenuDiet(value: unknown, whenMissing: string | null) {
  if (value === undefined) {
    return whenMissing;
  }
  const diet = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!diet) {
    return null;
  }
  if (diet === "veg" || diet === "non-veg" || diet === "egg") {
    return diet;
  }
  throw new Error("item-diet-invalid");
}

function nextItemSortOrder(database: Database.Database, categoryId: string | null) {
  const row = (
    categoryId
      ? database
          .prepare("SELECT COALESCE(MAX(sort_order), 0) AS sort_order FROM menu_items WHERE category_id = ?")
          .get(categoryId)
      : database
          .prepare(
            "SELECT COALESCE(MAX(sort_order), 0) AS sort_order FROM menu_items WHERE category_id IS NULL",
          )
          .get()
  ) as { sort_order?: number } | undefined;
  return Number(row?.sort_order || 0) + 1;
}

function itemFromRow(row: any, variants: MenuItemVariantDto[] = []): MenuItemDto {
  return {
    _id: row.id,
    type: "item",
    sku: row.sku || undefined,
    name: row.name,
    category: row.category_name || undefined,
    price: paiseToRupees(row.price_paise),
    available: Boolean(row.available),
    favorite: Boolean(row.favorite),
    taxRateBps: row.tax_rate_bps == null ? undefined : Number(row.tax_rate_bps),
    sortOrder: Number(row.sort_order || 0),
    diet: row.diet || null,
    variants,
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
    taxRateBps: row.tax_rate_bps == null ? undefined : Number(row.tax_rate_bps),
    kotPrintedQty: Number(row.kot_printed_qty || 0),
    kitchenNote: normalizeKitchenNote(row.kitchen_note),
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
  return normalizeGstConfig(row?.value_json ? parseJson(row.value_json, null) : null);
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

type AttendanceShiftConfig = {
  id: string;
  label: string;
  hours: number;
};

type AttendanceConfig = {
  shifts: AttendanceShiftConfig[];
  holidays: string[];
};

function defaultAttendanceShifts(): AttendanceShiftConfig[] {
  return [
    { id: "morning", label: "Morning", hours: 8 },
    { id: "evening", label: "Evening", hours: 8 },
    { id: "night", label: "Night", hours: 8 },
  ];
}

function assertAttendanceConfig(input: Record<string, unknown>) {
  const source = Array.isArray((input as any)?.shifts)
    ? ((input as any).shifts as Array<Record<string, unknown>>)
    : defaultAttendanceShifts();
  const shifts: AttendanceShiftConfig[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    const id = normalizeText(raw?.id).toLowerCase();
    const label = normalizeText(raw?.label);
    const hours = Number(raw?.hours);
    if (!id || !label) {
      throw new Error("attendance-shift-invalid");
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      throw new Error("attendance-shift-hours-invalid");
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    shifts.push({ id, label, hours: Math.round(hours * 100) / 100 });
  }
  if (!shifts.length) {
    throw new Error("attendance-shift-invalid");
  }
  return { shifts, holidays: normalizeHolidayDates((input as any)?.holidays) };
}

function getAttendanceShiftHours(database: Database.Database, shiftId?: string | null) {
  const key = String(shiftId || "")
    .trim()
    .toLowerCase();
  if (!key) {
    return DEFAULT_SHIFT_MINUTES;
  }
  const cfg = parseJson<any>(
    (
      database.prepare("SELECT value_json FROM settings WHERE key = ?").get("config:attendance") as
        | { value_json?: string }
        | undefined
    )?.value_json,
    { shifts: defaultAttendanceShifts() },
  );
  const shifts = Array.isArray(cfg?.shifts) ? cfg.shifts : defaultAttendanceShifts();
  const match = shifts.find((shift: any) => String(shift?.id || "").toLowerCase() === key);
  if (!match) {
    if (key === "half" || key === "half-day") {
      return 4 * 60;
    }
    return DEFAULT_SHIFT_MINUTES;
  }
  const hours = Number(match.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return DEFAULT_SHIFT_MINUTES;
  }
  return Math.max(0, Math.trunc(hours * 60));
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

function discountFromOrder(
  order:
    | {
        discountMode?: string | null;
        discountPercent?: number | null;
        discountAmount?: number | null;
      }
    | null
    | undefined,
) {
  return normalizeOrderDiscount({
    mode: order?.discountMode === "amount" ? "amount" : "percent",
    percent: Number(order?.discountPercent || 0),
    amount: Number(order?.discountAmount || 0),
  });
}

function discountFromRow(row: { discount_mode?: string | null; discount_percent?: number | null; discount_amount_paise?: number | null } | null | undefined) {
  return normalizeOrderDiscount({
    mode: row?.discount_mode === "amount" ? "amount" : "percent",
    percent: Number(row?.discount_percent || 0),
    amount: paiseToRupees(row?.discount_amount_paise),
  });
}

function discountAuditDetail(previous: OrderDiscount, next: OrderDiscount) {
  return {
    previousDiscountMode: previous.mode,
    previousDiscountPercent: previous.percent,
    previousDiscountAmount: previous.amount,
    discountMode: next.mode,
    discountPercent: next.percent,
    discountAmount: next.amount,
  };
}

function computeOrderTotals(
  lines: OrderLineDto[],
  discount: number | Partial<OrderDiscount> = 0,
  gstConfig?: Partial<GstConfig> | null,
) {
  const totals = calculateGstTotalsPaise(
    lines,
    discount,
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
  const meta = parseJson(row.meta_json, {});
  const discount = discountFromRow(row);
  const tableId = row.table_id === null || row.table_id === undefined ? null : Number(row.table_id);
  let tableName: string | null = null;
  if (tableId !== null && Number.isFinite(tableId)) {
    const tableRow = database
      .prepare("SELECT name FROM tables WHERE id = ? LIMIT 1")
      .get(tableId) as { name?: string } | undefined;
    tableName = tableRow?.name ? String(tableRow.name) : null;
  }
  return {
    _id: row.id,
    type: "order",
    orderType:
      resolveServiceModeIdFromOrderLike({ orderType: row.order_type, meta }) || row.order_type,
    tableId,
    tableName,
    customerId: row.customer_id || null,
    status: row.status,
    kotStatus: row.kot_status,
    kotSent: row.kot_status === "sent" || row.kot_status === "printed",
    kotPrinted: row.kot_status === "printed",
    items: lines,
    payments,
    discountMode: discount.mode,
    discountPercent: discount.percent,
    discountAmount: discount.amount,
    subtotal: paiseToRupees(row.subtotal_paise),
    taxTotal: paiseToRupees(row.tax_total_paise),
    discountTotal: paiseToRupees(row.discount_total_paise),
    total: paiseToRupees(row.total_paise),
    invoiceNumber: row.invoice_number || null,
    paidAt: row.paid_at || null,
    cancelledAt: row.cancelled_at || null,
    cancelledBy: row.cancelled_by || null,
    cancellationReason: row.cancellation_reason || null,
    meta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || null,
  };
}

function paidOrderTimeExpression() {
  // History / sales day should follow when the bill was settled (incl. credit).
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
    clauses.push(`${paidAt} < ?`);
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

function buildAuditFtsQuery(search: string): string | null {
  const tokens = String(search || "")
    .trim()
    .toLowerCase()
    .replace(/["*()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) {
    return null;
  }
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(" ");
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
    const ftsQuery = buildAuditFtsQuery(query.search);
    if (ftsQuery) {
      clauses.push("id IN (SELECT audit_id FROM audit_logs_fts WHERE audit_logs_fts MATCH ?)");
      params.push(ftsQuery);
    } else {
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

function getCreditConfigFromDb(database: Database.Database = getDb()) {
  const row = database
    .prepare("SELECT value_json FROM settings WHERE key = ?")
    .get(CREDIT_CONFIG_KEY) as { value_json?: string } | undefined;
  return normalizeCreditConfig(row?.value_json ? parseJson(row.value_json, {}) : null);
}

function customerAccountEntryFromRow(row: any): CustomerAccountEntryDto {
  return {
    id: row.id,
    customerId: row.customer_id,
    entryType: row.entry_type,
    amount: paiseToRupees(row.amount_paise),
    runningBalance: paiseToRupees(row.running_balance_paise),
    orderId: row.order_id || null,
    invoiceNumber: row.invoice_number || null,
    description: row.description || null,
    dueDate: row.due_date || null,
    remaining:
      row.remaining_paise === null || row.remaining_paise === undefined
        ? null
        : paiseToRupees(row.remaining_paise),
    paymentMethod: row.payment_method || null,
    reference: row.reference || null,
    notes: row.notes || null,
    createdAt: Number(row.created_at || 0),
    createdBy: row.created_by || null,
  };
}

function sumCustomerOverduePaise(database: Database.Database, customerId: string) {
  const businessDate = todayDateOnly();
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(remaining_paise), 0) AS overdue_paise
       FROM customer_account_entries
       WHERE customer_id = ?
         AND entry_type = 'credit_sale'
         AND remaining_paise > 0
         AND due_date IS NOT NULL
         AND due_date < ?`,
    )
    .get(customerId, businessDate) as { overdue_paise: number };
  return Math.max(0, Number(row?.overdue_paise || 0));
}

function refreshCustomerOutstanding(
  database: Database.Database,
  customerId: string,
  outstandingPaise: number,
) {
  database
    .prepare("UPDATE customers SET outstanding_paise = ?, updated_at = ? WHERE id = ?")
    .run(Math.max(0, outstandingPaise), now(), customerId);
}

function sumOpenCreditRemainingPaise(database: Database.Database, customerId: string) {
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(remaining_paise), 0) AS remaining_paise
       FROM customer_account_entries
       WHERE customer_id = ?
         AND entry_type = 'credit_sale'
         AND remaining_paise > 0`,
    )
    .get(customerId) as { remaining_paise?: number } | undefined;
  return Math.max(0, Number(row?.remaining_paise || 0));
}

function refreshCustomerOutstandingFromLedger(database: Database.Database, customerId: string) {
  const outstandingPaise = sumOpenCreditRemainingPaise(database, customerId);
  refreshCustomerOutstanding(database, customerId, outstandingPaise);
  return outstandingPaise;
}

function orderHasOpenCreditBalance(database: Database.Database, orderId: string) {
  const row = database
    .prepare(
      `SELECT remaining_paise
       FROM customer_account_entries
       WHERE order_id = ? AND entry_type = 'credit_sale'
       LIMIT 1`,
    )
    .get(orderId) as { remaining_paise?: number } | undefined;
  return Number(row?.remaining_paise || 0) > 0;
}

function createCreditSaleLedgerEntry(
  database: Database.Database,
  opts: {
    customerId: string;
    orderId: string;
    amountPaise: number;
    invoiceNumber: string | null;
    description: string;
    dueDate: string;
    actor: string | null;
  },
) {
  const customer = database
    .prepare("SELECT * FROM customers WHERE id = ? AND active = 1 LIMIT 1")
    .get(opts.customerId) as any;
  if (!customer) {
    throw new Error("customer-not-found");
  }
  if (!Number(customer.credit_enabled)) {
    throw new Error("credit-not-enabled-for-customer");
  }
  if (Number(customer.credit_blocked)) {
    throw new Error("credit-customer-blocked");
  }
  const limitPaise = Math.max(0, Number(customer.credit_limit_paise || 0));
  const currentOutstanding = sumOpenCreditRemainingPaise(database, opts.customerId);
  if (limitPaise <= 0 || currentOutstanding + opts.amountPaise > limitPaise) {
    throw new Error("credit-limit-exceeded");
  }

  const entryId = `credit-entry:${randomUUID()}`;
  const nextOutstanding = currentOutstanding + opts.amountPaise;
  database
    .prepare(
      `INSERT INTO customer_account_entries (
         id, customer_id, entry_type, amount_paise, running_balance_paise,
         order_id, invoice_number, description, due_date, remaining_paise,
         payment_method, reference, notes, created_at, created_by
       ) VALUES (?, ?, 'credit_sale', ?, ?, ?, ?, ?, ?, ?, 'credit', ?, NULL, ?, ?)`,
    )
    .run(
      entryId,
      opts.customerId,
      opts.amountPaise,
      nextOutstanding,
      opts.orderId,
      opts.invoiceNumber,
      opts.description,
      opts.dueDate,
      opts.amountPaise,
      opts.invoiceNumber,
      now(),
      opts.actor,
    );
  const reconciled = refreshCustomerOutstandingFromLedger(database, opts.customerId);
  createAuditRow(database, "customer.credit.sale", "customer", opts.customerId, opts.actor, {
    entryId,
    orderId: opts.orderId,
    amountPaise: opts.amountPaise,
    dueDate: opts.dueDate,
    invoiceNumber: opts.invoiceNumber,
    outstandingPaise: reconciled,
  });
  return entryId;
}

function allocateCustomerPaymentFifo(
  database: Database.Database,
  paymentEntryId: string,
  customerId: string,
  amountPaise: number,
): Array<{ creditEntryId: string; invoiceNumber: string | null; amountPaise: number }> {
  let remainingToApply = amountPaise;
  const allocations: Array<{
    creditEntryId: string;
    invoiceNumber: string | null;
    amountPaise: number;
  }> = [];
  const openCredits = database
    .prepare(
      `SELECT id, remaining_paise, invoice_number
       FROM customer_account_entries
       WHERE customer_id = ?
         AND entry_type = 'credit_sale'
         AND remaining_paise > 0
       ORDER BY COALESCE(due_date, '9999-12-31') ASC, created_at ASC, id ASC`,
    )
    .all(customerId) as Array<{
    id: string;
    remaining_paise: number;
    invoice_number: string | null;
  }>;

  for (const credit of openCredits) {
    if (remainingToApply <= 0) {
      break;
    }
    const creditRemaining = Math.max(0, Number(credit.remaining_paise || 0));
    if (creditRemaining <= 0) {
      continue;
    }
    const apply = Math.min(creditRemaining, remainingToApply);
    database
      .prepare(
        `INSERT INTO customer_credit_allocations (
           id, payment_entry_id, credit_entry_id, amount_paise, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(`credit-alloc:${randomUUID()}`, paymentEntryId, credit.id, apply, now());
    database
      .prepare("UPDATE customer_account_entries SET remaining_paise = ? WHERE id = ?")
      .run(creditRemaining - apply, credit.id);
    allocations.push({
      creditEntryId: credit.id,
      invoiceNumber: credit.invoice_number || null,
      amountPaise: apply,
    });
    remainingToApply -= apply;
  }
  if (remainingToApply > 0) {
    throw new Error("credit-allocation-incomplete");
  }
  return allocations;
}

function receiveCustomerAccountPayment(
  database: Database.Database,
  customerId: string,
  input: ReceiveCustomerPaymentInput,
  actor?: string | null,
) {
  const customer = database
    .prepare("SELECT * FROM customers WHERE id = ? AND active = 1 LIMIT 1")
    .get(customerId) as any;
  if (!customer) {
    throw new Error("customer-not-found");
  }
  const amountPaise = rupeesToPaise(input.amount);
  if (!amountPaise || amountPaise <= 0) {
    throw new Error("credit-amount-invalid");
  }
  const outstanding = sumOpenCreditRemainingPaise(database, customerId);
  if (amountPaise > outstanding) {
    throw new Error("credit-amount-exceeds-outstanding");
  }
  const method = String(input.method || "")
    .trim()
    .toLowerCase();
  if (!["cash", "upi", "card", "other"].includes(method)) {
    throw new Error("credit-payment-method-invalid");
  }

  const provisionalOutstanding = outstanding - amountPaise;
  const entryId = `credit-entry:${randomUUID()}`;
  const reference = optionalGroceryText(input.reference, 80, "credit-reference-too-long") || null;
  const notes = optionalGroceryText(input.notes, 500, "credit-notes-too-long") || null;
  database
    .prepare(
      `INSERT INTO customer_account_entries (
         id, customer_id, entry_type, amount_paise, running_balance_paise,
         order_id, invoice_number, description, due_date, remaining_paise,
         payment_method, reference, notes, created_at, created_by
       ) VALUES (?, ?, 'payment_received', ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      entryId,
      customerId,
      amountPaise,
      provisionalOutstanding,
      `Payment received (${method.toUpperCase()})`,
      method,
      reference,
      notes,
      now(),
      actor || null,
    );
  const allocations = allocateCustomerPaymentFifo(database, entryId, customerId, amountPaise);
  const nextOutstanding = refreshCustomerOutstandingFromLedger(database, customerId);
  if (nextOutstanding !== provisionalOutstanding) {
    database
      .prepare("UPDATE customer_account_entries SET running_balance_paise = ? WHERE id = ?")
      .run(nextOutstanding, entryId);
  }
  createAuditRow(database, "customer.credit.payment", "customer", customerId, actor || null, {
    entryId,
    amountPaise,
    method,
    outstandingPaise: nextOutstanding,
    reference,
  });
  return {
    entryId,
    amountPaise,
    method,
    outstandingPaise: nextOutstanding,
    allocations,
  };
}

function voidCustomerCreditSaleEntry(
  database: Database.Database,
  creditEntryId: string,
  input: VoidCustomerCreditSaleInput,
  actor?: string | null,
) {
  const credit = database
    .prepare(
      `SELECT *
       FROM customer_account_entries
       WHERE id = ? AND entry_type = 'credit_sale'
       LIMIT 1`,
    )
    .get(creditEntryId) as any;
  if (!credit) {
    throw new Error("credit-sale-not-found");
  }
  const remainingPaise = Math.max(0, Number(credit.remaining_paise || 0));
  if (remainingPaise <= 0) {
    throw new Error("credit-sale-already-settled");
  }
  const customerId = String(credit.customer_id);
  const customer = database
    .prepare("SELECT id FROM customers WHERE id = ? AND active = 1 LIMIT 1")
    .get(customerId) as { id: string } | undefined;
  if (!customer) {
    throw new Error("customer-not-found");
  }
  const reason = optionalGroceryText(input.reason, 500, "credit-void-reason-too-long") || null;

  database
    .prepare("UPDATE customer_account_entries SET remaining_paise = 0 WHERE id = ?")
    .run(creditEntryId);

  const nextOutstanding = sumOpenCreditRemainingPaise(database, customerId);
  const voidEntryId = `credit-entry:${randomUUID()}`;
  const invoiceLabel = credit.invoice_number ? ` ${credit.invoice_number}` : "";
  database
    .prepare(
      `INSERT INTO customer_account_entries (
         id, customer_id, entry_type, amount_paise, running_balance_paise,
         order_id, invoice_number, description, due_date, remaining_paise,
         payment_method, reference, notes, created_at, created_by
       ) VALUES (?, ?, 'void', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
    )
    .run(
      voidEntryId,
      customerId,
      remainingPaise,
      nextOutstanding,
      credit.order_id || null,
      credit.invoice_number || null,
      `Void credit sale${invoiceLabel}`,
      credit.invoice_number || null,
      reason,
      now(),
      actor || null,
    );
  refreshCustomerOutstanding(database, customerId, nextOutstanding);

  if (credit.order_id) {
    const orderRow = database
      .prepare("SELECT meta_json FROM orders WHERE id = ? LIMIT 1")
      .get(credit.order_id) as { meta_json?: string } | undefined;
    if (orderRow) {
      const meta = parseJson(orderRow.meta_json, {}) as Record<string, unknown>;
      const previousCredit = (
        meta.credit && typeof meta.credit === "object" ? meta.credit : {}
      ) as Record<string, unknown>;
      meta.credit = {
        ...previousCredit,
        voided: true,
        voidedAt: now(),
        voidedBy: actor || null,
        voidedAmountPaise: remainingPaise,
        voidEntryId,
      };
      database
        .prepare("UPDATE orders SET meta_json = ?, updated_at = ? WHERE id = ?")
        .run(stringifyJson(meta), now(), credit.order_id);
    }
  }

  createAuditRow(database, "customer.credit.voided", "customer", customerId, actor || null, {
    voidEntryId,
    creditEntryId,
    orderId: credit.order_id || null,
    amountPaise: remainingPaise,
    outstandingPaise: nextOutstanding,
    reason,
  });

  return {
    voidEntryId,
    creditEntryId,
    amountPaise: remainingPaise,
    outstandingPaise: nextOutstanding,
    customerId,
  };
}

function relinkCreditLedgerOnOrderRestore(database: Database.Database, order: OrderDto) {
  const customerId = order.customerId || null;
  if (!customerId) {
    return;
  }
  const hasCreditPayment = (order.payments || []).some(
    (payment) => String(payment?.method || "").toLowerCase() === "credit",
  );
  if (!hasCreditPayment) {
    return;
  }
  const invoiceNumber = getOrderInvoiceNumber(order);
  const amountPaise = rupeesToPaise(Number(order.total || 0));
  if (invoiceNumber) {
    const byInvoice = database
      .prepare(
        `UPDATE customer_account_entries
         SET order_id = ?
         WHERE customer_id = ?
           AND entry_type = 'credit_sale'
           AND order_id IS NULL
           AND invoice_number = ?`,
      )
      .run(order._id, customerId, invoiceNumber);
    if (byInvoice.changes > 0) {
      return;
    }
  }
  database
    .prepare(
      `UPDATE customer_account_entries
       SET order_id = ?
       WHERE id = (
         SELECT id FROM customer_account_entries
         WHERE customer_id = ?
           AND entry_type = 'credit_sale'
           AND order_id IS NULL
           AND amount_paise = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )`,
    )
    .run(order._id, customerId, amountPaise);
}

function lookupActorRole(database: Database.Database, username?: string | null): Role | null {
  const key = normalizeText(username)?.toLowerCase();
  if (!key) {
    return null;
  }
  const row = database.prepare("SELECT role FROM users WHERE username = ?").get(key) as
    | { role?: string }
    | undefined;
  return (row?.role as Role) || null;
}

function orderTableAuditContext(
  database: Database.Database,
  order: Pick<OrderDto, "tableId" | "total"> | null | undefined,
  actor?: string | null,
) {
  const tableId =
    order?.tableId !== null && order?.tableId !== undefined ? Number(order.tableId) : null;
  let tableName: string | null = null;
  let areaId: string | null = null;
  let areaName: string | null = null;
  if (tableId !== null && Number.isFinite(tableId)) {
    const row = database
      .prepare(
        `SELECT t.name AS table_name, t.area_id, sa.name AS area_name
         FROM tables t
         LEFT JOIN seating_areas sa ON sa.id = t.area_id
         WHERE t.id = ?`,
      )
      .get(tableId) as { table_name?: string; area_id?: string; area_name?: string } | undefined;
    if (row) {
      tableName = String(row.table_name || `Table ${tableId}`);
      areaId = String(row.area_id || "") || null;
      areaName = String(row.area_name || "") || null;
    }
  }
  return {
    tableId,
    tableName,
    areaId,
    areaName,
    amountPaise: rupeesToPaise(Number(order?.total || 0)),
    role: lookupActorRole(database, actor),
  };
}

function mergeOrderAuditDetail(
  database: Database.Database,
  order: Pick<OrderDto, "tableId" | "total"> | null | undefined,
  actor: string | null | undefined,
  detail?: Record<string, unknown>,
) {
  return {
    ...orderTableAuditContext(database, order, actor),
    ...(detail || {}),
  };
}

function appendReviewRange(
  clauses: string[],
  params: unknown[],
  expression: string,
  opts: ReviewRangeQuery = {},
) {
  const from = Number(opts.from);
  const to = Number(opts.to);
  if (Number.isFinite(from)) {
    clauses.push(`${expression} >= ?`);
    params.push(from);
  }
  if (Number.isFinite(to)) {
    clauses.push(`${expression} < ?`);
    params.push(to);
  }
}

function detailRecord(detail: unknown): Record<string, unknown> {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return detail as Record<string, unknown>;
  }
  return {};
}

function voidEventFromAudit(
  database: Database.Database,
  audit: AuditDto,
  order: OrderDto | null,
): ReviewVoidEvent {
  const detail = detailRecord(audit.detail);
  const context = orderTableAuditContext(database, order, audit.user);
  const amountPaise = Number(detail.amountPaise);
  return {
    auditId: audit._id,
    orderId: String(audit.entityId || audit.orderId || order?._id || ""),
    timestamp: Number(audit.timestamp || 0),
    actor: audit.user || null,
    reason: detail.reason != null ? String(detail.reason) : null,
    itemName: detail.name != null ? String(detail.name) : null,
    voidQty: detail.voidQty != null ? Number(detail.voidQty) : null,
    amount: Number.isFinite(amountPaise) ? paiseToRupees(amountPaise) : Number(order?.total || 0),
    tableId: order?.tableId ?? context.tableId,
    tableName: context.tableName,
    createdAt: order?.createdAt || null,
    meta: order?.meta,
  };
}

function discountEventFromAudit(
  database: Database.Database,
  audit: AuditDto,
  order: OrderDto | null,
): ReviewDiscountEvent {
  const detail = detailRecord(audit.detail);
  const context = orderTableAuditContext(database, order, audit.user);
  const amountPaise = Number(detail.amountPaise);
  const detailPercent =
    detail.discountPercent != null
      ? Number(detail.discountPercent)
      : detail.discount_percent != null
        ? Number(detail.discount_percent)
        : null;
  const orderPercent = order?.discountPercent != null ? Number(order.discountPercent) : null;
  const discountPercent =
    detailPercent != null && Number.isFinite(detailPercent) ? detailPercent : orderPercent;
  const detailMode =
    detail.discountMode === "amount" || detail.discountMode === "percent"
      ? detail.discountMode
      : null;
  const discountMode =
    detailMode || (detailPercent == null && order?.discountMode === "amount" ? "amount" : "percent");
  const detailAmount = Number(detail.discountAmount);
  return {
    auditId: audit._id,
    orderId: String(audit.entityId || audit.orderId || order?._id || ""),
    timestamp: Number(audit.timestamp || 0),
    actor: audit.user || null,
    previousDiscountPercent:
      detail.previousDiscountPercent != null
        ? Number(detail.previousDiscountPercent)
        : detail.previous_discount_percent != null
          ? Number(detail.previous_discount_percent)
          : null,
    discountPercent,
    discountMode,
    discountAmount:
      Number.isFinite(detailAmount)
        ? detailAmount
        : discountMode === "amount"
          ? Number(order?.discountAmount || 0)
          : 0,
    previousDiscountMode: detail.previousDiscountMode === "amount" ? "amount" : "percent",
    previousDiscountAmount:
      detail.previousDiscountAmount != null && Number.isFinite(Number(detail.previousDiscountAmount))
        ? Number(detail.previousDiscountAmount)
        : null,
    amount: Number.isFinite(amountPaise) ? paiseToRupees(amountPaise) : Number(order?.total || 0),
    tableId: order?.tableId ?? context.tableId,
    tableName: context.tableName,
    createdAt: order?.createdAt || null,
    meta: order?.meta,
  };
}

function discountEventFromOrder(database: Database.Database, order: OrderDto): ReviewDiscountEvent {
  const context = orderTableAuditContext(database, order, order.createdBy);
  const occurredAt = Number(order.paidAt || order.updatedAt || order.createdAt || 0);
  return {
    auditId: `order-discount:${order._id}`,
    orderId: order._id,
    timestamp: occurredAt,
    actor: order.createdBy || null,
    previousDiscountPercent: null,
    discountPercent: Number(order.discountPercent || 0),
    discountMode: order.discountMode === "amount" ? "amount" : "percent",
    discountAmount: Number(order.discountAmount || 0),
    amount: Number(order.total || 0),
    tableId: order.tableId ?? context.tableId,
    tableName: context.tableName,
    createdAt: order.createdAt || null,
    meta: order.meta,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

export function hashClientOpRequest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function getClientOp(database: Database.Database, id: string) {
  const key = normalizeText(id);
  if (!key) {
    return null;
  }
  const row = database
    .prepare(
      "SELECT id, username, action, entity_id, result_json, request_hash, created_at FROM client_ops WHERE id = ?",
    )
    .get(key) as
    | {
        id: string;
        username: string;
        action: string;
        entity_id: string | null;
        result_json: string | null;
        request_hash?: string | null;
        created_at: number;
      }
    | undefined;
  if (!row) {
    return null;
  }
  let result: unknown = null;
  if (row.result_json) {
    try {
      result = JSON.parse(row.result_json);
    } catch {
      result = row.result_json;
    }
  }
  return {
    id: row.id,
    username: row.username,
    action: row.action,
    entityId: row.entity_id,
    result,
    requestHash: row.request_hash || null,
    createdAt: row.created_at,
  };
}

function saveClientOp(
  database: Database.Database,
  input: {
    id: string;
    username: string;
    action: string;
    entityId?: string | null;
    result?: unknown;
    requestHash?: string | null;
  },
) {
  const id = normalizeText(input.id);
  if (!id) {
    throw new Error("client-op-id-required");
  }
  database
    .prepare(
      `INSERT INTO client_ops (id, username, action, entity_id, result_json, request_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      String(input.username || "")
        .trim()
        .toLowerCase(),
      String(input.action || "").trim(),
      input.entityId || null,
      input.result === undefined ? null : stringifyJson(input.result),
      input.requestHash || null,
      now(),
    );
}

function upsertOrderLines(database: Database.Database, orderId: string, lines: OrderLineDto[]) {
  database.prepare("DELETE FROM order_lines WHERE order_id = ?").run(orderId);
  const insert = database.prepare(`
    INSERT INTO order_lines (
      id, order_id, menu_item_id, item_name, category_name, quantity, rate_paise, tax_rate_bps,
      line_total_paise, kot_printed_qty, sort_order, created_at, updated_at, kitchen_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      line.taxRateBps ?? null,
      Math.round(qty * ratePaise),
      Number(line.kotPrintedQty || 0),
      index,
      at,
      at,
      normalizeKitchenNote(line.kitchenNote),
    );
  });
}

function updateOrderTotals(
  database: Database.Database,
  orderId: string,
  lines: OrderLineDto[],
  discount: number | Partial<OrderDiscount> = 0,
  gstConfig?: Partial<GstConfig> | null,
) {
  const normalized = normalizeOrderDiscount(discount);
  const totals = computeOrderTotals(lines, normalized, gstConfig);
  database
    .prepare(
      `UPDATE orders
       SET subtotal_paise = ?, tax_total_paise = ?, discount_percent = ?,
           discount_mode = ?, discount_amount_paise = ?,
           discount_total_paise = ?, total_paise = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      totals.subtotalPaise,
      totals.taxTotalPaise,
      normalized.percent,
      normalized.mode,
      rupeesToPaise(normalized.amount),
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
    updateOrderTotals(database, row.id, lines, discountFromRow(row), gstConfig);
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
    staffId?: string | null;
  },
) {
  const at = now();
  const credential = createCredentialHash(input.password);
  const displayName = normalizeDisplayName(input.displayName, input.username);
  const staffId = normalizeText(input.staffId) || null;
  if (staffId) {
    const staffRow = database.prepare("SELECT id FROM staff WHERE id = ?").get(staffId) as any;
    if (!staffRow) {
      throw new Error("staff-not-found");
    }
    const linked = database
      .prepare("SELECT username FROM users WHERE staff_id = ? LIMIT 1")
      .get(staffId) as any;
    if (linked) {
      throw new Error("staff-account-already-linked");
    }
  }
  database
    .prepare(
      `INSERT INTO users (
        username, display_name, role, password_hash, salt, hash_algo, active,
        require_password_change, staff_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      input.username,
      displayName,
      input.role,
      credential.hash,
      credential.salt,
      credential.hashAlgo,
      input.requirePasswordChange ? 1 : 0,
      staffId,
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
  if (displayName.length > TEXT_LIMITS.personName) {
    throw new Error("display-name-too-long");
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

/** Optional optimistic concurrency for multi-captain edits. Omitted = no check (desktop). */
function assertOrderBaseUpdatedAt(order: OrderDto, baseUpdatedAt?: number | null) {
  if (baseUpdatedAt === null || baseUpdatedAt === undefined) {
    return;
  }
  const expected = Number(baseUpdatedAt);
  if (!Number.isFinite(expected)) {
    return;
  }
  if (Number(order.updatedAt) !== expected) {
    throw new Error("order-conflict");
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
        taxRateBps: line.taxRateBps ?? null,
        kotPrintedQty: printedQty,
        kitchenNote: normalizeKitchenNote(line.kitchenNote),
      };
    })
    .filter((line) => line.name.length > 0);
}

/**
 * A fully sent line keeps the note that already went to the kitchen.
 * While quantity is still unsent, an omitted note keeps the previous one
 * so a qty edit from the POS does not wipe a captain's instruction.
 * An explicit empty string clears it.
 */
function applyKitchenNotes(current: OrderLineDto[], next: OrderLineDto[]) {
  const byId = new Map(current.map((line) => [line.id, line]));
  return next.map((line) => {
    const prev = byId.get(line.id);
    const rawPrinted =
      line.kotPrintedQty != null
        ? line.kotPrintedQty
        : prev && prev.kotPrintedQty != null
          ? prev.kotPrintedQty
          : 0;
    const printed = Math.max(0, Number(rawPrinted) || 0);
    const pending = Math.max(0, Number(line.qty || 0) - printed);
    if (prev && pending <= 0) {
      return { ...line, kitchenNote: prev.kitchenNote ?? null };
    }
    if (line.kitchenNote === undefined) {
      return { ...line, kitchenNote: prev?.kitchenNote ?? null };
    }
    return { ...line, kitchenNote: normalizeKitchenNote(line.kitchenNote) };
  });
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
  const allowed = new Set(["cash", "upi", "card", "voucher", "online", "split", "other", "credit"]);
  return allowed.has(value) ? (value as PaymentDto["method"]) : "other";
}

function normalizeSplitBreakdown(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value
    .map((entry) => ({
      method: normalizePaymentMethod((entry as any)?.method),
      amountPaise: rupeesToPaise((entry as any)?.amount),
    }))
    .filter((entry) => entry.amountPaise > 0);
  if (entries.filter((entry) => entry.method === "credit").length > 1) {
    throw new Error("credit-split-not-allowed");
  }
  return entries;
}

function preparePaymentForTotal(payment: PaymentDto, expectedAmountPaise: number) {
  const method = normalizePaymentMethod(payment.method);
  if (method === "credit") {
    return {
      method,
      amountPaise: expectedAmountPaise,
      amountPaidPaise: 0,
      changePaise: 0,
      creditPortionPaise: expectedAmountPaise,
      splitJson: null as string | null,
    };
  }
  const amountPaidPaise =
    payment.amountPaid === null || payment.amountPaid === undefined
      ? expectedAmountPaise
      : rupeesToPaise(payment.amountPaid);
  const splitBreakdown =
    method === "split" ? normalizeSplitBreakdown(payment.splitBreakdown) : undefined;

  let creditPortionPaise = 0;
  let settledPaidPaise = amountPaidPaise;
  if (method === "split") {
    const splitTotalPaise = (splitBreakdown || []).reduce(
      (sum, entry) => sum + entry.amountPaise,
      0,
    );
    if (!splitBreakdown?.length || splitTotalPaise !== expectedAmountPaise) {
      throw new Error("payment-split-total-mismatch");
    }
    creditPortionPaise = (splitBreakdown || [])
      .filter((entry) => entry.method === "credit")
      .reduce((sum, entry) => sum + entry.amountPaise, 0);
    settledPaidPaise = (splitBreakdown || [])
      .filter((entry) => entry.method !== "credit")
      .reduce((sum, entry) => sum + entry.amountPaise, 0);
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
    amountPaidPaise: settledPaidPaise,
    changePaise,
    creditPortionPaise,
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

function ensureDefaultSeatingArea(database: Database.Database) {
  const countRow = database.prepare("SELECT COUNT(*) AS count FROM seating_areas").get() as {
    count: number;
  };
  if (Number(countRow?.count || 0) > 0) {
    return;
  }
  const at = now();
  database
    .prepare(
      `INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
       VALUES (?, ?, 1, 1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(DEFAULT_SEATING_AREA_ID, DEFAULT_SEATING_AREA_NAME, at, at);
}

function getPrimaryActiveSeatingAreaId(database: Database.Database) {
  const row = database
    .prepare(
      `SELECT id
       FROM seating_areas
       WHERE active = 1
       ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC
       LIMIT 1`,
    )
    .get() as { id?: string } | undefined;
  return normalizeSeatingAreaId(row?.id, DEFAULT_SEATING_AREA_ID);
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
    staffId?: string | null;
    actorUsername?: string | null;
    actorPassword?: string | null;
  }) {
    const username = input.username.trim().toLowerCase();
    assertUsername(username);
    assertPassword(input.password);
    const role = input.role || "cashier";
    assertValidRole(role);
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
        staffId: input.staffId,
      });
      createAuditRow(database, "user.created", "user", username, actor, {
        role,
        staffId: normalizeText(input.staffId) || null,
      });
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
      .prepare(
        `SELECT u.*, s.name AS linked_staff_name
         FROM users u
         LEFT JOIN staff s ON s.id = u.staff_id
         ORDER BY u.created_at ASC`,
      )
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
    const stored = row
      ? {
          hash_algo: row.hash_algo,
          salt: row.salt,
          password_hash: row.password_hash,
        }
      : null;
    const verified = verifyCredentialAgainstStored(password, stored);
    if (!row) {
      recordFailedLogin(key);
      return { ok: false, reason: "not-found" };
    }
    if (!row.active) {
      createAuditRow(getDb(), "auth.login.blocked", "user", key, null, { reason: "inactive" });
      return { ok: false, reason: "inactive" };
    }
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
    if (!isDesktopLoginRole(res.user.role)) {
      return { ok: false, reason: "captain-phone-only" as const };
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

  /** Phone / Local Gateway login — captains allowed; same credential verification. */
  loginForGateway(username: string, password: string) {
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
    const updated = inTransaction((database) => {
      const actor = assertActiveAdminPassword(database, actorUsername, actorPassword);
      const current = database.prepare("SELECT * FROM users WHERE username = ?").get(key) as any;
      if (!current) {
        throw new Error("user-not-found");
      }
      if (updates.role) {
        assertValidRole(updates.role);
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
      return {
        user: userFromRow(database.prepare("SELECT * FROM users WHERE username = ?").get(key)),
        revokePhone:
          updates.active === false || Boolean(updates.role && updates.role !== current.role),
      };
    });
    if (updated.revokePhone) {
      revokeLanUser(key, "signed-out");
    }
    return updated.user;
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
    const result = inTransaction((database) => {
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
    revokeLanUser(key, "password-reset");
    return result;
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
    const safeCount = Math.max(0, Math.trunc(Number(count) || 0));
    if (safeCount > FLOOR_LAYOUT_LIMITS.MAX_TOTAL_TABLES) {
      throw new Error("table-count-invalid");
    }
    return inTransaction((database) => {
      ensureDefaultSeatingArea(database);
      const areaId = getPrimaryActiveSeatingAreaId(database);
      const tableConfig = this.getSetting("config:tables") as any;
      const configuredDefault = Math.trunc(Number(tableConfig?.defaultSeats));
      const defaultSeats =
        Number.isInteger(configuredDefault) && configuredDefault >= 1 && configuredDefault <= 50
          ? configuredDefault
          : 4;
      if (safeCount < this.getTables().length) {
        const statuses = ACTIVE_ORDER_STATUSES.map(() => "?").join(",");
        const blocked = database
          .prepare(
            `SELECT DISTINCT table_id AS id
             FROM orders
             WHERE table_id IS NOT NULL
               AND table_id > ?
               AND status IN (${statuses})`,
          )
          .all(safeCount, ...ACTIVE_ORDER_STATUSES) as Array<{ id: number }>;
        if (blocked.length) {
          throw new Error("tables-have-open-orders");
        }
      }
      const insert = database.prepare(`
        INSERT INTO tables (id, name, seats, area_id, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          active = 1,
          area_id = COALESCE(NULLIF(tables.area_id, ''), excluded.area_id),
          updated_at = excluded.updated_at
      `);
      for (let i = 1; i <= safeCount; i++) {
        insert.run(i, String(i), defaultSeats, areaId, i, at, at);
      }
      database
        .prepare("UPDATE tables SET active = 0, updated_at = ? WHERE id > ?")
        .run(at, safeCount);
      if (
        Number(tableConfig?.tableCount || 0) !== safeCount ||
        Number(tableConfig?.defaultSeats || 0) !== defaultSeats
      ) {
        this.setSetting(
          "config:tables",
          {
            tableCount: safeCount,
            defaultSeats,
          },
          actor,
        );
      }
      return this.getTables();
    });
  },

  ensureConfiguredTables() {
    const count = (() => {
      try {
        return this.getConfiguredTableCount();
      } catch {
        return 0;
      }
    })();
    return this.seedTables(count);
  },

  applyFloorLayout(
    input: {
      areas?: Array<{
        id?: string;
        name?: string;
        active?: boolean;
        order?: number;
        tableCount?: number;
        namingMode?: TableNamingMode;
        prefix?: string;
        defaultSeats?: number;
      }>;
      tableOverrides?: Array<{
        areaId?: string;
        plannedName?: string;
        name?: string;
        seats?: number;
      }>;
    } = {},
    actor?: string | null,
  ) {
    const sourceAreas = Array.isArray(input?.areas) ? input.areas : [];
    const areaPlans: AreaTablePlan[] = sourceAreas.map((entry, index) => {
      const id = normalizeSeatingAreaId(entry?.id, `area:${randomUUID()}`);
      const name = normalizeSeatingAreaName(entry?.name);
      const namingMode: TableNamingMode = entry?.namingMode === "prefix" ? "prefix" : "number";
      const defaultSeats = Math.trunc(Number(entry?.defaultSeats));
      return {
        id,
        name,
        active: entry?.active !== false,
        order: Number.isFinite(Number(entry?.order)) ? Math.trunc(Number(entry?.order)) : index + 1,
        tableCount: Math.max(0, Math.trunc(Number(entry?.tableCount) || 0)),
        namingMode,
        prefix: String(entry?.prefix || "")
          .trim()
          .toUpperCase()
          .slice(0, TEXT_LIMITS.areaPrefix),
        defaultSeats:
          Number.isInteger(defaultSeats) &&
          defaultSeats >= 1 &&
          defaultSeats <= FLOOR_LAYOUT_LIMITS.MAX_SEATS
            ? defaultSeats
            : 4,
      };
    });

    const planned = planTablesFromAreas(areaPlans);
    if (planned.error) {
      throw new Error(planned.error);
    }

    const overrideMap = new Map<string, { name?: string; seats?: number }>();
    for (const entry of Array.isArray(input?.tableOverrides) ? input.tableOverrides : []) {
      const areaId = normalizeSeatingAreaId(entry?.areaId);
      const plannedName = String(entry?.plannedName || "").trim();
      if (!areaId || !plannedName) {
        continue;
      }
      const seats = Math.trunc(Number(entry?.seats));
      const name = String(entry?.name || "").trim();
      overrideMap.set(`${areaId}::${plannedName}`, {
        name: name || undefined,
        seats:
          Number.isInteger(seats) && seats >= 1 && seats <= FLOOR_LAYOUT_LIMITS.MAX_SEATS
            ? seats
            : undefined,
      });
    }

    const finalTables = planned.tables.map((table) => {
      const override = overrideMap.get(`${table.areaId}::${table.name}`);
      return {
        ...table,
        name: override?.name || table.name,
        seats: override?.seats || table.seats,
      };
    });

    return inTransaction((database) => {
      ensureDefaultSeatingArea(database);
      this.setSeatingAreas(
        areaPlans.map((area) => ({
          id: area.id,
          name: area.name,
          active: area.active !== false,
          order: area.order,
        })),
        actor,
      );

      const statuses = ACTIVE_ORDER_STATUSES.map(() => "?").join(",");
      const nextCount = finalTables.length;
      if (nextCount < this.getTables().length) {
        const blocked = database
          .prepare(
            `SELECT DISTINCT table_id AS id
             FROM orders
             WHERE table_id IS NOT NULL
               AND table_id > ?
               AND status IN (${statuses})`,
          )
          .all(nextCount, ...ACTIVE_ORDER_STATUSES) as Array<{ id: number }>;
        if (blocked.length) {
          throw new Error("tables-have-open-orders");
        }
      }

      const existingSeats = new Map<number, number>();
      const seatRows = database
        .prepare("SELECT id, seats FROM tables WHERE active = 1")
        .all() as Array<{ id: number; seats: number }>;
      for (const row of seatRows) {
        existingSeats.set(Number(row.id), Number(row.seats) || 4);
      }

      const at = now();
      const upsert = database.prepare(`
        INSERT INTO tables (id, name, seats, area_id, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          seats = excluded.seats,
          area_id = excluded.area_id,
          sort_order = excluded.sort_order,
          active = 1,
          updated_at = excluded.updated_at
      `);

      finalTables.forEach((table, index) => {
        const id = index + 1;
        const hasOverride = overrideMap.has(`${table.areaId}::${planned.tables[index].name}`);
        const seats =
          hasOverride || !existingSeats.has(id)
            ? table.seats
            : existingSeats.get(id) || table.seats;
        upsert.run(id, table.name, seats, table.areaId, table.sortOrder, at, at);
      });
      database
        .prepare("UPDATE tables SET active = 0, updated_at = ? WHERE id > ?")
        .run(at, nextCount);

      const primaryArea = areaPlans.find((area) => area.active !== false);
      const defaultSeats = primaryArea?.defaultSeats || 4;

      this.setSetting(
        "config:tables",
        {
          tableCount: nextCount,
          defaultSeats,
          layout: areaPlans.map((area) => ({
            id: area.id,
            tableCount: area.tableCount,
            namingMode: area.namingMode,
            prefix: area.prefix,
            defaultSeats: area.defaultSeats,
          })),
        },
        actor,
      );

      createAuditRow(database, "tables.floor_layout.updated", "config", "tables", actor || null, {
        tableCount: nextCount,
        areaCount: areaPlans.length,
      });

      return {
        areas: this.getSeatingAreas(true),
        tables: this.getTables(),
        tableCount: nextCount,
      };
    });
  },

  getSeatingAreas(includeDisabled = false): SeatingAreaDto[] {
    const database = getDb();
    ensureDefaultSeatingArea(database);
    const where = includeDisabled ? "" : "WHERE active = 1";
    return database
      .prepare(
        `SELECT * FROM seating_areas ${where}
         ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC`,
      )
      .all()
      .map(seatingAreaFromRow);
  },

  setSeatingAreas(
    input: Array<{ id?: string; name?: string; active?: boolean; order?: number }> = [],
    actor?: string | null,
  ) {
    return inTransaction((database) => {
      ensureDefaultSeatingArea(database);
      const source = Array.isArray(input) ? input : [];
      const normalized = source
        .map((entry, index) => {
          const id = normalizeSeatingAreaId(entry?.id, `area:${randomUUID()}`);
          const name = normalizeSeatingAreaName(entry?.name);
          const active = entry?.active !== false;
          const order = Number.isFinite(Number(entry?.order))
            ? Math.trunc(Number(entry?.order))
            : index + 1;
          return { id, name, active, order };
        })
        .filter((entry, index, list) => list.findIndex((it) => it.id === entry.id) === index);

      if (!normalized.some((entry) => entry.active)) {
        throw new Error("seating-area-at-least-one-active");
      }

      const existingRows = database.prepare("SELECT id FROM seating_areas").all() as Array<{
        id: string;
      }>;
      const existingIds = new Set(existingRows.map((row) => String(row.id)));
      const nextIds = new Set(normalized.map((entry) => entry.id));

      const upsert = database.prepare(`
        INSERT INTO seating_areas (id, name, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          sort_order = excluded.sort_order,
          active = excluded.active,
          updated_at = excluded.updated_at
      `);
      const at = now();
      normalized.forEach((entry, index) => {
        upsert.run(entry.id, entry.name, index + 1, entry.active ? 1 : 0, at, at);
      });

      const fallbackId =
        normalized.find((entry) => entry.active)?.id ||
        normalizeSeatingAreaId(undefined, DEFAULT_SEATING_AREA_ID);
      const idsToDelete = Array.from(existingIds).filter((id) => !nextIds.has(id));
      for (const id of idsToDelete) {
        database.prepare("UPDATE tables SET area_id = ? WHERE area_id = ?").run(fallbackId, id);
        database.prepare("DELETE FROM seating_areas WHERE id = ?").run(id);
      }

      const remaining = database.prepare("SELECT COUNT(*) AS count FROM seating_areas").get() as {
        count: number;
      };
      if (!Number(remaining?.count || 0)) {
        upsert.run(DEFAULT_SEATING_AREA_ID, DEFAULT_SEATING_AREA_NAME, 1, 1, at, at);
      }

      createAuditRow(database, "seating_areas.updated", "config", "seating_areas", actor || null, {
        count: normalized.length,
      });
      return this.getSeatingAreas(true);
    });
  },

  deleteSeatingArea(areaId: string, reassignToAreaId: string, actor?: string | null) {
    const normalizedAreaId = normalizeSeatingAreaId(areaId);
    const targetId = normalizeSeatingAreaId(reassignToAreaId);
    if (normalizedAreaId === targetId) {
      throw new Error("seating-area-reassign-target-invalid");
    }
    return inTransaction((database) => {
      ensureDefaultSeatingArea(database);
      const existing = database
        .prepare("SELECT id FROM seating_areas WHERE id = ?")
        .get(normalizedAreaId) as { id?: string } | undefined;
      if (!existing) {
        throw new Error("seating-area-not-found");
      }
      const target = database
        .prepare("SELECT id FROM seating_areas WHERE id = ? AND active = 1")
        .get(targetId) as { id?: string } | undefined;
      if (!target) {
        throw new Error("seating-area-reassign-target-missing");
      }
      const remainingActive = database
        .prepare("SELECT COUNT(*) AS count FROM seating_areas WHERE active = 1 AND id != ?")
        .get(normalizedAreaId) as { count: number };
      if (!Number(remainingActive?.count || 0)) {
        throw new Error("seating-area-at-least-one-active");
      }
      database
        .prepare("UPDATE tables SET area_id = ? WHERE area_id = ?")
        .run(targetId, normalizedAreaId);
      database.prepare("DELETE FROM seating_areas WHERE id = ?").run(normalizedAreaId);
      createAuditRow(database, "seating_area.deleted", "config", normalizedAreaId, actor || null, {
        reassignToAreaId: targetId,
      });
      return { ok: true };
    });
  },

  setTableArea(tableId: number, areaId: string, actor?: string | null) {
    const safeTableId = Number(tableId);
    if (!Number.isInteger(safeTableId) || safeTableId <= 0) {
      throw new Error("table-id-invalid");
    }
    const normalizedAreaId = normalizeSeatingAreaId(areaId);
    return inTransaction((database) => {
      ensureDefaultSeatingArea(database);
      const area = database
        .prepare("SELECT id FROM seating_areas WHERE id = ? AND active = 1")
        .get(normalizedAreaId) as { id?: string } | undefined;
      if (!area) {
        throw new Error("seating-area-not-found");
      }
      const result = database
        .prepare("UPDATE tables SET area_id = ?, updated_at = ? WHERE id = ?")
        .run(normalizedAreaId, now(), safeTableId);
      if (!result.changes) {
        throw new Error("table-not-found");
      }
      createAuditRow(database, "table.area.updated", "table", String(safeTableId), actor || null, {
        areaId: normalizedAreaId,
      });
      return this.getTables().find((table) => table.id === safeTableId) || null;
    });
  },

  setTableSeats(tableId: number, seats: number, actor?: string | null) {
    const safeTableId = Number(tableId);
    if (!Number.isInteger(safeTableId) || safeTableId <= 0) {
      throw new Error("table-id-invalid");
    }
    const safeSeats = Math.trunc(Number(seats));
    if (!Number.isInteger(safeSeats) || safeSeats < 1 || safeSeats > 50) {
      throw new Error("table-seats-invalid");
    }
    return inTransaction((database) => {
      const result = database
        .prepare("UPDATE tables SET seats = ?, updated_at = ? WHERE id = ? AND active = 1")
        .run(safeSeats, now(), safeTableId);
      if (!result.changes) {
        throw new Error("table-not-found");
      }
      createAuditRow(database, "table.seats.updated", "table", String(safeTableId), actor || null, {
        seats: safeSeats,
      });
      return this.getTables().find((table) => table.id === safeTableId) || null;
    });
  },

  setTableName(tableId: number, name: string, actor?: string | null) {
    const safeTableId = Number(tableId);
    if (!Number.isInteger(safeTableId) || safeTableId <= 0) {
      throw new Error("table-id-invalid");
    }
    const safeName = String(name || "")
      .trim()
      .slice(0, TEXT_LIMITS.tableName);
    if (!safeName) {
      throw new Error("table-name-invalid");
    }
    return inTransaction((database) => {
      const result = database
        .prepare("UPDATE tables SET name = ?, updated_at = ? WHERE id = ? AND active = 1")
        .run(safeName, now(), safeTableId);
      if (!result.changes) {
        throw new Error("table-not-found");
      }
      createAuditRow(database, "table.name.updated", "table", String(safeTableId), actor || null, {
        name: safeName,
      });
      return this.getTables().find((table) => table.id === safeTableId) || null;
    });
  },

  getTablesSnapshot() {
    const database = getDb();
    ensureDefaultSeatingArea(database);
    const statuses = ACTIVE_ORDER_STATUSES.map(() => "?").join(",");
    const areas = this.getSeatingAreas(true);
    const tables = database
      .prepare(
        `SELECT
           t.*,
           sa.name AS area_name,
           o.id AS order_id,
           o.status AS order_status,
           o.created_at AS order_created_at,
           o.updated_at AS order_updated_at,
           (
             SELECT COUNT(*)
             FROM order_lines ol
             WHERE ol.order_id = o.id
           ) AS item_count,
           (
             SELECT COALESCE(SUM(ol.quantity * ol.rate_paise), 0)
             FROM order_lines ol
             WHERE ol.order_id = o.id
           ) AS total_paise,
           (
             SELECT COALESCE(SUM(CASE WHEN ol.quantity > COALESCE(ol.kot_printed_qty, 0)
               THEN ol.quantity - COALESCE(ol.kot_printed_qty, 0) ELSE 0 END), 0)
             FROM order_lines ol
             WHERE ol.order_id = o.id
           ) AS unsent_qty,
           (
             SELECT COALESCE(SUM(ol.kot_printed_qty), 0)
             FROM order_lines ol
             WHERE ol.order_id = o.id
           ) AS sent_qty
         FROM tables t
         LEFT JOIN seating_areas sa ON sa.id = t.area_id
         LEFT JOIN orders o
           ON o.id = (
             SELECT oo.id
             FROM orders oo
             WHERE oo.table_id = t.id
               AND oo.status IN (${statuses})
             ORDER BY oo.updated_at DESC
             LIMIT 1
           )
         WHERE t.active = 1
         ORDER BY sa.sort_order ASC, sa.name COLLATE NOCASE ASC, t.sort_order ASC, t.id ASC`,
      )
      .all(...ACTIVE_ORDER_STATUSES) as any[];

    const tableRows = tables.map((row) => ({
      ...tableFromRow(row),
      status: row.order_status || "",
      count: Number(row.item_count || 0),
      total: paiseToRupees(Number(row.total_paise || 0)),
      occupied: Boolean(row.order_id) && Number(row.item_count || 0) > 0,
      orderId: row.order_id || null,
      openedAt: Number(row.order_created_at || 0) || null,
      activityAt: Number(row.order_updated_at || 0) || null,
      unsentCount: Number(row.unsent_qty || 0),
      sentCount: Number(row.sent_qty || 0),
    }));

    const byArea: Record<string, Array<(typeof tableRows)[number]>> = {};
    for (const area of areas) {
      byArea[area.id] = [];
    }
    for (const table of tableRows) {
      const areaId = normalizeSeatingAreaId(table.areaId);
      byArea[areaId] = byArea[areaId] || [];
      byArea[areaId].push(table);
    }

    return {
      areas,
      tables: tableRows,
      byArea,
    };
  },

  getTables(): TableDto[] {
    const database = getDb();
    ensureDefaultSeatingArea(database);
    return database
      .prepare(
        `SELECT t.*, sa.name AS area_name
         FROM tables t
         LEFT JOIN seating_areas sa ON sa.id = t.area_id
         WHERE t.active = 1
         ORDER BY sa.sort_order ASC, sa.name COLLATE NOCASE ASC, t.sort_order ASC, t.id ASC`,
      )
      .all()
      .map(tableFromRow);
  },

  getConfiguredTableCount() {
    const cfg = this.getSetting("config:tables") as any;
    const tableCount = Number(cfg?.tableCount);
    if (!Number.isInteger(tableCount) || tableCount < 0) {
      throw new Error("table-count-not-configured");
    }
    return tableCount;
  },

  seedItems() {
    return this.getItems();
  },

  getItems(): MenuItemDto[] {
    const database = getDb();
    const rows = database
      .prepare(
        `SELECT mi.*, mc.name AS category_name
         FROM menu_items mi
         LEFT JOIN menu_categories mc ON mc.id = mi.category_id
         WHERE mi.active = 1
         ORDER BY
           CASE WHEN mc.id IS NULL THEN 1 ELSE 0 END,
           mc.sort_order,
           mc.name COLLATE NOCASE,
           mc.id,
           mi.sort_order,
           mi.name COLLATE NOCASE,
           mi.id`,
      )
      .all() as any[];
    const variantsByItem = getItemVariantsMap(
      database,
      rows.map((row) => String(row.id)),
    );
    return rows.map((row) => itemFromRow(row, variantsByItem.get(String(row.id)) || []));
  },

  getItemById(id: string): MenuItemDto | null {
    const database = getDb();
    const row = database
      .prepare(
        `SELECT mi.*, mc.name AS category_name
         FROM menu_items mi
         LEFT JOIN menu_categories mc ON mc.id = mi.category_id
         WHERE mi.id = ?`,
      )
      .get(id);
    if (!row) {
      return null;
    }
    const variantsByItem = getItemVariantsMap(database, [id]);
    return itemFromRow(row, variantsByItem.get(id) || []);
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
      sortOrder?: number;
      diet?: string | null;
      variants?: unknown;
    },
    actor?: string | null,
  ) {
    const name = normalizeText(input.name);
    const sku = normalizeSku(input.sku);
    const category = normalizeCategoryName(input.category);
    const variants = normalizeMenuVariants(input.variants);
    const diet = normalizeMenuDiet(input.diet, null);
    const variantFloor = variants.length ? Math.min(...variants.map((variant) => variant.price)) : null;
    const price = variantFloor ?? parsePositiveMoney(input.price);
    if (!name) {
      throw new Error("item-name-required");
    }
    if (name.length > TEXT_LIMITS.menuItemName) {
      throw new Error("menu-item-name-too-long");
    }
    if (sku.length > TEXT_LIMITS.sku) {
      throw new Error("menu-item-sku-too-long");
    }
    if (category.length > TEXT_LIMITS.menuCategory) {
      throw new Error("menu-category-too-long");
    }
    if (price === null) {
      throw new Error("item-price-invalid");
    }
    const at = now();
    const id = slugId("item", sku || name);
    return inTransaction((database) => {
      assertUniqueActiveSku(database, sku);
      const categoryId = ensureCategory(database, category);
      const sortOrder = Number.isFinite(Number(input.sortOrder))
        ? Math.trunc(Number(input.sortOrder))
        : nextItemSortOrder(database, categoryId);
      database
        .prepare(
          `INSERT INTO menu_items (
            id, sku, name, category_id, price_paise, available, favorite, tax_rate_bps,
            sort_order, diet, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          sku || null,
          name,
          categoryId,
          rupeesToPaise(price),
          input.available === false ? 0 : 1,
          input.available === false ? 0 : input.favorite ? 1 : 0,
          sortOrder,
          diet,
          at,
          at,
        );
      writeItemVariants(database, id, variants);
      createAuditRow(database, "menu.item.created", "item", id, actor || null, { name });
      return this.getItemById(id)!;
    });
  },

  updateItem(item: MenuItemDto, actor?: string | null) {
    const name = normalizeText(item.name);
    const sku = normalizeSku(item.sku);
    const price = parsePositiveMoney(item.price);
    const category = normalizeCategoryName(item.category);
    const variants = normalizeMenuVariants((item as any).variants);
    const variantFloor = variants.length
      ? Math.min(...variants.map((variant) => variant.price))
      : null;
    const storedPrice = variantFloor ?? price;
    if (!name) {
      throw new Error("item-name-required");
    }
    if (name.length > TEXT_LIMITS.menuItemName) {
      throw new Error("menu-item-name-too-long");
    }
    if (sku.length > TEXT_LIMITS.sku) {
      throw new Error("menu-item-sku-too-long");
    }
    if (category.length > TEXT_LIMITS.menuCategory) {
      throw new Error("menu-category-too-long");
    }
    if (storedPrice === null) {
      throw new Error("item-price-invalid");
    }
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM menu_items WHERE id = ?").get(item._id);
      if (!current) {
        throw new Error("item-not-found");
      }
      assertUniqueActiveSku(database, sku, item._id);
      const categoryId = ensureCategory(database, category);
      const sortOrder = Number.isFinite(Number(item.sortOrder))
        ? Math.trunc(Number(item.sortOrder))
        : Number(current.sort_order || 0);
      const diet = normalizeMenuDiet((item as any).diet, current.diet || null);
      database
        .prepare(
          `UPDATE menu_items
           SET sku = ?, name = ?, category_id = ?, price_paise = ?, available = ?,
               favorite = ?, sort_order = ?, diet = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          sku || null,
          name,
          categoryId,
          rupeesToPaise(storedPrice),
          item.available === false ? 0 : 1,
          item.available === false ? 0 : item.favorite ? 1 : 0,
          sortOrder,
          diet,
          now(),
          item._id,
        );
      writeItemVariants(database, item._id, variants);
      createAuditRow(database, "menu.item.updated", "item", item._id, actor || null, {});
      return this.getItemById(item._id)!;
    });
  },

  reorderItems(ids: string[], actor?: string | null) {
    const orderedIds = Array.from(
      new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "")).filter(Boolean)),
    );
    if (!orderedIds.length) {
      return { ok: true, count: 0 };
    }
    return inTransaction((database) => {
      const ts = now();
      const update = database.prepare(
        "UPDATE menu_items SET sort_order = ?, updated_at = ? WHERE id = ?",
      );
      orderedIds.forEach((id, index) => update.run(index + 1, ts, id));
      createAuditRow(database, "menu.items.reordered", "menu", "menu", actor || null, {
        count: orderedIds.length,
      });
      return { ok: true, count: orderedIds.length };
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
        "SELECT name FROM menu_categories WHERE active = 1 ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC",
      )
      .all()
      .map((row: any) => row.name);
  },

  setCategories(categories: string[], actor?: string | null) {
    return inTransaction((database) => {
      const ts = now();
      database.prepare("UPDATE menu_categories SET active = 0, updated_at = ?").run(ts);
      const findByName = database.prepare(
        "SELECT id FROM menu_categories WHERE lower(name) = lower(?) LIMIT 1",
      );
      const reactivate = database.prepare(`
        UPDATE menu_categories
        SET name = ?, sort_order = ?, active = 1, updated_at = ?
        WHERE id = ?
      `);
      const insertNew = database.prepare(`
        INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `);
      categories.forEach((category, index) => {
        const name = category.trim();
        if (!name) {
          return;
        }
        const existing = findByName.get(name) as { id?: string } | undefined;
        if (existing?.id) {
          reactivate.run(name, index + 1, ts, existing.id);
          return;
        }
        insertNew.run(slugId("cat", name), name, index + 1, ts, ts);
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

  getVariantOptions(): string[] {
    const cfg = this.getSetting("config:menu-variant-options") as any;
    const options = Array.isArray(cfg?.options) ? cfg.options : [];
    return options
      .map((value: unknown) => normalizeText(value))
      .filter((value: string) => Boolean(value));
  },

  setVariantOptions(options: string[], actor?: string | null) {
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const option of options || []) {
      const name = normalizeText(option);
      if (!name) {
        continue;
      }
      const key = name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      normalized.push(name);
    }
    this.setSetting("config:menu-variant-options", { options: normalized }, actor);
    createAuditRow(
      getDb(),
      "menu.variant-options.updated",
      "config",
      "config:menu-variant-options",
      actor || null,
      { count: normalized.length },
    );
    return { ok: true };
  },

  importMenu(
    input: { csv: string; fileName?: string; mode?: MenuImportMode },
    actor?: string | null,
  ) {
    const mode = normalizeMenuImportMode(input?.mode);
    const replacing = mode === "replace";
    const existingRows = getDb()
      .prepare(
        `SELECT mi.id, mi.name, mi.sku, mi.active, mi.category_id, mi.sort_order,
                mc.name AS category_name
         FROM menu_items mi
         LEFT JOIN menu_categories mc ON mc.id = mi.category_id`,
      )
      .all() as Array<{
      id: string;
      name: string;
      sku?: string | null;
      active?: number;
      category_id?: string | null;
      sort_order?: number | null;
      category_name?: string | null;
    }>;
    const existing = existingRows.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category_name || null,
      sku: item.sku || null,
      active: item.active !== 0,
    }));
    const existingById = new Map(existingRows.map((row) => [row.id, row]));
    const currentCategories = this.getCategories();
    const preview = validateMenuCsv(
      String(input?.csv || ""),
      existing,
      currentCategories,
      mode,
    );
    if (preview.errors.length) {
      const error = new Error("menu-import-invalid");
      (error as Error & { details?: string[] }).details = preview.errors;
      throw error;
    }
    const categoryNames: string[] = [];
    const seenCategories = new Set<string>();
    const addCategory = (name: string) => {
      const key = menuMatchKey(name);
      if (!key || seenCategories.has(key)) {
        return;
      }
      seenCategories.add(key);
      categoryNames.push(name);
    };
    if (!replacing) {
      currentCategories.forEach(addCategory);
    }
    [...preview.items]
      .sort(
        (left, right) =>
          left.categoryOrder - right.categoryOrder ||
          left.category.localeCompare(right.category),
      )
      .forEach((item) => addCategory(item.category));
    const variantNames: string[] = [];
    const seenVariants = new Set<string>();
    if (!replacing) {
      for (const name of this.getVariantOptions()) {
        const key = menuMatchKey(name);
        if (!seenVariants.has(key)) {
          seenVariants.add(key);
          variantNames.push(name);
        }
      }
    }
    for (const item of preview.items) {
      for (const variant of item.variants) {
        const key = menuMatchKey(variant.name);
        if (!seenVariants.has(key)) {
          seenVariants.add(key);
          variantNames.push(variant.name);
        }
      }
    }

    return inTransaction((database) => {
      const ts = now();
      if (replacing) {
        database.prepare("UPDATE menu_categories SET active = 0, updated_at = ?").run(ts);
      }
      const findByName = database.prepare(
        "SELECT id FROM menu_categories WHERE lower(name) = lower(?) LIMIT 1",
      );
      const reactivate = database.prepare(`
        UPDATE menu_categories
        SET name = ?, sort_order = ?, active = 1, updated_at = ?
        WHERE id = ?
      `);
      const insertCategory = database.prepare(`
        INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `);
      categoryNames.forEach((category, index) => {
        const existingCategory = findByName.get(category) as { id?: string } | undefined;
        if (existingCategory?.id) {
          reactivate.run(category, index + 1, ts, existingCategory.id);
          return;
        }
        insertCategory.run(slugId("cat", category), category, index + 1, ts, ts);
      });
      database
        .prepare(
          `INSERT INTO settings (key, value_json, updated_at)
           VALUES ('config:categories', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run(JSON.stringify({ categories: categoryNames }), ts);

      const keptIds: string[] = [];
      const lastSortOrder = database.prepare(
        "SELECT MAX(sort_order) AS value FROM menu_items WHERE active = 1 AND category_id IS ?",
      );
      const nextPosition = new Map<string | null, number>();
      const sortOrderFor = (
        item: (typeof preview.items)[number],
        categoryId: string | null,
      ) => {
        if (replacing) {
          return item.itemOrder;
        }
        const current = item.existingId ? existingById.get(item.existingId) : undefined;
        if (current && current.active !== 0 && current.category_id === categoryId) {
          return Number(current.sort_order) || 0;
        }
        let next = nextPosition.get(categoryId);
        if (next === undefined) {
          const row = lastSortOrder.get(categoryId) as { value?: number | null } | undefined;
          next = (Number(row?.value) || 0) + 1;
        }
        nextPosition.set(categoryId, next + 1);
        return next;
      };
      for (const item of preview.items) {
        const categoryId = ensureCategory(database, item.category);
        const id = item.existingId || slugId("item", item.sku || item.name);
        const price = item.price;
        if (price === null) {
          throw new Error("item-price-invalid");
        }
        const sortOrder = sortOrderFor(item, categoryId);
        if (item.existingId) {
          database
            .prepare(
              `UPDATE menu_items
               SET sku = ?, name = ?, category_id = ?, price_paise = ?, available = ?,
                   favorite = ?, sort_order = ?, diet = ?, active = 1, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              item.sku,
              item.name,
              categoryId,
              rupeesToPaise(price),
              item.available ? 1 : 0,
              item.favorite ? 1 : 0,
              sortOrder,
              item.diet,
              ts,
              id,
            );
        } else {
          database
            .prepare(
              `INSERT INTO menu_items (
                id, sku, name, category_id, price_paise, available, favorite, tax_rate_bps,
                sort_order, diet, active, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)`,
            )
            .run(
              id,
              item.sku,
              item.name,
              categoryId,
              rupeesToPaise(price),
              item.available ? 1 : 0,
              item.favorite ? 1 : 0,
              sortOrder,
              item.diet,
              ts,
              ts,
            );
        }
        writeItemVariants(
          database,
          id,
          item.variants.map((variant, index) => ({
            id: `item-variant:${randomUUID()}`,
            name: variant.name,
            price: variant.price,
            sortOrder: variant.sortOrder ?? index,
          })),
        );
        keptIds.push(id);
      }

      if (replacing && keptIds.length) {
        database
          .prepare(
            `UPDATE menu_items SET active = 0, updated_at = ?
             WHERE active = 1 AND id NOT IN (${keptIds.map(() => "?").join(",")})`,
          )
          .run(ts, ...keptIds);
      }
      database
        .prepare(
          `INSERT INTO settings (key, value_json, updated_at)
           VALUES ('config:menu-variant-options', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run(JSON.stringify({ options: variantNames }), ts);
      const result = {
        mode,
        created: preview.created,
        updated: preview.updated,
        deactivatedItems: preview.deactivatedItems,
        deactivatedCategories: preview.deactivatedCategories,
        variantChanges: preview.variantsReplaced,
        fileName: String(input?.fileName || "").slice(0, 180),
      };
      createAuditRow(database, "menu.imported", "menu", "menu", actor || null, result);
      return result;
    });
  },

  createOrder(
    input: {
      tableId?: number | null;
      orderType?: string;
      serviceModeId?: string;
      customerId?: string | null;
      meta?: Record<string, unknown>;
      createdBy?: string | null;
    } = {},
  ) {
    const at = now();
    const modeConfig = this.getSetting(SERVICE_MODE_CONFIG_KEY);
    const fallbackModeId =
      input.tableId !== null && input.tableId !== undefined ? "table" : "takeaway";
    const serviceModeId = normalizeModeId(input.serviceModeId || input.orderType) || fallbackModeId;
    const orderType = resolveLegacyOrderTypeForWrite(modeConfig, serviceModeId, input.tableId);
    const id = `order:${randomUUID()}`;
    const created = inTransaction((database) => {
      const customerId = resolveActiveCustomerId(database, input.customerId);
      const orderSeq = nextOrderSeq(database);
      const meta = { ...(input.meta || {}), orderSeq, serviceModeId };
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
      createAuditRow(
        database,
        "order.created",
        "order",
        id,
        input.createdBy || null,
        mergeOrderAuditDetail(
          database,
          { tableId: input.tableId ?? null, total: 0 },
          input.createdBy || null,
          {
            orderType,
            serviceModeId,
            tableId: input.tableId ?? null,
            customerId,
          },
        ),
      );
      return this.getOrderById(id)!;
    });
    publishOrdersChanged({ orderId: created._id, action: "order.created" });
    return created;
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

  getCaptainKots() {
    const tables = this.getTables();
    const tableById = new Map(tables.map((table) => [table.id, table]));
    const tickets = this.getActiveOrders()
      .filter(
        (order) => order.tableId !== null && order.tableId !== undefined && isKotQueueTicket(order),
      )
      .map((order) => {
        const items = order.items || [];
        const { sentCount, unsentCount } = kotLineCounts(items);
        const sentLines = items.filter((line) => Number(line.kotPrintedQty || 0) > 0);
        const unsentLines = items.filter(
          (line) => Number(line.qty || 0) > Number(line.kotPrintedQty || 0),
        );
        const summarySource = unsentLines.length ? unsentLines : sentLines;
        const table = tableById.get(Number(order.tableId));
        return {
          orderId: order._id,
          tableId: Number(order.tableId),
          tableName: formatTableLabel(Number(order.tableId), table?.name),
          kotStatus: order.kotStatus || "pending",
          openedAt: Number(order.createdAt || 0) || null,
          activityAt: Number(order.updatedAt || 0) || null,
          lastSendAt:
            order.kotSent || order.kotPrinted ? Number(order.updatedAt || 0) || null : null,
          sentSummary: sentLines
            .slice(0, 4)
            .map((line) => `${line.name} ×${Number(line.kotPrintedQty || 0)}`)
            .join(", "),
          itemSummary: summarySource
            .slice(0, 3)
            .map((line) => line.name)
            .join(", "),
          sentCount,
          unsentCount,
        };
      });

    tickets.sort(
      (a, b) => (b.lastSendAt || 0) - (a.lastSendAt || 0) || a.tableName.localeCompare(b.tableName),
    );
    return { tickets };
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
      kitchenNote?: string | null;
    },
    actor?: string | null,
    options: { baseUpdatedAt?: number | null } = {},
  ) {
    const updated = inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      assertOrderBaseUpdatedAt(order, options.baseUpdatedAt);
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
          taxRateBps: null,
          kotPrintedQty: 0,
          kitchenNote: normalizeKitchenNote(item.kitchenNote),
        });
      }
      upsertOrderLines(database, orderId, order.items);
      database
        .prepare("UPDATE orders SET kot_status = ?, updated_at = ? WHERE id = ?")
        .run(kotStatusAfterLineChange(order, order.items), now(), orderId);
      updateOrderTotals(database, orderId, order.items, discountFromOrder(order));
      const auditActor = actor || order.createdBy || null;
      createAuditRow(
        database,
        "item.added",
        "order",
        orderId,
        auditActor,
        mergeOrderAuditDetail(database, order, auditActor, { item }),
      );
      return this.getOrderById(orderId)!;
    });
    publishOrdersChanged({ orderId, action: "item.added" });
    return updated;
  },

  updateOrderLines(
    orderId: string,
    lines: OrderLineDto[],
    actor?: string | null,
    options: { baseUpdatedAt?: number | null } = {},
  ) {
    const updated = inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      assertOrderBaseUpdatedAt(order, options.baseUpdatedAt);
      const sanitized = sanitizeOrderLines(applyKitchenNotes(order.items || [], lines));
      assertNoSentKotReduction(order, sanitized);
      upsertOrderLines(database, orderId, sanitized);
      database
        .prepare("UPDATE orders SET kot_status = ?, updated_at = ? WHERE id = ?")
        .run(kotStatusAfterLineChange(order, sanitized), now(), orderId);
      updateOrderTotals(database, orderId, sanitized, discountFromOrder(order));
      const auditActor = actor || order.createdBy || null;
      createAuditRow(
        database,
        "order.lines.updated",
        "order",
        orderId,
        auditActor,
        mergeOrderAuditDetail(database, order, auditActor, {
          lineCount: sanitized.length,
        }),
      );
      return this.getOrderById(orderId)!;
    });
    publishOrdersChanged({ orderId, action: "order.lines.updated" });
    return updated;
  },

  voidKotLine(
    orderId: string,
    input: { lineId: string; finalQty: number; reason: string },
    actor?: string | null,
    options: { baseUpdatedAt?: number | null } = {},
  ) {
    const updated = inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      assertOrderBaseUpdatedAt(order, options.baseUpdatedAt);
      const lineId = String(input?.lineId || "").trim();
      const reason = normalizeText(input?.reason);
      const finalQty = Math.max(0, Number(input?.finalQty) || 0);
      if (!reason) {
        throw new Error("kot-void-reason-required");
      }
      if (reason.length > TEXT_LIMITS.reason) {
        throw new Error("kot-void-reason-too-long");
      }
      const line = order.items.find((candidate) => candidate.id === lineId);
      if (!line) {
        throw new Error("order-line-not-found");
      }
      const sentQty = Math.max(0, Number(line.kotPrintedQty || 0));
      if (sentQty <= 0 || finalQty >= sentQty) {
        throw new Error("kot-void-not-required");
      }
      const voidQty = sentQty - finalQty;
      const voidAmountPaise = rupeesToPaise(Number(line.rate || 0) * voidQty);
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
      updateOrderTotals(database, orderId, nextLines, discountFromOrder(order));
      const auditActor = actor || order.createdBy || null;
      createAuditRow(
        database,
        "order.kot.void",
        "order",
        orderId,
        auditActor,
        mergeOrderAuditDetail(database, this.getOrderById(orderId), auditActor, {
          lineId,
          name: line.name,
          voidQty,
          finalQty,
          reason,
          amountPaise: voidAmountPaise,
        }),
      );
      return this.getOrderById(orderId)!;
    });
    publishOrdersChanged({ orderId, action: "order.kot.void" });
    return updated;
  },

  setOrderDiscount(
    orderId: string,
    discount: number | Partial<OrderDiscount>,
    actor?: string | null,
  ) {
    return inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const previousDiscount = discountFromOrder(order);
      const nextDiscount = normalizeOrderDiscount(discount);
      updateOrderTotals(database, orderId, order.items || [], nextDiscount);
      if (!orderDiscountsEqual(previousDiscount, nextDiscount)) {
        createAuditRow(
          database,
          "order.discount.updated",
          "order",
          orderId,
          actor || order.createdBy || null,
          mergeOrderAuditDetail(
            database,
            order,
            actor || order.createdBy || null,
            discountAuditDetail(previousDiscount, nextDiscount),
          ),
        );
      }
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
    const updated = inTransaction((database) => {
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
      const auditActor = actor || order.createdBy || null;
      createAuditRow(
        database,
        "order.kot.sent",
        "order",
        orderId,
        auditActor,
        mergeOrderAuditDetail(database, order, auditActor, {
          lines: auditLines,
        }),
      );
      return this.getOrderById(orderId)!;
    });
    publishOrdersChanged({ orderId, action: "order.kot.sent" });
    return updated;
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

  markBillPrinted(orderId: string, actor?: string | null) {
    const updated = inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const auditActor = actor || order.createdBy || null;
      createAuditRow(
        database,
        "order.bill.printed",
        "order",
        orderId,
        auditActor,
        mergeOrderAuditDetail(database, order, auditActor, {}),
      );
      return this.getOrderById(orderId)!;
    });
    publishOrdersChanged({ orderId, action: "order.bill.printed" });
    return updated;
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
      const modeConfig = this.getSetting(SERVICE_MODE_CONFIG_KEY);
      const serviceModeId =
        resolveServiceModeIdFromOrderLike(order) || resolveServiceModeIdFromOrderLike(current);
      const legacyOrderType = resolveLegacyOrderTypeForWrite(
        modeConfig,
        serviceModeId,
        order.tableId,
      );
      database
        .prepare(
          `UPDATE orders
           SET order_type = ?, table_id = ?, customer_id = ?, status = ?, kot_status = ?,
               discount_percent = ?, meta_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          legacyOrderType,
          order.tableId ?? null,
          order.customerId || null,
          order.status || current.status,
          kotStatus,
          Number(order.discountPercent || 0),
          stringifyJson({ ...(order.meta || {}), serviceModeId }),
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
        discountFromOrder(order),
        gstConfig,
      );
      return this.getOrderById(order._id)!;
    });
  },

  setOrderPaid(orderId: string, payment: PaymentDto) {
    const paid = inTransaction((database) => {
      const order = this.getOrderById(orderId);
      assertOrderCanBeEdited(order);
      const rawPayment = (payment || {}) as any;
      const previousDiscount = discountFromOrder(order);
      const nextDiscount =
        rawPayment.discountPercent !== undefined
          ? normalizeOrderDiscount(Number(rawPayment.discountPercent || 0))
          : previousDiscount;
      const payActor = rawPayment.receivedBy || order.createdBy || null;
      if (!orderDiscountsEqual(previousDiscount, nextDiscount)) {
        createAuditRow(
          database,
          "order.discount.updated",
          "order",
          orderId,
          payActor,
          mergeOrderAuditDetail(
            database,
            order,
            payActor,
            discountAuditDetail(previousDiscount, nextDiscount),
          ),
        );
      }
      const gstConfig = getGstSettingFromDb(database);
      const totals = updateOrderTotals(
        database,
        orderId,
        order.items || [],
        nextDiscount,
        gstConfig,
      );
      const safePayment =
        payment || ({ method: "cash", amount: paiseToRupees(totals.totalPaise) } as PaymentDto);
      const preparedPayment = preparePaymentForTotal(safePayment, totals.totalPaise);

      let customerIdForCredit: string | null = order.customerId || null;
      let creditDueDate: string | null = null;
      if (preparedPayment.creditPortionPaise > 0) {
        const creditConfig = getCreditConfigFromDb(database);
        if (!creditConfig.enabled) {
          throw new Error("credit-disabled");
        }
        const attachedCustomerId = resolveActiveCustomerId(
          database,
          safePayment.customerId || order.customerId || null,
        );
        if (!attachedCustomerId) {
          throw new Error("credit-customer-required");
        }
        customerIdForCredit = attachedCustomerId;
        if (!order.customerId || order.customerId !== attachedCustomerId) {
          database
            .prepare("UPDATE orders SET customer_id = ?, updated_at = ? WHERE id = ?")
            .run(attachedCustomerId, now(), orderId);
        }
        const customerRow = database
          .prepare("SELECT default_credit_days FROM customers WHERE id = ?")
          .get(attachedCustomerId) as { default_credit_days?: number | null };
        creditDueDate = resolveCreditDueDate({
          explicitDueDate: safePayment.dueDate,
          customerDefaultDays:
            customerRow?.default_credit_days === null ||
            customerRow?.default_credit_days === undefined
              ? null
              : Number(customerRow.default_credit_days),
          restaurantDefaultDays: creditConfig.defaultCreditDays,
        });
        if (!isValidDateOnly(creditDueDate)) {
          throw new Error("credit-due-date-invalid");
        }
      }

      const txnRef = String(safePayment.txnRef || "")
        .trim()
        .replace(/\s+/g, " ");
      if (txnRef.length > PAYMENT_TXN_REF_LIMIT) {
        throw new Error("payment-txn-ref-too-long");
      }

      const paymentId = `payment:${randomUUID()}`;
      const receivedAt = now();
      const invoice = nextInvoiceSnapshot(database, receivedAt);
      const nextMeta: Record<string, unknown> = {
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
          txnRef || null,
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

      if (preparedPayment.creditPortionPaise > 0 && customerIdForCredit && creditDueDate) {
        createCreditSaleLedgerEntry(database, {
          customerId: customerIdForCredit,
          orderId,
          amountPaise: preparedPayment.creditPortionPaise,
          invoiceNumber: invoice.number,
          description: buildCreditSaleDescription(order.items || []),
          dueDate: creditDueDate,
          actor: safePayment.receivedBy || order.createdBy || null,
        });
        const customerRowFull = database
          .prepare("SELECT name, phone, outstanding_paise FROM customers WHERE id = ?")
          .get(customerIdForCredit) as {
          name?: string;
          phone?: string;
          outstanding_paise?: number;
        };
        nextMeta.credit = {
          customerId: customerIdForCredit,
          customerName: customerRowFull?.name || null,
          customerPhone: customerRowFull?.phone || null,
          dueDate: creditDueDate,
          amount: paiseToRupees(preparedPayment.creditPortionPaise),
          accountBalance: paiseToRupees(customerRowFull?.outstanding_paise),
        };
        database
          .prepare(`UPDATE orders SET meta_json = ?, updated_at = ? WHERE id = ?`)
          .run(stringifyJson(nextMeta), receivedAt, orderId);
      }

      createAuditRow(
        database,
        "order.paid",
        "order",
        orderId,
        safePayment.receivedBy || order.createdBy || null,
        mergeOrderAuditDetail(
          database,
          { tableId: order.tableId, total: paiseToRupees(preparedPayment.amountPaise) },
          safePayment.receivedBy || order.createdBy || null,
          {
            payment: {
              id: paymentId,
              method: preparedPayment.method,
              amount: paiseToRupees(preparedPayment.amountPaise),
              amountPaid: paiseToRupees(preparedPayment.amountPaidPaise),
              change: paiseToRupees(preparedPayment.changePaise),
              dueDate: creditDueDate,
            },
            invoice,
            gstDetailsEnabled: gstConfig.enabled,
            amountPaise: preparedPayment.amountPaise,
          },
        ),
      );
      return this.getOrderById(orderId)!;
    });
    publishOrdersChanged({ orderId, action: "order.paid" });
    return paid;
  },

  cancelOrder(orderId: string, actor?: string | null, reason?: string) {
    const reasonText = normalizeText(reason);
    if (!reasonText) {
      throw new Error("cancel-reason-required");
    }
    if (reasonText.length > TEXT_LIMITS.reason) {
      throw new Error("cancel-reason-too-long");
    }
    const updated = inTransaction((database) => {
      const order = this.getOrderById(orderId);
      if (!order) {
        throw new Error("order-not-found");
      }
      if (order.status === "paid" || order.status === "cancelled") {
        throw new Error("order-closed");
      }
      const at = now();
      const auditActor = actor || order.createdBy || null;
      const kotSent = orderHadKotSent(order);
      database
        .prepare(
          `UPDATE orders
           SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancellation_reason = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(at, auditActor, reasonText, at, orderId);
      createAuditRow(
        database,
        "order.cancelled",
        "order",
        orderId,
        auditActor,
        mergeOrderAuditDetail(database, order, auditActor, {
          reason: reasonText,
          kotSent,
          amountPaise: rupeesToPaise(Number(order.total || 0)),
        }),
      );
      return this.getOrderById(orderId)!;
    });
    publishOrdersChanged({ orderId, action: "order.cancelled" });
    return updated;
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
        if (order.status === "cancelled") {
          throw new Error("cannot-delete-cancelled-order");
        }
        if (order.status !== "paid") {
          throw new Error("cannot-delete-active-order");
        }
        if (orderHasOpenCreditBalance(database, id)) {
          throw new Error("cannot-delete-order-with-credit");
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
      const modeConfig = this.getSetting(SERVICE_MODE_CONFIG_KEY);
      const serviceModeId = resolveServiceModeIdFromOrderLike(order) || "takeaway";
      const legacyOrderType = resolveLegacyOrderTypeForWrite(
        modeConfig,
        serviceModeId,
        order.tableId,
      );
      database
        .prepare(
          `INSERT INTO orders (
            id, order_type, table_id, customer_id, status, kot_status, subtotal_paise,
            tax_total_paise, discount_percent, discount_total_paise, total_paise,
            invoice_number, paid_at, cancelled_at, cancelled_by, cancellation_reason,
            meta_json, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          order._id,
          legacyOrderType,
          order.tableId ?? null,
          order.customerId || null,
          order.status,
          order.kotPrinted ? "printed" : order.kotSent ? "sent" : order.kotStatus || "pending",
          Number(order.discountPercent || 0),
          getOrderInvoiceNumber(order),
          paidAt,
          order.status === "cancelled"
            ? Number(order.cancelledAt || order.updatedAt || createdAt)
            : null,
          order.status === "cancelled" ? order.cancelledBy || actor || null : null,
          order.status === "cancelled" ? order.cancellationReason || null : null,
          stringifyJson({ ...(order.meta || {}), serviceModeId }),
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
      updateOrderTotals(database, order._id, lines, discountFromOrder(order), gstConfig);
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
      relinkCreditLedgerOnOrderRestore(database, order);
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

  summarizePaidOrders(opts: PaidOrderQueryDto = {}): PaidOrdersSummaryDto {
    const query = buildPaidOrderWhere(opts);
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(o.total_paise), 0) AS total_paise
         FROM orders o
         WHERE ${query.whereSql}`,
      )
      .get(...query.params) as { count?: number; total_paise?: number } | undefined;
    return {
      count: Number(row?.count || 0),
      total: paiseToRupees(Number(row?.total_paise || 0)),
    };
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

  getSalesFacts(opts: { from?: number; to?: number } = {}): SalesFactsDto {
    const from = Number(opts.from || 0);
    const to = Number(opts.to ?? now());
    const database = getDb();
    const paymentRows = database
      .prepare(
        `SELECT /* sales-facts-bills */
           o.id, o.created_at, o.invoice_number, o.subtotal_paise, o.tax_total_paise,
           o.discount_total_paise, o.total_paise, o.order_type, o.meta_json,
           c.name AS customer_name,
           p.method, p.amount_paise, p.amount_paid_paise, p.change_paise, p.split_json, p.received_at
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         LEFT JOIN customers c ON c.id = o.customer_id
         WHERE p.status = 'completed' AND o.status = 'paid'
           AND p.received_at >= ? AND p.received_at < ?`,
      )
      .all(from, to) as any[];
    const orderIds = Array.from(new Set(paymentRows.map((row) => String(row.id))));
    const lineRows = orderIds.length
      ? (database
          .prepare(
            `SELECT /* sales-facts-lines */ order_id, item_name, category_name, quantity, line_total_paise, rate_paise
             FROM order_lines
             WHERE order_id IN (${orderIds.map(() => "?").join(",")})
             ORDER BY order_id, sort_order ASC, created_at ASC`,
          )
          .all(...orderIds) as any[])
      : [];
    const linesByOrder = new Map<string, SalesBillInput["lines"]>();
    for (const line of lineRows) {
      const orderId = String(line.order_id);
      const stored = Number(line.line_total_paise);
      const lineValuePaise =
        Number.isFinite(stored) && stored >= 0
          ? stored
          : Math.max(0, Number(line.quantity || 0) * Number(line.rate_paise || 0));
      const bucket = linesByOrder.get(orderId) || [];
      bucket.push({
        itemName: String(line.item_name || ""),
        category: String(line.category_name || ""),
        units: Math.max(0, Number(line.quantity || 0)),
        lineValuePaise,
      });
      linesByOrder.set(orderId, bucket);
    }
    const billsById = new Map<string, SalesBillInput>();
    for (const row of paymentRows) {
      const id = String(row.id);
      const meta = parseJson<Record<string, unknown>>(row.meta_json, {});
      const snapshot = normalizeGstConfig(
        meta.gstSnapshot && typeof meta.gstSnapshot === "object" ? (meta.gstSnapshot as any) : { enabled: false },
      );
      const modeId = String((meta as any).serviceModeId || row.order_type || "unknown");
      let bill = billsById.get(id);
      if (!bill) {
        bill = {
          id,
          createdAt: Number(row.created_at || 0),
          settledAt: Number(row.received_at || 0),
          invoiceNumber: row.invoice_number ? String(row.invoice_number) : null,
          customerName: row.customer_name ? String(row.customer_name) : null,
          netSalesPaise: Number(row.subtotal_paise || 0),
          taxPaise: Number(row.tax_total_paise || 0),
          discountPaise: Number(row.discount_total_paise || 0),
          billTotalPaise: Number(row.total_paise || 0),
          gstEnabled: snapshot.enabled,
          priceIncludesTax: snapshot.priceIncludesTax,
          gstRateBps: snapshot.enabled ? snapshot.gstRateBps : 0,
          serviceModeId: modeId,
          lines: linesByOrder.get(id) || [],
          tenders: [],
        };
        billsById.set(id, bill);
      }
      bill.settledAt = Math.min(bill.settledAt, Number(row.received_at || bill.settledAt));
      const receivedAt = Number(row.received_at || 0);
      const method = String(row.method || "other");
      if (method === "split") {
        const split = parseJson<any[]>(row.split_json, []);
        if (Array.isArray(split) && split.length) {
          for (const entry of split) {
            const amountPaise =
              entry?.amountPaise !== undefined ? Number(entry.amountPaise) : rupeesToPaise(entry?.amount);
            if (Number.isFinite(amountPaise) && amountPaise > 0) {
              bill.tenders.push({
                method: String(entry.method || "other"),
                amountPaise,
                receivedAt,
                amountPaidPaise: Number(row.amount_paid_paise || 0),
              });
            }
          }
          continue;
        }
      }
      bill.tenders.push({
        method,
        amountPaise: Number(row.amount_paise || 0),
        receivedAt,
        amountPaidPaise: Number(row.amount_paid_paise || 0),
      });
    }
    const collections = database
      .prepare(
        `SELECT amount_paise, created_at
         FROM customer_account_entries
         WHERE entry_type = 'payment_received' AND created_at >= ? AND created_at < ?`,
      )
      .all(from, to) as Array<{ amount_paise: number; created_at: number }>;
    const credit = this.getCustomerCreditTotals();
    const labels: Record<string, string> = {};
    for (const mode of normalizeServiceModes(this.getSetting(SERVICE_MODE_CONFIG_KEY))) {
      labels[mode.id] = mode.name;
    }
    return buildSalesFacts({
      from,
      to,
      timeZone: resolveBusinessTimezone(),
      bills: Array.from(billsById.values()),
      creditCollections: collections.map((row) => ({
        amountPaise: Number(row.amount_paise || 0),
        collectedAt: Number(row.created_at || 0),
      })),
      outstandingCreditPaise: rupeesToPaise(credit.outstanding),
      serviceModeLabels: labels,
    });
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
    const paymentClauses = ["p.status = 'completed'", "o.status = 'paid'"];
    const paymentParams: unknown[] = [];
    if (opts.from !== null && opts.from !== undefined) {
      paymentClauses.push("p.received_at >= ?");
      paymentParams.push(opts.from);
    }
    if (opts.to !== null && opts.to !== undefined) {
      paymentClauses.push("p.received_at < ?");
      paymentParams.push(opts.to);
    }

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
         WHERE o.id IN (
           SELECT DISTINCT p.order_id
           FROM payments p
           JOIN orders o2 ON o2.id = p.order_id
           WHERE ${paymentClauses.join(" AND ").replace(/\bo\./g, "o2.")}
         )
         ORDER BY o.id, l.sort_order ASC, l.created_at ASC`,
      )
      .all(...paymentParams) as any[];

    if (!rows.length) {
      return {
        categorySales: [],
        itemSales: [],
        totals: { totalSales: 0, totalUnits: 0 },
      };
    }

    const orderIds = Array.from(
      new Set(rows.map((row) => String(row.order_id || "")).filter(Boolean)),
    );

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
      clauses.push("p.received_at < ?");
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
      key === "config:gst"
        ? assertGstConfig(merged as Partial<GstConfig>)
        : key === "config:attendance"
          ? assertAttendanceConfig(merged)
          : key === CREDIT_CONFIG_KEY
            ? assertCreditConfig(merged as any)
            : key === SERVICE_MODE_CONFIG_KEY
              ? toServiceModeConfigDoc(merged)
              : merged;
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
    const actions = ORDER_LIFECYCLE_AUDIT_ACTIONS as readonly string[];
    const placeholders = actions.map(() => "?").join(",");
    const result = getDb()
      .prepare(`DELETE FROM audit_logs WHERE timestamp < ? AND action NOT IN (${placeholders})`)
      .run(cutoff, ...actions);
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
      .prepare(
        `SELECT o.id
         FROM orders o
         WHERE o.status = 'paid'
           AND COALESCE(o.paid_at, o.updated_at) < ?
           AND NOT EXISTS (
             SELECT 1 FROM customer_account_entries e
             WHERE e.order_id = o.id
               AND e.entry_type = 'credit_sale'
               AND e.remaining_paise > 0
           )`,
      )
      .all(cutoff) as any[];
    rows.forEach((row) => this.deleteOrder(row.id));
    return rows.length;
  },

  listCancelledOrdersInRange(opts: ReviewRangeQuery = {}): OrderDto[] {
    const clauses = ["o.status = 'cancelled'"];
    const params: unknown[] = [];
    appendReviewRange(clauses, params, "COALESCE(o.cancelled_at, o.updated_at)", opts);
    const actor = actorKey(opts.actor);
    if (actor) {
      clauses.push("LOWER(COALESCE(o.cancelled_by, o.created_by, '')) = ?");
      params.push(actor);
    }
    const database = getDb();
    return database
      .prepare(
        `SELECT o.* FROM orders o
         WHERE ${clauses.join(" AND ")}
         ORDER BY COALESCE(o.cancelled_at, o.updated_at) DESC, o.id DESC`,
      )
      .all(...params)
      .map((row: any) => orderFromRow(database, row));
  },

  listVoidAuditsInRange(opts: ReviewRangeQuery = {}): AuditDto[] {
    const clauses = ["action = 'order.kot.void'"];
    const params: unknown[] = [];
    appendReviewRange(clauses, params, "timestamp", opts);
    const actor = actorKey(opts.actor);
    if (actor) {
      clauses.push("LOWER(COALESCE(user, '')) = ?");
      params.push(actor);
    }
    return getDb()
      .prepare(
        `SELECT * FROM audit_logs
         WHERE ${clauses.join(" AND ")}
         ORDER BY timestamp DESC`,
      )
      .all(...params)
      .map(auditFromRow);
  },

  listDiscountAuditsInRange(opts: ReviewRangeQuery = {}): AuditDto[] {
    const clauses = ["action = 'order.discount.updated'"];
    const params: unknown[] = [];
    appendReviewRange(clauses, params, "timestamp", opts);
    const actor = actorKey(opts.actor);
    if (actor) {
      clauses.push("LOWER(COALESCE(user, '')) = ?");
      params.push(actor);
    }
    return getDb()
      .prepare(
        `SELECT * FROM audit_logs
         WHERE ${clauses.join(" AND ")}
         ORDER BY timestamp DESC`,
      )
      .all(...params)
      .map(auditFromRow);
  },

  /** Orders that still carry a positive discount in-range (History truth), even if audit rows are missing. */
  listDiscountedOrdersInRange(opts: ReviewRangeQuery = {}): OrderDto[] {
    const database = getDb();
    const clauses = ["(o.discount_percent > 0 OR COALESCE(o.discount_amount_paise, 0) > 0)"];
    const params: unknown[] = [];
    // Prefer payment time; fall back to update/create so open discounted tickets still appear.
    appendReviewRange(clauses, params, "COALESCE(o.paid_at, o.updated_at, o.created_at)", opts);
    const actor = actorKey(opts.actor);
    if (actor) {
      clauses.push("LOWER(COALESCE(o.created_by, '')) = ?");
      params.push(actor);
    }
    return database
      .prepare(
        `SELECT o.*
         FROM orders o
         WHERE ${clauses.join(" AND ")}
         ORDER BY COALESCE(o.paid_at, o.updated_at, o.created_at) DESC`,
      )
      .all(...params)
      .map((row: any) => orderFromRow(database, row));
  },

  listReviewItems(opts: ReviewRangeQuery = {}): ReviewItemDto[] {
    const database = getDb();
    const cancelled = this.listCancelledOrdersInRange(opts);
    const voidAudits = this.listVoidAuditsInRange(opts);
    const discountAudits = this.listDiscountAuditsInRange(opts);
    const discountedOrders = this.listDiscountedOrdersInRange(opts);
    const voidOrderIds = voidAudits
      .map((audit) => String(audit.entityId || audit.orderId || ""))
      .filter(Boolean);
    const lookupIds = [...new Set([...cancelled.map((order) => order._id), ...voidOrderIds])];
    const kotSentAt = new Map<string, number>();
    const billPrintedAt = new Map<string, number>();
    if (lookupIds.length) {
      const placeholders = lookupIds.map(() => "?").join(",");
      const kotRows = database
        .prepare(
          `SELECT entity_id, MIN(timestamp) AS kot_sent_at
           FROM audit_logs
           WHERE action = 'order.kot.sent' AND entity_id IN (${placeholders})
           GROUP BY entity_id`,
        )
        .all(...lookupIds) as Array<{ entity_id: string; kot_sent_at: number }>;
      kotRows.forEach((row) => {
        kotSentAt.set(String(row.entity_id), Number(row.kot_sent_at));
      });
      const billRows = database
        .prepare(
          `SELECT entity_id, MIN(timestamp) AS bill_printed_at
           FROM audit_logs
           WHERE action = 'order.bill.printed' AND entity_id IN (${placeholders})
           GROUP BY entity_id`,
        )
        .all(...lookupIds) as Array<{ entity_id: string; bill_printed_at: number }>;
      billRows.forEach((row) => {
        billPrintedAt.set(String(row.entity_id), Number(row.bill_printed_at));
      });
    }
    const cancelCountsByActor: Record<string, number> = {};
    const cancelledSnapshots = cancelled.map((order) => {
      const actor = actorKey(order.cancelledBy || order.createdBy);
      if (actor) {
        cancelCountsByActor[actor] = (cancelCountsByActor[actor] || 0) + 1;
      }
      const context = orderTableAuditContext(database, order, order.cancelledBy || order.createdBy);
      return {
        _id: order._id,
        tableId: order.tableId,
        tableName: context.tableName,
        total: Number(order.total || 0),
        createdAt: Number(order.createdAt || 0),
        cancelledAt: order.cancelledAt || null,
        cancelledBy: order.cancelledBy || null,
        cancellationReason: order.cancellationReason || null,
        createdBy: order.createdBy || null,
        kotStatus: order.kotStatus || null,
        items: order.items || [],
        meta: order.meta,
        kotSentAt: kotSentAt.get(order._id) || null,
        billPrintedAt: billPrintedAt.get(order._id) || null,
      };
    });
    const voidEvents = voidAudits.map((audit) => {
      const orderId = String(audit.entityId || audit.orderId || "");
      const event = voidEventFromAudit(
        database,
        audit,
        orderId ? this.getOrderById(orderId) : null,
      );
      return {
        ...event,
        kotSentAt: kotSentAt.get(event.orderId) || null,
      };
    });
    const discountEventsByOrder = new Map<string, ReviewDiscountEvent>();
    const rememberDiscount = (event: ReviewDiscountEvent) => {
      const orderId = String(event.orderId || "").trim();
      const percent = Number(event.discountPercent);
      if (!orderId || !Number.isFinite(percent) || percent <= 0) {
        return;
      }
      const existing = discountEventsByOrder.get(orderId);
      // Prefer real discount audits over synthetic order snapshots; then newest timestamp.
      const existingIsAudit = Boolean(
        existing && !String(existing.auditId).startsWith("order-discount:"),
      );
      const nextIsAudit = !String(event.auditId).startsWith("order-discount:");
      if (
        !existing ||
        (nextIsAudit && !existingIsAudit) ||
        (nextIsAudit === existingIsAudit && event.timestamp >= existing.timestamp)
      ) {
        discountEventsByOrder.set(orderId, event);
      }
    };
    for (const audit of discountAudits) {
      const orderId = String(audit.entityId || audit.orderId || "");
      rememberDiscount(
        discountEventFromAudit(database, audit, orderId ? this.getOrderById(orderId) : null),
      );
    }
    for (const order of discountedOrders) {
      rememberDiscount(discountEventFromOrder(database, order));
    }
    return buildReviewItems({
      cancelledOrders: cancelledSnapshots,
      voidEvents,
      discountEvents: Array.from(discountEventsByOrder.values()),
      cancelCountsByActor,
      actorFilter: opts.actor,
      threshold: REPEATED_CANCELLATION_THRESHOLD,
    });
  },

  getReviewSummary(opts: ReviewRangeQuery = {}): ReviewSummaryDto {
    const items = this.listReviewItems(opts);
    const counts = summarizeReviewItems(items);
    return {
      paidOrders: this.countPaidOrders({ from: opts.from, to: opts.to }),
      cancelledOrders: this.listCancelledOrdersInRange(opts).length,
      ...counts,
    };
  },

  getStaffActivity(opts: ReviewRangeQuery = {}): StaffActivityRowDto[] {
    const database = getDb();
    const tally = new Map<
      string,
      {
        username: string;
        orders: number;
        voids: number;
        discounts: number;
        afterKot: number;
      }
    >();
    const bump = (
      username: string | null | undefined,
      field: "orders" | "voids" | "discounts" | "afterKot",
      amount = 1,
    ) => {
      const key = actorKey(username);
      if (!key) {
        return;
      }
      const current = tally.get(key) || {
        username: String(username || key),
        orders: 0,
        voids: 0,
        discounts: 0,
        afterKot: 0,
      };
      current[field] += amount;
      tally.set(key, current);
    };

    const createdClauses: string[] = ["created_by IS NOT NULL"];
    const createdParams: unknown[] = [];
    appendReviewRange(createdClauses, createdParams, "created_at", opts);
    (
      database
        .prepare(
          `SELECT created_by AS username, COUNT(*) AS count
           FROM orders
           WHERE ${createdClauses.join(" AND ")}
           GROUP BY created_by`,
        )
        .all(...createdParams) as Array<{ username: string; count: number }>
    ).forEach((row) => bump(row.username, "orders", Number(row.count || 0)));

    for (const item of this.listReviewItems({ from: opts.from, to: opts.to })) {
      if (item.rule === "item_void") {
        bump(item.actor, "voids");
      } else if (item.rule === "discount_applied") {
        bump(item.actor, "discounts");
      } else if (item.rule === "cancellation_after_kot") {
        bump(item.actor, "afterKot");
      }
    }

    const rows = Array.from(tally.values()).sort((a, b) => a.username.localeCompare(b.username));
    return rows.map((row) => {
      const user = database
        .prepare("SELECT username, display_name FROM users WHERE username = ?")
        .get(row.username) as { username?: string; display_name?: string } | undefined;
      return {
        username: user?.username || row.username,
        displayName: user?.display_name || null,
        orders: row.orders,
        voids: row.voids,
        discounts: row.discounts,
        afterKot: row.afterKot,
      };
    });
  },

  getOrderTimeline(orderId: string): { order: OrderDto; events: OrderTimelineEventDto[] } {
    const key = String(orderId || "").trim();
    const order = this.getOrderById(key);
    if (!order) {
      throw new Error("order-not-found");
    }
    const events = getDb()
      .prepare(
        `SELECT * FROM audit_logs
         WHERE entity_id = ?
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(key)
      .map((row: any) => auditFromRow(row))
      .map((audit: AuditDto) => ({
        timestamp: Number(audit.timestamp || 0),
        action: audit.action,
        label: timelineActionLabel(audit.action),
        actor: audit.user || null,
        detail: audit.detail,
      }));
    return { order, events };
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

  getLiveActivity(opts: { limit?: number; since?: number } = {}) {
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 40));
    const since = Number(opts.since) || 0;
    const actions = LIVE_ACTIVITY_ACTIONS as readonly string[];
    const placeholders = actions.map(() => "?").join(",");
    const params: Array<string | number> = [...actions];
    let sql = `SELECT * FROM audit_logs WHERE action IN (${placeholders})`;
    if (since > 0) {
      sql += " AND timestamp >= ?";
      params.push(since);
    }
    sql += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);
    return getDb()
      .prepare(sql)
      .all(...params)
      .map(auditFromRow);
  },

  getClientOp(id: string) {
    return getClientOp(getDb(), id);
  },

  assertClientOpRequest(existing: { requestHash?: string | null }, request: unknown) {
    const stored = String(existing.requestHash || "");
    if (!stored) {
      return;
    }
    if (stored !== hashClientOpRequest(request)) {
      throw new Error("client-op-conflict");
    }
  },

  rememberClientOp(input: {
    id: string;
    username: string;
    action: string;
    entityId?: string | null;
    result?: unknown;
    request?: unknown;
  }) {
    const requestHash = input.request === undefined ? null : hashClientOpRequest(input.request);
    return inTransaction((database) => {
      const existing = getClientOp(database, input.id);
      if (existing) {
        if (requestHash) {
          this.assertClientOpRequest(existing, input.request);
        }
        return { replay: true as const, op: existing };
      }
      saveClientOp(database, { ...input, requestHash });
      return { replay: false as const, op: getClientOp(database, input.id)! };
    });
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
    const rows = database
      .prepare("SELECT * FROM grocery_items ORDER BY lower(name) ASC")
      .all() as any[];
    const priceHints = batchGroceryPriceHints(database, rows);
    return rows.map((row: any) => groceryItemFromRow(database, row, true, priceHints.get(row.id)));
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
      .all(...params) as any[];
    const linesByList = batchGroceryListLines(
      database,
      rows.map((row) => row.id),
    );
    const spendByList = batchGroceryListSpend(
      database,
      rows.map((row) => row.id),
    );
    return rows.map((row: any) =>
      groceryListFromRow(database, row, linesByList.get(row.id), spendByList.get(row.id) || 0),
    );
  },

  getGroceryList(id: string): GroceryListDto | null {
    const database = getDb();
    const row = database.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(id) as any;
    return row ? groceryListFromRow(database, row) : null;
  },

  createGroceryList(
    input: {
      title?: string;
      listDate?: number;
      listType?: GroceryListType;
      notes?: string | null;
      lines?: Partial<GroceryListLineDto>[];
      templateId?: string;
      sourceListId?: string;
    },
    actor?: string | null,
  ) {
    const at = now();
    const listDate = Number(input.listDate || at);
    if (!Number.isFinite(listDate) || listDate <= 0) {
      throw new Error("grocery-date-invalid");
    }
    const id = `grocery-list:${randomUUID()}`;
    const listType = normalizeGroceryListType(input.listType);
    const hour = new Date(listDate).getHours();
    const suggestedTitle =
      hour < 12 ? "Morning Procurement" : hour < 17 ? "Afternoon Refill" : "Evening Refill";
    const title = normalizeText(input.title) || suggestedTitle;
    if (title.length > TEXT_LIMITS.listTitle) {
      throw new Error("grocery-list-title-too-long");
    }
    const notes = optionalGroceryText(input.notes, 500, "grocery-notes-too-long");
    return inTransaction((database) => {
      // Explicit `lines: []` means blank list. Omitted lines keep legacy seed-from-items.
      const linesProvided = Array.isArray(input.lines);
      let sourceLines: Partial<GroceryListLineDto>[] | undefined = linesProvided
        ? input.lines
        : undefined;
      if ((!sourceLines || !sourceLines.length) && !linesProvided && input.templateId) {
        sourceLines = (
          database
            .prepare(
              `SELECT * FROM grocery_list_template_lines
               WHERE template_id = ?
               ORDER BY sort_order ASC, created_at ASC`,
            )
            .all(input.templateId) as any[]
        ).map((line) => ({
          groceryItemId: line.grocery_item_id,
          itemName: line.item_name,
          category: line.category,
          quantity: line.default_quantity || 1,
          unit: line.unit,
        }));
      }
      if ((!sourceLines || !sourceLines.length) && !linesProvided && input.sourceListId) {
        sourceLines = (
          database
            .prepare(
              `SELECT * FROM grocery_list_lines
               WHERE list_id = ?
               ORDER BY sort_order ASC, created_at ASC`,
            )
            .all(input.sourceListId) as any[]
        ).map((line) => ({
          groceryItemId: line.grocery_item_id,
          itemName: line.item_name,
          category: line.category,
          quantity: line.quantity,
          unit: line.unit,
          vendorHint: line.vendor_hint,
          estimatedUnitPrice:
            line.estimated_unit_price_paise == null
              ? null
              : paiseToRupees(line.estimated_unit_price_paise),
        }));
      }
      if (
        (!sourceLines || !sourceLines.length) &&
        !linesProvided &&
        !input.templateId &&
        !input.sourceListId
      ) {
        // Backward-compatible default: seed from reusable items when no source provided.
        sourceLines = (
          database
            .prepare("SELECT * FROM grocery_items WHERE active = 1 ORDER BY lower(name) ASC")
            .all() as any[]
        ).map((item) => ({
          groceryItemId: item.id,
          itemName: item.name,
          category: item.category,
          quantity: item.default_quantity,
          unit: item.default_unit,
          vendorHint: item.vendor_hint,
        }));
      }
      if (!sourceLines) {
        sourceLines = [];
      }
      const lines = sourceLines.map((line, index) => prepareGroceryListLineInput(line, index));
      const initialStatus: GroceryListStatus = lines.length ? "open" : "draft";
      database
        .prepare(
          `INSERT INTO grocery_lists (
             id, title, list_date, list_type, status, notes, created_by, updated_by,
             completed_at, print_count, last_printed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)`,
        )
        .run(
          id,
          title,
          listDate,
          listType,
          initialStatus,
          notes,
          actor || null,
          actor || null,
          at,
          at,
        );
      const insertLine = database.prepare(
        `INSERT INTO grocery_list_lines (
          id, list_id, grocery_item_id, item_name, category, quantity, unit, vendor_hint,
          sort_order, estimated_unit_price_paise, estimated_total_paise,
          purchased_quantity, purchased_unit_price_paise, purchased_total_paise, line_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          line.estimatedUnitPrice == null ? null : rupeesToPaise(line.estimatedUnitPrice),
          line.estimatedTotal == null ? null : rupeesToPaise(line.estimatedTotal),
          line.purchasedQuantity == null ? null : line.purchasedQuantity,
          line.purchasedUnitPrice == null ? null : rupeesToPaise(line.purchasedUnitPrice),
          line.purchasedTotal == null ? null : rupeesToPaise(line.purchasedTotal),
          line.lineStatus || "pending",
          at,
          at,
        );
      });
      createAuditRow(database, "grocery.list.created", "grocery-list", id, actor || null, {
        lineCount: lines.length,
        listType,
        templateId: input.templateId || null,
        sourceListId: input.sourceListId || null,
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
      listType?: GroceryListType;
      notes?: string | null;
      status?: GroceryListDto["status"];
      lines?: Partial<GroceryListLineDto>[];
      recordPrint?: boolean;
    },
    actor?: string | null,
  ) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(id) as any;
      if (!current) {
        throw new Error("grocery-list-not-found");
      }
      const currentStatus = normalizeGroceryListStatus(current.status);
      if (updates.status === "partial" || updates.status === "completed") {
        throw new Error("grocery-list-status-derived");
      }
      if (
        updates.status &&
        updates.status !== "draft" &&
        updates.status !== "open" &&
        updates.status !== "cancelled" &&
        updates.status !== ("printed" as any)
      ) {
        throw new Error("grocery-list-status-invalid");
      }
      const title =
        updates.title === undefined ? current.title : normalizeText(updates.title) || current.title;
      if (title.length > TEXT_LIMITS.listTitle) {
        throw new Error("grocery-list-title-too-long");
      }
      const listDate =
        updates.listDate === undefined ? current.list_date : Number(updates.listDate);
      if (!Number.isFinite(listDate) || listDate <= 0) {
        throw new Error("grocery-date-invalid");
      }
      const listType =
        updates.listType === undefined
          ? normalizeGroceryListType(current.list_type)
          : normalizeGroceryListType(updates.listType);
      const notes =
        updates.notes === undefined
          ? current.notes || null
          : optionalGroceryText(updates.notes, 500, "grocery-notes-too-long");

      let status = currentStatus;
      if (updates.status === "cancelled") {
        status = "cancelled";
      } else if (currentStatus !== "cancelled") {
        if (updates.status === "open" && currentStatus === "draft") {
          status = "open";
        } else if (updates.status === ("printed" as any)) {
          status = currentStatus === "draft" ? "open" : currentStatus;
        }
      }

      const at = now();
      let printCount = Number(current.print_count || 0);
      let lastPrintedAt = current.last_printed_at || null;
      if (updates.recordPrint) {
        printCount += 1;
        lastPrintedAt = at;
        createAuditRow(database, "grocery.list.printed", "grocery-list", id, actor || null, {
          printCount,
        });
      }
      const completedAt =
        status === "completed"
          ? current.completed_at || at
          : status === "cancelled"
            ? current.completed_at || null
            : current.completed_at;

      database
        .prepare(
          `UPDATE grocery_lists SET
             title = ?, list_date = ?, list_type = ?, status = ?, notes = ?,
             updated_by = ?, completed_at = ?, print_count = ?, last_printed_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          title,
          listDate,
          listType,
          status,
          notes,
          actor || null,
          completedAt,
          printCount,
          lastPrintedAt,
          at,
          id,
        );

      if (updates.status === "cancelled" && currentStatus !== "cancelled") {
        createAuditRow(database, "grocery.list.cancelled", "grocery-list", id, actor || null, {});
      }

      if (updates.lines) {
        mergeGroceryListLines(database, id, updates.lines, at);
      }

      if (status !== "cancelled") {
        recalcGroceryListStatus(database, id);
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

  /** Applies only the changed lines; covered (purchased) lines cannot be edited or removed. */
  changeGroceryListLines(id: string, change: GroceryListLinesChange, actor?: string | null) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(id) as any;
      if (!current) {
        throw new Error("grocery-list-not-found");
      }
      if (normalizeGroceryListStatus(current.status) === "cancelled") {
        throw new Error("grocery-list-cancelled");
      }
      const at = now();
      const lineById = (lineId: string) => {
        const row = database
          .prepare(`SELECT * FROM grocery_list_lines WHERE id = ? AND list_id = ?`)
          .get(lineId, id) as any;
        if (!row) {
          throw new Error("grocery-list-line-not-found");
        }
        if (isCoveredGroceryListLine(row)) {
          throw new Error("grocery-list-line-covered");
        }
        return row;
      };

      for (const lineId of change.remove || []) {
        lineById(lineId);
        database.prepare(`DELETE FROM grocery_list_lines WHERE id = ?`).run(lineId);
      }

      for (const patch of change.update || []) {
        const row = lineById(patch.id);
        const quantity = patch.quantity === undefined ? Number(row.quantity) : normalizeQuantity(patch.quantity);
        const unit = patch.unit === undefined ? row.unit : normalizeGroceryUnit(patch.unit);
        database
          .prepare(`UPDATE grocery_list_lines SET quantity = ?, unit = ?, updated_at = ? WHERE id = ?`)
          .run(quantity, unit, at, row.id);
      }

      if (change.add?.length) {
        let sortOrder =
          Number(
            (
              database
                .prepare(`SELECT MAX(sort_order) AS max FROM grocery_list_lines WHERE list_id = ?`)
                .get(id) as { max: number | null }
            ).max ?? -1,
          ) + 1;
        const existingNames = new Set(
          (
            database
              .prepare(`SELECT lower(item_name) AS name FROM grocery_list_lines WHERE list_id = ?`)
              .all(id) as Array<{ name: string }>
          ).map((row) => row.name),
        );
        for (const raw of change.add) {
          const prepared = prepareGroceryListLineInput(raw, sortOrder);
          if (existingNames.has(prepared.itemName.toLowerCase())) {
            throw new Error("grocery-list-line-duplicate");
          }
          existingNames.add(prepared.itemName.toLowerCase());
          const lineId = prepared.id.startsWith("grocery-list-line:")
            ? prepared.id
            : `grocery-list-line:${randomUUID()}`;
          database
            .prepare(
              `INSERT INTO grocery_list_lines (
                id, list_id, grocery_item_id, item_name, category, quantity, unit, vendor_hint,
                sort_order, estimated_unit_price_paise, estimated_total_paise,
                purchased_quantity, purchased_unit_price_paise, purchased_total_paise, line_status,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'pending', ?, ?)`,
            )
            .run(
              lineId,
              id,
              prepared.groceryItemId || null,
              prepared.itemName,
              prepared.category || null,
              prepared.quantity,
              prepared.unit,
              prepared.vendorHint || null,
              sortOrder,
              at,
              at,
            );
          sortOrder += 1;
        }
      }

      database
        .prepare(`UPDATE grocery_lists SET updated_by = ?, updated_at = ? WHERE id = ?`)
        .run(actor || null, at, id);
      recalcGroceryListStatus(database, id);
      createAuditRow(database, "grocery.list.lines-changed", "grocery-list", id, actor || null, {
        added: change.add?.length || 0,
        updated: change.update?.length || 0,
        removed: change.remove?.length || 0,
      });
      return groceryListFromRow(
        database,
        database.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(id),
      );
    });
  },

  deleteGroceryList(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(id) as any;
      if (!current) {
        throw new Error("grocery-list-not-found");
      }
      const status = normalizeGroceryListStatus(current.status);
      if (status !== "draft") {
        throw new Error("grocery-list-delete-only-draft");
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
    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return getDb()
      .prepare(
        `SELECT * FROM grocery_purchase_lines
         ${whereSql}
         ORDER BY purchased_at DESC, created_at DESC
         ${limitSql}`,
      )
      .all(...params)
      .map(groceryPurchaseFromRow);
  },

  createGroceryPurchaseHeader(input: GroceryPurchaseHeaderCreateInput, actor?: string | null) {
    const coverage = input.coverage;
    if (coverage !== "pending" && coverage !== "selected" && coverage !== "none") {
      throw new Error("grocery-purchase-empty-coverage");
    }
    const buyingListId = normalizeText(input.buyingListId) || null;
    if (coverage === "none" && buyingListId) {
      throw new Error("grocery-purchase-linked-none");
    }
    if ((coverage === "pending" || coverage === "selected") && !buyingListId) {
      throw new Error("grocery-purchase-empty-coverage");
    }
    const total = parsePositiveMoney(input.total);
    const totalPaise = rupeesToPaise(total);
    const purchaseDate = Number(input.purchaseDate || now());
    assertGroceryPurchaseDate(purchaseDate);
    const paymentMethod =
      optionalGroceryText(input.paymentMethod, 40, "grocery-payment-method-too-long") || "cash";
    const invoiceNumber = optionalGroceryText(
      input.invoiceNumber,
      80,
      "grocery-notes-too-long",
    );
    const notes = optionalGroceryText(input.notes, 500, "grocery-notes-too-long");
    const at = now();
    return inTransaction((database) => {
      if (buyingListId) {
        const list = database
          .prepare("SELECT id FROM grocery_lists WHERE id = ?")
          .get(buyingListId);
        if (!list) {
          throw new Error("grocery-list-not-found");
        }
      }
      const vendorId = resolvePurchaseVendor(
        database,
        { vendorId: input.vendorId, vendorName: input.vendorName },
        actor || null,
        at,
      );
      const vendorName = vendorId
        ? ((
            database.prepare(`SELECT name FROM vendors WHERE id = ?`).get(vendorId) as
              | { name: string }
              | undefined
          )?.name ?? null)
        : null;

      let coverRows: any[] = [];
      const selectedById = new Map(
        (input.lines || []).map((line) => [line.listLineId, line] as const),
      );
      if (coverage === "pending") {
        coverRows = pendingGroceryListLines(database, buyingListId as string);
        if (!coverRows.length) {
          throw new Error("grocery-purchase-empty-coverage");
        }
      } else if (coverage === "selected") {
        const ids = (input.lines || []).map((line) => line.listLineId).filter(Boolean);
        if (!ids.length) {
          throw new Error("grocery-purchase-empty-coverage");
        }
        for (const lineId of ids) {
          const row = database
            .prepare(`SELECT * FROM grocery_list_lines WHERE id = ?`)
            .get(lineId) as any;
          if (
            !row ||
            row.list_id !== buyingListId ||
            row.line_status === "purchased" ||
            row.line_status === "skipped"
          ) {
            throw new Error("grocery-purchase-selected-invalid");
          }
          coverRows.push(row);
        }
      }

      assertAmountPaidValid(totalPaise, totalPaise);
      const purchaseHeaderId = `grocery-purchase-hdr:${randomUUID()}`;
      database
        .prepare(
          `INSERT INTO grocery_purchases (
             id, buying_list_id, vendor_id, purchase_date, invoice_number, payment_method,
             status, payment_status, amount_paid_paise, subtotal_paise, tax_paise, total_paise,
             notes, migration_source, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'recorded', 'paid', ?, ?, 0, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(
          purchaseHeaderId,
          buyingListId,
          vendorId,
          purchaseDate,
          invoiceNumber,
          paymentMethod,
          totalPaise,
          totalPaise,
          totalPaise,
          notes,
          actor || null,
          at,
          at,
        );

      let allocatedPaise = 0;
      for (const row of coverRows) {
        const extra = selectedById.get(row.id);
        const quantity =
          extra && extra.quantity !== undefined && extra.quantity !== null
            ? parseExplicitReceivedQuantity(extra.quantity)
            : Number(row.quantity) || 1;
        const unit = extra?.unit ? normalizeGroceryUnit(extra.unit) : row.unit;
        const unitPrice =
          extra?.unitPrice == null || extra.unitPrice === undefined
            ? null
            : parseNonNegativeMoney(extra.unitPrice);
        const explicitTotal =
          extra?.lineTotal == null || extra.lineTotal === undefined
            ? null
            : parseNonNegativeMoney(extra.lineTotal);
        const lineTotalPaise =
          coverRows.length === 1
            ? totalPaise
            : explicitTotal != null
              ? rupeesToPaise(explicitTotal)
              : unitPrice != null
                ? rupeesToPaise(+(unitPrice * quantity).toFixed(2))
                : 0;
        const unitPricePaise = unitPrice == null ? null : rupeesToPaise(unitPrice);
        allocatedPaise += lineTotalPaise;
        if (allocatedPaise > totalPaise) {
          throw new Error("grocery-purchase-lines-exceed-total");
        }
        coverGroceryListLine(database, row, at, {
          quantity,
          unitPricePaise,
          totalPaise: lineTotalPaise,
        });
        insertGroceryPurchaseLine(database, {
          id: `grocery-purchase:${randomUUID()}`,
          purchaseId: purchaseHeaderId,
          listId: buyingListId,
          listLineId: row.id,
          groceryItemId: row.grocery_item_id || null,
          itemName: row.item_name,
          category: row.category || null,
          quantity,
          unit,
          unitPricePaise,
          totalPaise: lineTotalPaise,
          vendor: vendorName,
          vendorId,
          paymentMethod,
          notes,
          purchasedAt: purchaseDate,
          actor: actor || null,
          at,
        });
      }

      createAuditRow(
        database,
        "grocery.purchase.created",
        "grocery-purchase",
        purchaseHeaderId,
        actor || null,
        { coverage, lineCount: coverRows.length, total: paiseToRupees(totalPaise) },
      );
      if (buyingListId) {
        recalcGroceryListStatus(database, buyingListId);
      }
      const header = database
        .prepare(
          `SELECT p.*, v.name AS vendor_name, gl.title AS buying_list_title
           FROM grocery_purchases p
           LEFT JOIN vendors v ON v.id = p.vendor_id
           LEFT JOIN grocery_lists gl ON gl.id = p.buying_list_id
           WHERE p.id = ?`,
        )
        .get(purchaseHeaderId);
      return groceryPurchaseHeaderFromRow(database, header);
    });
  },

  /** Edits money and bill details. Which items a bill covers is fixed; void and re-record to change it. */
  updateGroceryPurchaseHeader(
    id: string,
    input: GroceryPurchaseHeaderUpdateInput,
    actor?: string | null,
  ) {
    return inTransaction((database) => {
      const current = database
        .prepare("SELECT * FROM grocery_purchases WHERE id = ?")
        .get(id) as any;
      if (!current) {
        throw new Error("grocery-purchase-not-found");
      }
      if (current.status !== "recorded") {
        throw new Error("grocery-purchase-voided");
      }
      const at = now();
      const totalPaise =
        input.total === undefined ? Number(current.total_paise) : rupeesToPaise(parsePositiveMoney(input.total));
      const purchaseDate =
        input.purchaseDate === undefined ? Number(current.purchase_date) : Number(input.purchaseDate);
      assertGroceryPurchaseDate(purchaseDate);
      const paymentMethod =
        input.paymentMethod === undefined
          ? current.payment_method
          : optionalGroceryText(input.paymentMethod, 40, "grocery-payment-method-too-long") || "cash";
      const invoiceNumber =
        input.invoiceNumber === undefined
          ? current.invoice_number
          : optionalGroceryText(input.invoiceNumber, 80, "grocery-notes-too-long");
      const vendorId =
        input.vendorId === undefined && input.vendorName === undefined
          ? current.vendor_id
          : resolvePurchaseVendor(
              database,
              { vendorId: input.vendorId, vendorName: input.vendorName },
              actor || null,
              at,
            );
      const vendorName = vendorId
        ? ((
            database.prepare(`SELECT name FROM vendors WHERE id = ?`).get(vendorId) as
              | { name: string }
              | undefined
          )?.name ?? null)
        : null;

      const purchaseLines = database
        .prepare(`SELECT * FROM grocery_purchase_lines WHERE purchase_id = ?`)
        .all(id) as any[];
      const edits = new Map((input.lines || []).map((line) => [line.purchaseLineId, line] as const));
      for (const lineId of edits.keys()) {
        if (!purchaseLines.some((line) => line.id === lineId)) {
          throw new Error("grocery-purchase-selected-invalid");
        }
      }
      const nextQuantities = purchaseLines.map((line) => {
        const edit = edits.get(line.id);
        if (edit && edit.quantity !== undefined && edit.quantity !== null) {
          return parseExplicitReceivedQuantity(edit.quantity);
        }
        return Number(line.quantity) || 1;
      });
      const nextLineTotals = purchaseLines.map((line) => {
        const edit = edits.get(line.id);
        if (edit && edit.lineTotal !== undefined) {
          return edit.lineTotal == null ? 0 : rupeesToPaise(parseNonNegativeMoney(edit.lineTotal));
        }
        return Number(line.total_paise) || 0;
      });
      if (nextLineTotals.length === 1) {
        nextLineTotals[0] = totalPaise;
      }
      const allocated = nextLineTotals.reduce((sum, value) => sum + value, 0);
      if (allocated > totalPaise) {
        throw new Error("grocery-purchase-lines-exceed-total");
      }

      database
        .prepare(
          `UPDATE grocery_purchases
           SET vendor_id = ?, purchase_date = ?, invoice_number = ?, payment_method = ?,
               amount_paid_paise = ?, subtotal_paise = ?, total_paise = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(vendorId, purchaseDate, invoiceNumber, paymentMethod, totalPaise, totalPaise, totalPaise, at, id);

      purchaseLines.forEach((line, index) => {
        const lineTotalPaise = nextLineTotals[index];
        const quantity = nextQuantities[index];
        const unitPricePaise =
          lineTotalPaise > 0 ? Math.round(lineTotalPaise / quantity) : line.unit_price_paise ?? null;
        database
          .prepare(
            `UPDATE grocery_purchase_lines
             SET quantity = ?, total_paise = ?, unit_price_paise = ?, vendor = ?, vendor_id = ?,
                 payment_method = ?, purchased_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            quantity,
            lineTotalPaise,
            lineTotalPaise > 0 ? unitPricePaise : null,
            vendorName,
            vendorId,
            paymentMethod,
            purchaseDate,
            at,
            line.id,
          );
        if (line.list_line_id) {
          database
            .prepare(
              `UPDATE grocery_list_lines
               SET purchased_quantity = ?, purchased_total_paise = ?, purchased_unit_price_paise = ?, updated_at = ?
               WHERE id = ? AND line_status = 'purchased'`,
            )
            .run(
              quantity,
              lineTotalPaise > 0 ? lineTotalPaise : null,
              lineTotalPaise > 0 ? unitPricePaise : null,
              at,
              line.list_line_id,
            );
        }
      });

      createAuditRow(database, "grocery.purchase.updated", "grocery-purchase", id, actor || null, {
        oldTotalPaise: current.total_paise,
        totalPaise,
      });
      const header = database
        .prepare(
          `SELECT p.*, v.name AS vendor_name, gl.title AS buying_list_title
           FROM grocery_purchases p
           LEFT JOIN vendors v ON v.id = p.vendor_id
           LEFT JOIN grocery_lists gl ON gl.id = p.buying_list_id
           WHERE p.id = ?`,
        )
        .get(id);
      return groceryPurchaseHeaderFromRow(database, header);
    });
  },

  createGroceryPurchase(input: Partial<GroceryPurchaseLineDto>, actor?: string | null) {
    const prepared = prepareGroceryPurchaseInput(input);
    const id = `grocery-purchase:${randomUUID()}`;
    const at = now();
    return inTransaction((database) => {
      const vendorId = ensureVendorId(database, prepared.vendor, actor || null, at);
      const totalPaise = rupeesToPaise(prepared.totalAmount);
      assertAmountPaidValid(totalPaise, totalPaise);
      const purchaseHeaderId = `grocery-purchase-hdr:${randomUUID()}`;
      database
        .prepare(
          `INSERT INTO grocery_purchases (
             id, buying_list_id, vendor_id, purchase_date, invoice_number, payment_method,
             status, payment_status, amount_paid_paise, subtotal_paise, tax_paise, total_paise,
             notes, migration_source, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, NULL, ?, 'recorded', 'paid', ?, ?, 0, ?, NULL, NULL, ?, ?, ?)`,
        )
        .run(
          purchaseHeaderId,
          prepared.listId,
          vendorId,
          prepared.purchasedAt,
          prepared.paymentMethod,
          totalPaise,
          totalPaise,
          totalPaise,
          actor || null,
          at,
          at,
        );
      const isWholeList =
        !prepared.groceryItemId &&
        normalizeText(prepared.itemName).toLowerCase() ===
          GROCERY_LIST_TOTAL_ITEM_NAME.toLowerCase() &&
        normalizeText(prepared.category).toLowerCase() === GROCERY_LIST_TOTAL_CATEGORY.toLowerCase();
      const pending = prepared.listId ? pendingGroceryListLines(database, prepared.listId) : [];
      let matched = pending.find(
        (row) =>
          (prepared.groceryItemId && row.grocery_item_id === prepared.groceryItemId) ||
          normalizeText(row.item_name).toLowerCase() === prepared.itemName.toLowerCase(),
      );
      insertGroceryPurchaseLine(database, {
        id,
        purchaseId: purchaseHeaderId,
        listId: prepared.listId,
        listLineId: isWholeList ? null : matched?.id || null,
        groceryItemId: prepared.groceryItemId,
        itemName: prepared.itemName,
        category: prepared.category,
        quantity: prepared.quantity,
        unit: prepared.unit,
        unitPricePaise: prepared.unitPrice === null ? null : rupeesToPaise(prepared.unitPrice),
        totalPaise,
        vendor: prepared.vendor,
        vendorId,
        paymentMethod: prepared.paymentMethod,
        notes: prepared.notes,
        purchasedAt: prepared.purchasedAt,
        actor: actor || null,
        at,
      });
      createAuditRow(database, "grocery.purchase.created", "grocery-purchase", id, actor || null, {
        itemName: prepared.itemName,
        totalAmount: prepared.totalAmount,
        purchaseId: purchaseHeaderId,
      });
      if (prepared.listId) {
        if (isWholeList) {
          for (const row of pending) {
            coverGroceryListLine(database, row, at, {
              quantity: Number(row.quantity) || 1,
              unitPricePaise: null,
              totalPaise: 0,
            });
          }
        } else if (matched) {
          coverGroceryListLine(database, matched, at, {
            quantity: prepared.quantity,
            unitPricePaise: prepared.unitPrice == null ? null : rupeesToPaise(prepared.unitPrice),
            totalPaise,
          });
        }
        recalcGroceryListStatus(database, prepared.listId);
      }
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
        .prepare("SELECT * FROM grocery_purchase_lines WHERE id = ?")
        .get(id) as any;
      if (!current) {
        throw new Error("grocery-purchase-not-found");
      }
      // Recorded purchases are voided, never hard-deleted.
      if (current.purchase_id) {
        database
          .prepare(
            `UPDATE grocery_purchases
             SET status = 'voided', updated_at = ?
             WHERE id = ? AND status != 'voided'`,
          )
          .run(now(), current.purchase_id);
        createAuditRow(
          database,
          "grocery.purchase.voided",
          "grocery-purchase",
          current.purchase_id,
          actor || null,
          { lineId: id },
        );
        return { ok: true };
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

  listVendors(opts: { includeInactive?: boolean; search?: string } = {}): VendorDto[] {
    const clauses: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    if (!opts.includeInactive) {
      clauses.push("active = 1");
    }
    if (opts.search) {
      clauses.push("(name LIKE ? OR phone LIKE ? OR contact_person LIKE ?)");
      const q = `%${String(opts.search).trim()}%`;
      params.push(q, q, q);
    }
    return getDb()
      .prepare(`SELECT * FROM vendors WHERE ${clauses.join(" AND ")} ORDER BY lower(name) ASC`)
      .all(...params)
      .map(vendorFromRow);
  },

  createVendor(
    input: {
      name: string;
      contactPerson?: string | null;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      gstin?: string | null;
      notes?: string | null;
    },
    actor?: string | null,
  ): VendorDto {
    const name = normalizeText(input.name);
    if (!name) {
      throw new Error("vendor-name-required");
    }
    const at = now();
    const id = `vendor:${randomUUID()}`;
    return inTransaction((database) => {
      const existing = database
        .prepare(
          `SELECT id FROM vendors WHERE deleted_at IS NULL AND name = ? COLLATE NOCASE LIMIT 1`,
        )
        .get(name);
      if (existing) {
        throw new Error("vendor-name-duplicate");
      }
      database
        .prepare(
          `INSERT INTO vendors (
             id, name, contact_person, phone, email, address, gstin, notes,
             active, created_by, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          name,
          optionalGroceryText(input.contactPerson, 120, "vendor-contact-too-long"),
          optionalGroceryText(input.phone, 40, "vendor-phone-too-long"),
          optionalGroceryText(input.email, 120, "vendor-email-too-long"),
          optionalGroceryText(input.address, 300, "vendor-address-too-long"),
          optionalGroceryText(input.gstin, 20, "vendor-gstin-too-long"),
          optionalGroceryText(input.notes, 500, "vendor-notes-too-long"),
          actor || null,
          at,
          at,
        );
      createAuditRow(database, "vendor.created", "vendor", id, actor || null, { name });
      return vendorFromRow(database.prepare("SELECT * FROM vendors WHERE id = ?").get(id));
    });
  },

  updateVendor(id: string, updates: Partial<VendorDto>, actor?: string | null): VendorDto {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM vendors WHERE id = ?").get(id) as any;
      if (!current || current.deleted_at) {
        throw new Error("vendor-not-found");
      }
      const name =
        updates.name === undefined ? current.name : normalizeText(updates.name) || current.name;
      database
        .prepare(
          `UPDATE vendors SET
             name = ?, contact_person = ?, phone = ?, email = ?, address = ?, gstin = ?, notes = ?,
             active = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          name,
          updates.contactPerson === undefined
            ? current.contact_person
            : optionalGroceryText(updates.contactPerson, 120, "vendor-contact-too-long"),
          updates.phone === undefined
            ? current.phone
            : optionalGroceryText(updates.phone, 40, "vendor-phone-too-long"),
          updates.email === undefined
            ? current.email
            : optionalGroceryText(updates.email, 120, "vendor-email-too-long"),
          updates.address === undefined
            ? current.address
            : optionalGroceryText(updates.address, 300, "vendor-address-too-long"),
          updates.gstin === undefined
            ? current.gstin
            : optionalGroceryText(updates.gstin, 20, "vendor-gstin-too-long"),
          updates.notes === undefined
            ? current.notes
            : optionalGroceryText(updates.notes, 500, "vendor-notes-too-long"),
          updates.active === undefined ? current.active : updates.active ? 1 : 0,
          now(),
          id,
        );
      createAuditRow(database, "vendor.updated", "vendor", id, actor || null, {
        fields: Object.keys(updates || {}).sort(),
      });
      return vendorFromRow(database.prepare("SELECT * FROM vendors WHERE id = ?").get(id));
    });
  },

  deleteVendor(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM vendors WHERE id = ?").get(id) as any;
      if (!current || current.deleted_at) {
        throw new Error("vendor-not-found");
      }
      database
        .prepare("UPDATE vendors SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?")
        .run(now(), now(), id);
      createAuditRow(database, "vendor.deleted", "vendor", id, actor || null, {});
      return { ok: true };
    });
  },

  listGroceryPurchaseHeaders(
    opts: {
      from?: number;
      to?: number;
      listId?: string;
      vendorId?: string;
      includeVoided?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): GroceryPurchaseDto[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (!opts.includeVoided) {
      clauses.push("p.status = 'recorded'");
    }
    if (opts.from != null) {
      clauses.push("p.purchase_date >= ?");
      params.push(opts.from);
    }
    if (opts.to != null) {
      clauses.push("p.purchase_date <= ?");
      params.push(opts.to);
    }
    if (opts.listId) {
      clauses.push("p.buying_list_id = ?");
      params.push(opts.listId);
    }
    if (opts.vendorId) {
      clauses.push("p.vendor_id = ?");
      params.push(opts.vendorId);
    }
    const limit = Math.min(200, Math.max(1, Number(opts.limit || 50)));
    const offset = Math.max(0, Number(opts.offset || 0));
    params.push(limit, offset);
    const database = getDb();
    const rows = database
      .prepare(
        `SELECT p.*, v.name AS vendor_name, gl.title AS buying_list_title
         FROM grocery_purchases p
         LEFT JOIN vendors v ON v.id = p.vendor_id
         LEFT JOIN grocery_lists gl ON gl.id = p.buying_list_id
         ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
         ORDER BY p.purchase_date DESC, p.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params) as any[];
    const linesByPurchase = batchGroceryPurchaseLines(
      database,
      rows.map((row) => row.id),
    );
    return rows.map((row: any) =>
      groceryPurchaseHeaderFromRow(database, row, linesByPurchase.get(row.id)),
    );
  },

  voidGroceryPurchaseHeader(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database
        .prepare("SELECT * FROM grocery_purchases WHERE id = ?")
        .get(id) as any;
      if (!current) {
        throw new Error("grocery-purchase-not-found");
      }
      if (current.status === "voided") {
        return { ok: true };
      }
      const at = now();
      database
        .prepare("UPDATE grocery_purchases SET status = 'voided', updated_at = ? WHERE id = ?")
        .run(at, id);
      const listId = current.buying_list_id as string | null;
      if (listId) {
        const purchaseLines = database
          .prepare(
            `SELECT list_line_id, grocery_item_id, item_name, category
             FROM grocery_purchase_lines WHERE purchase_id = ?`,
          )
          .all(id) as Array<{
          list_line_id: string | null;
          grocery_item_id: string | null;
          item_name: string;
          category: string | null;
        }>;
        const resetLine = (lineId: string) => {
          database
            .prepare(
              `UPDATE grocery_list_lines
               SET line_status = 'pending',
                   purchased_quantity = NULL,
                   purchased_unit_price_paise = NULL,
                   purchased_total_paise = NULL,
                   updated_at = ?
               WHERE id = ?`,
            )
            .run(at, lineId);
        };
        const linkedIds = purchaseLines.map((line) => line.list_line_id).filter(Boolean) as string[];
        if (linkedIds.length) {
          for (const lineId of linkedIds) {
            resetLine(lineId);
          }
        } else {
          const isWholeList = purchaseLines.some(
            (line) =>
              normalizeText(line.item_name).toLowerCase() ===
                GROCERY_LIST_TOTAL_ITEM_NAME.toLowerCase() &&
              normalizeText(line.category).toLowerCase() ===
                GROCERY_LIST_TOTAL_CATEGORY.toLowerCase(),
          );
          if (isWholeList) {
            database
              .prepare(
                `UPDATE grocery_list_lines
                 SET line_status = 'pending',
                     purchased_quantity = NULL,
                     purchased_unit_price_paise = NULL,
                     purchased_total_paise = NULL,
                     updated_at = ?
                 WHERE list_id = ? AND line_status = 'purchased'`,
              )
              .run(at, listId);
          } else {
            for (const line of purchaseLines) {
              database
                .prepare(
                  `UPDATE grocery_list_lines
                   SET line_status = 'pending',
                       purchased_quantity = NULL,
                       purchased_unit_price_paise = NULL,
                       purchased_total_paise = NULL,
                       updated_at = ?
                   WHERE list_id = ?
                     AND (
                       (? IS NOT NULL AND grocery_item_id = ?)
                       OR lower(item_name) = lower(?)
                     )`,
                )
                .run(at, listId, line.grocery_item_id, line.grocery_item_id, line.item_name);
            }
          }
        }
        recalcGroceryListStatus(database, listId);
      }
      createAuditRow(database, "grocery.purchase.voided", "grocery-purchase", id, actor || null, {
        oldTotalPaise: current.total_paise,
      });
      return { ok: true };
    });
  },

  listExpenseCategories(opts: { includeInactive?: boolean } = {}): ExpenseCategoryDto[] {
    const clauses = ["deleted_at IS NULL"];
    if (!opts.includeInactive) {
      clauses.push("active = 1");
    }
    return getDb()
      .prepare(
        `SELECT * FROM expense_categories WHERE ${clauses.join(" AND ")} ORDER BY sort_order ASC, name ASC`,
      )
      .all()
      .map(expenseCategoryFromRow);
  },

  listExpenses(
    opts: { from?: number; to?: number; categoryId?: string; limit?: number; offset?: number } = {},
  ): ExpenseDto[] {
    const clauses = ["e.deleted_at IS NULL"];
    const params: unknown[] = [];
    if (opts.from != null) {
      clauses.push("e.expense_date >= ?");
      params.push(opts.from);
    }
    if (opts.to != null) {
      clauses.push("e.expense_date <= ?");
      params.push(opts.to);
    }
    if (opts.categoryId) {
      clauses.push("e.category_id = ?");
      params.push(opts.categoryId);
    }
    const limit = Math.min(200, Math.max(1, Number(opts.limit || 50)));
    const offset = Math.max(0, Number(opts.offset || 0));
    params.push(limit, offset);
    return getDb()
      .prepare(
        `SELECT e.*, c.name AS category_name, v.name AS vendor_name
         FROM expenses e
         JOIN expense_categories c ON c.id = e.category_id
         LEFT JOIN vendors v ON v.id = e.vendor_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY e.expense_date DESC, e.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params)
      .map(expenseFromRow);
  },

  createExpense(
    input: {
      categoryId: string;
      amount: number;
      expenseDate?: number;
      vendorId?: string | null;
      description?: string | null;
      paymentMethod?: string | null;
      invoiceNumber?: string | null;
    },
    actor?: string | null,
  ): ExpenseDto {
    const amount = parsePositiveMoney(input.amount);
    if (amount === null) {
      throw new Error("expense-amount-invalid");
    }
    const expenseDate = Number(input.expenseDate || now());
    if (!Number.isFinite(expenseDate) || expenseDate <= 0) {
      throw new Error("expense-date-invalid");
    }
    const id = `expense:${randomUUID()}`;
    const at = now();
    return inTransaction((database) => {
      const category = database
        .prepare("SELECT id FROM expense_categories WHERE id = ? AND deleted_at IS NULL")
        .get(input.categoryId);
      if (!category) {
        throw new Error("expense-category-not-found");
      }
      database
        .prepare(
          `INSERT INTO expenses (
             id, category_id, amount_paise, expense_date, vendor_id, description,
             payment_method, invoice_number, recurring_expense_id, created_by, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          input.categoryId,
          rupeesToPaise(amount),
          expenseDate,
          input.vendorId || null,
          optionalGroceryText(input.description, 500, "expense-description-too-long"),
          optionalGroceryText(input.paymentMethod, 40, "expense-payment-method-too-long"),
          optionalGroceryText(input.invoiceNumber, 80, "expense-invoice-too-long"),
          actor || null,
          at,
          at,
        );
      createAuditRow(database, "expense.created", "expense", id, actor || null, { amount });
      return expenseFromRow(
        database
          .prepare(
            `SELECT e.*, c.name AS category_name, v.name AS vendor_name
             FROM expenses e
             JOIN expense_categories c ON c.id = e.category_id
             LEFT JOIN vendors v ON v.id = e.vendor_id
             WHERE e.id = ?`,
          )
          .get(id),
      );
    });
  },

  updateExpense(id: string, updates: Partial<ExpenseDto>, actor?: string | null): ExpenseDto {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as any;
      if (!current || current.deleted_at) {
        throw new Error("expense-not-found");
      }
      const amount =
        updates.amount === undefined
          ? paiseToRupees(current.amount_paise)
          : parsePositiveMoney(updates.amount);
      if (amount === null) {
        throw new Error("expense-amount-invalid");
      }
      const expenseDate =
        updates.expenseDate === undefined ? current.expense_date : Number(updates.expenseDate);
      database
        .prepare(
          `UPDATE expenses SET
             category_id = ?, amount_paise = ?, expense_date = ?, vendor_id = ?, description = ?,
             payment_method = ?, invoice_number = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          updates.categoryId === undefined ? current.category_id : updates.categoryId,
          rupeesToPaise(amount),
          expenseDate,
          updates.vendorId === undefined ? current.vendor_id : updates.vendorId || null,
          updates.description === undefined
            ? current.description
            : optionalGroceryText(updates.description, 500, "expense-description-too-long"),
          updates.paymentMethod === undefined
            ? current.payment_method
            : optionalGroceryText(updates.paymentMethod, 40, "expense-payment-method-too-long"),
          updates.invoiceNumber === undefined
            ? current.invoice_number
            : optionalGroceryText(updates.invoiceNumber, 80, "expense-invoice-too-long"),
          now(),
          id,
        );
      createAuditRow(database, "expense.updated", "expense", id, actor || null, {
        oldAmount: paiseToRupees(current.amount_paise),
        newAmount: amount,
      });
      return expenseFromRow(
        database
          .prepare(
            `SELECT e.*, c.name AS category_name, v.name AS vendor_name
             FROM expenses e
             JOIN expense_categories c ON c.id = e.category_id
             LEFT JOIN vendors v ON v.id = e.vendor_id
             WHERE e.id = ?`,
          )
          .get(id),
      );
    });
  },

  voidExpense(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as any;
      if (!current || current.deleted_at) {
        throw new Error("expense-not-found");
      }
      database
        .prepare("UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .run(now(), now(), id);
      createAuditRow(database, "expense.voided", "expense", id, actor || null, {
        amount: paiseToRupees(current.amount_paise),
      });
      return { ok: true };
    });
  },

  listSalaryAdvances(
    opts: { from?: number; to?: number; staffId?: string; limit?: number; offset?: number } = {},
  ): SalaryAdvanceDto[] {
    const clauses = ["a.deleted_at IS NULL"];
    const params: unknown[] = [];
    if (opts.from != null) {
      clauses.push("a.advance_date >= ?");
      params.push(opts.from);
    }
    if (opts.to != null) {
      clauses.push("a.advance_date <= ?");
      params.push(opts.to);
    }
    if (opts.staffId) {
      clauses.push("a.staff_id = ?");
      params.push(opts.staffId);
    }
    const limit = Math.min(500, Math.max(1, Number(opts.limit || 200)));
    const offset = Math.max(0, Number(opts.offset || 0));
    params.push(limit, offset);
    return getDb()
      .prepare(
        `SELECT a.*, s.name AS staff_name, s.designation AS staff_designation
         FROM salary_advances a
         JOIN staff s ON s.id = a.staff_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY a.advance_date ASC, a.created_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params)
      .map(salaryAdvanceFromRow);
  },

  createSalaryAdvance(
    input: {
      staffId: string;
      amount: number;
      advanceDate?: number;
      note?: string | null;
    },
    actor?: string | null,
  ): SalaryAdvanceDto {
    const amount = parsePositiveMoney(input.amount);
    if (amount === null) {
      throw new Error("salary-advance-amount-invalid");
    }
    const advanceDate = Number(input.advanceDate || now());
    if (!Number.isFinite(advanceDate) || advanceDate <= 0) {
      throw new Error("salary-advance-date-invalid");
    }
    const staffId = normalizeText(input.staffId);
    if (!staffId) {
      throw new Error("salary-advance-staff-required");
    }
    const id = `salary-advance:${randomUUID()}`;
    const at = now();
    return inTransaction((database) => {
      const staff = database.prepare("SELECT id FROM staff WHERE id = ?").get(staffId);
      if (!staff) {
        throw new Error("salary-advance-staff-not-found");
      }
      database
        .prepare(
          `INSERT INTO salary_advances (
             id, staff_id, amount_paise, advance_date, note, created_by, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          staffId,
          rupeesToPaise(amount),
          advanceDate,
          optionalGroceryText(input.note, 500, "salary-advance-note-too-long"),
          actor || null,
          at,
          at,
        );
      createAuditRow(database, "salary_advance.created", "salary-advance", id, actor || null, {
        staffId,
        amount,
      });
      return salaryAdvanceFromRow(
        database
          .prepare(
            `SELECT a.*, s.name AS staff_name, s.designation AS staff_designation
             FROM salary_advances a
             JOIN staff s ON s.id = a.staff_id
             WHERE a.id = ?`,
          )
          .get(id),
      );
    });
  },

  voidSalaryAdvance(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT * FROM salary_advances WHERE id = ?").get(id) as any;
      if (!current || current.deleted_at) {
        throw new Error("salary-advance-not-found");
      }
      database
        .prepare("UPDATE salary_advances SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .run(now(), now(), id);
      createAuditRow(database, "salary_advance.voided", "salary-advance", id, actor || null, {
        staffId: current.staff_id,
        amount: paiseToRupees(current.amount_paise),
      });
      return { ok: true };
    });
  },

  listBuyingListTemplates(): BuyingListTemplateDto[] {
    const database = getDb();
    return database
      .prepare(
        `SELECT * FROM grocery_list_templates
         WHERE deleted_at IS NULL AND active = 1
         ORDER BY lower(name) ASC`,
      )
      .all()
      .map((row: any) => buyingListTemplateFromRow(database, row));
  },

  createBuyingListTemplate(
    input: {
      name: string;
      description?: string | null;
      lines?: Partial<BuyingListTemplateLineDto>[];
      sourceListId?: string;
    },
    actor?: string | null,
  ): BuyingListTemplateDto {
    const name = normalizeText(input.name);
    if (!name) {
      throw new Error("template-name-required");
    }
    if (name.length > TEXT_LIMITS.templateName) {
      throw new Error("template-name-too-long");
    }
    const id = `grocery-list-template:${randomUUID()}`;
    const at = now();
    return inTransaction((database) => {
      let lines = input.lines || [];
      if ((!lines || !lines.length) && input.sourceListId) {
        lines = (
          database
            .prepare(`SELECT * FROM grocery_list_lines WHERE list_id = ? ORDER BY sort_order ASC`)
            .all(input.sourceListId) as any[]
        ).map((line) => ({
          groceryItemId: line.grocery_item_id,
          itemName: line.item_name,
          category: line.category,
          defaultQuantity: line.quantity,
          unit: line.unit,
        }));
      }
      database
        .prepare(
          `INSERT INTO grocery_list_templates (
             id, name, description, active, created_by, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, 1, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          name,
          optionalGroceryText(input.description, 300, "template-description-too-long"),
          actor || null,
          at,
          at,
        );
      const insertLine = database.prepare(
        `INSERT INTO grocery_list_template_lines (
           id, template_id, grocery_item_id, item_name, category, default_quantity, unit,
           sort_order, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      lines.forEach((line, index) => {
        const itemName = normalizeText(line.itemName);
        if (!itemName) {
          return;
        }
        insertLine.run(
          `grocery-list-template-line:${randomUUID()}`,
          id,
          line.groceryItemId || null,
          itemName,
          optionalGroceryText(line.category, 80, "grocery-category-too-long"),
          line.defaultQuantity == null ? null : Number(line.defaultQuantity),
          normalizeGroceryUnit(line.unit || "unit"),
          index,
          at,
          at,
        );
      });
      createAuditRow(
        database,
        "grocery.template.created",
        "grocery-list-template",
        id,
        actor || null,
        {
          name,
        },
      );
      return buyingListTemplateFromRow(
        database,
        database.prepare("SELECT * FROM grocery_list_templates WHERE id = ?").get(id),
      );
    });
  },

  deleteBuyingListTemplate(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database
        .prepare("SELECT * FROM grocery_list_templates WHERE id = ?")
        .get(id) as any;
      if (!current || current.deleted_at) {
        throw new Error("template-not-found");
      }
      database
        .prepare(
          "UPDATE grocery_list_templates SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?",
        )
        .run(now(), now(), id);
      createAuditRow(
        database,
        "grocery.template.deleted",
        "grocery-list-template",
        id,
        actor || null,
        {},
      );
      return { ok: true };
    });
  },

  getProfitabilitySummary(opts: { from?: number; to?: number } = {}): ProfitabilitySummaryDto {
    const from = Number(opts.from || 0);
    const to = Number(opts.to || now());
    const sales = this.getSalesFacts({ from, to });
    const revenue = sales.netSales;
    const database = getDb();
    const purchases = this.getGroceryPurchaseAnalysis({ from, to }).summary.purchaseTotal;
    const foodCostAmount = purchases;
    const expenseRows = database
      .prepare(
        `SELECT c.id AS category_id, c.name AS category_name, COALESCE(SUM(e.amount_paise), 0) AS amount_paise
         FROM expenses e
         JOIN expense_categories c ON c.id = e.category_id
         WHERE e.deleted_at IS NULL
           AND e.expense_date >= ?
           AND e.expense_date <= ?
         GROUP BY c.id, c.name
         ORDER BY amount_paise DESC`,
      )
      .all(from, to) as Array<{ category_id: string; category_name: string; amount_paise: number }>;
    const operatingExpenses = expenseRows.reduce(
      (sum, row) => sum + paiseToRupees(row.amount_paise),
      0,
    );
    const grossContribution = +(revenue - foodCostAmount).toFixed(2);
    const estimatedOperatingProfit = +(grossContribution - operatingExpenses).toFixed(2);
    const expenseBreakdown = expenseRows.map((row) => {
      const amount = paiseToRupees(row.amount_paise);
      return {
        categoryId: row.category_id,
        categoryName: row.category_name,
        amount: +amount.toFixed(2),
        percentOfRevenue: revenue > 0 ? +((amount / revenue) * 100).toFixed(1) : null,
      };
    });
    const staffCostRecorded = expenseBreakdown.some(
      (row) => row.categoryId === "expense-category:staff" || row.categoryName.trim().toLowerCase() === "staff",
    );
    return {
      from,
      to,
      revenue: +revenue.toFixed(2),
      recordedPurchaseCostPercent:
        revenue > 0 ? +((foodCostAmount / revenue) * 100).toFixed(1) : null,
      staffCostRecorded,
      foodCost: {
        openingInventory: null,
        purchases: +purchases.toFixed(2),
        closingInventory: null,
        amount: +foodCostAmount.toFixed(2),
        basis: "purchases",
      },
      grossContribution,
      operatingExpenses: +operatingExpenses.toFixed(2),
      expenseBreakdown: expenseBreakdown.filter((row) => row.amount !== 0),
      estimatedOperatingProfit,
      operatingMarginPercent:
        revenue > 0 ? +((estimatedOperatingProfit / revenue) * 100).toFixed(1) : null,
      disclaimer:
        "Estimate based on recorded sales, purchases and expenses. Purchase cost is based on purchases recorded during the selected period and is not inventory-adjusted food consumption.",
    };
  },

  getGroceryPurchaseAnalysis(opts: { from?: number; to?: number } = {}): GroceryPurchaseAnalysisDto {
    const from = Number(opts.from ?? 0);
    const to = Number(opts.to ?? now());
    const duration = to - from;
    const database = getDb();
    const periodBills = loadRecordedGroceryBills(database, from, to);
    const previousBills = loadRecordedGroceryBills(database, from - duration, from);
    const historyBills = loadRecordedGroceryBills(database, 0, to);
    return buildGroceryPurchaseAnalysis({ from, to, periodBills, previousBills, historyBills });
  },

  getFoodCostSummary(opts: { from?: number; to?: number } = {}): FoodCostSummaryDto {
    const sales = this.getSalesSummary(opts);
    const database = getDb();
    const clauses = ["l.active = 1", "(l.purchase_id IS NULL OR p.status = 'recorded')"];
    const params: unknown[] = [];
    if (opts.from != null) {
      clauses.push("l.purchased_at >= ?");
      params.push(opts.from);
    }
    if (opts.to != null) {
      clauses.push("l.purchased_at <= ?");
      params.push(opts.to);
    }
    const purchases = (
      database
        .prepare(
          `SELECT l.*
           FROM grocery_purchase_lines l
           LEFT JOIN grocery_purchases p ON p.id = l.purchase_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY l.purchased_at DESC`,
        )
        .all(...params) as any[]
    ).map(groceryPurchaseFromRow);
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

  listCustomers(opts: { filter?: "all" | "outstanding" | "overdue" } = {}): CustomerDto[] {
    const filter = opts?.filter || "all";
    const businessDate = todayDateOnly();
    const database = getDb();
    let sql = "SELECT * FROM customers WHERE active = 1";
    const params: unknown[] = [];
    if (filter === "outstanding") {
      sql += " AND COALESCE(outstanding_paise, 0) > 0";
    } else if (filter === "overdue") {
      sql += ` AND id IN (
        SELECT customer_id FROM customer_account_entries
        WHERE entry_type = 'credit_sale'
          AND remaining_paise > 0
          AND due_date IS NOT NULL
          AND due_date < ?
      )`;
      params.push(businessDate);
    }
    sql += " ORDER BY created_at DESC";
    const rows = database.prepare(sql).all(...params) as any[];
    const overdueByCustomer = new Map<string, number>();
    if (rows.length) {
      try {
        const overdueRows = database
          .prepare(
            `SELECT customer_id, COALESCE(SUM(remaining_paise), 0) AS overdue_paise
             FROM customer_account_entries
             WHERE entry_type = 'credit_sale'
               AND remaining_paise > 0
               AND due_date IS NOT NULL
               AND due_date < ?
             GROUP BY customer_id`,
          )
          .all(businessDate) as Array<{ customer_id: string; overdue_paise: number }>;
        overdueRows.forEach((row) => {
          overdueByCustomer.set(row.customer_id, Math.max(0, Number(row.overdue_paise || 0)));
        });
      } catch {
        // Ledger table may be mid-migration; list customers without overdue badges.
      }
    }
    return rows.map((row) => customerFromRow(row, overdueByCustomer.get(row.id) || 0));
  },

  createCustomer(
    input: {
      name: string;
      phone: string;
      address?: string;
      notes?: string;
      creditEnabled?: boolean;
      creditBlocked?: boolean;
      creditLimit?: number;
      defaultCreditDays?: number | null;
    },
    actor?: string | null,
  ) {
    const name = normalizeText(input.name);
    const phone = normalizePhone(input.phone);
    if (!isValidPersonName(name, { max: CUSTOMER_NAME_LIMIT })) {
      throw new Error("customer-name-invalid");
    }
    if (!isValidIndianMobile(phone)) {
      throw new Error("customer-phone-invalid");
    }
    const id = `customer:${randomUUID()}`;
    const at = now();
    const database = getDb();
    assertUniqueActiveCustomerPhone(database, phone);
    const creditLimitPaise = rupeesToPaise(Number(input.creditLimit || 0));
    const defaultDays =
      input.defaultCreditDays === null || input.defaultCreditDays === undefined
        ? null
        : Math.max(0, Math.min(365, Math.round(Number(input.defaultCreditDays))));
    database
      .prepare(
        `INSERT INTO customers (
           id, name, phone, address, notes, active,
           credit_enabled, credit_blocked, credit_limit_paise, default_credit_days, outstanding_paise,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        name,
        phone,
        optionalLimitedText(input.address, TEXT_LIMITS.address, "customer-address-too-long"),
        optionalLimitedText(input.notes, TEXT_LIMITS.notes, "customer-notes-too-long"),
        input.creditEnabled ? 1 : 0,
        input.creditBlocked ? 1 : 0,
        Math.max(0, creditLimitPaise || 0),
        defaultDays,
        at,
        at,
      );
    if (
      input.creditEnabled ||
      input.creditBlocked ||
      creditLimitPaise > 0 ||
      defaultDays !== null
    ) {
      createAuditRow(database, "customer.credit.updated", "customer", id, actor || null, {
        creditEnabled: Boolean(input.creditEnabled),
        creditBlocked: Boolean(input.creditBlocked),
        creditLimitPaise: Math.max(0, creditLimitPaise || 0),
        defaultCreditDays: defaultDays,
        created: true,
      });
    }
    return this.listCustomers().find((customer) => customer.id === id)!;
  },

  updateCustomer(id: string, updates: Partial<CustomerDto>, actor?: string | null) {
    const current = getDb().prepare("SELECT * FROM customers WHERE id = ?").get(id) as any;
    if (!current) {
      throw new Error("customer-not-found");
    }
    const name = updates.name === undefined ? current.name : normalizeText(updates.name);
    const phone = updates.phone === undefined ? current.phone : normalizePhone(updates.phone);
    if (!isValidPersonName(name, updates.name === undefined ? {} : { max: CUSTOMER_NAME_LIMIT })) {
      throw new Error("customer-name-invalid");
    }
    if (!isValidIndianMobile(phone)) {
      throw new Error("customer-phone-invalid");
    }
    const database = getDb();
    assertUniqueActiveCustomerPhone(database, phone, id);
    const creditEnabled =
      updates.creditEnabled === undefined
        ? Number(current.credit_enabled || 0)
        : updates.creditEnabled
          ? 1
          : 0;
    const creditBlocked =
      updates.creditBlocked === undefined
        ? Number(current.credit_blocked || 0)
        : updates.creditBlocked
          ? 1
          : 0;
    const creditLimitPaise =
      updates.creditLimit === undefined
        ? Number(current.credit_limit_paise || 0)
        : Math.max(0, rupeesToPaise(Number(updates.creditLimit || 0)));
    let defaultCreditDays = current.default_credit_days;
    if (updates.defaultCreditDays !== undefined) {
      defaultCreditDays =
        updates.defaultCreditDays === null
          ? null
          : Math.max(0, Math.min(365, Math.round(Number(updates.defaultCreditDays))));
    }
    database
      .prepare(
        `UPDATE customers SET
           name = ?, phone = ?, address = ?, notes = ?, active = ?,
           credit_enabled = ?, credit_blocked = ?, credit_limit_paise = ?, default_credit_days = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        name,
        phone,
        updates.address === undefined
          ? current.address
          : optionalLimitedText(updates.address, TEXT_LIMITS.address, "customer-address-too-long"),
        updates.notes === undefined
          ? current.notes
          : optionalLimitedText(updates.notes, TEXT_LIMITS.notes, "customer-notes-too-long"),
        updates.active === undefined ? current.active : updates.active ? 1 : 0,
        creditEnabled,
        creditBlocked,
        creditLimitPaise,
        defaultCreditDays,
        now(),
        id,
      );
    if (
      updates.creditEnabled !== undefined ||
      updates.creditBlocked !== undefined ||
      updates.creditLimit !== undefined ||
      updates.defaultCreditDays !== undefined
    ) {
      createAuditRow(database, "customer.credit.updated", "customer", id, actor || null, {
        creditEnabled: Boolean(creditEnabled),
        creditBlocked: Boolean(creditBlocked),
        creditLimitPaise,
        defaultCreditDays,
      });
    }
    return this.listCustomers().find((customer) => customer.id === id) || null;
  },

  deleteCustomer(id: string) {
    const current = getDb().prepare("SELECT * FROM customers WHERE id = ?").get(id) as any;
    if (!current) {
      throw new Error("customer-not-found");
    }
    const outstanding = sumOpenCreditRemainingPaise(getDb(), id);
    if (outstanding > 0) {
      refreshCustomerOutstanding(getDb(), id, outstanding);
      throw new Error("customer-has-outstanding");
    }
    refreshCustomerOutstanding(getDb(), id, 0);
    getDb().prepare("UPDATE customers SET active = 0, updated_at = ? WHERE id = ?").run(now(), id);
    return { ok: true };
  },

  getCustomerAccount(customerId: string): CustomerAccountSummaryDto {
    const database = getDb();
    const customer = database
      .prepare("SELECT * FROM customers WHERE id = ? AND active = 1 LIMIT 1")
      .get(customerId) as any;
    if (!customer) {
      throw new Error("customer-not-found");
    }
    const outstandingPaise = refreshCustomerOutstandingFromLedger(database, customerId);
    const countRow = database
      .prepare(`SELECT COUNT(*) AS total FROM customer_account_entries WHERE customer_id = ?`)
      .get(customerId) as { total: number };
    const outstanding = paiseToRupees(outstandingPaise);
    const overdue = paiseToRupees(sumCustomerOverduePaise(database, customerId));
    const creditLimit = paiseToRupees(customer.credit_limit_paise);
    return {
      customerId,
      outstanding,
      overdue,
      creditLimit,
      availableCredit: Math.max(0, creditLimit - outstanding),
      creditEnabled: Boolean(customer.credit_enabled),
      creditBlocked: Boolean(customer.credit_blocked),
      defaultCreditDays:
        customer.default_credit_days === null || customer.default_credit_days === undefined
          ? null
          : Number(customer.default_credit_days),
      entryCount: Number(countRow?.total || 0),
      entries: [],
    };
  },

  listCustomerAccountEntries(
    customerId: string,
    opts: { limit?: number; offset?: number } = {},
  ): CustomerAccountEntriesPageDto {
    const database = getDb();
    const customer = database
      .prepare("SELECT id FROM customers WHERE id = ? AND active = 1 LIMIT 1")
      .get(customerId) as { id: string } | undefined;
    if (!customer) {
      throw new Error("customer-not-found");
    }
    const limit = Math.max(1, Math.min(100, Math.round(Number(opts.limit ?? 20))));
    const offset = Math.max(0, Math.round(Number(opts.offset ?? 0)));
    const countRow = database
      .prepare(`SELECT COUNT(*) AS total FROM customer_account_entries WHERE customer_id = ?`)
      .get(customerId) as { total: number };
    const total = Number(countRow?.total || 0);
    const entries = database
      .prepare(
        `SELECT * FROM customer_account_entries
         WHERE customer_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(customerId, limit, offset)
      .map(customerAccountEntryFromRow);
    return {
      customerId,
      entries,
      total,
      limit,
      offset,
      hasMore: offset + entries.length < total,
    };
  },

  listCustomerOpenBills(customerId: string): CustomerOpenBillDto[] {
    const database = getDb();
    const customer = database
      .prepare("SELECT id FROM customers WHERE id = ? AND active = 1 LIMIT 1")
      .get(customerId) as { id: string } | undefined;
    if (!customer) {
      throw new Error("customer-not-found");
    }
    const rows = database
      .prepare(
        `SELECT id, invoice_number, description, due_date, amount_paise, remaining_paise, created_at
         FROM customer_account_entries
         WHERE customer_id = ?
           AND entry_type = 'credit_sale'
           AND remaining_paise > 0
         ORDER BY COALESCE(due_date, '9999-12-31') ASC, created_at ASC, id ASC`,
      )
      .all(customerId) as Array<{
      id: string;
      invoice_number: string | null;
      description: string | null;
      due_date: string | null;
      amount_paise: number;
      remaining_paise: number;
      created_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoice_number || null,
      description: row.description || null,
      dueDate: row.due_date || null,
      amount: paiseToRupees(row.amount_paise),
      remaining: paiseToRupees(row.remaining_paise),
      createdAt: Number(row.created_at),
    }));
  },

  receiveCustomerPayment(
    customerId: string,
    input: ReceiveCustomerPaymentInput,
    actor?: string | null,
  ): ReceiveCustomerPaymentResultDto {
    return inTransaction((database) => {
      const payment = receiveCustomerAccountPayment(database, customerId, input, actor);
      return {
        account: this.getCustomerAccount(customerId),
        payment: {
          entryId: payment.entryId,
          amount: paiseToRupees(payment.amountPaise),
          method: payment.method,
          outstandingAfter: paiseToRupees(payment.outstandingPaise),
          allocations: payment.allocations.map((row) => ({
            creditEntryId: row.creditEntryId,
            invoiceNumber: row.invoiceNumber,
            amount: paiseToRupees(row.amountPaise),
          })),
        },
      };
    });
  },

  voidCustomerCreditSale(
    creditEntryId: string,
    input: VoidCustomerCreditSaleInput = {},
    actor?: string | null,
  ): VoidCustomerCreditSaleResultDto {
    return inTransaction((database) => {
      const voided = voidCustomerCreditSaleEntry(database, creditEntryId, input || {}, actor);
      return {
        account: this.getCustomerAccount(voided.customerId),
        voided: {
          entryId: voided.voidEntryId,
          creditEntryId: voided.creditEntryId,
          amount: paiseToRupees(voided.amountPaise),
          outstandingAfter: paiseToRupees(voided.outstandingPaise),
        },
      };
    });
  },

  getCreditCollectionsInRange(opts: { from?: number; to?: number } = {}) {
    const clauses = ["entry_type = 'payment_received'"];
    const params: unknown[] = [];
    if (opts.from !== null && opts.from !== undefined) {
      clauses.push("created_at >= ?");
      params.push(opts.from);
    }
    if (opts.to !== null && opts.to !== undefined) {
      clauses.push("created_at < ?");
      params.push(opts.to);
    }
    const rows = getDb()
      .prepare(
        `SELECT payment_method, SUM(amount_paise) AS amount_paise
         FROM customer_account_entries
         WHERE ${clauses.join(" AND ")}
         GROUP BY payment_method`,
      )
      .all(...params) as Array<{ payment_method: string | null; amount_paise: number }>;
    return rows.reduce((acc: Record<string, number>, row) => {
      const key = String(row.payment_method || "other");
      acc[key] = (acc[key] || 0) + paiseToRupees(row.amount_paise);
      return acc;
    }, {});
  },

  getCustomerCreditTotals() {
    const database = getDb();
    const outstandingRow = database
      .prepare(
        `SELECT COALESCE(SUM(remaining_paise), 0) AS outstanding_paise
         FROM customer_account_entries
         WHERE entry_type = 'credit_sale'
           AND remaining_paise > 0`,
      )
      .get() as { outstanding_paise: number };
    const overdueRow = database
      .prepare(
        `SELECT COALESCE(SUM(remaining_paise), 0) AS overdue_paise
         FROM customer_account_entries
         WHERE entry_type = 'credit_sale'
           AND remaining_paise > 0
           AND due_date IS NOT NULL
           AND due_date < ?`,
      )
      .get(todayDateOnly()) as { overdue_paise: number };
    return {
      outstanding: paiseToRupees(outstandingRow?.outstanding_paise),
      overdue: paiseToRupees(overdueRow?.overdue_paise),
    };
  },

  listStaff(
    opts: {
      includeInactive?: boolean;
      status?: "active" | "left" | "all";
      includePhotos?: boolean;
    } = {},
  ): StaffDto[] {
    const status = opts.status ?? (opts.includeInactive ? "all" : "active");
    const includePhotos = opts.includePhotos === true;
    let where = "";
    if (status === "active") {
      where = "WHERE s.active = 1";
    } else if (status === "left") {
      where = "WHERE s.active = 0";
    }
    const photoCols = includePhotos ? "s.photo_mime, s.photo_base64," : "";
    const sql = `
      SELECT s.id, s.name, s.phone, s.designation, s.joining_date, s.salary_paise,
             s.address, s.notes, s.weekly_off_days, s.default_shift_id,
             ${photoCols} s.active, s.created_at, s.updated_at,
             u.username AS linked_username, u.active AS linked_user_active
      FROM staff s
      LEFT JOIN users u ON u.staff_id = s.id
      ${where}
      ORDER BY s.active DESC, s.created_at DESC
    `;
    return getDb().prepare(sql).all().map(staffFromRow);
  },

  getStaff(id: string): StaffDto | null {
    const row = getDb()
      .prepare(
        `SELECT s.*, u.username AS linked_username, u.active AS linked_user_active
         FROM staff s
         LEFT JOIN users u ON u.staff_id = s.id
         WHERE s.id = ?
         LIMIT 1`,
      )
      .get(normalizeText(id)) as any;
    return row ? staffFromRow(row) : null;
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
    weeklyOffDays?: number[] | null;
    defaultShiftId?: string | null;
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
          photo_mime, photo_base64, weekly_off_days, default_shift_id, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
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
        prepared.weeklyOffDays,
        prepared.defaultShiftId,
        at,
        at,
      );
    createAuditRow(database, "staff.created", "staff", id, null, {
      name: prepared.name,
      phone: prepared.phone,
    });
    return this.getStaff(id)!;
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
      weeklyOffDays:
        updates.weeklyOffDays === undefined
          ? normalizeWeeklyOffDays(current.weekly_off_days)
          : updates.weeklyOffDays,
      defaultShiftId:
        updates.defaultShiftId === undefined ? current.default_shift_id : updates.defaultShiftId,
    });
    assertUniqueActiveStaffPhone(database, prepared.phone, id);
    const nextActive =
      updates.active === undefined ? Number(current.active) : updates.active ? 1 : 0;
    database
      .prepare(
        `UPDATE staff
         SET name = ?, phone = ?, designation = ?, joining_date = ?, salary_paise = ?,
             address = ?, notes = ?, photo_mime = ?, photo_base64 = ?,
             weekly_off_days = ?, default_shift_id = ?, active = ?, updated_at = ?
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
        prepared.weeklyOffDays,
        prepared.defaultShiftId,
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
    return this.getStaff(id);
  },

  deleteStaff(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const current = database.prepare("SELECT id, active FROM staff WHERE id = ?").get(id) as any;
      if (!current) {
        throw new Error("staff-not-found");
      }
      const attendanceCount = (
        database
          .prepare("SELECT COUNT(*) AS count FROM attendance_records WHERE staff_id = ?")
          .get(id) as any
      )?.count;
      if (Number(attendanceCount) > 0) {
        throw new Error("staff-has-attendance");
      }
      const linkedUser = database
        .prepare("SELECT username FROM users WHERE staff_id = ? LIMIT 1")
        .get(id) as any;
      if (linkedUser?.username) {
        throw new Error("staff-has-account");
      }
      const auditCount = (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type = 'staff' AND entity_id = ?",
          )
          .get(id) as any
      )?.count;
      if (Number(auditCount) > 0) {
        throw new Error("staff-has-history");
      }
      database.prepare("DELETE FROM staff WHERE id = ?").run(id);
      createAuditRow(database, "staff.deleted", "staff", id, actor || null, {
        active: Boolean(current.active),
      });
      return { ok: true };
    });
  },

  listAttendance(input: {
    date?: string;
    fromDate?: string;
    toDate?: string;
    shiftId?: string | null;
    status?: AttendanceStatus | null;
    search?: string;
  }): AttendanceDto[] {
    if (input.fromDate && input.toDate) {
      return this.listAttendanceRange({
        fromDate: input.fromDate,
        toDate: input.toDate,
        shiftId: input.shiftId,
        search: input.search,
      });
    }
    if (!input.date) {
      throw new Error("attendance-date-required");
    }
    const date = normalizeAttendanceDate(input.date);
    const clauses = ["ar.attendance_date = ?"];
    const params: unknown[] = [date];
    const shiftId = normalizeText(input.shiftId);
    if (shiftId) {
      clauses.push("COALESCE(ar.shift_id, '') = ?");
      params.push(shiftId);
    }
    if (input.status) {
      clauses.push("ar.status = ?");
      params.push(normalizeAttendanceStatus(input.status));
    }
    const search = normalizeText(input.search).toLowerCase();
    if (search) {
      clauses.push("(lower(s.name) LIKE ? OR lower(COALESCE(s.designation, '')) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    return getDb()
      .prepare(
        `SELECT ar.*, s.name AS staff_name, s.designation AS staff_role
         FROM attendance_records ar
         JOIN staff s ON s.id = ar.staff_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY lower(s.name) ASC, ar.created_on ASC`,
      )
      .all(...params)
      .map(attendanceFromRow);
  },

  listAttendanceRange(input: {
    fromDate: string;
    toDate: string;
    shiftId?: string | null;
    search?: string;
  }): AttendanceDto[] {
    const fromDate = normalizeAttendanceDateFormat(input.fromDate);
    const rawToDate = normalizeAttendanceDateFormat(input.toDate);
    const today = todayDateOnly();
    const toDate = rawToDate > today ? today : rawToDate;
    if (fromDate > toDate) {
      return [];
    }
    const clauses = ["ar.attendance_date >= ?", "ar.attendance_date <= ?"];
    const params: unknown[] = [fromDate, toDate];
    const shiftId = normalizeText(input.shiftId);
    if (shiftId) {
      clauses.push("COALESCE(ar.shift_id, '') = ?");
      params.push(shiftId);
    }
    const search = normalizeText(input.search).toLowerCase();
    if (search) {
      clauses.push("(lower(s.name) LIKE ? OR lower(COALESCE(s.designation, '')) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    return getDb()
      .prepare(
        `SELECT ar.*, s.name AS staff_name, s.designation AS staff_role
         FROM attendance_records ar
         JOIN staff s ON s.id = ar.staff_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY ar.attendance_date ASC, lower(s.name) ASC, ar.created_on ASC`,
      )
      .all(...params)
      .map(attendanceFromRow);
  },

  upsertAttendanceRows(
    input: {
      attendanceDate: string;
      rows: Array<{
        id?: string;
        staffId: string;
        shiftId?: string | null;
        status: AttendanceStatus;
        isLate?: boolean;
        checkInTime?: string | null;
        checkOutTime?: string | null;
        breakMinutes?: number;
        overtimeMinutes?: number | null;
        remarks?: string | null;
      }>;
    },
    actor?: string | null,
  ) {
    const attendanceDate = normalizeAttendanceDate(input.attendanceDate);
    const rows = Array.isArray(input.rows) ? input.rows : [];
    return inTransaction((database) => {
      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const staffId = normalizeText(row.staffId);
        if (!staffId) {
          throw new Error("attendance-staff-required");
        }
        assertAttendanceStaffExists(database, staffId);
        const status = normalizeAttendanceStatus(row.status);
        const isLate = normalizeAttendanceLate(row.isLate, status);
        const shiftKey = normalizeText(row.shiftId) || "morning";
        const shiftId = shiftKey;
        const checkInTime = normalizeAttendanceTime(row.checkInTime);
        const checkOutTime = normalizeAttendanceTime(row.checkOutTime);
        const breakMinutes = normalizeAttendanceBreakMinutes(row.breakMinutes);
        const overtimeOverrideMinutes = normalizeAttendanceOvertimeOverride(row.overtimeMinutes);
        const remarks = optionalLimitedText(
          row.remarks,
          STAFF_TEXT_LIMITS.notes,
          "staff-notes-too-long",
        );
        if (status === "leave" && !remarks) {
          throw new Error("attendance-remarks-required-for-leave");
        }
        const durations = computeAttendanceDurations({
          database,
          checkInTime,
          checkOutTime,
          breakMinutes,
          shiftId,
          overtimeOverrideMinutes,
        });

        const explicitId = normalizeText(row.id);
        const existingById = explicitId
          ? (database
              .prepare("SELECT id FROM attendance_records WHERE id = ?")
              .get(explicitId) as any)
          : null;
        const existingByUnique = database
          .prepare(
            "SELECT id FROM attendance_records WHERE staff_id = ? AND attendance_date = ? AND shift_id = ? LIMIT 1",
          )
          .get(staffId, attendanceDate, shiftKey) as any;
        const targetId = existingById?.id || existingByUnique?.id || `attendance:${randomUUID()}`;
        const nowAt = now();
        const exists = Boolean(existingById?.id || existingByUnique?.id);
        if (exists) {
          database
            .prepare(
              `UPDATE attendance_records
               SET shift_id = ?, status = ?, is_late = ?, check_in_time = ?, check_out_time = ?, break_minutes = ?,
                   worked_minutes = ?, overtime_minutes = ?, remarks = ?, updated_by = ?, updated_on = ?
               WHERE id = ?`,
            )
            .run(
              shiftId,
              status,
              isLate ? 1 : 0,
              checkInTime,
              checkOutTime,
              breakMinutes,
              durations.workedMinutes,
              durations.overtimeMinutes,
              remarks,
              actor || null,
              nowAt,
              targetId,
            );
          createAuditRow(database, "attendance.updated", "attendance", targetId, actor || null, {
            staffId,
            attendanceDate,
            status,
          });
          updated += 1;
        } else {
          try {
            database
              .prepare(
                `INSERT INTO attendance_records (
                  id, staff_id, attendance_date, shift_id, status, is_late, check_in_time, check_out_time,
                  break_minutes, worked_minutes, overtime_minutes, remarks,
                  created_by, created_on, updated_by, updated_on
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                targetId,
                staffId,
                attendanceDate,
                shiftId,
                status,
                isLate ? 1 : 0,
                checkInTime,
                checkOutTime,
                breakMinutes,
                durations.workedMinutes,
                durations.overtimeMinutes,
                remarks,
                actor || null,
                nowAt,
                actor || null,
                nowAt,
              );
          } catch (error: any) {
            const message = String(error?.message || "");
            if (message.includes("UNIQUE") && message.includes("attendance_records.staff_id")) {
              throw new Error("attendance-duplicate-day");
            }
            throw error;
          }
          createAuditRow(database, "attendance.created", "attendance", targetId, actor || null, {
            staffId,
            attendanceDate,
            status,
          });
          created += 1;
        }
      }
      createAuditRow(
        database,
        "attendance.bulk-update",
        "attendance",
        attendanceDate,
        actor || null,
        {
          attendanceDate,
          created,
          updated,
          total: rows.length,
        },
      );
      return this.listAttendance({ date: attendanceDate });
    });
  },

  copyAttendance(fromDate: string, toDate: string, actor?: string | null) {
    const sourceDate = normalizeAttendanceDate(fromDate);
    const targetDate = normalizeAttendanceDate(toDate);
    return inTransaction((database) => {
      const sourceRows = database
        .prepare("SELECT * FROM attendance_records WHERE attendance_date = ?")
        .all(sourceDate) as any[];
      const at = now();
      const upsert = database.prepare(`
        INSERT INTO attendance_records (
          id, staff_id, attendance_date, shift_id, status, is_late, check_in_time, check_out_time,
          break_minutes, worked_minutes, overtime_minutes, remarks,
          created_by, created_on, updated_by, updated_on
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(staff_id, attendance_date, shift_id) DO UPDATE SET
          shift_id = excluded.shift_id,
          status = excluded.status,
          is_late = excluded.is_late,
          check_in_time = excluded.check_in_time,
          check_out_time = excluded.check_out_time,
          break_minutes = excluded.break_minutes,
          worked_minutes = excluded.worked_minutes,
          overtime_minutes = excluded.overtime_minutes,
          remarks = excluded.remarks,
          updated_by = excluded.updated_by,
          updated_on = excluded.updated_on
      `);
      for (const row of sourceRows) {
        upsert.run(
          `attendance:${randomUUID()}`,
          row.staff_id,
          targetDate,
          row.shift_id,
          row.status,
          Number(row.is_late || 0) ? 1 : 0,
          row.check_in_time,
          row.check_out_time,
          row.break_minutes,
          row.worked_minutes,
          row.overtime_minutes,
          row.remarks,
          actor || null,
          at,
          actor || null,
          at,
        );
      }
      createAuditRow(database, "attendance.bulk-update", "attendance", targetDate, actor || null, {
        action: "copy",
        sourceDate,
        targetDate,
        copied: sourceRows.length,
      });
      return this.listAttendance({ date: targetDate });
    });
  },

  deleteAttendance(id: string, actor?: string | null) {
    return inTransaction((database) => {
      const row = database.prepare("SELECT * FROM attendance_records WHERE id = ?").get(id) as any;
      if (!row) {
        throw new Error("attendance-not-found");
      }
      database.prepare("DELETE FROM attendance_records WHERE id = ?").run(id);
      createAuditRow(database, "attendance.deleted", "attendance", id, actor || null, {
        staffId: row.staff_id,
        attendanceDate: row.attendance_date,
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

  insertBackupRecord(input: {
    id: string;
    destination: string;
    pathOrProvider: string;
    status: string;
    checksum: string | null;
    sizeBytes: number | null;
    actor?: string | null;
    cloudBackupId?: string | null;
    error?: string | null;
  }) {
    getDb()
      .prepare(
        `INSERT INTO backup_records (
          id, destination, path_or_provider, status, checksum, size_bytes, created_by, created_at, cloud_backup_id, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.destination,
        input.pathOrProvider,
        input.status,
        input.checksum,
        input.sizeBytes,
        input.actor || null,
        now(),
        input.cloudBackupId || null,
        input.error || null,
      );
  },

  updateBackupRecord(
    id: string,
    patch: {
      status?: string;
      cloudBackupId?: string | null;
      error?: string | null;
      destination?: string;
    },
  ) {
    const row = getDb().prepare("SELECT id FROM backup_records WHERE id = ?").get(id) as
      | { id?: string }
      | undefined;
    if (!row?.id) {
      return false;
    }
    getDb()
      .prepare(
        `UPDATE backup_records
         SET status = COALESCE(?, status),
             cloud_backup_id = COALESCE(?, cloud_backup_id),
             error = CASE WHEN ? IS NOT NULL THEN ? ELSE error END,
             destination = COALESCE(?, destination)
         WHERE id = ?`,
      )
      .run(
        patch.status ?? null,
        patch.cloudBackupId === undefined ? null : patch.cloudBackupId,
        patch.error === undefined ? null : 1,
        patch.error === undefined ? null : patch.error,
        patch.destination ?? null,
        id,
      );
    return true;
  },

  markUploadPendingBackupsCompleted(cloudBackupId?: string | null) {
    getDb()
      .prepare(
        `UPDATE backup_records
         SET status = 'completed',
             error = NULL,
             cloud_backup_id = COALESCE(?, cloud_backup_id)
         WHERE destination = 'local' AND status = 'upload_pending'`,
      )
      .run(cloudBackupId || null);
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
  const existing = database
    .prepare("SELECT id FROM menu_categories WHERE lower(name) = lower(?) LIMIT 1")
    .get(name) as { id?: string } | undefined;
  const at = now();
  if (existing?.id) {
    database
      .prepare(
        `UPDATE menu_categories
         SET name = ?, active = 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(name, at, existing.id);
    return existing.id;
  }
  const id = slugId("cat", name);
  database
    .prepare(
      `INSERT INTO menu_categories (id, name, sort_order, active, created_at, updated_at)
       VALUES (?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM menu_categories), 1), 1, ?, ?)`,
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
  weeklyOffDays?: unknown;
  defaultShiftId?: unknown;
}) {
  const name = normalizeText(input.name);
  const phone = normalizePhone(input.phone);
  if (!isValidPersonName(name, { max: STAFF_TEXT_LIMITS.name })) {
    throw new Error("staff-name-invalid");
  }
  if (!isValidIndianMobile(phone)) {
    throw new Error("staff-phone-invalid");
  }
  const defaultShiftId = normalizeText(input.defaultShiftId).toLowerCase() || "morning";
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
    weeklyOffDays: serializeWeeklyOffDays(normalizeWeeklyOffDays(input.weeklyOffDays)),
    defaultShiftId,
    ...prepareStaffPhoto(input.photoMime, input.photoBase64),
  };
}

function normalizeAttendanceDateFormat(value: unknown) {
  const date = normalizeText(value);
  if (!date) {
    throw new Error("attendance-date-required");
  }
  if (!isValidDateOnly(date)) {
    throw new Error("attendance-date-invalid");
  }
  return date;
}

function normalizeAttendanceDate(value: unknown) {
  const date = normalizeAttendanceDateFormat(value);
  if (isFutureDateOnly(date)) {
    throw new Error("attendance-date-future");
  }
  return date;
}

function normalizeAttendanceStatus(value: unknown): AttendanceStatus {
  const status = String(value || "") as AttendanceStatus;
  if (!ATTENDANCE_STATUSES.has(status)) {
    throw new Error("attendance-status-invalid");
  }
  return status;
}

function normalizeAttendanceLate(value: unknown, status: AttendanceStatus): boolean {
  if (status !== "present" && status !== "half-day") {
    return false;
  }
  return value === true || value === 1 || value === "1";
}

function normalizeAttendanceTime(value: unknown) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(text)) {
    throw new Error("attendance-time-invalid");
  }
  return text;
}

function attendanceTimeToMinutes(value: string | null) {
  if (!value) {
    return null;
  }
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

function normalizeAttendanceBreakMinutes(value: unknown) {
  const breakMinutes = Number(value ?? 0);
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
    throw new Error("attendance-break-invalid");
  }
  return Math.trunc(breakMinutes);
}

function normalizeAttendanceOvertimeOverride(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const overtimeMinutes = Number(value);
  if (!Number.isFinite(overtimeMinutes) || overtimeMinutes < 0) {
    throw new Error("attendance-break-invalid");
  }
  return Math.trunc(overtimeMinutes);
}

function computeAttendanceDurations(input: {
  database: Database.Database;
  checkInTime: string | null;
  checkOutTime: string | null;
  breakMinutes: number;
  shiftId?: string | null;
  overtimeOverrideMinutes?: number | null;
}) {
  const inMinutes = attendanceTimeToMinutes(input.checkInTime);
  const outMinutes = attendanceTimeToMinutes(input.checkOutTime);
  if ((inMinutes === null) !== (outMinutes === null)) {
    throw new Error("attendance-checkout-before-checkin");
  }
  if (inMinutes !== null && outMinutes !== null && outMinutes < inMinutes) {
    throw new Error("attendance-checkout-before-checkin");
  }
  const rawWorked =
    inMinutes !== null && outMinutes !== null ? Math.max(0, outMinutes - inMinutes) : 0;
  if (input.breakMinutes > rawWorked) {
    throw new Error("attendance-break-exceeds-worked");
  }
  const workedMinutes = Math.max(0, rawWorked - input.breakMinutes);
  const shiftMinutes = getAttendanceShiftHours(input.database, input.shiftId);
  const autoOvertimeMinutes = Math.max(0, workedMinutes - shiftMinutes);
  const overtimeMinutes =
    input.overtimeOverrideMinutes === null || input.overtimeOverrideMinutes === undefined
      ? autoOvertimeMinutes
      : Math.max(0, input.overtimeOverrideMinutes);
  return { workedMinutes, overtimeMinutes };
}

function assertAttendanceStaffExists(database: Database.Database, staffId: string) {
  const row = database.prepare("SELECT id FROM staff WHERE id = ?").get(staffId) as any;
  if (!row?.id) {
    throw new Error("attendance-staff-required");
  }
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

function customerFromRow(row: any, overduePaise = 0): CustomerDto {
  const outstanding = paiseToRupees(row.outstanding_paise);
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address || undefined,
    notes: row.notes || undefined,
    active: Boolean(row.active),
    creditEnabled: Boolean(row.credit_enabled),
    creditBlocked: Boolean(row.credit_blocked),
    creditLimit: paiseToRupees(row.credit_limit_paise),
    defaultCreditDays:
      row.default_credit_days === null || row.default_credit_days === undefined
        ? null
        : Number(row.default_credit_days),
    outstanding,
    overdue: paiseToRupees(overduePaise),
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
    linkedUsername: row.linked_username || null,
    linkedAccountActive:
      row.linked_user_active === undefined || row.linked_user_active === null
        ? null
        : Boolean(row.linked_user_active),
    weeklyOffDays: normalizeWeeklyOffDays(row.weekly_off_days),
    defaultShiftId: row.default_shift_id || "morning",
  };
}

function attendanceFromRow(row: any): AttendanceDto {
  return {
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name || "",
    role: row.staff_role || null,
    attendanceDate: row.attendance_date,
    shiftId: row.shift_id || null,
    status: row.status,
    isLate: Boolean(Number(row.is_late || 0)),
    checkInTime: row.check_in_time || null,
    checkOutTime: row.check_out_time || null,
    breakMinutes: Number(row.break_minutes || 0),
    workedMinutes: Number(row.worked_minutes || 0),
    overtimeMinutes: Number(row.overtime_minutes || 0),
    remarks: row.remarks || null,
    createdBy: row.created_by || null,
    createdOn: Number(row.created_on || 0),
    updatedBy: row.updated_by || null,
    updatedOn: Number(row.updated_on || 0),
  };
}

function vendorFromRow(row: any): VendorDto {
  return {
    _id: row.id,
    id: row.id,
    type: "vendor",
    name: row.name,
    contactPerson: row.contact_person || null,
    phone: row.phone || null,
    email: row.email || null,
    address: row.address || null,
    gstin: row.gstin || null,
    notes: row.notes || null,
    active: Boolean(row.active),
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

function groceryPurchaseHeaderFromRow(
  database: Database.Database,
  row: any,
  lines?: GroceryPurchaseLineDto[],
): GroceryPurchaseDto {
  const resolvedLines =
    lines ??
    database
      .prepare(
        `SELECT * FROM grocery_purchase_lines
       WHERE purchase_id = ?
       ORDER BY purchased_at ASC, created_at ASC`,
      )
      .all(row.id)
      .map(groceryPurchaseFromRow);
  const total = paiseToRupees(row.total_paise);
  const amountPaid = paiseToRupees(row.amount_paid_paise);
  return {
    _id: row.id,
    id: row.id,
    type: "grocery-purchase-header",
    buyingListId: row.buying_list_id || null,
    buyingListTitle: row.buying_list_title || null,
    vendorId: row.vendor_id || null,
    vendorName: row.vendor_name || null,
    purchaseDate: row.purchase_date,
    invoiceNumber: row.invoice_number || null,
    paymentMethod: row.payment_method || null,
    status: (row.status as GroceryPurchaseStatus) || "recorded",
    paymentStatus: (row.payment_status as GroceryPaymentStatus) || "pending",
    amountPaid,
    outstanding: Math.max(0, +(total - amountPaid).toFixed(2)),
    subtotal: paiseToRupees(row.subtotal_paise),
    tax: paiseToRupees(row.tax_paise),
    total,
    notes: row.notes || null,
    migrationSource: row.migration_source || null,
    lines: resolvedLines,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function expenseCategoryFromRow(row: any): ExpenseCategoryDto {
  return {
    _id: row.id,
    id: row.id,
    type: "expense-category",
    name: row.name,
    slug: row.slug,
    sortOrder: Number(row.sort_order || 0),
    isSystem: Boolean(row.is_system),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

function expenseFromRow(row: any): ExpenseDto {
  return {
    _id: row.id,
    id: row.id,
    type: "expense",
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    amount: paiseToRupees(row.amount_paise),
    expenseDate: row.expense_date,
    vendorId: row.vendor_id || null,
    vendorName: row.vendor_name || null,
    description: row.description || null,
    paymentMethod: row.payment_method || null,
    invoiceNumber: row.invoice_number || null,
    recurringExpenseId: row.recurring_expense_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

function salaryAdvanceFromRow(row: any): SalaryAdvanceDto {
  return {
    _id: row.id,
    id: row.id,
    type: "salary-advance",
    staffId: row.staff_id,
    staffName: row.staff_name || null,
    staffDesignation: row.staff_designation || null,
    amount: paiseToRupees(row.amount_paise),
    advanceDate: row.advance_date,
    note: row.note || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

function buyingListTemplateFromRow(database: Database.Database, row: any): BuyingListTemplateDto {
  const lines = (
    database
      .prepare(
        `SELECT * FROM grocery_list_template_lines
         WHERE template_id = ?
         ORDER BY sort_order ASC, created_at ASC`,
      )
      .all(row.id) as any[]
  ).map(
    (line): BuyingListTemplateLineDto => ({
      id: line.id,
      groceryItemId: line.grocery_item_id || null,
      itemName: line.item_name,
      category: line.category || null,
      defaultQuantity: line.default_quantity == null ? null : Number(line.default_quantity),
      unit: normalizeGroceryUnit(line.unit),
      sortOrder: Number(line.sort_order || 0),
    }),
  );
  return {
    _id: row.id,
    id: row.id,
    type: "grocery-list-template",
    name: row.name,
    description: row.description || null,
    active: Boolean(row.active),
    lines,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

function groceryPurchaseFromRow(row: any): GroceryPurchaseLineDto {
  return {
    _id: row.id,
    id: row.id,
    type: "grocery-purchase",
    purchaseId: row.purchase_id || null,
    listId: row.list_id || null,
    listLineId: row.list_line_id || null,
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
    vendorId: row.vendor_id || null,
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
    estimatedUnitPrice:
      row.estimated_unit_price_paise == null ? null : paiseToRupees(row.estimated_unit_price_paise),
    estimatedTotal:
      row.estimated_total_paise == null ? null : paiseToRupees(row.estimated_total_paise),
    purchasedQuantity: row.purchased_quantity == null ? null : Number(row.purchased_quantity),
    purchasedUnitPrice:
      row.purchased_unit_price_paise == null ? null : paiseToRupees(row.purchased_unit_price_paise),
    purchasedTotal:
      row.purchased_total_paise == null ? null : paiseToRupees(row.purchased_total_paise),
    lineStatus: row.line_status || "pending",
  };
}

function groceryListFromRow(
  database: Database.Database,
  row: any,
  lines?: GroceryListLineDto[],
  spentPaise?: number,
): GroceryListDto {
  const resolvedLines =
    lines ??
    database
      .prepare(
        "SELECT * FROM grocery_list_lines WHERE list_id = ? ORDER BY sort_order ASC, created_at ASC",
      )
      .all(row.id)
      .map(groceryListLineFromRow);
  const counts = groceryLineCounts(resolvedLines);
  const spendPaise =
    spentPaise == null ? groceryListSpendPaise(database, row.id) : Number(spentPaise || 0);
  return {
    _id: row.id,
    id: row.id,
    type: "grocery-list",
    title: row.title,
    listDate: row.list_date,
    listType: normalizeGroceryListType(row.list_type),
    status: normalizeGroceryListStatus(row.status),
    notes: row.notes || null,
    lines: resolvedLines,
    spentTotal: paiseToRupees(spendPaise),
    pendingCount: counts.pendingCount,
    purchasedCount: counts.purchasedCount,
    itemCount: counts.itemCount,
    createdBy: row.created_by || null,
    updatedBy: row.updated_by || null,
    completedAt: row.completed_at || null,
    printCount: Number(row.print_count || 0),
    lastPrintedAt: row.last_printed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computeGroceryPriceHint(
  defaultUnit: ReturnType<typeof normalizeGroceryUnit>,
  purchases: any[],
): GroceryItemDto["priceHint"] {
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

function batchGroceryPriceHints(
  database: Database.Database,
  rows: Array<{ id: string; default_unit: string }>,
): Map<string, GroceryItemDto["priceHint"]> {
  const hints = new Map<string, GroceryItemDto["priceHint"]>();
  if (!rows.length) {
    return hints;
  }
  const placeholders = rows.map(() => "?").join(",");
  const purchases = database
    .prepare(
      `SELECT *
       FROM grocery_purchase_lines
       WHERE grocery_item_id IN (${placeholders})
       ORDER BY grocery_item_id, purchased_at DESC, created_at DESC`,
    )
    .all(...rows.map((row) => row.id)) as any[];
  const purchasesByItem = new Map<string, any[]>();
  for (const purchase of purchases) {
    const itemId = purchase.grocery_item_id as string | null;
    if (!itemId) {
      continue;
    }
    const bucket = purchasesByItem.get(itemId) || [];
    if (bucket.length < 100) {
      bucket.push(purchase);
      purchasesByItem.set(itemId, bucket);
    }
  }
  for (const row of rows) {
    hints.set(
      row.id,
      computeGroceryPriceHint(
        normalizeGroceryUnit(row.default_unit),
        purchasesByItem.get(row.id) || [],
      ),
    );
  }
  return hints;
}

function batchGroceryListLines(
  database: Database.Database,
  listIds: string[],
): Map<string, GroceryListLineDto[]> {
  const linesByList = new Map<string, GroceryListLineDto[]>();
  if (!listIds.length) {
    return linesByList;
  }
  const placeholders = listIds.map(() => "?").join(",");
  const rows = database
    .prepare(
      `SELECT * FROM grocery_list_lines
       WHERE list_id IN (${placeholders})
       ORDER BY list_id, sort_order ASC, created_at ASC`,
    )
    .all(...listIds) as any[];
  for (const row of rows) {
    const listId = row.list_id as string;
    const bucket = linesByList.get(listId) || [];
    bucket.push(groceryListLineFromRow(row));
    linesByList.set(listId, bucket);
  }
  return linesByList;
}

function batchGroceryPurchaseLines(
  database: Database.Database,
  purchaseIds: string[],
): Map<string, GroceryPurchaseLineDto[]> {
  const linesByPurchase = new Map<string, GroceryPurchaseLineDto[]>();
  if (!purchaseIds.length) {
    return linesByPurchase;
  }
  const placeholders = purchaseIds.map(() => "?").join(",");
  const rows = database
    .prepare(
      `SELECT * FROM grocery_purchase_lines
       WHERE purchase_id IN (${placeholders})
       ORDER BY purchase_id, purchased_at ASC, created_at ASC`,
    )
    .all(...purchaseIds) as any[];
  for (const row of rows) {
    const purchaseId = row.purchase_id as string;
    const bucket = linesByPurchase.get(purchaseId) || [];
    bucket.push(groceryPurchaseFromRow(row));
    linesByPurchase.set(purchaseId, bucket);
  }
  return linesByPurchase;
}

function groceryPriceHint(database: Database.Database, row: any): GroceryItemDto["priceHint"] {
  const purchases = database
    .prepare(
      `SELECT *
       FROM grocery_purchase_lines
       WHERE grocery_item_id = ?
       ORDER BY purchased_at DESC, created_at DESC
       LIMIT 100`,
    )
    .all(row.id) as any[];
  return computeGroceryPriceHint(normalizeGroceryUnit(row.default_unit), purchases);
}

function groceryItemFromRow(
  database: Database.Database,
  row: any,
  includePriceHint = true,
  priceHint?: GroceryItemDto["priceHint"],
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
    priceHint: includePriceHint ? (priceHint ?? groceryPriceHint(database, row)) : undefined,
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
