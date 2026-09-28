import { create as createQrSymbol } from "qrcode/lib/core/qrcode";
import { RECEIPT_TEXT_WIDTH, wrapText } from "./receiptWrap";

export const RECEIPT_QR_SIZE = 240;
export const RECEIPT_QR_ERROR_CORRECTION = "M" as const;
export const RECEIPT_QR_NOTE_LIMIT = 120;
export const RECEIPT_QR_SAMPLE_AMOUNT = 100;
export const RECEIPT_QR_SAMPLE_REFERENCE = "SAMPLE";

const QUIET_ZONE_MODULES = 4;

export type ReceiptQrMode = "off" | "feedback" | "pay";

export type ReceiptQrConfig = {
  mode?: ReceiptQrMode;
  feedbackUrl?: string;
  upiId?: string;
  payeeName?: string;
  includeAmount?: boolean;
  note?: string;
};

export type ReceiptQrRaster = {
  width: number;
  height: number;
  dataBase64: string;
};

export type ReceiptQrBillInput = {
  receiptQr?: ReceiptQrConfig | null;
  grandTotal: number;
  reference?: string;
  hotelName?: string;
};

const optionalText = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text || undefined;
};

export function isHttpsFeedbackUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function isUpiId(value: string) {
  const upiId = value.trim();
  if (upiId.length < 3 || upiId.length > 255 || /\s/.test(upiId)) {
    return false;
  }
  const at = upiId.indexOf("@");
  if (at <= 0 || at !== upiId.lastIndexOf("@") || at >= upiId.length - 1) {
    return false;
  }
  const local = upiId.slice(0, at);
  const handle = upiId.slice(at + 1);
  return /^[A-Za-z0-9._-]+$/.test(local) && /^[A-Za-z0-9.-]+$/.test(handle);
}

export function normalizeReceiptNote(note: unknown) {
  const collapsed = String(note ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) {
    return "";
  }
  return collapsed.slice(0, RECEIPT_QR_NOTE_LIMIT);
}

export function receiptQrSettingsError(input: {
  mode: ReceiptQrMode;
  feedbackUrl: string;
  upiId: string;
}) {
  if (input.mode === "feedback" && !isHttpsFeedbackUrl(input.feedbackUrl)) {
    return "Feedback URL must be an https:// link";
  }
  if (input.mode === "pay" && !isUpiId(input.upiId)) {
    return "Enter a UPI ID like name@bank";
  }
  return null;
}

export function receiptQrConfigForSave(input: {
  mode: ReceiptQrMode;
  feedbackUrl: string;
  upiId: string;
  payeeName: string;
  includeAmount: boolean;
  note: string;
}): ReceiptQrConfig {
  const note = normalizeReceiptNote(input.note);
  const config: ReceiptQrConfig = { mode: input.mode, includeAmount: input.includeAmount };
  const feedbackUrl = optionalText(input.feedbackUrl);
  const upiId = optionalText(input.upiId);
  const payeeName = optionalText(input.payeeName);
  if (feedbackUrl) {
    config.feedbackUrl = feedbackUrl;
  }
  if (upiId) {
    config.upiId = upiId;
  }
  if (payeeName) {
    config.payeeName = payeeName;
  }
  if (note) {
    config.note = note;
  }
  return config;
}

function activeMode(receiptQr?: ReceiptQrConfig | null): "feedback" | "pay" | null {
  if (receiptQr?.mode === "feedback" || receiptQr?.mode === "pay") {
    return receiptQr.mode;
  }
  return null;
}

function formatUpiAmount(amount: number) {
  const paise = Math.round((Number(amount) || 0) * 100);
  const safe = Number.isFinite(paise) && paise > 0 ? paise : 0;
  const rupees = Math.floor(safe / 100);
  const frac = safe % 100;
  if (frac === 0) {
    return String(rupees);
  }
  return `${rupees}.${String(frac).padStart(2, "0")}`;
}

function upiQuery(params: Array<[string, string]>) {
  return params
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

export function buildReceiptQrPayload(input: ReceiptQrBillInput) {
  const mode = activeMode(input.receiptQr);
  if (!mode || !input.receiptQr) {
    return null;
  }
  if (mode === "feedback") {
    const url = String(input.receiptQr.feedbackUrl || "").trim();
    return isHttpsFeedbackUrl(url) ? url : null;
  }

  const upiId = String(input.receiptQr.upiId || "").trim();
  if (!isUpiId(upiId)) {
    return null;
  }
  const payee =
    String(input.receiptQr.payeeName || "").trim() ||
    String(input.hotelName || "").trim() ||
    "Restaurant";
  const reference = String(input.reference || "").trim();
  const params: Array<[string, string]> = [
    ["pa", upiId],
    ["pn", payee],
  ];
  if (input.receiptQr.includeAmount !== false) {
    params.push(["am", formatUpiAmount(input.grandTotal)]);
  }
  params.push(["cu", "INR"]);
  if (reference) {
    params.push(["tn", reference]);
  }
  return `upi://pay?${upiQuery(params)}`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function receiptQrRasterBytes(dataBase64: string) {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function buildReceiptQrBitmap(payload: string): ReceiptQrRaster | null {
  const text = String(payload || "").trim();
  if (!text) {
    return null;
  }
  let symbol: ReturnType<typeof createQrSymbol>;
  try {
    symbol = createQrSymbol(text, { errorCorrectionLevel: RECEIPT_QR_ERROR_CORRECTION });
  } catch {
    return null;
  }
  const modules = symbol.modules.size;
  const total = modules + QUIET_ZONE_MODULES * 2;
  const modulePx = Math.floor(RECEIPT_QR_SIZE / total);
  if (modulePx < 1) {
    return null;
  }
  const drawn = total * modulePx;
  const offset = Math.floor((RECEIPT_QR_SIZE - drawn) / 2);
  const widthBytes = Math.ceil(RECEIPT_QR_SIZE / 8);
  const bytes = new Uint8Array(widthBytes * RECEIPT_QR_SIZE);

  for (let y = 0; y < RECEIPT_QR_SIZE; y += 1) {
    for (let x = 0; x < RECEIPT_QR_SIZE; x += 1) {
      if (x < offset || y < offset || x >= offset + drawn || y >= offset + drawn) {
        continue;
      }
      const moduleX = Math.floor((x - offset) / modulePx);
      const moduleY = Math.floor((y - offset) / modulePx);
      const inSymbol =
        moduleX >= QUIET_ZONE_MODULES &&
        moduleY >= QUIET_ZONE_MODULES &&
        moduleX < QUIET_ZONE_MODULES + modules &&
        moduleY < QUIET_ZONE_MODULES + modules;
      if (!inSymbol || !symbol.modules.get(moduleY - QUIET_ZONE_MODULES, moduleX - QUIET_ZONE_MODULES)) {
        continue;
      }
      bytes[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  return {
    width: RECEIPT_QR_SIZE,
    height: RECEIPT_QR_SIZE,
    dataBase64: bytesToBase64(bytes),
  };
}

export function receiptQrRgba(raster: ReceiptQrRaster) {
  const bytes = receiptQrRasterBytes(raster.dataBase64);
  const widthBytes = Math.ceil(raster.width / 8);
  const rgba = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const dark = (bytes[y * widthBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
      const offset = (y * raster.width + x) * 4;
      const channel = dark ? 0 : 255;
      rgba[offset] = channel;
      rgba[offset + 1] = channel;
      rgba[offset + 2] = channel;
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

function qrDirective(payload: string) {
  const raster = buildReceiptQrBitmap(payload);
  if (!raster) {
    return null;
  }
  return `QR_MONO:${raster.width}:${raster.height}:${raster.dataBase64}`;
}

export function buildReceiptQrFooterLines(input: ReceiptQrBillInput) {
  const mode = activeMode(input.receiptQr);
  if (!mode) {
    return [] as string[];
  }
  const note = normalizeReceiptNote(input.receiptQr?.note);
  const payload = buildReceiptQrPayload(input);
  if (!note && !payload) {
    return [] as string[];
  }
  const lines = ["BLANK"];
  if (note) {
    wrapText(note, RECEIPT_TEXT_WIDTH).forEach((line) => {
      lines.push(`CENTER:${line}`);
    });
  }
  if (payload) {
    const directive = qrDirective(payload);
    if (directive) {
      lines.push(directive);
    }
  }
  if (lines.length === 1) {
    return [] as string[];
  }
  return lines;
}
