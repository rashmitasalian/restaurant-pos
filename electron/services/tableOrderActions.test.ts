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
import { retryStoredPrintJob } from "./kitchenDispatch";
import { printKitchenTicket } from "./kitchenDispatch";
import { createCredentialHash } from "./credentials";
import { posService, setOrderRestructureTestHooks } from "./posService";

const printMock = printPayload as jest.Mock;

function gate() {
  let release: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let used = false;
  return {
    opened,
    release,
    wait: async () => {
      if (!used) {
        used = true;
        entered();
        await released;
      }
    },
  };
}

function snapshot() {
  const database = getDb();
  return {
    orders: database.prepare("SELECT * FROM orders ORDER BY id").all(),
    lines: database.prepare("SELECT * FROM order_lines ORDER BY id").all(),
    jobs: database.prepare("SELECT id, status, payload_json FROM print_jobs ORDER BY id").all(),
    audits: database.prepare("SELECT action, entity_id, detail_json FROM audit_logs ORDER BY id").all(),
  };
}

function insertJob(input: {
  id: string;
  orderId: string;
  status: "pending" | "failed" | "completed";
  lines: string[];
  sentLines?: Array<{ id: string; sentQty: number }>;
  recovery?: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO print_jobs (
        id, printer_key, job_type, payload_json, status, attempts, max_attempts, created_at
      ) VALUES (?, 'kitchen', 'kot', ?, ?, 0, 3, ?)`,
    )
    .run(
      input.id,
      JSON.stringify({
        type: "kot",
        printer: "kitchen",
        orderId: input.orderId,
        recovery: input.recovery,
        data: {
          lines: input.lines,
          orderId: input.orderId,
          sentLines: input.sentLines || [],
        },
      }),
      input.status,
      Date.now(),
    );
}

describe("merge and split", () => {
  let tempDir = "";

  beforeEach(async () => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-table-actions-"));
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = path.join(tempDir, "restaurant-pos.sqlite");
    await initializeDatabase();
    posService.seedTables(6);
    printMock.mockReset();
    printMock.mockResolvedValue({ type: "kot", printerName: "Kitchen", transport: "windows-raw" });
    setOrderRestructureTestHooks({ fault: null, waitBeforeTransaction: null, publishOrdersChanged: null });
    resetOrderPrintTurnsForTests();
  });

  afterEach(() => {
    setOrderRestructureTestHooks({ fault: null, waitBeforeTransaction: null, publishOrdersChanged: null });
    resetOrderPrintTurnsForTests();
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function orderOn(tableId: number, name = "Tea", qty = 1, rate = 40) {
    const created = posService.createOrder({ tableId, orderType: "table" });
    return posService.addItemToOrder(created._id, { name, qty, rate });
  }

  function merge(survivor: { _id: string; updatedAt: number }, source: { _id: string; updatedAt: number }) {
    return posService.mergeOrders(
      {
        survivorOrderId: survivor._id,
        sourceOrderId: source._id,
        reason: "Customer requested",
        survivorBaseUpdatedAt: survivor.updatedAt,
        sourceBaseUpdatedAt: source.updatedAt,
      },
      null,
    );
  }

  it("moves lines onto the survivor and leaves a zero-total cancelled source", async () => {
    const survivor = orderOn(1, "Rice", 1, 50);
    const source = orderOn(2, "Paneer", 2, 80);
    const sourceNumber = source.meta?.orderSeq;
    const result = await merge(survivor, source);
    expect(result.committed).toBe(true);
    expect(result.order._id).toBe(survivor._id);
    expect(result.order.meta?.orderSeq).toBe(survivor.meta?.orderSeq);
    expect(result.order.items.map((line) => line.name).sort()).toEqual(["Paneer", "Rice"]);
    expect(result.notice).toBe("not-required");
    const cancelled = posService.getOrderById(source._id)!;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellationReason).toBe("merged-into");
    expect(cancelled.tableId).toBe(2);
    expect(cancelled.meta?.orderSeq).toBe(sourceNumber);
    expect(cancelled.total).toBe(0);
    expect(cancelled.subtotal).toBe(0);
    expect(cancelled.items).toEqual([]);
    expect(posService.listPaidOrders()).toEqual([]);
    const audit = getDb()
      .prepare("SELECT detail_json FROM audit_logs WHERE action = 'order.merged'")
      .get() as { detail_json: string };
    const detail = JSON.parse(audit.detail_json);
    expect(detail.lines).toEqual([
      expect.objectContaining({ name: "Paneer", qty: 2, rate: 80, kotPrintedQty: 0 }),
    ]);
    expect(detail.sourceOrderId).toBe(source._id);
  });

  it("rolls back when the notice row cannot be inserted", async () => {
    const survivor = orderOn(1, "Rice");
    const source = orderOn(2, "Paneer");
    posService.markKotSent(source._id, [{ id: source.items[0].id, sentQty: 1 }]);
    const before = snapshot();
    setOrderRestructureTestHooks({ fault: "notice-insert" });
    await expect(merge(posService.getOrderById(survivor._id)!, posService.getOrderById(source._id)!)).rejects.toThrow(
      "notice-insert-fault",
    );
    expect(snapshot()).toEqual(before);
  });

  it("rolls back a line move and a zeroed total", async () => {
    const survivor = orderOn(1, "Rice");
    const source = orderOn(2, "Paneer");
    const before = snapshot();
    setOrderRestructureTestHooks({ fault: "after-line-move" });
    await expect(merge(survivor, source)).rejects.toThrow("merge-fault");
    expect(snapshot()).toEqual(before);
    setOrderRestructureTestHooks({ fault: "after-zero" });
    await expect(merge(survivor, source)).rejects.toThrow("merge-fault");
    expect(snapshot()).toEqual(before);
  });

  it("keeps a committed merge when the printer fails and when the floor event fails", async () => {
    const survivor = orderOn(1, "Rice");
    const source = orderOn(2, "Paneer");
    posService.markKotSent(source._id, [{ id: source.items[0].id, sentQty: 1 }]);
    printMock.mockRejectedValueOnce(new Error("printer-offline"));
    const printed = await merge(posService.getOrderById(survivor._id)!, posService.getOrderById(source._id)!);
    expect(printed.committed).toBe(true);
    expect(printed.notice).toBe("pending");
    const job = getDb()
      .prepare("SELECT status, payload_json FROM print_jobs WHERE id LIKE 'print-job:merge:%'")
      .get() as { status: string; payload_json: string };
    expect(job.status).toBe("pending");
    expect(job.payload_json).toContain("table-merge");
    expect(job.payload_json).not.toContain("sentLines");

    const survivor2 = orderOn(3, "Soup");
    const source2 = orderOn(4, "Tea");
    posService.markKotSent(source2._id, [{ id: source2.items[0].id, sentQty: 1 }]);
    setOrderRestructureTestHooks({
      publishOrdersChanged: () => {
        throw new Error("publish-down");
      },
    });
    const refreshed = await merge(posService.getOrderById(survivor2._id)!, posService.getOrderById(source2._id)!);
    expect(refreshed.committed).toBe(true);
    expect(refreshed.refresh).toBe("publish-failed");
    expect(posService.getOrderById(source2._id)?.status).toBe("cancelled");
  });

  it("retries a pending merge notice without marking food sent", async () => {
    const survivor = orderOn(1, "Rice");
    const source = orderOn(2, "Paneer");
    posService.markKotSent(source._id, [{ id: source.items[0].id, sentQty: 1 }]);
    printMock.mockRejectedValueOnce(new Error("printer-offline"));
    await merge(posService.getOrderById(survivor._id)!, posService.getOrderById(source._id)!);
    const beforeSent = Number(
      posService.getOrderById(survivor._id)!.items.find((line) => line.name === "Paneer")?.kotPrintedQty,
    );
    const beforeAudits = (
      getDb().prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'order.kot.sent'").get() as {
        count: number;
      }
    ).count;
    printMock.mockClear();
    const jobId = (getDb().prepare("SELECT id FROM print_jobs WHERE id LIKE 'print-job:merge:%'").get() as { id: string })
      .id;
    const retry = await retryStoredPrintJob(jobId);
    expect(retry.ok).toBe(true);
    const lines = printMock.mock.calls[0][0].data.lines as string[];
    expect(lines.join("\n")).toContain("No new food");
    expect(lines.join("\n")).not.toContain("Paneer");
    expect(
      Number(posService.getOrderById(survivor._id)!.items.find((line) => line.name === "Paneer")?.kotPrintedQty),
    ).toBe(beforeSent);
    expect(
      (getDb().prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'order.kot.sent'").get() as {
        count: number;
      }).count,
    ).toBe(beforeAudits);
  });

  it("prints the stored partial-send ticket once and caps sent quantity", async () => {
    const survivor = orderOn(1, "SURVIVOR-RICE", 1, 30);
    const source = orderOn(2, "Paneer", 4, 100);
    const lineId = source.items[0].id;
    getDb().prepare("UPDATE order_lines SET kot_printed_qty = 1 WHERE id = ?").run(lineId);
    insertJob({
      id: "job:partial",
      orderId: source._id,
      status: "failed",
      lines: ["Table No: OLD", "LEFT:3 x UNSENT-PANEER"],
      sentLines: [{ id: lineId, sentQty: 4 }],
    });
    const completed = insertJob({
      id: "job:done",
      orderId: source._id,
      status: "completed",
      lines: ["HISTORICAL-PANEER"],
      sentLines: [{ id: lineId, sentQty: 1 }],
    });
    void completed;
    const beforeCompleted = (
      getDb().prepare("SELECT payload_json FROM print_jobs WHERE id = 'job:done'").get() as { payload_json: string }
    ).payload_json;
    await merge(posService.getOrderById(survivor._id)!, posService.getOrderById(source._id)!);
    expect(
      (getDb().prepare("SELECT payload_json FROM print_jobs WHERE id = 'job:done'").get() as { payload_json: string })
        .payload_json,
    ).toBe(beforeCompleted);
    printMock.mockClear();
    const retry = await retryStoredPrintJob("job:partial");
    expect(retry.ok).toBe(true);
    expect(printMock).toHaveBeenCalledTimes(1);
    const lines = printMock.mock.calls[0][0].data.lines as string[];
    expect(lines.join("\n")).toContain("3 x UNSENT-PANEER");
    expect(lines.join("\n")).not.toContain("SURVIVOR-RICE");
    expect(lines.join("\n")).not.toContain("OLD");
    const moved = posService.getOrderById(survivor._id)!.items.find((line) => line.id === lineId)!;
    expect(moved.kotPrintedQty).toBe(4);
    expect(moved.qty).toBe(4);
  });

  it("does not print a send-unrecorded job during merge or on an unconfirmed retry", async () => {
    const survivor = orderOn(1, "Rice");
    const source = orderOn(2, "Paneer", 2, 40);
    insertJob({
      id: "job:recovery",
      orderId: source._id,
      status: "failed",
      lines: ["LEFT:2 x Paneer"],
      sentLines: [{ id: source.items[0].id, sentQty: 2 }],
      recovery: "send-unrecorded",
    });
    printMock.mockClear();
    await merge(survivor, source);
    expect(printMock).not.toHaveBeenCalled();
    const payload = JSON.parse(
      (getDb().prepare("SELECT payload_json FROM print_jobs WHERE id = 'job:recovery'").get() as { payload_json: string })
        .payload_json,
    );
    expect(payload.orderId).toBe(survivor._id);
    expect(payload.recovery).toBe("send-unrecorded");
    expect(payload.data.sentLines).toEqual([{ id: source.items[0].id, sentQty: 2 }]);
    const retry = await retryStoredPrintJob("job:recovery");
    expect(retry).toEqual({ ok: false, error: "needs-confirmation" });
    expect(printMock).not.toHaveBeenCalled();
  });

  it("rejects a voided or refunded payment", async () => {
    const survivor = orderOn(1, "Rice");
    const source = orderOn(2, "Paneer");
    getDb()
      .prepare(
        "INSERT INTO payments (id, order_id, method, amount_paise, status, received_at) VALUES (?, ?, 'cash', 100, 'voided', ?)",
      )
      .run("pay:voided", source._id, Date.now());
    const before = snapshot();
    await expect(merge(survivor, source)).rejects.toThrow("order-not-mergeable");
    expect(snapshot()).toEqual(before);

    const splittable = orderOn(3, "Soup", 2);
    getDb()
      .prepare(
        "INSERT INTO payments (id, order_id, method, amount_paise, status, received_at) VALUES (?, ?, 'cash', 100, 'refunded', ?)",
      )
      .run("pay:refunded", splittable._id, Date.now());
    expect(() =>
      posService.previewSplitOrder({
        orderId: splittable._id,
        destinationTableId: 4,
        moves: [{ lineId: splittable.items[0].id, qty: 1 }],
      }),
    ).toThrow("order-not-splittable");
  });

  it("rejects a mismatched discount, a stale order, and a food job whose line is not moving", async () => {
    const survivor = orderOn(1, "Rice");
    const source = orderOn(2, "Paneer");
    posService.setOrderDiscount(source._id, { mode: "percent", percent: 10 });
    const before = snapshot();
    await expect(
      merge(posService.getOrderById(survivor._id)!, posService.getOrderById(source._id)!),
    ).rejects.toThrow("discount-mismatch");
    expect(snapshot()).toEqual(before);

    const plain = orderOn(3, "Soup");
    const other = orderOn(4, "Tea");
    await expect(
      posService.mergeOrders(
        {
          survivorOrderId: plain._id,
          sourceOrderId: other._id,
          reason: "Customer requested",
          survivorBaseUpdatedAt: plain.updatedAt - 1,
          sourceBaseUpdatedAt: other.updatedAt,
        },
        null,
      ),
    ).rejects.toThrow("order-conflict");

    const taxed = orderOn(5, "Bread");
    const plainTax = orderOn(6, "Dal");
    const taxedMeta = {
      ...(posService.getOrderById(taxed._id)?.meta || {}),
      gstSnapshot: { enabled: true, gstRateBps: 500, priceIncludesTax: false },
    };
    getDb()
      .prepare("UPDATE orders SET meta_json = ? WHERE id = ?")
      .run(JSON.stringify(taxedMeta), taxed._id);
    const taxBefore = snapshot();
    await expect(
      merge(posService.getOrderById(taxed._id)!, posService.getOrderById(plainTax._id)!),
    ).rejects.toThrow("gst-mismatch");
    expect(snapshot()).toEqual(taxBefore);

    posService.seedTables(8);
    const blocked = orderOn(7, "Naan");
    const moving = orderOn(8, "Roti");
    insertJob({
      id: "job:foreign",
      orderId: moving._id,
      status: "pending",
      lines: ["LEFT:1 x Gone"],
      sentLines: [{ id: "line:missing", sentQty: 1 }],
    });
    const prior = snapshot();
    await expect(merge(blocked, moving)).rejects.toThrow("print-job-blocks-merge");
    expect(snapshot()).toEqual(prior);
  });

  it("does not file a merged cancellation as Cancelled after KOT or a repeated cancellation", async () => {
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
    const survivor = orderOn(1, "Rice");
    const source = orderOn(2, "Paneer");
    posService.markKotSent(source._id, [{ id: source.items[0].id, sentQty: 1 }]);
    await posService.mergeOrders(
      {
        survivorOrderId: survivor._id,
        sourceOrderId: posService.getOrderById(source._id)!._id,
        reason: "Customer requested",
        survivorBaseUpdatedAt: posService.getOrderById(survivor._id)!.updatedAt,
        sourceBaseUpdatedAt: posService.getOrderById(source._id)!.updatedAt,
      },
      "cashier",
    );
    for (const tableId of [3, 4]) {
      const cancelled = orderOn(tableId, "Tea");
      posService.markKotSent(cancelled._id, [{ id: cancelled.items[0].id, sentQty: 1 }]);
      posService.cancelOrder(cancelled._id, "cashier", "Guest left");
    }
    const items = posService.listReviewItems();
    expect(items.some((item) => item.rule === "cancellation_after_kot" && item.orderId === source._id)).toBe(false);
    expect(items.filter((item) => item.rule === "cancellation_after_kot")).toHaveLength(2);
    expect(items.some((item) => item.rule === "repeated_cancellations")).toBe(false);
  });

  it("serializes two merges and a kitchen send with a deferred gate", async () => {
    const survivor = orderOn(1, "Rice");
    const firstSource = orderOn(2, "Paneer");
    const secondSource = orderOn(3, "Soup");
    const hold = gate();
    setOrderRestructureTestHooks({ waitBeforeTransaction: hold.wait });
    const first = merge(survivor, firstSource);
    await hold.opened;
    const second = merge(survivor, secondSource);
    let printedAfterMerge = false;
    printMock.mockImplementation(async () => {
      const current = posService.getOrderById(survivor._id);
      printedAfterMerge = (current?.items.length || 0) >= 2;
      return { type: "kot", printerName: "Kitchen", transport: "windows-raw" };
    });
    const sending = printKitchenTicket({
      intent: "send",
      orderId: survivor._id,
      lines: ["LEFT:1 x Rice"],
      sentLines: [{ id: survivor.items[0].id, sentQty: survivor.items[0].qty }],
      actor: null,
    });
    hold.release();
    const merged = await first;
    await expect(second).rejects.toThrow("order-conflict");
    await sending;
    expect(merged.committed).toBe(true);
    expect(printedAfterMerge).toBe(true);
    expect(posService.getOrderById(secondSource._id)?.status).toBe("open");
    expect(posService.getOrderById(survivor._id)?.items).toHaveLength(2);
  });

  it("splits sent and unsent quantities and keeps the source table occupied", async () => {
    const source = orderOn(1, "Paneer", 4, 100);
    const lineId = source.items[0].id;
    getDb().prepare("UPDATE order_lines SET kot_printed_qty = 1 WHERE id = ?").run(lineId);
    const fresh = posService.getOrderById(source._id)!;
    const preview = posService.previewSplitOrder({
      orderId: fresh._id,
      destinationTableId: 2,
      moves: [{ lineId, qty: 2 }],
    });
    const result = await posService.splitOrder(
      {
        orderId: fresh._id,
        destinationTableId: 2,
        reason: "Customer requested",
        baseUpdatedAt: fresh.updatedAt,
        moves: [{ lineId, qty: 2 }],
        total: 1,
      } as never,
      null,
    );
    expect(result.committed).toBe(true);
    expect(result.order._id).toBe(source._id);
    expect(result.order.items[0]).toEqual(expect.objectContaining({ id: lineId, qty: 2, kotPrintedQty: 1 }));
    expect(result.destination.items[0]).toEqual(
      expect.objectContaining({ qty: 2, kotPrintedQty: 0, rate: 100, name: "Paneer" }),
    );
    expect(result.destination.items[0].id).not.toBe(lineId);
    expect(result.order.total).toBe(preview.source.total);
    expect(result.destination.total).toBe(preview.destination.total);
    expect(result.notice).toBe("not-required");
    const table = posService.getTablesSnapshot().tables.find((entry) => entry.id === 1);
    expect(table?.occupied).toBe(true);
    const combinedQty =
      result.order.items[0].qty + result.destination.items[0].qty;
    const combinedSent =
      Number(result.order.items[0].kotPrintedQty) + Number(result.destination.items[0].kotPrintedQty);
    expect(combinedQty).toBe(4);
    expect(combinedSent).toBe(1);
  });

  it("splits a fully sent line without treating it as new food", async () => {
    const source = orderOn(1, "Paneer", 4, 50);
    posService.markKotSent(source._id, [{ id: source.items[0].id, sentQty: 4 }]);
    const fresh = posService.getOrderById(source._id)!;
    const result = await posService.splitOrder(
      {
        orderId: fresh._id,
        destinationTableId: 2,
        reason: "Guest moved",
        baseUpdatedAt: fresh.updatedAt,
        moves: [{ lineId: fresh.items[0].id, qty: 2 }],
      },
      null,
    );
    expect(result.order.items[0].kotPrintedQty).toBe(2);
    expect(result.destination.items[0].kotPrintedQty).toBe(2);
    expect(result.destination.items[0].qty).toBe(2);
    expect(result.notice).toBe("printed");
    const payload = (
      getDb().prepare("SELECT payload_json FROM print_jobs WHERE id LIKE 'print-job:split:%'").get() as {
        payload_json: string;
      }
    ).payload_json;
    expect(payload).toContain("table-split");
    expect(payload).not.toContain("Paneer");
    const retry = await retryStoredPrintJob(
      (getDb().prepare("SELECT id FROM print_jobs WHERE id LIKE 'print-job:split:%'").get() as { id: string }).id,
    );
    expect(retry.ok).toBe(true);
    expect(result.destination.items[0].kotPrintedQty).toBe(
      posService.getOrderById(result.destination._id)!.items[0].kotPrintedQty,
    );
  });

  it("rejects a pending food job, an amount discount, a taken table, and a stale split", async () => {
    const source = orderOn(1, "Paneer", 4, 40);
    insertJob({
      id: "job:open",
      orderId: source._id,
      status: "pending",
      lines: ["LEFT:4 x Paneer"],
      sentLines: [{ id: source.items[0].id, sentQty: 4 }],
    });
    await expect(
      posService.splitOrder(
        {
          orderId: source._id,
          destinationTableId: 2,
          reason: "Customer requested",
          baseUpdatedAt: source.updatedAt,
          moves: [{ lineId: source.items[0].id, qty: 1 }],
        },
        null,
      ),
    ).rejects.toThrow("split-print-pending");
    expect(posService.getOrderById(source._id)?.items[0].qty).toBe(4);

    const discounted = orderOn(2, "Soup", 4, 80);
    posService.setOrderDiscount(discounted._id, { mode: "amount", amount: 10 });
    expect(() =>
      posService.previewSplitOrder({
        orderId: discounted._id,
        destinationTableId: 3,
        moves: [{ lineId: posService.getOrderById(discounted._id)!.items[0].id, qty: 1 }],
      }),
    ).toThrow("discount-amount");

    const left = orderOn(4, "Tea", 2, 20);
    orderOn(5, "Bread");
    await expect(
      posService.splitOrder(
        {
          orderId: left._id,
          destinationTableId: 5,
          reason: "Customer requested",
          baseUpdatedAt: left.updatedAt,
          moves: [{ lineId: left.items[0].id, qty: 1 }],
        },
        null,
      ),
    ).rejects.toThrow("table-occupied");
    expect(posService.getOrderById(left._id)?.items[0].qty).toBe(2);

    await expect(
      posService.splitOrder(
        {
          orderId: left._id,
          destinationTableId: 3,
          reason: "Customer requested",
          baseUpdatedAt: left.updatedAt - 5,
          moves: [{ lineId: left.items[0].id, qty: 1 }],
        },
        null,
      ),
    ).rejects.toThrow("order-conflict");
  });

  it("rejects a destination shell that still has a print job", async () => {
    const source = orderOn(1, "Paneer", 2, 40);
    const shell = posService.createOrder({ tableId: 2, orderType: "table" });
    insertJob({
      id: "job:shell",
      orderId: shell._id,
      status: "pending",
      lines: ["LEFT:old"],
      sentLines: [{ id: "line:missing", sentQty: 1 }],
    });
    await expect(
      posService.splitOrder(
        {
          orderId: source._id,
          destinationTableId: 2,
          reason: "Customer requested",
          baseUpdatedAt: source.updatedAt,
          moves: [{ lineId: source.items[0].id, qty: 1 }],
        },
        null,
      ),
    ).rejects.toThrow("table-print-pending");
    expect(posService.getOrderById(source._id)?.items[0].qty).toBe(2);
    expect(posService.getOrderById(shell._id)?.status).toBe("open");
  });

  it("rolls back a split when the new order insert is abandoned", async () => {
    const source = orderOn(1, "Paneer", 3, 40);
    const before = snapshot();
    setOrderRestructureTestHooks({ fault: "after-split-insert" });
    await expect(
      posService.splitOrder(
        {
          orderId: source._id,
          destinationTableId: 2,
          reason: "Customer requested",
          baseUpdatedAt: source.updatedAt,
          moves: [{ lineId: source.items[0].id, qty: 1 }],
        },
        null,
      ),
    ).rejects.toThrow("split-fault");
    expect(snapshot()).toEqual(before);
  });

  it("lets only one of two deferred splits take a free table", async () => {
    const left = orderOn(1, "Paneer", 2, 40);
    const right = orderOn(2, "Soup", 2, 40);
    const hold = gate();
    setOrderRestructureTestHooks({ waitBeforeTransaction: hold.wait });
    const first = posService.splitOrder(
      {
        orderId: left._id,
        destinationTableId: 3,
        reason: "Customer requested",
        baseUpdatedAt: left.updatedAt,
        moves: [{ lineId: left.items[0].id, qty: 1 }],
      },
      null,
    );
    await hold.opened;
    const second = posService.splitOrder(
      {
        orderId: right._id,
        destinationTableId: 3,
        reason: "Customer requested",
        baseUpdatedAt: right.updatedAt,
        moves: [{ lineId: right.items[0].id, qty: 1 }],
      },
      null,
    );
    hold.release();
    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain("table-occupied");
    const onTable = getDb()
      .prepare("SELECT id FROM orders WHERE table_id = 3 AND status = 'open'")
      .all() as Array<{ id: string }>;
    expect(onTable).toHaveLength(1);
  });

  it("copies a percent discount and shows the changed rupee amount in the preview", async () => {
    const source = orderOn(1, "Paneer", 4, 100);
    posService.setOrderDiscount(source._id, { mode: "percent", percent: 10 });
    const fresh = posService.getOrderById(source._id)!;
    const preview = posService.previewSplitOrder({
      orderId: fresh._id,
      destinationTableId: 2,
      moves: [{ lineId: fresh.items[0].id, qty: 1 }],
    });
    expect(preview.discountNote).toContain("rupee discount");
    const result = await posService.splitOrder(
      {
        orderId: fresh._id,
        destinationTableId: 2,
        reason: "Customer requested",
        baseUpdatedAt: fresh.updatedAt,
        moves: [{ lineId: fresh.items[0].id, qty: 1 }],
      },
      null,
    );
    expect(result.order.discountTotal).toBe(preview.source.discount);
    expect(result.destination.discountTotal).toBe(preview.destination.discount);
    expect(result.order.total).toBe(preview.source.total);
    expect(result.destination.total).toBe(preview.destination.total);
    expect(result.order.discountPercent).toBe(10);
    expect(result.destination.discountPercent).toBe(10);
  });
});
