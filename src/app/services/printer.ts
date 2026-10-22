// Printer service will call the IPC exposed in preload (window.pos.print)
import { logger } from "../utils/logger";
import { PrinterOfflineQueue } from "../utils/printerQueue";
import { handleError, PrinterError } from "../utils/errors";

export async function printReceipt(data: { text?: string; lines?: string[]; printer?: string }) {
  try {
    // Send to main process for printing; place printer at top-level so main can read it
    const payload: any = { type: "receipt", data };
    if (data?.printer) {
      payload.printer = data.printer;
    }

    logger.info("Printing receipt", { printer: data?.printer });

    // @ts-ignore
    const result = await window.pos.print(payload);
    if (result && result.ok === false) {
      throw new Error(result.error || "Print failed");
    }
    logger.info("Receipt printed successfully", { printer: data?.printer });
    return result;
  } catch (error) {
    logger.error("Receipt printing failed", error as Error, { printer: data?.printer });

    // Queue the job for retry when printer comes back online
    const printerName = data?.printer || "default";
    await PrinterOfflineQueue.addPrintJob(printerName, "receipt", data);

    const printerError = new PrinterError("Failed to print receipt", true, { ...data });
    handleError(printerError);
    throw printerError;
  }
}

const KITCHEN_ERRORS_WITHOUT_QUEUE = new Set([
  "table-changed",
  "print-intent-required",
  "kot-sent-not-recorded",
  "send-unrecorded-not-saved",
  "needs-confirmation",
  "order-not-found",
  "print-job-not-found",
  "print-job-invalid",
  "order-conflict",
]);

export function kitchenPrintErrorCode(error: unknown) {
  const value = error as { code?: string; message?: string };
  return String(value?.code || value?.message || "");
}

export function kitchenPrintRecorded(error: unknown) {
  return String((error as { kotRecorded?: string })?.kotRecorded || "");
}

function kitchenPrintError(code: string, kotRecorded?: string): Error {
  const error = new Error(code) as Error & { code?: string; kotRecorded?: string };
  error.code = code;
  if (kotRecorded) {
    error.kotRecorded = kotRecorded;
  }
  return error;
}

export async function printKOT(data: {
  text?: string;
  lines?: string[];
  printer?: string;
  orderId?: string;
  intent?: "send" | "reprint" | "transfer-notice";
  builtTableId?: number | null;
  sentLines?: Array<{ id: string; sentQty: number }>;
  clearPendingKotVoidIds?: string[];
}) {
  const payload: any = { type: "kot", intent: data.intent, data };
  if (data?.printer) {
    payload.printer = data.printer;
  }
  logger.info("Printing KOT", { printer: data?.printer, intent: data?.intent });
  try {
    // @ts-ignore
    const result = await window.pos.print(payload);
    if (result && result.ok === false) {
      const code = String(result.error || "Print failed");
      if (KITCHEN_ERRORS_WITHOUT_QUEUE.has(code) || result.kotRecorded === "unrecorded") {
        throw kitchenPrintError(code, result.kotRecorded);
      }
      const printerName = data?.printer || "default";
      await PrinterOfflineQueue.addPrintJob(printerName, "kot", data);
      const queued = kitchenPrintError(code, result.kotRecorded);
      logger.error("KOT printing failed", queued, { printer: data?.printer });
      throw queued;
    }
    logger.info("KOT printed successfully", { printer: data?.printer });
    return result;
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code) {
      throw error;
    }
    logger.error("KOT printing failed", error as Error, { printer: data?.printer });
    const printerName = data?.printer || "default";
    await PrinterOfflineQueue.addPrintJob(printerName, "kot", data);
    const printerError = new PrinterError("Failed to print KOT", true, { ...data });
    handleError(printerError);
    throw printerError;
  }
}
