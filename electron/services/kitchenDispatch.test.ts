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
import { closeDb, initializeDatabase } from "../db/sqlite";
import { printPayload } from "../printing/printService";
import { resetOrderPrintTurnsForTests } from "../printing/orderPrintTurn";
import { printKitchenTicket, retryStoredPrintJob } from "./kitchenDispatch";
import { posService } from "./posService";

const printMock = printPayload as jest.Mock;

describe("kitchen dispatch", () => {
  let tempDir = "";

  beforeEach(async () => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-kitchen-dispatch-"));
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = path.join(tempDir, "restaurant-pos.sqlite");
    await initializeDatabase();
    posService.seedTables(4);
    printMock.mockReset();
    printMock.mockResolvedValue({ type: "kot", printerName: "Kitchen", transport: "windows-raw" });
    resetOrderPrintTurnsForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetOrderPrintTurnsForTests();
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function orderOn(tableId: number) {
    const created = posService.createOrder({ tableId, orderType: "table" });
    return posService.addItemToOrder(created._id, { name: "Tea", qty: 1, rate: 30 });
  }

  it("requires an explicit kitchen intent and does not print without one", async () => {
    const order = orderOn(1);
    await expect(
      printKitchenTicket({ orderId: order._id, lines: ["LEFT:  1 x Tea"] }),
    ).rejects.toThrow("print-intent-required");
    expect(printMock).not.toHaveBeenCalled();
  });

  it("rejects a stale table before printing and does not mark a reprint as sent", async () => {
    const order = orderOn(1);
    await expect(
      printKitchenTicket({
        intent: "send",
        orderId: order._id,
        lines: ["LEFT:  Table No: 2", "LEFT:  1 x Tea"],
        sentLines: [{ id: order.items[0].id, sentQty: 1 }],
        builtTableId: 2,
        checkBuiltTable: true,
      }),
    ).rejects.toThrow("table-changed");
    expect(printMock).not.toHaveBeenCalled();
    expect(posService.getOrderById(order._id)?.items[0].kotPrintedQty).toBe(0);

    await printKitchenTicket({
      intent: "reprint",
      orderId: order._id,
      lines: ["BIGBOLD:KOT - REPRINT"],
    });
    expect(posService.getOrderById(order._id)?.items[0].kotPrintedQty).toBe(0);
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it("records send-unrecorded instead of a normal failure, and refuses a retry until confirmed", async () => {
    const order = orderOn(1);
    const sentLines = [{ id: order.items[0].id, sentQty: 1 }];
    const original = posService.markKotSent.bind(posService);
    const mark = jest.spyOn(posService, "markKotSent").mockImplementation((...args) => {
      throw new Error("disk-full");
    });
    await expect(
      printKitchenTicket({
        intent: "send",
        orderId: order._id,
        lines: ["LEFT:  Table No: 1", "LEFT:  1 x Tea"],
        sentLines,
        checkBuiltTable: true,
        builtTableId: 1,
      }),
    ).rejects.toThrow("kot-sent-not-recorded");
    mark.mockImplementation(original);
    const jobs = posService.listPrintJobs();
    const recovery = jobs.find(
      (job: { content: unknown; _id: string }) =>
        (job.content as { recovery?: string }).recovery === "send-unrecorded",
    );
    expect(recovery).toBeTruthy();
    expect(posService.getOrderById(order._id)?.kotStatus).not.toBe("failed");

    const calls = printMock.mock.calls.length;
    const blocked = await retryStoredPrintJob(recovery!._id);
    expect(blocked).toEqual({ ok: false, error: "needs-confirmation" });
    expect(printMock).toHaveBeenCalledTimes(calls);

    const confirmed = await retryStoredPrintJob(recovery!._id, { confirm: true });
    expect(confirmed.ok).toBe(true);
    expect(posService.getOrderById(order._id)?.items[0].kotPrintedQty).toBe(1);
    expect(posService.getPrintJob(recovery!._id)?.status).toBe("completed");
  });

  it("does not create a normal food job when the recovery row cannot be saved", async () => {
    const order = orderOn(1);
    jest.spyOn(posService, "markKotSent").mockImplementation(() => {
      throw new Error("disk-full");
    });
    jest.spyOn(posService, "addPrintJob").mockImplementation(() => {
      throw new Error("disk-full");
    });
    await expect(
      printKitchenTicket({
        intent: "send",
        orderId: order._id,
        lines: ["LEFT:  1 x Tea"],
        sentLines: [{ id: order.items[0].id, sentQty: 1 }],
        builtTableId: 1,
        checkBuiltTable: true,
      }),
    ).rejects.toThrow("send-unrecorded-not-saved");
    expect(posService.listPrintJobs()).toHaveLength(0);
    expect(posService.getOrderById(order._id)?.kotStatus).not.toBe("failed");
  });

  it("waits for an in-flight transfer before rejecting a stale kitchen send", async () => {
    const created = posService.createOrder({ tableId: 1, orderType: "table" });
    const order = posService.addItemToOrder(created._id, { name: "Tea", qty: 1, rate: 30 });
    const sent = posService.markKotSent(order._id, [{ id: order.items[0].id, sentQty: 1 }]);
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const startedGate = new Promise<void>((resolve) => {
      started = resolve;
    });
    printMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          started();
          void gate.then(() => resolve({ type: "kot", printerName: "Kitchen", transport: "windows-raw" }));
        }),
    );
    const transfer = posService.transferOrderTable(
      {
        orderId: sent._id,
        destinationTableId: 2,
        reason: "Customer requested",
        baseUpdatedAt: sent.updatedAt,
      },
      null,
    );
    await startedGate;
    let sendSettled = false;
    const send = printKitchenTicket({
      intent: "send",
      orderId: sent._id,
      lines: ["LEFT:  Table No: 1", "LEFT:  1 x Tea"],
      sentLines: [{ id: sent.items[0].id, sentQty: 1 }],
      builtTableId: 1,
      checkBuiltTable: true,
    }).then(
      (value) => {
        sendSettled = true;
        return value;
      },
      (error) => {
        sendSettled = true;
        throw error;
      },
    );
    await Promise.resolve();
    expect(sendSettled).toBe(false);
    expect(printMock).toHaveBeenCalledTimes(1);
    release(undefined);
    const moved = await transfer;
    await expect(send).rejects.toThrow("table-changed");
    expect(moved.order.tableId).toBe(2);
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it("still prints the next ticket after the previous one fails", async () => {
    const first = orderOn(1);
    const second = orderOn(1);
    printMock.mockRejectedValueOnce(new Error("printer-offline"));
    await expect(
      printKitchenTicket({
        intent: "send",
        orderId: first._id,
        lines: ["LEFT:  1 x Tea"],
        sentLines: [{ id: first.items[0].id, sentQty: 1 }],
        builtTableId: 1,
        checkBuiltTable: true,
      }),
    ).rejects.toThrow("printer-offline");
    await printKitchenTicket({
      intent: "reprint",
      orderId: first._id,
      lines: ["BIGBOLD:KOT - REPRINT"],
    });
    expect(printMock).toHaveBeenCalledTimes(2);
    expect(second._id).toBeTruthy();
  });
});
