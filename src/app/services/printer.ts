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

export async function printKOT(data: {
  text?: string;
  lines?: string[];
  printer?: string;
  orderId?: string;
  sentLines?: Array<{ id: string; sentQty: number }>;
}) {
  try {
    const payload: any = { type: "kot", data };
    if (data?.printer) {
      payload.printer = data.printer;
    }

    logger.info("Printing KOT", { printer: data?.printer });

    // @ts-ignore
    const result = await window.pos.print(payload);
    if (result && result.ok === false) {
      throw new Error(result.error || "Print failed");
    }
    logger.info("KOT printed successfully", { printer: data?.printer });
    return result;
  } catch (error) {
    logger.error("KOT printing failed", error as Error, { printer: data?.printer });

    // Queue the job for retry when printer comes back online
    const printerName = data?.printer || "default";
    await PrinterOfflineQueue.addPrintJob(printerName, "kot", data);

    const printerError = new PrinterError("Failed to print KOT", true, { ...data });
    handleError(printerError);
    throw printerError;
  }
}
