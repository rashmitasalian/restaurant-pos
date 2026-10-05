import { ENV } from "../../../../config/env";
import {
  DEFAULT_GST_CONFIG,
  formatGstRate,
  getOrderGstConfig,
  normalizeGstConfig,
  type GstConfig,
  type GstTotals,
} from "../../../../shared/gst";
import { buildReceiptQrFooterLines, type ReceiptQrConfig } from "./receiptQr";
import { RECEIPT_TEXT_WIDTH, wrapText } from "./receiptWrap";

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
  receiptQr?: ReceiptQrConfig | null;
};

const rpad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s.padEnd(w));
const lpad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s.padStart(w));
const fmtAmt = (n: number) => `${Math.round(n * 100) / 100}`;
const RECEIPT_WIDTH = RECEIPT_TEXT_WIDTH;
const TOTAL_AMOUNT_WIDTH = 12;

function formatReceiptMoney(amount: number) {
  const paise = Math.round((Number(amount) || 0) * 100);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = String(rupees).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}Rs ${grouped}.${frac}`;
}

function totalRow(label: string, amount: number) {
  const money = formatReceiptMoney(amount);
  const labelWidth = Math.max(0, RECEIPT_WIDTH - 2 - Math.max(TOTAL_AMOUNT_WIDTH, money.length));
  return `LEFTB:${"  "}${rpad(label, labelWidth)}${lpad(money, Math.max(TOTAL_AMOUNT_WIDTH, money.length))}`;
}
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
  options?: { preview?: boolean; tableLabel?: string | null; discountMode?: "percent" | "amount" },
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
  const roundOff = Number(totals.roundOff || 0);
  const gstEnabled = taxTotal > 0 && Boolean(totals.gstEnabled ?? gstConfig.gstRateBps > 0);
  const showGstDetails = gstConfig.enabled && Boolean(gstConfig.gstin);
  const gstHalfRate = totals.gstHalfRateBps ?? Math.round((gstConfig.gstRateBps || 0) / 2);
  const taxLabelSuffix = gstConfig.priceIncludesTax ? " incl." : "";
  const gstStateLine = formatGstStateLine(gstConfig.stateName, gstConfig.stateCode);

  const discountMode =
    options?.discountMode ?? (ord?.discountMode === "amount" ? "amount" : "percent");
  const discountLabel =
    discountMode === "percent" && discPct > 0 ? `Discount ${discPct}%` : "Discount";
  const printedAtStr = formatReceiptDateTime(Date.now());
  const billDateTimeStr = formatReceiptDateTime(getBillTimestamp(ord));

  const orderNum = Number(ord?.meta?.orderSeq) || null;
  const invoiceNumber = String(ord?.invoiceNumber || ord?.meta?.invoice?.number || "").trim();
  const meta = ord?.meta || {};
  const orderType = String(ord?.orderType || (tableNum ? "table" : "takeaway")).toLowerCase();
  const normalizedOrderTypeLabel = orderType.replace(/[_-]+/g, " ").trim();
  const orderTypeLabel =
    orderType === "delivery"
      ? "DELIVERY"
      : orderType === "takeaway"
        ? "TAKEAWAY"
        : orderType === "table"
          ? "DINE-IN"
          : normalizedOrderTypeLabel
            ? normalizedOrderTypeLabel.toUpperCase()
            : "ORDER";
  const tableLabel =
    String(options?.tableLabel || ord?.tableName || "").trim() ||
    (tableNum !== null && tableNum !== undefined ? `Table ${tableNum}` : "");

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
    ...(showGstDetails ? [`CENTER:GSTIN: ${gstConfig.gstin}`, "CENTER:SAC 996331"] : []),
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
    ...(options?.preview ? ["SUBHEADER:*** BILL ***"] : []),
    ...(tableLabel ? [`CENTER:Table: ${tableLabel}`] : []),
    ...(orderType === "delivery"
      ? [
          `CENTER:Platform: ${meta.platform || "Delivery"}`,
          ...(meta.code ? [`CENTER:Order Code: #${meta.code}`] : []),
        ]
      : []),
    ...(orderType !== "table" && orderType !== "delivery" && (meta.customerName || meta.parcelName)
      ? [`CENTER:Customer: ${meta.customerName || meta.parcelName}`]
      : []),
    ...(orderType !== "table" && orderType !== "delivery" && meta.customerPhone
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
    totalRow("Sub Total", itemSubtotal),
    ...(discAmt > 0 ? [totalRow(discountLabel, -discAmt)] : []),
    ...(gstEnabled
      ? [
          ...(gstConfig.priceIncludesTax ? [totalRow("Taxable Value", taxableSubtotal)] : []),
          totalRow(`CGST ${formatGstRate(gstHalfRate)}${taxLabelSuffix}`, cgst),
          totalRow(`SGST ${formatGstRate(gstHalfRate)}${taxLabelSuffix}`, sgst),
          ...(roundOff !== 0 ? [totalRow("Round off", roundOff)] : []),
        ]
      : []),
    "SEP",
    totalRow("Grand Total", grandTotal).replace("LEFTB:", "BOLDLEFT:"),
    "SEP",
    ...(() => {
      const payments = Array.isArray(ord?.payments) ? ord.payments : [];
      const splitParts = payments.flatMap((p: any) =>
        Array.isArray(p?.splitBreakdown) ? p.splitBreakdown : [],
      );
      const creditPart = splitParts.find(
        (part: any) =>
          String(part?.method || "").toLowerCase() === "credit" && Number(part?.amount) > 0,
      );
      const creditPayment = payments.find(
        (p: any) => String(p?.method || "").toLowerCase() === "credit",
      );
      const creditMeta = ord?.meta?.credit;
      if (!creditPayment && !creditPart && !creditMeta) {
        return [] as string[];
      }
      const methodLabel = (value: string) => {
        const raw = String(value || "").toLowerCase();
        if (raw === "upi") return "UPI";
        if (raw === "credit") return "Credit";
        return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Payment";
      };
      const collectedLines = creditPart
        ? splitParts
            .filter(
              (part: any) =>
                String(part?.method || "").toLowerCase() !== "credit" && Number(part?.amount) > 0,
            )
            .map(
              (part: any) =>
                `LEFT:${PAD}Paid ${methodLabel(String(part.method || ""))}: Rs ${fmtAmt(Number(part.amount))}`,
            )
        : [];
      const dueDate = String(creditMeta?.dueDate || "").trim();
      const [y, m, d] = dueDate.split("-").map(Number);
      const dueLabel =
        y && m && d
          ? new Date(y, m - 1, d).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : dueDate || null;
      const customerName = String(
        creditMeta?.customerName || meta.customerName || meta.parcelName || "",
      ).trim();
      const customerPhone = String(creditMeta?.customerPhone || meta.customerPhone || "").trim();
      const balance =
        creditMeta?.accountBalance === null || creditMeta?.accountBalance === undefined
          ? null
          : Number(creditMeta.accountBalance);
      return [
        ...collectedLines,
        creditPart
          ? `LEFTB:${PAD}On account: Rs ${fmtAmt(Number(creditPart.amount))}`
          : `LEFTB:${PAD}Payment: ON ACCOUNT`,
        ...(customerName ? [`LEFT:${PAD}Customer: ${customerName}`] : []),
        ...(customerPhone ? [`LEFT:${PAD}Phone: ${customerPhone}`] : []),
        ...(dueLabel ? [`LEFT:${PAD}This bill due: ${dueLabel}`] : []),
        ...(balance !== null && Number.isFinite(balance)
          ? [`LEFTB:${PAD}Account balance: Rs ${fmtAmt(balance)}`]
          : []),
        "SEP",
      ];
    })(),
    `LEFTB:${PAD}Printed by: Admin`,
    `LEFTB:${PAD}Printed On: ${printedAtStr}`,
    "BLANK",
    "CENTERB:Thank you! Visit again.",
    ...buildReceiptQrFooterLines({
      receiptQr: brandingInput?.receiptQr,
      grandTotal,
      reference: invoiceNumber || (orderNum ? String(orderNum) : ""),
      hotelName: branding.hotelName,
    }),
    "CUT",
  ];
}

// ── KOT builder (shared with main-process / Local Gateway) ──────────────────

export {
  buildKotLines,
  buildKotVoidLines,
  type KotPreviewData,
  type KotPreviewItem,
  type KotTicketBranding,
} from "../../../../shared/kotTicket";
