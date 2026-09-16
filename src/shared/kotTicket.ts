export type KotTicketBranding = {
  hotelName?: string | null;
};

export type KotPreviewItem = {
  id?: string;
  name: string;
  qty: number;
  sentQty?: number;
};

export type KotPreviewData = {
  kotId?: string | number;
  sentBy?: string;
  orderType?: string;
  /** Internal table id (numeric). Prefer tableLabel for printing. */
  tableNum?: number | string | null;
  /** Display name shown on screen (F14, G1, Patio). */
  tableLabel?: string | null;
  platform?: string;
  platformCode?: string;
  customerName?: string;
  customerPhone?: string;
  items?: KotPreviewItem[];
  reason?: string;
};

/** What kitchen sees as "Table No" — must match on-screen table label. */
export function resolveKotTableLabel(previewData: {
  tableLabel?: string | null;
  tableNum?: number | string | null;
}): string {
  const label = String(previewData.tableLabel || "").trim();
  if (label) {
    return label;
  }
  if (
    previewData.tableNum !== null &&
    previewData.tableNum !== undefined &&
    previewData.tableNum !== ""
  ) {
    return String(previewData.tableNum);
  }
  return "-";
}

function rpad(s: string, w: number) {
  return s.length >= w ? s.slice(0, w) : s.padEnd(w);
}

function lpad(s: string, w: number) {
  return s.length >= w ? s.slice(0, w) : s.padStart(w);
}

function hotelNameFrom(branding?: KotTicketBranding | null) {
  return String(branding?.hotelName || "Restaurant").trim() || "Restaurant";
}

/** Void item line — ESC/POS raster strikethrough (GS v 0), not a second dash row. */
export function buildVoidKotItemPrintLines(pad: string, name: string, qty: string): string[] {
  return [`LEFTDHVOID:${pad}${name}${qty}`];
}

export function buildKotLines(
  previewData: KotPreviewData,
  orderData: { items?: KotPreviewItem[]; notes?: string } | null | undefined,
  tableNum: number | string | null,
  brandingInput?: KotTicketBranding | null,
): string[] {
  const hotelName = hotelNameFrom(brandingInput);
  const PAD = "  ";
  const COL_ITEM = 32;
  const COL_QTY = 8;

  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()}`;
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const kotNum = String(previewData.kotId || "-");

  return [
    `BIGBOLD:${hotelName}`,
    "SUBHEADER:---------KOT---------",
    `LEFT:${PAD}KOT No: ${kotNum}`,
    `LEFT:${PAD}Date: ${dateStr}  Time: ${timeStr}`,
    ...(previewData.sentBy ? [`LEFT:${PAD}Sent by: ${previewData.sentBy}`] : []),
    ...(previewData.orderType === "table"
      ? [
          `LEFT:${PAD}Table No: ${resolveKotTableLabel({
            tableLabel: previewData.tableLabel,
            tableNum: previewData.tableNum ?? tableNum,
          })}`,
        ]
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
    ...((previewData.items || orderData?.items || []) as KotPreviewItem[]).map((it) => {
      const name = rpad(String(it.name || "").trim(), COL_ITEM);
      const qty = lpad(String(it.qty !== null && it.qty !== undefined ? it.qty : 1), COL_QTY);
      return `LEFTDH:${PAD}${name}${qty}`;
    }),
    ...(orderData?.notes ? ["SEP", `LEFT:${PAD}Note: ${orderData.notes}`] : []),
    "BLANK",
    "CUT",
  ];
}

export function buildKotVoidLines(
  previewData: KotPreviewData,
  brandingInput?: KotTicketBranding | null,
): string[] {
  const hotelName = hotelNameFrom(brandingInput);
  const PAD = "  ";
  const COL_ITEM = 32;
  const COL_QTY = 8;
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()}`;
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return [
    `BIGBOLD:${hotelName}`,
    "SUBHEADER:-------VOID KOT-------",
    `LEFT:${PAD}Date: ${dateStr}  Time: ${timeStr}`,
    ...(previewData.sentBy ? [`LEFT:${PAD}Voided by: ${previewData.sentBy}`] : []),
    ...(previewData.orderType === "table"
      ? [`LEFT:${PAD}Table No: ${resolveKotTableLabel(previewData)}`]
      : [`LEFT:${PAD}Type: ${previewData.orderType || "Order"}`]),
    ...(previewData.reason ? [`LEFT:${PAD}Reason: ${previewData.reason}`] : []),
    "SEP",
    `LEFT:${PAD}${rpad("Cancel Item", COL_ITEM)}${lpad("Qty", COL_QTY)}`,
    "SEP",
    ...((previewData.items || []) as KotPreviewItem[]).flatMap((it) => {
      const name = rpad(String(it.name || "").trim(), COL_ITEM);
      const qty = lpad(String(it.qty || 1), COL_QTY);
      return buildVoidKotItemPrintLines(PAD, name, qty);
    }),
    "BLANK",
    "CUT",
  ];
}
