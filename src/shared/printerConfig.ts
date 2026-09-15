export const DEFAULT_USB_PRINTER_NAME = "POS-80C";
export const PRINTER_SELECT_NETWORK = "__network_ip__";
export const PRINTER_SELECT_SAME_AS_KITCHEN = "__same_as_kitchen__";
export const PRINTER_SELECT_SAME_AS_COUNTER = "__same_as_counter__";

const VIRTUAL_PRINTER_PATTERN =
  /print to pdf|microsoft print to pdf|onenote|xps document writer|fax driver|microsoft shared fax|adobe pdf|foxit|cutepdf|nitro pdf|send to onenote/i;
const VIRTUAL_PORT_PATTERN = /^(file:|portprompt:|nul:|shrFAX:|fax:)/i;

export type InstalledPrinterInfo = {
  name: string;
  driverName?: string;
  portName?: string;
};

export type PrinterConfigInput = {
  kitchenPrinterIp?: string;
  counterPrinterIp?: string;
  printerPort?: number;
};

export function normalizePrinterTarget(value: unknown): string {
  return String(value || "").trim();
}

/** Windows virtual printers (PDF, OneNote, Fax) cannot receive RAW ESC/POS. */
export function isSelectablePosPrinter(printer: InstalledPrinterInfo | string): boolean {
  const info = typeof printer === "string" ? { name: printer } : printer;
  const name = normalizePrinterTarget(info.name);
  if (!name) {
    return false;
  }
  if (/\bfax\b/i.test(name)) {
    return false;
  }
  const blob = `${name}\n${info.driverName || ""}\n${info.portName || ""}`;
  if (VIRTUAL_PRINTER_PATTERN.test(blob)) {
    return false;
  }
  const port = normalizePrinterTarget(info.portName);
  if (port && VIRTUAL_PORT_PATTERN.test(port)) {
    return false;
  }
  return true;
}

/** True when the saved target is a raw TCP/IP printer (port 9100 path). */
export function isIpv4PrinterTarget(value: unknown): boolean {
  const parts = normalizePrinterTarget(value).split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) {
        return false;
      }
      const octet = Number(part);
      return octet >= 0 && octet <= 255;
    })
  );
}

export function printerDropdownValue(
  savedTarget: unknown,
  options: { networkMode?: boolean; blankValue?: string } = {},
): string {
  if (options.networkMode) {
    return PRINTER_SELECT_NETWORK;
  }
  const target = normalizePrinterTarget(savedTarget);
  if (!target) {
    return options.blankValue || "";
  }
  if (isIpv4PrinterTarget(target)) {
    return PRINTER_SELECT_NETWORK;
  }
  return target;
}

export function extraPrinterOption(savedTarget: unknown, printers: string[]): string | null {
  const target = normalizePrinterTarget(savedTarget);
  if (!target || isIpv4PrinterTarget(target)) {
    return null;
  }
  return printers.includes(target) ? null : target;
}

/** Resolved kitchen/KOT printer. Falls back to the counter printer for single-printer setups. */
export function resolveKitchenPrinterTarget(
  cfg: PrinterConfigInput | null | undefined,
  fallback = DEFAULT_USB_PRINTER_NAME,
): string {
  return (
    normalizePrinterTarget(cfg?.kitchenPrinterIp) ||
    normalizePrinterTarget(cfg?.counterPrinterIp) ||
    fallback
  );
}

/**
 * Resolved counter/receipt printer target.
 * Falls back to the kitchen printer so single-printer setups work without duplicating config.
 */
export function resolveCounterPrinterTarget(
  cfg: PrinterConfigInput | null | undefined,
  fallback = DEFAULT_USB_PRINTER_NAME,
): string {
  return (
    normalizePrinterTarget(cfg?.counterPrinterIp) ||
    normalizePrinterTarget(cfg?.kitchenPrinterIp) ||
    fallback
  );
}

export function samePrinterTarget(a: string, b: string): boolean {
  const left = normalizePrinterTarget(a).toLowerCase();
  const right = normalizePrinterTarget(b).toLowerCase();
  return Boolean(left) && left === right;
}
