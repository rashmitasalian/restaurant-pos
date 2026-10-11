import { randomUUID } from "crypto";
import fs from "fs";
import { getDb, inImmediateTransaction, validateSqliteBackup } from "../db/sqlite";
import {
  admitAsync,
  blockOperations,
  clearOperationsBlock,
  closeAdmissions,
  drainAdmissions,
  operationsBlockReason,
  reopenAdmissions,
  resetOperationsAdmissionForTests,
  runAsGoLive,
} from "./operationsAdmission";
import {
  readIntentFile,
  readSidecarFile,
  removeIntentFile,
  removeSidecarFile,
  writeIntentFile,
  writeSidecarFile,
  type OperationsMarker,
  type RestoreIntent,
} from "./operationsFiles";

export const OPERATIONS_CONFIG_KEY = "config:operations";
export const INVOICE_CONFIG_KEY = "config:invoice";
export const ORDER_SEQ_KEY = "config:order-seq";
export const KOT_SEQ_KEY = "config:kot-seq";
export const LIVE_START_PHRASE = "START LIVE";

export const CLEARED_TABLES = [
  "customer_credit_allocations",
  "customer_account_entries",
  "payments",
  "order_lines",
  "orders",
  "print_jobs",
  "attendance_records",
  "salary_advances",
  "grocery_purchase_lines",
  "grocery_purchases",
  "grocery_list_lines",
  "grocery_lists",
  "expenses",
  "audit_archives",
  "audit_logs",
  "client_ops",
] as const;

export const KEPT_TABLES = [
  "schema_migrations",
  "users",
  "admin_recovery_codes",
  "login_lockouts",
  "seating_areas",
  "tables",
  "menu_categories",
  "menu_items",
  "menu_item_variants",
  "customers",
  "staff",
  "settings",
  "backup_records",
  "grocery_items",
  "vendors",
  "expense_categories",
  "grocery_list_templates",
  "grocery_list_template_lines",
] as const;

/** Named SQLite and FTS objects. A new application table is not covered by a prefix rule. */
export const SQLITE_INTERNAL_PREFIX = "sqlite_";
export const FTS_VIRTUAL_TABLES = ["audit_logs_fts"] as const;
export const FTS_SHADOW_TABLES = [
  "audit_logs_fts_data",
  "audit_logs_fts_idx",
  "audit_logs_fts_content",
  "audit_logs_fts_docsize",
  "audit_logs_fts_config",
] as const;

export function isClassifiedSchemaObject(name: string) {
  if (name.startsWith(SQLITE_INTERNAL_PREFIX)) {
    return true;
  }
  const known = new Set<string>([
    ...CLEARED_TABLES,
    ...KEPT_TABLES,
    ...FTS_VIRTUAL_TABLES,
    ...FTS_SHADOW_TABLES,
  ]);
  return known.has(name);
}

export type LiveOperationsCounts = {
  openOrders: number;
  paidOrders: number;
  payments: number;
  creditEntries: number;
  creditAllocations: number;
  expenses: number;
  purchases: number;
  buyingLists: number;
  attendance: number;
  salaryAdvances: number;
  printJobs: number;
};

type SqliteDatabase = ReturnType<typeof getDb>;
type InvoiceConfig = {
  prefix: string;
  fiscalYear: string;
  lastNumber: number;
  extra: Record<string, unknown>;
};

let drainTimeoutMs = 30_000;
let prepareStarted = false;
let prepareHeld = false;
let commitStarted = false;
let beforeValidateForTests: (() => void) | null = null;
let sidecarWriter: (marker: OperationsMarker) => void = writeSidecarFile;

export function setDrainTimeoutMsForTests(timeoutMs: number) {
  drainTimeoutMs = timeoutMs;
}

export function setSidecarWriterForTests(writer: ((marker: OperationsMarker) => void) | null) {
  sidecarWriter = writer || writeSidecarFile;
}

export function setBeforeValidateForTests(hook: (() => void) | null) {
  beforeValidateForTests = hook;
}

export function resetLiveOperationsForTests() {
  prepareStarted = false;
  prepareHeld = false;
  commitStarted = false;
  drainTimeoutMs = 30_000;
  sidecarWriter = writeSidecarFile;
  beforeValidateForTests = null;
  resetOperationsAdmissionForTests();
}

export function getFiscalYearLabel(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth();
  const startYear = month >= 3 ? year : year - 1;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function readOperationsMarker(database: SqliteDatabase): OperationsMarker | null {
  const row = database
    .prepare("SELECT value_json FROM settings WHERE key = ?")
    .get(OPERATIONS_CONFIG_KEY) as { value_json?: string } | undefined;
  const parsed = parseJson<Partial<OperationsMarker>>(row?.value_json, {});
  if (!parsed.liveStartedAt || !parsed.liveStartOperationId) {
    return null;
  }
  return {
    liveStartedAt: Number(parsed.liveStartedAt),
    liveStartedBy: String(parsed.liveStartedBy || ""),
    liveStartOperationId: String(parsed.liveStartOperationId),
    backupId: String(parsed.backupId || ""),
  };
}

export function isLiveOperations(database: SqliteDatabase = getDb()) {
  return Boolean(readOperationsMarker(database)?.liveStartedAt);
}

export function stampPracticeMeta<T extends Record<string, unknown>>(
  database: SqliteDatabase,
  meta: T,
): T & { practice?: true } {
  if (isLiveOperations(database)) {
    return meta;
  }
  return { ...meta, practice: true };
}

function readInvoiceConfig(database: SqliteDatabase): InvoiceConfig {
  const row = database
    .prepare("SELECT value_json FROM settings WHERE key = ?")
    .get(INVOICE_CONFIG_KEY) as { value_json?: string } | undefined;
  const parsed = parseJson<Record<string, unknown>>(row?.value_json, {});
  const prefix =
    String(parsed.prefix || "INV")
      .trim()
      .replace(/[^A-Za-z0-9/-]/g, "") || "INV";
  return {
    prefix,
    fiscalYear: String(parsed.fiscalYear || ""),
    lastNumber: Number(parsed.lastNumber || 0),
    extra: parsed,
  };
}

function tableCount(database: SqliteDatabase, tableName: string) {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number;
  };
  return Number(row?.count || 0);
}

export function hasTaxInvoiceEvidence(database: SqliteDatabase) {
  const orders = database
    .prepare(
      `SELECT COUNT(*) AS count FROM orders
       WHERE (invoice_number IS NOT NULL AND TRIM(invoice_number) != '')
          OR (
            json_extract(meta_json, '$.invoice.number') IS NOT NULL
            AND TRIM(json_extract(meta_json, '$.invoice.number')) != ''
          )
          OR CAST(COALESCE(json_extract(meta_json, '$.invoice.sequence'), 0) AS INTEGER) > 0`,
    )
    .get() as { count: number };
  if (Number(orders?.count || 0) > 0) {
    return true;
  }
  const credit = database
    .prepare(
      `SELECT COUNT(*) AS count FROM customer_account_entries
       WHERE invoice_number IS NOT NULL AND TRIM(invoice_number) != ''`,
    )
    .get() as { count: number };
  return Number(credit?.count || 0) > 0;
}

function currentFiscalYearNumber(database: SqliteDatabase, issuedAt = Date.now()) {
  const config = readInvoiceConfig(database);
  const fiscalYear = getFiscalYearLabel(issuedAt);
  if (config.fiscalYear !== fiscalYear) {
    return 0;
  }
  return Number(config.lastNumber || 0);
}

export function assertCanAllocateTaxInvoice(database: SqliteDatabase) {
  if (!isLiveOperations(database)) {
    throw new Error("tax-invoice-before-live");
  }
}

export function assertEligibleForLiveStart(database: SqliteDatabase) {
  if (readOperationsMarker(database)?.liveStartedAt) {
    throw new Error("operations-already-live");
  }
  if (readSidecarFile()?.liveStartedAt) {
    throw new Error("operations-sidecar-blocks-go-live");
  }
  if (currentFiscalYearNumber(database) > 0) {
    throw new Error("tax-invoice-sequence-already-used");
  }
  if (hasTaxInvoiceEvidence(database)) {
    throw new Error("tax-invoice-already-issued");
  }
}

/**
 * Databases that already issued tax invoices before this feature stay live.
 * Cleanup is refused for them, and billing continues on the existing sequence.
 */
export function adoptExistingBillingAsLive(database: SqliteDatabase) {
  if (readOperationsMarker(database)?.liveStartedAt) {
    return;
  }
  const config = readInvoiceConfig(database);
  if (Number(config.lastNumber || 0) <= 0 && !hasTaxInvoiceEvidence(database)) {
    return;
  }
  const marker: OperationsMarker = {
    liveStartedAt: Date.now(),
    liveStartedBy: "system:existing-billing",
    liveStartOperationId: `ops:${randomUUID()}`,
    backupId: "",
  };
  database
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(OPERATIONS_CONFIG_KEY, JSON.stringify(marker), marker.liveStartedAt);
}

export function countLiveOperationsActivity(database: SqliteDatabase): LiveOperationsCounts {
  return {
    openOrders: Number(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM orders WHERE status NOT IN ('paid', 'cancelled')",
          )
          .get() as { count: number }
      )?.count || 0,
    ),
    paidOrders: Number(
      (
        database.prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'paid'").get() as {
          count: number;
        }
      )?.count || 0,
    ),
    payments: tableCount(database, "payments"),
    creditEntries: tableCount(database, "customer_account_entries"),
    creditAllocations: tableCount(database, "customer_credit_allocations"),
    expenses: tableCount(database, "expenses"),
    purchases: tableCount(database, "grocery_purchases"),
    buyingLists: tableCount(database, "grocery_lists"),
    attendance: tableCount(database, "attendance_records"),
    salaryAdvances: tableCount(database, "salary_advances"),
    printJobs: tableCount(database, "print_jobs"),
  };
}

function clearActivity(database: SqliteDatabase, at: number) {
  for (const tableName of CLEARED_TABLES) {
    database.prepare(`DELETE FROM ${tableName}`).run();
  }
  database.prepare("UPDATE customers SET outstanding_paise = 0, updated_at = ?").run(at);
  database
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(ORDER_SEQ_KEY, JSON.stringify({ lastNumber: 0 }), at);
  database
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(KOT_SEQ_KEY, JSON.stringify({ day: "", lastNumber: 0 }), at);

  const invoice = readInvoiceConfig(database);
  const fiscalYear = getFiscalYearLabel(at);
  database
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(
      INVOICE_CONFIG_KEY,
      JSON.stringify({
        ...invoice.extra,
        prefix: invoice.prefix,
        fiscalYear,
        lastNumber: 0,
      }),
      at,
    );
}

function validateCleanup(database: SqliteDatabase, marker: OperationsMarker) {
  beforeValidateForTests?.();
  for (const tableName of CLEARED_TABLES) {
    if (tableName === "audit_logs") {
      continue;
    }
    if (tableCount(database, tableName) !== 0) {
      throw new Error(`operations-cleanup-incomplete:${tableName}`);
    }
  }
  const outstanding = database
    .prepare("SELECT COALESCE(SUM(outstanding_paise), 0) AS total FROM customers")
    .get() as { total: number };
  if (Number(outstanding?.total || 0) !== 0) {
    throw new Error("operations-outstanding-remains");
  }
  if (hasTaxInvoiceEvidence(database)) {
    throw new Error("operations-invoice-remains");
  }
  const invoice = readInvoiceConfig(database);
  if (invoice.lastNumber !== 0 || invoice.fiscalYear !== getFiscalYearLabel(marker.liveStartedAt)) {
    throw new Error("operations-invoice-sequence-invalid");
  }
  const orderSeq = parseJson<{ lastNumber?: number }>(
    (
      database.prepare("SELECT value_json FROM settings WHERE key = ?").get(ORDER_SEQ_KEY) as
        | { value_json?: string }
        | undefined
    )?.value_json,
    {},
  );
  const kotSeq = parseJson<{ lastNumber?: number }>(
    (
      database.prepare("SELECT value_json FROM settings WHERE key = ?").get(KOT_SEQ_KEY) as
        | { value_json?: string }
        | undefined
    )?.value_json,
    {},
  );
  if (Number(orderSeq.lastNumber || 0) !== 0 || Number(kotSeq.lastNumber || 0) !== 0) {
    throw new Error("operations-sequence-not-reset");
  }
  const violations = database.pragma("foreign_key_check");
  if (Array.isArray(violations) && violations.length > 0) {
    throw new Error("foreign-key-check-failed");
  }
  const stored = readOperationsMarker(database);
  if (stored?.liveStartOperationId !== marker.liveStartOperationId) {
    throw new Error("operations-marker-missing");
  }
  const audit = database
    .prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'operations.started'")
    .get() as { count: number };
  if (Number(audit?.count || 0) !== 1) {
    throw new Error("operations-audit-missing");
  }
}

function writeLiveState(database: SqliteDatabase, actor: string, backupId: string) {
  const at = Date.now();
  clearActivity(database, at);
  const marker: OperationsMarker = {
    liveStartedAt: at,
    liveStartedBy: actor,
    liveStartOperationId: `ops:${randomUUID()}`,
    backupId,
  };
  database
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(OPERATIONS_CONFIG_KEY, JSON.stringify(marker), at);
  database
    .prepare(
      `INSERT INTO audit_logs (id, action, entity_type, entity_id, user, detail_json, timestamp)
       VALUES (?, 'operations.started', 'operations', ?, ?, ?, ?)`,
    )
    .run(
      `audit:${randomUUID()}`,
      marker.liveStartOperationId,
      actor,
      JSON.stringify({ backupId, liveStartedAt: at }),
      at,
    );
  validateCleanup(database, marker);
  return marker;
}

export function getLiveOperationsStatus() {
  const database = getDb();
  const marker = readOperationsMarker(database);
  const sidecar = readSidecarFile();
  const intent = readIntentFile();
  const block = operationsBlockReason();
  let phase: "practice" | "live" | "recovery" = "practice";
  if (block || (sidecar?.liveStartedAt && !marker?.liveStartedAt) || intent) {
    phase = "recovery";
  } else if (marker?.liveStartedAt) {
    phase = "live";
  }
  return {
    phase,
    blockReason: block,
    marker,
    sidecarPresent: Boolean(sidecar?.liveStartedAt),
    intent,
    prepareHeld,
  };
}

export async function prepareLiveOperations() {
  if (operationsBlockReason()) {
    throw new Error(operationsBlockReason() || "operations-blocked");
  }
  if (prepareStarted || prepareHeld || commitStarted) {
    throw new Error("operations-prepare-in-progress");
  }
  assertEligibleForLiveStart(getDb());
  prepareStarted = true;
  closeAdmissions();
  try {
    await drainAdmissions(drainTimeoutMs);
    assertEligibleForLiveStart(getDb());
    const counts = countLiveOperationsActivity(getDb());
    prepareHeld = true;
    return { ok: true as const, counts };
  } catch (error) {
    prepareStarted = false;
    prepareHeld = false;
    reopenAdmissions();
    throw error;
  }
}

export function cancelLiveOperations() {
  if (commitStarted) {
    throw new Error("operations-commit-in-progress");
  }
  const wasHeld = prepareHeld || prepareStarted;
  prepareHeld = false;
  prepareStarted = false;
  reopenAdmissions();
  return { ok: true as const, cancelled: wasHeld };
}

export async function commitLiveOperations(
  actor: string,
  phrase: string,
  createVerifiedBackup: () => Promise<{ id: string }>,
) {
  if (!prepareHeld) {
    throw new Error("operations-prepare-required");
  }
  if (commitStarted) {
    throw new Error("operations-commit-in-progress");
  }
  if (phrase !== LIVE_START_PHRASE) {
    throw new Error("operations-confirmation-mismatch");
  }
  commitStarted = true;
  let committed = false;
  try {
    const result = await runAsGoLive(async () => {
      assertEligibleForLiveStart(getDb());
      const counts = countLiveOperationsActivity(getDb());
      const backup = await createVerifiedBackup();
      const marker = inImmediateTransaction((database) => {
        assertEligibleForLiveStart(database);
        return writeLiveState(database, actor, backup.id);
      });
      committed = true;
      try {
        sidecarWriter(marker);
        clearOperationsBlock();
        return {
          ok: true as const,
          marker,
          counts,
          sidecarStatus: "matched" as const,
          needsRelaunch: true,
        };
      } catch {
        blockOperations("sidecar-repair-required");
        return {
          ok: true as const,
          marker,
          counts,
          sidecarStatus: "repair-required" as const,
          needsRelaunch: true,
        };
      }
    });
    return result;
  } finally {
    commitStarted = false;
    prepareHeld = false;
    prepareStarted = false;
    if (!committed || !operationsBlockReason()) {
      reopenAdmissions();
    }
  }
}

export function repairOperationsSidecar() {
  const marker = readOperationsMarker(getDb());
  if (!marker?.liveStartedAt) {
    throw new Error("operations-not-live");
  }
  sidecarWriter(marker);
  clearOperationsBlock();
  reopenAdmissions();
  return { ok: true as const, marker };
}

export function reconcileOperationsFiles() {
  try {
    const marker = readOperationsMarker(getDb());
    const sidecar = readSidecarFile();
    const intent = readIntentFile();
    if (marker?.liveStartedAt) {
      if (!sidecar || sidecar.liveStartOperationId !== marker.liveStartOperationId) {
        try {
          sidecarWriter(marker);
          clearOperationsBlock();
        } catch {
          blockOperations("sidecar-repair-required");
        }
      } else if (operationsBlockReason() === "sidecar-repair-required") {
        clearOperationsBlock();
      }
      if (
        intent?.phase === "database-replaced" &&
        sidecar?.liveStartOperationId === marker.liveStartOperationId
      ) {
        removeIntentFile();
      }
      return;
    }

    if (sidecar?.liveStartedAt) {
      blockOperations("sidecar-without-database-marker");
      return;
    }

    if (intent?.phase === "database-replaced") {
      removeIntentFile();
    }
    if (
      operationsBlockReason() === "sidecar-without-database-marker" ||
      operationsBlockReason() === "sidecar-repair-required"
    ) {
      clearOperationsBlock();
    }
  } catch {
    blockOperations("operations-reconcile-failed");
  }
}

export function readMarkerFromSqliteFile(filePath: string): OperationsMarker | null {
  const BetterSqlite3 = require("better-sqlite3");
  const database = new BetterSqlite3(filePath, { readonly: true, fileMustExist: true });
  try {
    return readOperationsMarker(database);
  } finally {
    database.close();
  }
}

export function inspectRestore(backupMarker: OperationsMarker | null, acknowledgePreLive: boolean) {
  const currentMarker = readOperationsMarker(getDb());
  const sidecar = readSidecarFile();
  const currentIsLive = Boolean(currentMarker?.liveStartedAt || sidecar?.liveStartedAt);
  const backupIsLive = Boolean(backupMarker?.liveStartedAt);
  const needsPreLiveRecovery = currentIsLive && !backupIsLive;
  if (needsPreLiveRecovery && !acknowledgePreLive) {
    throw new Error("restore-would-discard-live-operations");
  }
  return { needsPreLiveRecovery, currentIsLive, backupIsLive };
}

export async function guardedDatabaseReplace(options: {
  actor: string;
  sourceLabel: string;
  materializedSqlitePath: string;
  acknowledgePreLive: boolean;
  createSafetyCopy: () => Promise<string>;
  replaceDatabase: () => Promise<void>;
}) {
  const backupMarker = readMarkerFromSqliteFile(options.materializedSqlitePath);
  const decision = inspectRestore(backupMarker, options.acknowledgePreLive);
  const safetyCopyPath = await options.createSafetyCopy();
  validateSqliteBackup(safetyCopyPath);
  const intentBase: RestoreIntent = {
    kind: "pre-live-restore",
    phase: "safety-ready",
    acknowledgedBy: options.actor,
    acknowledgedAt: Date.now(),
    safetyCopyPath,
    sourceLabel: options.sourceLabel,
  };
  if (decision.needsPreLiveRecovery) {
    writeIntentFile(intentBase);
  }
  await options.replaceDatabase();
  if (decision.needsPreLiveRecovery) {
    writeIntentFile({ ...intentBase, phase: "database-replaced" });
  }
  try {
    const marker = readOperationsMarker(getDb());
    if (marker?.liveStartedAt) {
      sidecarWriter(marker);
    } else {
      removeSidecarFile();
    }
    removeIntentFile();
    clearOperationsBlock();
    reopenAdmissions();
  } catch (error) {
    blockOperations("restore-recovery-required");
    throw error;
  }
  return { ok: true as const, safetyCopyPath };
}

export function completeInterruptedRestore() {
  const intent = readIntentFile();
  if (!intent) {
    throw new Error("restore-intent-missing");
  }
  if (!fs.existsSync(intent.safetyCopyPath)) {
    throw new Error("safety-copy-missing");
  }
  const marker = readOperationsMarker(getDb());
  if (marker?.liveStartedAt && intent.phase === "safety-ready") {
    throw new Error("restore-not-replaced");
  }
  if (marker?.liveStartedAt) {
    sidecarWriter(marker);
  } else {
    removeSidecarFile();
  }
  removeIntentFile();
  clearOperationsBlock();
  reopenAdmissions();
  return { ok: true as const, completed: true };
}

export function assertPracticeAllowsInvoiceRestore(database: SqliteDatabase, invoiceNumber: string | null) {
  if (!invoiceNumber || isLiveOperations(database)) {
    return;
  }
  throw new Error("tax-invoice-before-live");
}

export { admitAsync };
