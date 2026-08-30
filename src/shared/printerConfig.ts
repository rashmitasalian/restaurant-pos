export const DEFAULT_USB_PRINTER_NAME = "POS-80C";

export type PrinterConfigInput = {
  kitchenPrinterIp?: string;
  counterPrinterIp?: string;
  printerPort?: number;
};

export function normalizePrinterTarget(value: unknown): string {
  return String(value || "").trim();
}

/** Resolved kitchen printer target (IP, hostname, or Windows queue name). */
export function resolveKitchenPrinterTarget(
  cfg: PrinterConfigInput | null | undefined,
  fallback = DEFAULT_USB_PRINTER_NAME,
): string {
  return normalizePrinterTarget(cfg?.kitchenPrinterIp) || fallback;
}

/**
 * Resolved counter/receipt printer target.
 * Falls back to the kitchen printer so single-printer setups work without duplicating config.
 */
export function resolveCounterPrinterTarget(
  cfg: PrinterConfigInput | null | undefined,
  fallback = DEFAULT_USB_PRINTER_NAME,
): string {
  const counter = normalizePrinterTarget(cfg?.counterPrinterIp);
  if (counter) {
    return counter;
  }
  const kitchen = normalizePrinterTarget(cfg?.kitchenPrinterIp);
  return kitchen || fallback;
}

export function samePrinterTarget(a: string, b: string): boolean {
  const left = normalizePrinterTarget(a).toLowerCase();
  const right = normalizePrinterTarget(b).toLowerCase();
  return Boolean(left) && left === right;
}
