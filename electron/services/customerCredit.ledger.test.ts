jest.mock("electron", () => ({
  app: {
    getPath: () => process.env.POS_TEST_USER_DATA_DIR || "",
  },
}));

import fs from "fs";
import os from "os";
import path from "path";
import { closeDb, getDb, initializeDatabase } from "../db/sqlite";
import { CREDIT_CONFIG_KEY } from "../../src/shared/customerCredit";
import { posService } from "./posService";

describe("customer credit ledger", () => {
  let tempDir = "";

  beforeEach(async () => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-credit-ledger-"));
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = path.join(tempDir, "restaurant-pos.sqlite");
    await initializeDatabase();
    posService.setSetting(CREDIT_CONFIG_KEY, { enabled: true, defaultCreditDays: 7 });
  });

  afterEach(() => {
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createCreditReadyCustomer(limit = 5000) {
    return posService.createCustomer(
      {
        name: "Credit Guest",
        phone: "9876543210",
        creditEnabled: true,
        creditLimit: limit,
        defaultCreditDays: 7,
      },
      "manager",
    );
  }

  function createPaidCreditOrder(customerId: string, amount: number, dueDate?: string) {
    const order = posService.createOrder({
      orderType: "takeaway",
      serviceModeId: "takeaway",
      customerId,
      createdBy: "cashier",
    });
    posService.updateOrderLines(order._id, [
      {
        id: `line:${amount}`,
        name: "Test Dish",
        qty: 1,
        rate: amount,
      },
    ]);
    return posService.setOrderPaid(order._id, {
      method: "credit",
      amount,
      amountPaid: 0,
      customerId,
      dueDate,
      receivedBy: "cashier",
    });
  }

  it("creates a credit sale, blocks over limit, allocates FIFO, and voids remaining", () => {
    const customer = createCreditReadyCustomer(1000);
    const first = createPaidCreditOrder(customer.id, 400, "2026-01-01");
    expect(first.status).toBe("paid");
    expect(first.payments?.[0]?.method).toBe("credit");

    const accountAfterSale = posService.getCustomerAccount(customer.id);
    expect(accountAfterSale.outstanding).toBe(400);
    expect(accountAfterSale.availableCredit).toBe(600);

    expect(() => createPaidCreditOrder(customer.id, 700)).toThrow("credit-limit-exceeded");

    const second = createPaidCreditOrder(customer.id, 300, "2026-01-10");
    expect(posService.getCustomerAccount(customer.id).outstanding).toBe(700);

    const payment = posService.receiveCustomerPayment(
      customer.id,
      { amount: 500, method: "cash" },
      "cashier",
    );
    expect(payment.payment.outstandingAfter).toBe(200);
    expect(payment.payment.allocations).toEqual([
      expect.objectContaining({ amount: 400 }),
      expect.objectContaining({ amount: 100 }),
    ]);

    const openBills = posService.listCustomerOpenBills(customer.id);
    expect(openBills).toHaveLength(1);
    expect(openBills[0].remaining).toBe(200);

    const voided = posService.voidCustomerCreditSale(openBills[0].id, { reason: "mistaken bill" }, "manager");
    expect(voided.voided.amount).toBe(200);
    expect(voided.account.outstanding).toBe(0);

    const totals = posService.getCustomerCreditTotals();
    expect(totals.outstanding).toBe(0);

    const entries = posService.listCustomerAccountEntries(customer.id, { limit: 20, offset: 0 });
    expect(entries.entries.some((row) => row.entryType === "void")).toBe(true);

    const orderMeta = posService.getOrderById(second._id)?.meta as any;
    expect(orderMeta?.credit?.voided).toBe(true);

    const dbOutstanding = getDb()
      .prepare("SELECT outstanding_paise FROM customers WHERE id = ?")
      .get(customer.id) as { outstanding_paise: number };
    expect(dbOutstanding.outstanding_paise).toBe(0);
  });

  it("relinks orphaned credit ledger rows when restoring a deleted paid credit order", () => {
    const customer = createCreditReadyCustomer(2000);
    const paid = createPaidCreditOrder(customer.id, 250);
    const snapshot = posService.getOrderById(paid._id)!;

    posService.receiveCustomerPayment(customer.id, { amount: 250, method: "upi" }, "cashier");
    expect(posService.getCustomerAccount(customer.id).outstanding).toBe(0);

    posService.deleteClosedOrders([paid._id], "admin");
    const orphan = getDb()
      .prepare(
        `SELECT order_id FROM customer_account_entries
         WHERE customer_id = ? AND entry_type = 'credit_sale' LIMIT 1`,
      )
      .get(customer.id) as { order_id: string | null };
    expect(orphan.order_id).toBeNull();

    const restored = posService.restoreOrderSnapshot(snapshot, "admin");
    const relinked = getDb()
      .prepare(
        `SELECT order_id FROM customer_account_entries
         WHERE customer_id = ? AND entry_type = 'credit_sale' LIMIT 1`,
      )
      .get(customer.id) as { order_id: string | null };
    expect(relinked.order_id).toBe(restored._id);
  });
});
