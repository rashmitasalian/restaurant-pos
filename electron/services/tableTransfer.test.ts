jest.mock("../printing/printService", () => ({
  printPayload: jest.fn(async () => ({
    type: "kot",
    printerName: "Kitchen",
    transport: "windows-raw",
  })),
}));

import fs from "fs";
import os from "os";
import path from "path";
import { closeDb, getDb, initializeDatabase } from "../db/sqlite";
import { printPayload } from "../printing/printService";
import { resetOrderPrintTurnsForTests } from "../printing/orderPrintTurn";
import { createCredentialHash } from "./credentials";
import { posService, setTableTransferTestHooks } from "./posService";

const printMock = printPayload as jest.Mock;

describe("table transfer", () => {
  let tempDir = "";

  beforeEach(async () => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-table-transfer-"));
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = path.join(tempDir, "restaurant-pos.sqlite");
    await initializeDatabase();
    posService.seedTables(6);
    printMock.mockReset();
    printMock.mockResolvedValue({ type: "kot", printerName: "Kitchen", transport: "windows-raw" });
    setTableTransferTestHooks({ fault: null, publishOrdersChanged: null });
    resetOrderPrintTurnsForTests();
  });

  afterEach(() => {
    setTableTransferTestHooks({ fault: null, publishOrdersChanged: null });
    resetOrderPrintTurnsForTests();
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function orderOn(tableId: number, name = "Tea") {
    const created = posService.createOrder({ tableId, orderType: "table" });
    return posService.addItemToOrder(created._id, { name, qty: 1, rate: 40 });
  }

  function sendFood(order: { _id: string; items: Array<{ id: string; qty: number }> }) {
    const line = order.items[0];
    return posService.markKotSent(order._id, [{ id: line.id, sentQty: line.qty }]);
  }

  it("moves the same order, clears an empty shell, and returns notice plus refresh", async () => {
    const source = sendFood(orderOn(1, "Tea"));
    const shell = posService.createOrder({ tableId: 2, orderType: "table" });
    const credential = createCredentialHash("TestPass123!");
    const at = Date.now();
    getDb()
      .prepare(
        `INSERT INTO users (
           username, display_name, role, password_hash, salt, hash_algo,
           active, require_password_change, created_at, updated_at
         ) VALUES ('cashier', 'Cashier', 'cashier', ?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(credential.hash, credential.salt, credential.hashAlgo, at, at);
    const lineId = source.items[0].id;
    const result = await posService.transferOrderTable(
      {
        orderId: source._id,
        destinationTableId: 2,
        reason: "Customer requested",
        baseUpdatedAt: source.updatedAt,
      },
      "cashier",
    );

    expect(result.order._id).toBe(source._id);
    expect(result.order.tableId).toBe(2);
    expect(result.order.items[0].id).toBe(lineId);
    expect(result.order.items[0].kotPrintedQty).toBe(1);
    expect(result.notice).toBe("printed");
    expect(result.refresh).toBe("published");
    expect(posService.getOrderById(shell._id)?.status).toBe("cancelled");
    const audit = getDb()
      .prepare("SELECT user, detail_json FROM audit_logs WHERE action = ? AND entity_id = ?")
      .get("order.table.transferred", source._id) as { user: string; detail_json: string };
    const detail = JSON.parse(audit.detail_json);
    expect(audit.user).toBe("cashier");
    expect(detail.fromTableId).toBe(1);
    expect(detail.toTableId).toBe(2);
    expect(detail.reason).toBe("Customer requested");
    expect(detail.user).toBeUndefined();
    expect(printMock).toHaveBeenCalledTimes(1);
    const job = getDb()
      .prepare("SELECT status, payload_json FROM print_jobs WHERE id LIKE 'print-job:transfer:%'")
      .get() as { status: string; payload_json: string };
    expect(job.status).toBe("completed");
    expect(job.payload_json).toContain("No new food");
    expect(job.payload_json).not.toContain("Tea");
  });

  it("does not print a notice when the kitchen has not received food", async () => {
    const source = orderOn(1);
    const result = await posService.transferOrderTable(
      {
        orderId: source._id,
        destinationTableId: 2,
        reason: "Guest moved",
        baseUpdatedAt: source.updatedAt,
      },
      null,
    );
    expect(result.notice).toBe("not-required");
    expect(result.refresh).toBe("published");
    expect(printMock).not.toHaveBeenCalled();
  });

  it("keeps the move when the notice printer fails and when the floor event fails", async () => {
    const source = sendFood(orderOn(1));
    printMock.mockRejectedValueOnce(new Error("printer-offline"));
    const pending = await posService.transferOrderTable(
      {
        orderId: source._id,
        destinationTableId: 2,
        reason: "Customer requested",
        baseUpdatedAt: source.updatedAt,
      },
      null,
    );
    expect(pending.order.tableId).toBe(2);
    expect(pending.notice).toBe("pending");
    expect(pending.refresh).toBe("published");
    const job = getDb()
      .prepare("SELECT status FROM print_jobs WHERE id LIKE 'print-job:transfer:%'")
      .get() as { status: string };
    expect(job.status).toBe("pending");

    const second = sendFood(orderOn(3));
    setTableTransferTestHooks({
      publishOrdersChanged: () => {
        throw new Error("publish-boom");
      },
    });
    printMock.mockResolvedValueOnce({ type: "kot", printerName: "Kitchen", transport: "windows-raw" });
    const published = await posService.transferOrderTable(
      {
        orderId: second._id,
        destinationTableId: 4,
        reason: "Customer requested",
        baseUpdatedAt: second.updatedAt,
      },
      null,
    );
    expect(published.refresh).toBe("publish-failed");
    expect(published.notice).toBe("printed");
    expect(published.order.tableId).toBe(4);
  });

  it("rejects an empty, invoiced, paid, or stale order without moving it", async () => {
    const empty = posService.createOrder({ tableId: 1, orderType: "table" });
    await expect(
      posService.transferOrderTable(
        {
          orderId: empty._id,
          destinationTableId: 2,
          reason: "Customer requested",
          baseUpdatedAt: empty.updatedAt,
        },
        null,
      ),
    ).rejects.toThrow("order-empty");

    const source = orderOn(1);
    await expect(
      posService.transferOrderTable(
        {
          orderId: source._id,
          destinationTableId: 2,
          reason: "Customer requested",
          baseUpdatedAt: undefined,
        },
        null,
      ),
    ).rejects.toThrow("order-conflict");
    expect(posService.getOrderById(source._id)?.tableId).toBe(1);

    getDb().prepare("UPDATE orders SET invoice_number = ? WHERE id = ?").run("INV-1", source._id);
    const invoiced = posService.getOrderById(source._id)!;
    await expect(
      posService.transferOrderTable(
        {
          orderId: source._id,
          destinationTableId: 2,
          reason: "Customer requested",
          baseUpdatedAt: invoiced.updatedAt,
        },
        null,
      ),
    ).rejects.toThrow("order-not-transferable");

    getDb().prepare("UPDATE orders SET invoice_number = NULL, status = 'paid' WHERE id = ?").run(source._id);
    const paid = posService.getOrderById(source._id)!;
    await expect(
      posService.transferOrderTable(
        {
          orderId: source._id,
          destinationTableId: 2,
          reason: "Customer requested",
          baseUpdatedAt: paid.updatedAt,
        },
        null,
      ),
    ).rejects.toThrow("order-not-transferable");
  });

  it("lets a voided payment through and blocks a completed one", async () => {
    const blocked = orderOn(1);
    getDb()
      .prepare(
        "INSERT INTO payments (id, order_id, method, amount_paise, status, received_at) VALUES (?, ?, 'cash', 100, 'completed', ?)",
      )
      .run("pay:1", blocked._id, Date.now());
    await expect(
      posService.transferOrderTable(
        {
          orderId: blocked._id,
          destinationTableId: 2,
          reason: "Customer requested",
          baseUpdatedAt: blocked.updatedAt,
        },
        null,
      ),
    ).rejects.toThrow("order-not-transferable");

    const allowed = orderOn(3);
    getDb()
      .prepare(
        "INSERT INTO payments (id, order_id, method, amount_paise, status, received_at) VALUES (?, ?, 'cash', 100, 'voided', ?)",
      )
      .run("pay:2", allowed._id, Date.now());
    const moved = await posService.transferOrderTable(
      {
        orderId: allowed._id,
        destinationTableId: 4,
        reason: "Customer requested",
        baseUpdatedAt: allowed.updatedAt,
      },
      null,
    );
    expect(moved.order.tableId).toBe(4);
  });

  it("blocks an occupied table and a shell that still has a print job, and rolls the clear back", async () => {
    const source = orderOn(1);
    orderOn(2, "Soup");
    await expect(
      posService.transferOrderTable(
        {
          orderId: source._id,
          destinationTableId: 2,
          reason: "Customer requested",
          baseUpdatedAt: source.updatedAt,
        },
        null,
      ),
    ).rejects.toThrow("table-occupied");

    const shell = posService.createOrder({ tableId: 5, orderType: "table" });
    posService.addPrintJob({
      printerName: "kitchen",
      jobType: "kot",
      content: { orderId: shell._id, data: { lines: ["LEFT:  Table No: 5"], orderId: shell._id } },
    });
    await expect(
      posService.transferOrderTable(
        {
          orderId: source._id,
          destinationTableId: 5,
          reason: "Customer requested",
          baseUpdatedAt: posService.getOrderById(source._id)!.updatedAt,
        },
        null,
      ),
    ).rejects.toThrow("table-print-pending");
    expect(posService.getOrderById(shell._id)?.status).toBe("open");

    const empty = posService.createOrder({ tableId: 6, orderType: "table" });
    setTableTransferTestHooks({ fault: "after-clear" });
    await expect(
      posService.transferOrderTable(
        {
          orderId: source._id,
          destinationTableId: 6,
          reason: "Customer requested",
          baseUpdatedAt: posService.getOrderById(source._id)!.updatedAt,
        },
        null,
      ),
    ).rejects.toThrow("transfer-fault");
    expect(posService.getOrderById(empty._id)?.status).toBe("open");
    expect(posService.getOrderById(source._id)?.tableId).toBe(1);
  });

  it("rewrites pending food headers and leaves a completed ticket alone", async () => {
    const source = orderOn(1);
    const line = source.items[0];
    const pending = posService.addPrintJob({
      printerName: "kitchen",
      jobType: "kot",
      content: {
        orderId: source._id,
        sentLines: [{ id: line.id, sentQty: 1 }],
        data: {
          lines: ["LEFT:  Table No: 1", "LEFT:  1 x Tea"],
          orderId: source._id,
          sentLines: [{ id: line.id, sentQty: 1 }],
        },
      },
    });
    const done = posService.addPrintJob({
      printerName: "kitchen",
      jobType: "kot",
      content: {
        orderId: source._id,
        sentLines: [{ id: line.id, sentQty: 1 }],
        lines: ["LEFT:  Table No: 1", "LEFT:  1 x Tea"],
      },
    });
    posService.markPrintJobCompleted(done._id);
    await posService.transferOrderTable(
      {
        orderId: source._id,
        destinationTableId: 2,
        reason: "Customer requested",
        baseUpdatedAt: source.updatedAt,
      },
      null,
    );
    const pendingJob = posService.getPrintJob(pending._id)!;
    const doneJob = posService.getPrintJob(done._id)!;
    expect(JSON.stringify(pendingJob.content)).toContain("Table No: 2");
    expect(JSON.stringify(doneJob.content)).toContain("Table No: 1");
    expect(JSON.stringify(doneJob.content)).not.toContain("Table No: 2");
  });

  it("gives one free table to the first of two transfers", async () => {
    const first = orderOn(1, "Tea");
    const second = orderOn(2, "Soup");
    const results = await Promise.allSettled([
      posService.transferOrderTable(
        {
          orderId: first._id,
          destinationTableId: 3,
          reason: "Customer requested",
          baseUpdatedAt: first.updatedAt,
        },
        null,
      ),
      posService.transferOrderTable(
        {
          orderId: second._id,
          destinationTableId: 3,
          reason: "Customer requested",
          baseUpdatedAt: second.updatedAt,
        },
        null,
      ),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason?.message || "")).toContain(
      "table-occupied",
    );
    const tables = [first._id, second._id].map((id) => posService.getOrderById(id)?.tableId);
    expect(tables.filter((id) => id === 3)).toHaveLength(1);
  });

  it("keeps floor save on the old error and still clears an empty shell that has a print job", () => {
    const occupied = orderOn(3);
    expect(() => posService.seedTables(2)).toThrow("tables-have-open-orders");
    expect(posService.getOrderById(occupied._id)?.status).toBe("open");
    expect(posService.getTables().some((table) => table.id === 3)).toBe(true);

    posService.cancelOrder(occupied._id, null, "test");
    const shell = posService.createOrder({ tableId: 3, orderType: "table" });
    posService.addPrintJob({
      printerName: "kitchen",
      jobType: "kot",
      content: { orderId: shell._id, lines: ["LEFT:  Table No: 3"] },
    });
    expect(() => posService.seedTables(2)).not.toThrow();
    expect(posService.getOrderById(shell._id)?.status).toBe("cancelled");
  });
});
