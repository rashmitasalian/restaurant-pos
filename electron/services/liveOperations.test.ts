jest.mock("electron", () => ({
  app: {
    getPath: () => process.env.POS_TEST_USER_DATA_DIR || "",
  },
}));

import fs from "fs";
import os from "os";
import path from "path";
import { backupDatabase, closeDb, getDb, initializeDatabase } from "../db/sqlite";
import { CREDIT_CONFIG_KEY } from "../../src/shared/customerCredit";
import { admitAsync } from "./operationsAdmission";
import { createCredentialHash } from "./credentials";
import {
  CLEARED_TABLES,
  FTS_SHADOW_TABLES,
  FTS_VIRTUAL_TABLES,
  KEPT_TABLES,
  commitLiveOperations,
  completeInterruptedRestore,
  getFiscalYearLabel,
  isClassifiedSchemaObject,
  prepareLiveOperations,
  cancelLiveOperations,
  readOperationsMarker,
  reconcileOperationsFiles,
  resetLiveOperationsForTests,
  setBeforeValidateForTests,
  setDrainTimeoutMsForTests,
  setSidecarWriterForTests,
  guardedDatabaseReplace,
} from "./liveOperations";
import {
  readIntentFile,
  readSidecarFile,
  removeIntentFile,
  removeSidecarFile,
  writeIntentFile,
  writeSidecarFile,
} from "./operationsFiles";
import { allocateTaxInvoice, posService } from "./posService";

function seedAdmin() {
  const database = getDb();
  const at = Date.now();
  const credential = createCredentialHash("TestPass123!");
  database
    .prepare(
      `INSERT INTO users (
         username, display_name, role, password_hash, salt, hash_algo,
         active, require_password_change, created_at, updated_at
       ) VALUES ('admin', 'Admin', 'admin', ?, ?, ?, 1, 0, ?, ?)`,
    )
    .run(credential.hash, credential.salt, credential.hashAlgo, at, at);
}

async function goLive() {
  await prepareLiveOperations();
  return commitLiveOperations("admin", "START LIVE", async () => ({ id: "backup:test" }));
}

describe("start live operations", () => {
  let tempDir = "";

  beforeEach(async () => {
    resetLiveOperationsForTests();
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-live-ops-"));
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = path.join(tempDir, "restaurant-pos.sqlite");
    await initializeDatabase();
    seedAdmin();
    posService.setSetting(CREDIT_CONFIG_KEY, { enabled: true, defaultCreditDays: 7 });
    posService.setSetting("config:invoice", { prefix: "RST", fiscalYear: "", lastNumber: 0 });
    posService.seedTables(12);
  });

  afterEach(() => {
    resetLiveOperationsForTests();
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function practiceWorld() {
    const item = posService.createItem(
      {
        name: "Tea",
        category: "Drinks",
        price: 80,
        variants: [{ name: "Large", price: 100 }],
      },
      "admin",
    );
    const customer = posService.createCustomer(
      {
        name: "Credit Guest",
        phone: "9876543210",
        creditEnabled: true,
        creditLimit: 5000,
        defaultCreditDays: 7,
      },
      "admin",
    );
    const cash = posService.createOrder({ orderType: "takeaway", createdBy: "admin" });
    posService.addItemToOrder(cash._id, { name: "Tea", qty: 1, rate: 80, menuItemId: item._id });
    const paidCash = posService.setOrderPaid(cash._id, { method: "cash", amount: 80, receivedBy: "admin" });

    const credit = posService.createOrder({
      orderType: "takeaway",
      customerId: customer.id,
      createdBy: "admin",
    });
    posService.addItemToOrder(credit._id, { name: "Tea", qty: 1, rate: 400, menuItemId: item._id });
    posService.setOrderPaid(credit._id, {
      method: "credit",
      amount: 400,
      amountPaid: 0,
      customerId: customer.id,
      dueDate: "2026-12-01",
      receivedBy: "admin",
    });
    posService.receiveCustomerPayment(customer.id, { amount: 100, method: "cash" }, "admin");

    const open = posService.createOrder({ tableId: 1, orderType: "table", createdBy: "admin" });
    const withLine = posService.addItemToOrder(open._id, { name: "Tea", qty: 1, rate: 80, menuItemId: item._id });
    posService.markKotSent(open._id, [{ id: withLine.items[0].id, sentQty: 1 }], "admin");

    const category = getDb().prepare("SELECT id FROM expense_categories LIMIT 1").get() as { id: string };
    posService.createExpense({ categoryId: category.id, amount: 40, invoiceNumber: "VENDOR-1" }, "admin");
    const staff = posService.createStaff({ name: "Ravi", phone: "9000000001", designation: "Cook" });
    posService.createSalaryAdvance({ staffId: staff.id, amount: 25 }, "admin");
    const at = Date.now();
    getDb()
      .prepare(
        `INSERT INTO attendance_records (
           id, staff_id, attendance_date, shift_id, status, created_on, updated_on
         ) VALUES ('attendance:1', ?, '2026-10-01', 'morning', 'present', ?, ?)`,
      )
      .run(staff.id, at, at);
    getDb()
      .prepare(
        `INSERT INTO vendors (id, name, active, created_at, updated_at)
         VALUES ('vendor:1', 'Farm', 1, ?, ?)`,
      )
      .run(at, at);
    getDb()
      .prepare(
        `INSERT INTO grocery_lists (
           id, title, list_date, list_type, status, print_count, created_at, updated_at
         ) VALUES ('list:1', 'Monday', ?, 'regular', 'open', 0, ?, ?)`,
      )
      .run(at, at, at);
    getDb()
      .prepare(
        `INSERT INTO grocery_purchases (
           id, vendor_id, purchase_date, invoice_number, status, payment_status,
           amount_paid_paise, subtotal_paise, tax_paise, total_paise, created_at, updated_at
         ) VALUES ('purchase:1', 'vendor:1', ?, 'SUP-9', 'recorded', 'paid', 1000, 1000, 0, 1000, ?, ?)`,
      )
      .run(at, at, at);
    getDb()
      .prepare(
        `INSERT INTO grocery_purchase_lines (
           id, purchase_id, item_name, quantity, unit, total_paise, purchased_at, active, created_at, updated_at
         ) VALUES ('pline:1', 'purchase:1', 'Rice', 1, 'kg', 1000, ?, 1, ?, ?)`,
      )
      .run(at, at, at);
    getDb()
      .prepare(
        `INSERT INTO print_jobs (
           id, printer_key, job_type, payload_json, status, attempts, max_attempts, created_at
         ) VALUES ('print:1', 'counter', 'receipt', '{}', 'completed', 1, 3, ?)`,
      )
      .run(at);
    getDb()
      .prepare(
        `INSERT INTO client_ops (id, username, action, result_json, created_at)
         VALUES ('op:1', 'admin', 'order.paid', '{}', ?)`,
      )
      .run(at);

    return { item, customer, paidCash, staff };
  }

  it("lets practice payments succeed without allocating a tax invoice", () => {
    const { paidCash } = practiceWorld();
    expect(paidCash.status).toBe("paid");
    expect(paidCash.invoiceNumber || null).toBeNull();
    expect((paidCash.meta as { practice?: boolean }).practice).toBe(true);
    const invoice = getDb().prepare("SELECT value_json FROM settings WHERE key = 'config:invoice'").get() as {
      value_json: string;
    };
    expect(JSON.parse(invoice.value_json).lastNumber).toBe(0);
    expect(() => allocateTaxInvoice()).toThrow("tax-invoice-before-live");
    const after = getDb().prepare("SELECT value_json FROM settings WHERE key = 'config:invoice'").get() as {
      value_json: string;
    };
    expect(JSON.parse(after.value_json).lastNumber).toBe(0);
  });

  it("clears practice activity, keeps setup, and starts invoices at 000001", async () => {
    const { item, customer, staff } = practiceWorld();
    expect(posService.getCustomerAccount(customer.id).outstanding).toBe(300);
    const result = await goLive();
    expect(result.sidecarStatus).toBe("matched");
    expect(result.counts.paidOrders).toBe(2);
    expect(result.counts.openOrders).toBe(1);

    expect(getDb().prepare("SELECT COUNT(*) AS count FROM orders").get()).toEqual({ count: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM payments").get()).toEqual({ count: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM customer_account_entries").get()).toEqual({
      count: 0,
    });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM customer_credit_allocations").get()).toEqual({
      count: 0,
    });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM expenses").get()).toEqual({ count: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM grocery_purchases").get()).toEqual({ count: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM grocery_lists").get()).toEqual({ count: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM attendance_records").get()).toEqual({ count: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM salary_advances").get()).toEqual({ count: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM print_jobs").get()).toEqual({ count: 0 });
    expect(posService.getOpenOrderForTable(1)).toBeNull();
    expect(
      (getDb().prepare("SELECT outstanding_paise FROM customers WHERE id = ?").get(customer.id) as {
        outstanding_paise: number;
      }).outstanding_paise,
    ).toBe(0);
    expect(posService.getOrderById(item._id)).toBeNull();
    expect(getDb().prepare("SELECT name FROM menu_items WHERE id = ?").get(item._id)).toEqual({ name: "Tea" });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM menu_item_variants").get()).toEqual({ count: 1 });
    expect(getDb().prepare("SELECT username FROM users WHERE username = 'admin'").get()).toEqual({
      username: "admin",
    });
    expect(getDb().prepare("SELECT name FROM staff WHERE id = ?").get(staff.id)).toEqual({ name: "Ravi" });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM tables").get()).toEqual(
      expect.objectContaining({ count: expect.any(Number) }),
    );
    const violations = getDb().pragma("foreign_key_check");
    expect(violations).toEqual([]);

    const invoice = JSON.parse(
      (getDb().prepare("SELECT value_json FROM settings WHERE key = 'config:invoice'").get() as { value_json: string })
        .value_json,
    );
    expect(invoice.prefix).toBe("RST");
    expect(invoice.lastNumber).toBe(0);
    const fiscalYear = getFiscalYearLabel(Date.now());
    expect(invoice.fiscalYear).toBe(fiscalYear);

    const next = posService.createOrder({ orderType: "takeaway", createdBy: "admin" });
    posService.addItemToOrder(next._id, { name: "Tea", qty: 1, rate: 80, menuItemId: item._id });
    const livePaid = posService.setOrderPaid(next._id, { method: "cash", amount: 80, receivedBy: "admin" });
    expect(livePaid.invoiceNumber).toBe(`RST-${fiscalYear}-000001`);
    expect((livePaid.meta as { practice?: boolean }).practice).toBeUndefined();

    await expect(goLive()).rejects.toThrow("operations-already-live");
    closeDb();
    await initializeDatabase();
    expect(readOperationsMarker(getDb())?.liveStartedBy).toBe("admin");
    expect(readSidecarFile()?.liveStartOperationId).toBe(readOperationsMarker(getDb())?.liveStartOperationId);
  });

  it("rolls back when backup, validation, or the drain fails", async () => {
    practiceWorld();
    await prepareLiveOperations();
    await expect(
      commitLiveOperations("admin", "START LIVE", async () => {
        throw new Error("backup-checksum-mismatch");
      }),
    ).rejects.toThrow("backup-checksum-mismatch");
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM orders").get()).toEqual({ count: 3 });
    const again = posService.createOrder({ orderType: "takeaway", createdBy: "admin" });
    expect(again._id).toBeTruthy();

    await prepareLiveOperations();
    setBeforeValidateForTests(() => {
      throw new Error("operations-cleanup-incomplete:orders");
    });
    await expect(commitLiveOperations("admin", "START LIVE", async () => ({ id: "backup:test" }))).rejects.toThrow(
      "operations-cleanup-incomplete:orders",
    );
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM orders").get() as { count: number }).count).toBeGreaterThan(
      0,
    );
    expect(readOperationsMarker(getDb())).toBeNull();
    setBeforeValidateForTests(null);

    setDrainTimeoutMsForTests(40);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = admitAsync(async () => {
      await gate;
    });
    await expect(prepareLiveOperations()).rejects.toThrow("operations-drain-timeout");
    release();
    await pending;
    expect(readOperationsMarker(getDb())).toBeNull();
    expect(posService.createOrder({ orderType: "takeaway" })._id).toBeTruthy();
  });

  it("rejects a second start and an unadmitted write while go-live is held", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = admitAsync(async () => {
      await gate;
    });
    const first = prepareLiveOperations();
    await expect(prepareLiveOperations()).rejects.toThrow("operations-prepare-in-progress");
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO print_jobs (
             id, printer_key, job_type, payload_json, status, attempts, max_attempts, created_at
           ) VALUES ('print:locked', 'counter', 'kot', '{}', 'pending', 0, 3, 1)`,
        )
        .run(),
    ).toThrow("operations-locked");
    expect(() => posService.createOrder({ orderType: "takeaway" })).toThrow("operations-locked");
    release();
    await pending;
    await first;
    await expect(commitLiveOperations("admin", "start live", async () => ({ id: "backup:test" }))).rejects.toThrow(
      "operations-confirmation-mismatch",
    );
    expect(cancelLiveOperations().cancelled).toBe(true);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM client_ops").get()).toEqual({ count: 0 });
  });

  it("keeps the database live when the sidecar write fails and refuses a sidecar-only database", async () => {
    practiceWorld();
    setSidecarWriterForTests(() => {
      throw new Error("disk-full");
    });
    await prepareLiveOperations();
    const result = await commitLiveOperations("admin", "START LIVE", async () => ({ id: "backup:test" }));
    expect(result.sidecarStatus).toBe("repair-required");
    expect(readSidecarFile()).toBeNull();
    await expect(prepareLiveOperations()).rejects.toThrow("sidecar-repair-required");
    setSidecarWriterForTests(null);
    reconcileOperationsFiles();
    expect(readSidecarFile()?.liveStartOperationId).toBe(readOperationsMarker(getDb())?.liveStartOperationId);
    await expect(prepareLiveOperations()).rejects.toThrow("operations-already-live");

    resetLiveOperationsForTests();
    closeDb();
    removeSidecarFile();
    removeIntentFile();
    fs.rmSync(process.env.POS_DB_PATH_OVERRIDE || "", { force: true });
    await initializeDatabase();
    seedAdmin();
    writeSidecarFile({
      liveStartedAt: Date.now(),
      liveStartedBy: "admin",
      liveStartOperationId: "ops:stale",
      backupId: "backup:old",
    });
    reconcileOperationsFiles();
    expect(readSidecarFile()?.liveStartOperationId).toBe("ops:stale");
    await expect(prepareLiveOperations()).rejects.toThrow("sidecar-without-database-marker");
  });

  it("refuses a pre-live restore over live data unless it was acknowledged, and can finish an interrupted one", async () => {
    const prelivePath = path.join(tempDir, "prelive.sqlite");
    await backupDatabase(prelivePath);
    practiceWorld();
    await goLive();
    expect(readOperationsMarker(getDb())?.liveStartedAt).toBeGreaterThan(0);

    await expect(posService.restoreLocalBackup(prelivePath, "admin")).rejects.toThrow(
      "restore-would-discard-live-operations",
    );
    expect(readOperationsMarker(getDb())?.liveStartedBy).toBe("admin");
    expect(readSidecarFile()?.liveStartedBy).toBe("admin");

    await expect(
      guardedDatabaseReplace({
        actor: "admin",
        sourceLabel: prelivePath,
        materializedSqlitePath: prelivePath,
        acknowledgePreLive: true,
        createSafetyCopy: async () => {
          throw new Error("safety-copy-failed");
        },
        replaceDatabase: async () => {
          throw new Error("should-not-replace");
        },
      }),
    ).rejects.toThrow("safety-copy-failed");
    expect(readIntentFile()).toBeNull();
    expect(readOperationsMarker(getDb())?.liveStartedBy).toBe("admin");

    const safetyCopyPath = path.join(tempDir, "safety.sqlite");
    fs.copyFileSync(prelivePath, safetyCopyPath);
    getDb().prepare("DELETE FROM settings WHERE key = 'config:operations'").run();
    writeIntentFile({
      kind: "pre-live-restore",
      phase: "database-replaced",
      acknowledgedBy: "admin",
      acknowledgedAt: Date.now(),
      safetyCopyPath,
      sourceLabel: prelivePath,
    });
    reconcileOperationsFiles();
    await expect(prepareLiveOperations()).rejects.toThrow("sidecar-without-database-marker");
    expect(readSidecarFile()).toBeTruthy();
    completeInterruptedRestore();
    expect(readSidecarFile()).toBeNull();
    expect(readIntentFile()).toBeNull();
    expect(() => completeInterruptedRestore()).toThrow("restore-intent-missing");

    const marker = {
      liveStartedAt: Date.now(),
      liveStartedBy: "admin",
      liveStartOperationId: "ops:done",
      backupId: "backup:done",
    };
    getDb()
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at) VALUES ('config:operations', ?, ?)`,
      )
      .run(JSON.stringify(marker), marker.liveStartedAt);
    writeSidecarFile(marker);
    writeIntentFile({
      kind: "pre-live-restore",
      phase: "database-replaced",
      acknowledgedBy: "admin",
      acknowledgedAt: Date.now(),
      safetyCopyPath,
      sourceLabel: prelivePath,
    });
    reconcileOperationsFiles();
    expect(readIntentFile()).toBeNull();
    expect(readSidecarFile()?.liveStartOperationId).toBe("ops:done");
    reconcileOperationsFiles();
    expect(readOperationsMarker(getDb())?.liveStartOperationId).toBe("ops:done");
  });

  it("classifies every application table and fails closed on a new one", () => {
    const names = (
      getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((row) => row.name);
    for (const name of names) {
      expect(isClassifiedSchemaObject(name)).toBe(true);
    }
    for (const name of [...KEPT_TABLES, ...CLEARED_TABLES, ...FTS_VIRTUAL_TABLES]) {
      expect(names).toContain(name);
    }
    expect(isClassifiedSchemaObject("sqlite_sequence")).toBe(true);
    for (const shadow of FTS_SHADOW_TABLES) {
      expect(isClassifiedSchemaObject(shadow)).toBe(true);
    }
    expect(isClassifiedSchemaObject("future_loyalty")).toBe(false);
  });
});
