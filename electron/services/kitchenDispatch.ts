import { kotSentLinesNeedPrint } from "../../src/shared/kot";
import { rewriteKotTableHeader } from "../../src/shared/kotTicket";
import { formatTableTileLabel } from "../../src/shared/floorLayout";
import {
  DEFAULT_USB_PRINTER_NAME,
  resolveCounterPrinterTarget,
  resolveKitchenPrinterTarget,
} from "../../src/shared/printerConfig";
import { printPayload, type PrinterConfig } from "../printing/printService";
import { withOrderPrintTurn } from "../printing/orderPrintTurn";
import { posService } from "./posService";

const KITCHEN_INTENTS = new Set(["send", "reprint", "transfer-notice"]);

type KitchenIntent = "send" | "reprint" | "transfer-notice";

export type KitchenPrintInput = {
  intent?: string;
  orderId?: string;
  lines?: string[];
  sentLines?: Array<{ id: string; sentQty: number }>;
  clearPendingKotVoidIds?: string[];
  builtTableId?: number | null;
  checkBuiltTable?: boolean;
  actor?: string | null;
  printer?: string;
  jobId?: string;
  existingJobId?: string;
};

function printerConfig(): PrinterConfig {
  try {
    const cfg = (posService.getSetting("config:printers") as Record<string, unknown>) || {};
    const kitchenFallback =
      process.env.KITCHEN_PRINTER_USB_NAME ||
      process.env.COUNTER_PRINTER_USB_NAME ||
      DEFAULT_USB_PRINTER_NAME;
    const counterFallback =
      process.env.COUNTER_PRINTER_USB_NAME ||
      process.env.KITCHEN_PRINTER_USB_NAME ||
      DEFAULT_USB_PRINTER_NAME;
    return {
      kitchenPrinterName: resolveKitchenPrinterTarget(cfg, kitchenFallback),
      counterPrinterName: resolveCounterPrinterTarget(cfg, counterFallback),
      printerPort: Number(cfg.printerPort || process.env.PRINTER_PORT || 9100),
    };
  } catch {
    return {
      kitchenPrinterName: process.env.KITCHEN_PRINTER_USB_NAME || DEFAULT_USB_PRINTER_NAME,
      counterPrinterName:
        process.env.COUNTER_PRINTER_USB_NAME ||
        process.env.KITCHEN_PRINTER_USB_NAME ||
        DEFAULT_USB_PRINTER_NAME,
      printerPort: Number(process.env.PRINTER_PORT || 9100),
    };
  }
}

function hotelName() {
  try {
    const cfg = (posService.getConfigDoc("config:branding") || {}) as { hotelName?: string };
    return String(cfg.hotelName || process.env.HOTEL_NAME || "Restaurant").trim();
  } catch {
    return "Restaurant";
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "print-failed");
}

function fail(message: string, kotRecorded?: string): never {
  const error = new Error(message) as Error & { kotRecorded?: string };
  if (kotRecorded) {
    error.kotRecorded = kotRecorded;
  }
  throw error;
}

function payloadOrderId(content: any) {
  const value = content?.orderId || content?.data?.orderId;
  return typeof value === "string" ? value.trim() : "";
}

function payloadLines(content: any): string[] | null {
  if (Array.isArray(content?.data?.lines)) {
    return content.data.lines.map((line: unknown) => String(line));
  }
  if (Array.isArray(content?.lines)) {
    return content.lines.map((line: unknown) => String(line));
  }
  return null;
}

function payloadSentLines(content: any) {
  if (Array.isArray(content?.data?.sentLines)) {
    return content.data.sentLines;
  }
  if (Array.isArray(content?.sentLines)) {
    return content.sentLines;
  }
  return null;
}

function payloadVoidIds(content: any) {
  if (Array.isArray(content?.data?.clearPendingKotVoidIds)) {
    return content.data.clearPendingKotVoidIds;
  }
  if (Array.isArray(content?.clearPendingKotVoidIds)) {
    return content.clearPendingKotVoidIds;
  }
  return undefined;
}

async function persistSendUnrecorded(input: KitchenPrintInput, orderId: string, markError: unknown) {
  const order = posService.getOrderById(orderId);
  const content = {
    type: "kot",
    printer: input.printer || "kitchen",
    orderId,
    recovery: "send-unrecorded",
    data: {
      lines: input.lines || [],
      orderId,
      sentLines: input.sentLines || [],
      clearPendingKotVoidIds: input.clearPendingKotVoidIds || [],
    },
  };
  try {
    if (input.existingJobId) {
      const current = posService.getPrintJob(input.existingJobId);
      posService.replacePrintJobPayload(input.existingJobId, {
        ...(current?.content && typeof current.content === "object" ? current.content : {}),
        ...content,
      });
      return;
    }
    posService.addPrintJob({
      printerName: input.printer || "kitchen",
      jobType: "kot",
      content,
    });
  } catch (saveError) {
    console.error(
      "[PRINT] Kitchen ticket was printed but the send was not recorded, and the recovery row was not saved.",
      {
        orderId,
        tableId: order?.tableId ?? null,
        markKotSentError: errorMessage(markError),
        saveError: errorMessage(saveError),
      },
    );
    fail("send-unrecorded-not-saved");
  }
}

async function executeKitchenPrint(input: KitchenPrintInput, intent: KitchenIntent, orderId: string) {
  const order = posService.getOrderById(orderId);
  if (!order) {
    fail("order-not-found");
  }
  const lines = (input.lines || []).map((line) => String(line));
  if (!lines.length) {
    fail("print-job-invalid");
  }
  if (intent === "send" && input.checkBuiltTable) {
    const built =
      input.builtTableId == null || !Number.isFinite(Number(input.builtTableId))
        ? null
        : Number(input.builtTableId);
    const current = order!.tableId == null ? null : Number(order!.tableId);
    const normalizedBuilt = built != null && built > 0 ? built : null;
    if (normalizedBuilt !== current) {
      fail("table-changed");
    }
  }
  try {
    await printPayload(
      {
        type: "kot",
        printer: input.printer || "kitchen",
        data: { lines, orderId },
      },
      printerConfig(),
      { hotelName: hotelName() },
    );
  } catch (error) {
    if (intent === "send") {
      try {
        posService.markKotFailed(orderId, errorMessage(error), input.actor || null);
      } catch (markError) {
        console.error("[PRINT] Kitchen print failed and the failed status was not saved", {
          orderId,
          markError: errorMessage(markError),
        });
      }
      fail(errorMessage(error), "failed");
    }
    throw error;
  }
  if (intent === "transfer-notice") {
    if (input.jobId) {
      posService.markPrintJobCompleted(input.jobId);
    }
    return { intent, order };
  }
  if (intent !== "send") {
    return { intent, order };
  }
  try {
    const updated = posService.markKotSent(orderId, input.sentLines || [], input.actor || null, {
      clearPendingKotVoidIds: input.clearPendingKotVoidIds,
    });
    return { intent, order: updated };
  } catch (error) {
    await persistSendUnrecorded(input, orderId, error);
    fail("kot-sent-not-recorded", "unrecorded");
  }
}

export async function printKitchenTicket(input: KitchenPrintInput, options?: { inTurn?: boolean }) {
  const intent = String(input.intent || "");
  if (!KITCHEN_INTENTS.has(intent)) {
    fail("print-intent-required");
  }
  const orderId = typeof input.orderId === "string" ? input.orderId.trim() : "";
  if (!orderId) {
    fail("order-not-found");
  }
  if (!posService.getOrderById(orderId)) {
    fail("order-not-found");
  }
  const run = () => executeKitchenPrint(input, intent as KitchenIntent, orderId);
  if (options?.inTurn) {
    return run();
  }
  return withOrderPrintTurn(orderId, run);
}

export async function printFromDesktop(payload: any, actor?: string | null) {
  const intent = payload?.intent || payload?.data?.intent;
  if (payload?.type !== "kot" || intent === "printer-test") {
    const result = await printPayload(payload, printerConfig(), { hotelName: hotelName() });
    return { ok: true as const, ...result };
  }
  try {
    const data = payload?.data || {};
    const result = await printKitchenTicket({
      intent,
      orderId: data.orderId,
      lines: data.lines,
      sentLines: data.sentLines,
      clearPendingKotVoidIds: data.clearPendingKotVoidIds,
      builtTableId: data.builtTableId,
      checkBuiltTable: Object.prototype.hasOwnProperty.call(data, "builtTableId"),
      actor,
      printer: payload?.printer,
      jobId: data.jobId,
    });
    return { ok: true as const, ...result };
  } catch (error: any) {
    return {
      ok: false as const,
      error: errorMessage(error),
      kotRecorded: error?.kotRecorded,
    };
  }
}

function tableLabelFor(order: { tableId?: number | null }) {
  const tableId = order.tableId == null ? null : Number(order.tableId);
  if (tableId == null || !Number.isFinite(tableId)) {
    return "";
  }
  const table = posService.getTables().find((entry) => Number(entry.id) === tableId);
  return formatTableTileLabel(tableId, table?.name);
}

function withRewrittenLines(content: any, lines: string[]) {
  const next = { ...(content || {}) };
  if (Array.isArray(next?.data?.lines)) {
    next.data = { ...next.data, lines };
  } else {
    next.lines = lines;
  }
  return next;
}

export async function retryStoredPrintJob(jobId: string, options?: { confirm?: boolean }) {
  const job = posService.getPrintJob(jobId);
  if (!job) {
    return { ok: false as const, error: "print-job-not-found" };
  }
  const content = job.content as any;
  const orderId = payloadOrderId(content);
  if (job.jobType === "receipt" && !orderId) {
    try {
      await printPayload(
        {
          type: "receipt",
          printer: content?.printer || job.printerName,
          data: content?.data || content,
        },
        printerConfig(),
        { hotelName: hotelName() },
      );
      posService.markPrintJobCompleted(jobId);
      return { ok: true as const };
    } catch (error) {
      posService.retryPrintJob(jobId);
      return { ok: false as const, error: errorMessage(error) };
    }
  }
  if (!orderId) {
    return { ok: false as const, error: "print-job-invalid" };
  }
  if (!posService.getOrderById(orderId)) {
    return { ok: false as const, error: "order-not-found" };
  }
  return withOrderPrintTurn(orderId, async () => {
    const fresh = posService.getPrintJob(jobId);
    if (!fresh) {
      return { ok: false as const, error: "print-job-not-found" };
    }
    if (fresh.status === "completed") {
      return { ok: true as const, skipped: true };
    }
    const body = fresh.content as any;
    if (body?.recovery === "send-unrecorded" && !options?.confirm) {
      return { ok: false as const, error: "needs-confirmation" };
    }
    const order = posService.getOrderById(orderId);
    if (!order) {
      return { ok: false as const, error: "order-not-found" };
    }
    const lines = payloadLines(body);
    if (!lines) {
      return { ok: false as const, error: "print-job-invalid" };
    }
    const notice =
      body?.kind === "table-transfer" || body?.kind === "table-merge" || body?.kind === "table-split";
    const recovery = body?.recovery === "send-unrecorded";
    const sentLines = payloadSentLines(body);
    let nextLines = lines;
    if (!notice && Array.isArray(sentLines)) {
      nextLines = rewriteKotTableHeader(lines, tableLabelFor(order));
      posService.replacePrintJobPayload(jobId, withRewrittenLines(body, nextLines));
      if (!recovery && !kotSentLinesNeedPrint(order, sentLines, payloadVoidIds(body))) {
        posService.markPrintJobCompleted(jobId);
        return { ok: true as const, skipped: true };
      }
    }
    const intent: KitchenIntent = notice
      ? "transfer-notice"
      : recovery || (Array.isArray(sentLines) && kotSentLinesNeedPrint(order, sentLines, payloadVoidIds(body)))
        ? "send"
        : "reprint";
    try {
      await printKitchenTicket(
        {
          intent,
          orderId,
          lines: nextLines,
          sentLines: intent === "send" ? sentLines || [] : undefined,
          clearPendingKotVoidIds: intent === "send" ? payloadVoidIds(body) : undefined,
          actor: null,
          printer: body?.printer || fresh.printerName,
          jobId: notice ? jobId : undefined,
          existingJobId: jobId,
          checkBuiltTable: false,
        },
        { inTurn: true },
      );
    } catch (error: any) {
      const message = errorMessage(error);
      if (message === "kot-sent-not-recorded" || message === "send-unrecorded-not-saved") {
        return { ok: false as const, error: message, kotRecorded: error?.kotRecorded };
      }
      posService.retryPrintJob(jobId);
      return { ok: false as const, error: message, kotRecorded: error?.kotRecorded };
    }
    const latest = posService.getPrintJob(jobId);
    if (latest && latest.status !== "completed") {
      posService.markPrintJobCompleted(jobId);
    }
    return { ok: true as const };
  });
}
