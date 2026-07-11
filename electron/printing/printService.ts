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
  const key = String(requested || "").trim().toLowerCase();
  if (key === "kitchen") {
    return cfg.kitchenPrinterName;
  }
  if (key === "counter") {
    return cfg.counterPrinterName;
  }
  if (requested && key !== "default") {
    return requested;
  }
  return type === "kot" ? cfg.kitchenPrinterName : cfg.counterPrinterName;
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
  const escPosBuffer = buildEscPosBuffer(type, text, lines, options.hotelName || "");
  const sendBuffer = async (buffer: Buffer): Promise<PrintResult> => {
    if (isIpv4Address(printerName)) {
      await printViaNetworkRaw(printerName, cfg.printerPort || 9100, buffer);
      return { type, printerName, transport: "network" };
    }

    await printViaWindowsRaw(printerName, buffer);
    return { type, printerName, transport: "windows-raw" };
  };

  try {
    return await sendBuffer(escPosBuffer);
  } catch (error) {
    const hasReceiptLogo = type === "receipt" && lines.some((line) => line.startsWith("IMAGE_MONO:"));
    if (!hasReceiptLogo) {
      throw error;
    }
    const textOnlyLines = lines.filter((line) => !line.startsWith("IMAGE_MONO:"));
    const fallbackBuffer = buildEscPosBuffer(type, text, textOnlyLines, options.hotelName || "");
    return sendBuffer(fallbackBuffer);
  }
}
