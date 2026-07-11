import { ENV } from "../../../../config/env";
import {
  DEFAULT_GST_CONFIG,
  formatGstRate,
  getOrderGstConfig,
  normalizeGstConfig,
  type GstConfig,
  type GstTotals,
} from "../../../../shared/gst";

export type ReceiptBranding = {
  hotelName?: string;
  hotelInitials?: string;
  tagline?: string;
  phone?: string;
  email?: string;
  logoDataUrl?: string | null;
  receiptLogoRaster?: {
    width: number;
    height: number;
    dataBase64: string;
  } | null;
};

const rpad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s.padEnd(w));
const lpad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s.padStart(w));
const fmtAmt = (n: number) => `${Math.round(n * 100) / 100}`;
const wrapText = (value: string, width: number) => {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) {
    lines.push(current);
  }
  return lines;
};

const formatGstStateLine = (stateName: string, stateCode: string) => {
  const name = String(stateName || "").trim();
  const code = String(stateCode || "").trim();
  if (name && code) {
    return `State: ${name} (${code})`;
  }
  if (name) {
    return `State: ${name}`;
  }
  if (code) {
    return `State Code: ${code}`;
  }
  return "";
};

const formatReceiptDateTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${dateStr} ${timeStr}`;
};

const getBillTimestamp = (ord: any) => {
  const invoiceAt = Number(ord?.paidAt || ord?.meta?.invoice?.issuedAt || 0);
  if (Number.isFinite(invoiceAt) && invoiceAt > 0) {
    return invoiceAt;
  }
  const paymentAt = (ord?.payments || [])
    .map((payment: any) => Number(payment?.receivedAt || 0))
    .filter((value: number) => Number.isFinite(value) && value > 0)
    .sort((a: number, b: number) => a - b)[0];
  return paymentAt || Number(ord?.updatedAt || Date.now());
};

const getReceiptBranding = (branding?: ReceiptBranding | null) => {
  const hotelName = String(branding?.hotelName || ENV.HOTEL_NAME || "Restaurant").trim();
  return {
    hotelName,
    phone: String(branding?.phone || ENV.HOTEL_PHONE || "").trim(),
    email: String(branding?.email || ENV.HOTEL_EMAIL || "").trim(),
    receiptLogoRaster: branding?.receiptLogoRaster || null,
  };
};

// ── Receipt (Bill) builder ──────────────────────────────────────────────────

export function buildReceiptLines(
  ord: any,
  tableNum: number | null,
  discPct: number,
  totals: Partial<GstTotals> & { subtotal?: number; cgst?: number; sgst?: number; total: number },
  gstConfigInput?: Partial<GstConfig> | null,
  brandingInput?: ReceiptBranding | null,
): string[] {
  const branding = getReceiptBranding(brandingInput);
  const gstConfig = normalizeGstConfig(
    getOrderGstConfig(ord, gstConfigInput || DEFAULT_GST_CONFIG),
  );
  const itemSubtotal = Number(totals.itemSubtotal ?? totals.subtotal ?? 0);
  const taxableSubtotal = Number(totals.taxableSubtotal ?? itemSubtotal);
  const cgst = Number(totals.cgst || 0);
  const sgst = Number(totals.sgst || 0);
  const taxTotal = Number(totals.taxTotal ?? cgst + sgst);
  const discAmt =
    totals.discountTotal !== undefined
      ? Number(totals.discountTotal || 0)
      : +(((totals.preDiscountTotal ?? totals.total) * discPct) / 100).toFixed(2);
  const grandTotal = Number(totals.total || 0);
  const gstEnabled = taxTotal > 0 && Boolean(totals.gstEnabled ?? gstConfig.gstRateBps > 0);
  const showGstDetails = gstConfig.enabled && Boolean(gstConfig.gstin);
  const gstHalfRate = totals.gstHalfRateBps ?? Math.round((gstConfig.gstRateBps || 0) / 2);
  const taxLabelSuffix = gstConfig.priceIncludesTax ? " incl." : "";
  const gstStateLine = formatGstStateLine(gstConfig.stateName, gstConfig.stateCode);

  const printedAtStr = formatReceiptDateTime(Date.now());
  const billDateTimeStr = formatReceiptDateTime(getBillTimestamp(ord));

  const orderNum = Number(ord?.meta?.orderSeq) || null;
  const invoiceNumber = String(ord?.invoiceNumber || ord?.meta?.invoice?.number || "").trim();
  const meta = ord?.meta || {};
  const orderType = ord?.orderType || (tableNum ? "dine-in" : "takeaway");
  const orderTypeLabel =
    orderType === "delivery" ? "DELIVERY" : orderType === "takeaway" ? "TAKEAWAY" : "DINE-IN";

  const PAD = "  ";
  const COL_ITEM = 20;
  const COL_QTY = 4;
  const COL_RATE = 8;
  const COL_AMT = 8;

  return [
    ...(branding.receiptLogoRaster
      ? [
          `IMAGE_MONO:${branding.receiptLogoRaster.width}:${branding.receiptLogoRaster.height}:${branding.receiptLogoRaster.dataBase64}`,
          "BLANK",
        ]
      : []),
    `BIGBOLD:${branding.hotelName}`,
    ...(showGstDetails && gstConfig.legalName && gstConfig.legalName !== branding.hotelName
      ? [`CENTER:${gstConfig.legalName}`]
      : []),
    ...(showGstDetails ? [`CENTER:GSTIN: ${gstConfig.gstin}`] : []),
    ...(showGstDetails && gstConfig.registeredAddress
      ? wrapText(gstConfig.registeredAddress, 42)
          .slice(0, 3)
          .map((line) => `CENTER:${line}`)
      : []),
    ...(showGstDetails && gstStateLine ? [`CENTER:${gstStateLine}`] : []),
    ...(branding.phone ? [`CENTER:Mob: ${branding.phone}`] : []),
    ...(branding.email ? [`CENTER:${branding.email}`] : []),
    "SEP",
    `SUBHEADER:${orderTypeLabel}`,
    ...(tableNum ? [`CENTER:Table No: ${tableNum}`] : []),
    ...(orderType === "delivery"
      ? [
          `CENTER:Platform: ${meta.platform || "Delivery"}`,
          ...(meta.code ? [`CENTER:Order Code: #${meta.code}`] : []),
        ]
      : []),
    ...(orderType === "takeaway" && (meta.customerName || meta.parcelName)
      ? [`CENTER:Customer: ${meta.customerName || meta.parcelName}`]
      : []),
    ...(orderType === "takeaway" && meta.customerPhone
      ? [`CENTER:Phone: ${meta.customerPhone}`]
      : []),
    "SEP",
    `LEFT:${PAD}${invoiceNumber ? `Invoice No: ${invoiceNumber}` : orderNum ? `Order No: #${String(orderNum).padStart(4, "0")}` : "Order No: -"}`,
    `LEFT:${PAD}Date: ${billDateTimeStr}`,
    "SEP",
    `LEFT:${PAD}${rpad("Item", COL_ITEM)}${lpad("Qty", COL_QTY)}${lpad("Rate", COL_RATE)}${lpad("Amt", COL_AMT)}`,
    "SEP",
    ...(ord?.items || []).map((it: any) => {
      const name = rpad(String(it.name || ""), COL_ITEM);
      const qty = lpad(String(it.qty || 1), COL_QTY);
      const rate = lpad(fmtAmt(it.rate || 0), COL_RATE);
      const amt = lpad(fmtAmt((it.qty || 1) * (it.rate || 0)), COL_AMT);
      return `LEFTB:${PAD}${name}${qty}${rate}${amt}`;
    }),
    "SEP",
    `LEFTB:${PAD}${rpad("Sub Total", COL_ITEM + COL_QTY + COL_RATE)}${lpad(`Rs ${fmtAmt(itemSubtotal)}`, COL_AMT)}`,
    ...(discAmt > 0
      ? [
          `LEFTB:${PAD}${rpad(`Discount ${discPct}%`, COL_ITEM + COL_QTY + COL_RATE)}${lpad(`-Rs ${fmtAmt(discAmt)}`, COL_AMT)}`,
        ]
      : []),
    ...(gstEnabled
      ? [
          `LEFTB:${PAD}${rpad("Taxable Value", COL_ITEM + COL_QTY + COL_RATE)}${lpad(`Rs ${fmtAmt(taxableSubtotal)}`, COL_AMT)}`,
          `LEFTB:${PAD}${rpad(`CGST ${formatGstRate(gstHalfRate)}${taxLabelSuffix}`, COL_ITEM + COL_QTY + COL_RATE)}${lpad(`Rs ${fmtAmt(cgst)}`, COL_AMT)}`,
          `LEFTB:${PAD}${rpad(`SGST ${formatGstRate(gstHalfRate)}${taxLabelSuffix}`, COL_ITEM + COL_QTY + COL_RATE)}${lpad(`Rs ${fmtAmt(sgst)}`, COL_AMT)}`,
        ]
      : []),
    "SEP",
    `BOLDLEFT:${PAD}${rpad("Grand Total", COL_ITEM + COL_QTY + COL_RATE)}${lpad(`Rs ${fmtAmt(grandTotal)}`, COL_AMT)}`,
    "SEP",
    `LEFTB:${PAD}Printed by: Admin`,
    `LEFTB:${PAD}Printed On: ${printedAtStr}`,
    "BLANK",
    "CENTERB:Thank you! Visit again.",
    "CUT",
  ];
}

// ── KOT builder ─────────────────────────────────────────────────────────────

export function buildKotLines(
  previewData: any,
  orderData: any,
  tableNum: number | null,
  brandingInput?: ReceiptBranding | null,
): string[] {
  const branding = getReceiptBranding(brandingInput);
  const PAD = "  ";
  const COL_ITEM = 32;
  const COL_QTY = 8;

  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()}`;
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const kotNum = String(previewData.kotId || "-");

  return [
    `BIGBOLD:${branding.hotelName}`,
    "SUBHEADER:---------KOT---------",
    `LEFT:${PAD}KOT No: ${kotNum}`,
    `LEFT:${PAD}Date: ${dateStr}  Time: ${timeStr}`,
    ...(previewData.sentBy ? [`LEFT:${PAD}Sent by: ${previewData.sentBy}`] : []),
    ...(previewData.orderType === "table"
      ? [`LEFT:${PAD}Table No: ${previewData.tableNum || tableNum || "-"}`]
      : []),
    ...(previewData.orderType === "delivery"
      ? [
          `LEFT:${PAD}Type: ${previewData.platform || "Delivery"}`,
          ...(previewData.platformCode ? [`LEFT:${PAD}Code: ${previewData.platformCode}`] : []),
        ]
      : []),
    ...(previewData.orderType === "takeaway" && previewData.customerName
      ? [`LEFT:${PAD}Customer: ${previewData.customerName}`]
      : []),
    ...(previewData.orderType === "takeaway" && previewData.customerPhone
      ? [`LEFT:${PAD}Phone: ${previewData.customerPhone}`]
      : []),
    "SEP",
    `LEFT:${PAD}${rpad("Item", COL_ITEM)}${lpad("Qty", COL_QTY)}`,
    "SEP",
    ...((previewData.items || orderData.items || []) as any[]).map((it: any) => {
      const name = rpad(String(it.name || "").trim(), COL_ITEM);
      const qty = lpad(String(it.qty !== null ? it.qty : 1), COL_QTY);
      return `LEFTDH:${PAD}${name}${qty}`;
    }),
    ...(orderData.notes ? ["SEP", `LEFT:${PAD}Note: ${orderData.notes}`] : []),
    "BLANK",
    "CUT",
  ];
}

export function buildKotVoidLines(
  previewData: any,
  brandingInput?: ReceiptBranding | null,
): string[] {
  const branding = getReceiptBranding(brandingInput);
  const PAD = "  ";
  const COL_ITEM = 32;
  const COL_QTY = 8;
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()}`;
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return [
    `BIGBOLD:${branding.hotelName}`,
    "SUBHEADER:-------VOID KOT-------",
    `LEFT:${PAD}Date: ${dateStr}  Time: ${timeStr}`,
    ...(previewData.sentBy ? [`LEFT:${PAD}Voided by: ${previewData.sentBy}`] : []),
    ...(previewData.orderType === "table"
      ? [`LEFT:${PAD}Table No: ${previewData.tableNum || "-"}`]
      : [`LEFT:${PAD}Type: ${previewData.orderType || "Order"}`]),
    ...(previewData.reason ? [`LEFT:${PAD}Reason: ${previewData.reason}`] : []),
    "SEP",
    `LEFT:${PAD}${rpad("Cancel Item", COL_ITEM)}${lpad("Qty", COL_QTY)}`,
    "SEP",
    ...((previewData.items || []) as any[]).map((it: any) => {
      const name = rpad(String(it.name || "").trim(), COL_ITEM);
      const qty = lpad(String(it.qty || 1), COL_QTY);
      return `LEFTDH:${PAD}${name}${qty}`;
    }),
    "BLANK",
    "CUT",
  ];
}
