import { buildEscPosBuffer, type PrintJobType } from "./escpos";
import { isIpv4Address, printViaNetworkRaw } from "./networkRaw";
import { printViaWindowsRaw } from "./windowsRaw";

export type PrinterConfig = {
  kitchenPrinterName: string;
  counterPrinterName: string;
  printerPort: number;
};

export type PrintResult = {
  type: PrintJobType;
  printerName: string;
  transport: "network" | "windows-raw";
};

export function normalizePrintType(type: unknown): PrintJobType {
  return type === "kot" ? "kot" : "receipt";
}

export function resolvePrinterTarget(
  requested: string | undefined,
  type: PrintJobType,
  cfg: PrinterConfig,
) {
  const key = String(requested || "")
    .trim()
    .toLowerCase();
  if (key === "kitchen") {
    return cfg.kitchenPrinterName;
  }
  if (key === "counter") {
    return cfg.counterPrinterName;
  }
  return type === "kot" ? cfg.kitchenPrinterName : cfg.counterPrinterName;
}

/** One FIFO chain per printer so concurrent KOT/receipt jobs never interleave bytes. */
const printQueues = new Map<string, Promise<unknown>>();

export function enqueuePrinterJob<T>(printerKey: string, task: () => Promise<T>): Promise<T> {
  const key = String(printerKey || "default").trim().toLowerCase() || "default";
  const previous = printQueues.get(key) || Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  printQueues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** Test helper — clears in-memory printer queues between unit tests. */
export function resetPrinterQueuesForTests() {
  printQueues.clear();
}

export async function printPayload(
  payload: any,
  cfg: PrinterConfig,
  options: { hotelName?: string } = {},
): Promise<PrintResult> {
  const data = payload?.data || {};
  const type = normalizePrintType(payload?.type);
  const printerName = resolvePrinterTarget(payload?.printer, type, cfg);
  if (!Array.isArray(data?.lines) || data.lines.length === 0) {
    throw new Error("print-lines-required");
  }
  const text = typeof data?.text === "string" ? data.text : "";
  const lines: string[] = data.lines.map((line: unknown) => String(line));
  const sendBuffer = async (buffer: Buffer): Promise<PrintResult> => {
    if (isIpv4Address(printerName)) {
      await printViaNetworkRaw(printerName, cfg.printerPort || 9100, buffer);
      return { type, printerName, transport: "network" };
    }

    await printViaWindowsRaw(printerName, buffer);
    return { type, printerName, transport: "windows-raw" };
  };

  const sendLines = (jobLines: string[]) => {
    const buffer = buildEscPosBuffer(type, text, jobLines, options.hotelName || "");
    return sendBuffer(buffer);
  };

  return enqueuePrinterJob(printerName, async () => {
    if (type !== "receipt") {
      return sendLines(lines);
    }

    const hasLogo = lines.some((line) => line.startsWith("IMAGE_MONO:"));
    const hasQr = lines.some((line) => line.startsWith("QR_MONO:"));
    try {
      return await sendLines(lines);
    } catch (error) {
      if (!hasLogo && !hasQr) {
        throw error;
      }
      const withoutLogo = hasLogo
        ? lines.filter((line) => !line.startsWith("IMAGE_MONO:"))
        : lines;
      if (hasLogo) {
        try {
          return await sendLines(withoutLogo);
        } catch (noLogoError) {
          if (!hasQr) {
            throw noLogoError;
          }
          return sendLines(withoutLogo.filter((line) => !line.startsWith("QR_MONO:")));
        }
      }
      return sendLines(lines.filter((line) => !line.startsWith("QR_MONO:")));
    }
  });
}
