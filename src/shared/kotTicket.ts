import { formatWrappedColumnRows, wrapFixedWidth } from "./printColumns";

export type KotTicketBranding = {
  hotelName?: string | null;
};

export type KotPreviewItem = {
  id?: string;
  name: string;
  qty: number;
  sentQty?: number;
  note?: string | null;
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
  /** Sent items cancelled since the last kitchen ticket. */
  voidItems?: KotPreviewItem[];
  reason?: string;
  /** Practice slip. Printed before live operations start. */
  practice?: boolean;
};

export const PRACTICE_DOCUMENT_BANNER = "PRACTICE — NOT A TAX INVOICE";

function practiceBanner(practice: boolean | undefined) {
  return practice ? [`CENTER:${PRACTICE_DOCUMENT_BANNER}`] : [];
}

/** One shared reason stays in the header. Mixed reasons print under each item. */
export function describeKotVoids(
  voids: Array<{ name: string; qty: number; reason?: string | null }>,
): { reason?: string; items: KotPreviewItem[] } {
  const reasons = [
    ...new Set(voids.map((row) => String(row.reason || "").trim()).filter(Boolean)),
  ];
  const shared = reasons.length === 1 ? reasons[0] : undefined;
  return {
    reason: shared,
    items: voids.map((row) => ({
      name: row.name,
      qty: row.qty,
      note: shared ? null : String(row.reason || "").trim() || null,
    })),
  };
}

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

function hotelNameFrom(branding?: KotTicketBranding | null) {
  return String(branding?.hotelName || "Restaurant").trim() || "Restaurant";
}

const PAD = "  ";
const COL_ITEM = 32;
const COL_QTY = 8;

function rpad(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, " ");
}

function lpad(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value.padStart(width, " ");
}

function columnHeader() {
  return `LEFT:${PAD}${rpad("Item", COL_ITEM)}${lpad("Qty", COL_QTY)}`;
}

/** Heavy heading. The clean rule under it keeps the word off the dish. */
function sectionLabel(word: string) {
  return [`LEFTDH:${PAD}${word}`, "SEP"];
}

/**
 * Dish on the left, quantity on the right. A long name wraps inside the item
 * column so the quantity stays on the first line.
 */
function itemRows(
  prefix: string,
  items: KotPreviewItem[],
  options: { showNote?: boolean } = {},
) {
  return items.flatMap((it) => {
    const qty = lpad(String(it.qty !== null && it.qty !== undefined ? it.qty : 1), COL_QTY);
    const rows = formatWrappedColumnRows(
      `${prefix}${PAD}`,
      String(it.name || "").trim(),
      COL_ITEM,
      qty,
    );
    const note = options.showNote === false ? "" : String(it.note || "").trim();
    const notes = note
      ? wrapFixedWidth(note, COL_ITEM).map((chunk) => `LEFT:${PAD}  ${chunk}`)
      : [];
    return [...rows, ...notes];
  });
}

/** One stop line: the dish on the left, the quantity on the right. */
export function buildVoidKotItemPrintLines(_pad: string, name: string, qty: string): string[] {
  return itemRows("LEFTDH:", [{ name: name.trim(), qty: Number(String(qty).trim()) || 1 }], {
    showNote: false,
  });
}

export function buildKotLines(
  previewData: KotPreviewData,
  orderData: { items?: KotPreviewItem[]; notes?: string } | null | undefined,
  tableNum: number | string | null,
  brandingInput?: KotTicketBranding | null,
): string[] {
  const hotelName = hotelNameFrom(brandingInput);

  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()}`;
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const kotNum = String(previewData.kotId || "-");
  const voidItems = previewData.voidItems || [];
  const foodItems = (previewData.items || orderData?.items || []) as KotPreviewItem[];

  return [
    `BIGBOLD:${hotelName}`,
    ...practiceBanner(previewData.practice),
    ...(voidItems.length ? [] : ["SUBHEADER:---------KOT---------"]),
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
    columnHeader(),
    "SEP",
    ...(voidItems.length
      ? [
          ...sectionLabel("STOP"),
          ...itemRows("LEFTDH:", voidItems, { showNote: false }),
          ...(foodItems.length ? ["SEP", ...sectionLabel("MAKE")] : []),
        ]
      : []),
    ...itemRows("LEFTDH:", foodItems, { showNote: true }),
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
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()}`;
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return [
    `BIGBOLD:${hotelName}`,
    ...practiceBanner(previewData.practice),
    `LEFT:${PAD}Date: ${dateStr}  Time: ${timeStr}`,
    ...(previewData.sentBy ? [`LEFT:${PAD}Sent by: ${previewData.sentBy}`] : []),
    ...(previewData.orderType === "table"
      ? [`LEFT:${PAD}Table No: ${resolveKotTableLabel(previewData)}`]
      : [`LEFT:${PAD}Type: ${previewData.orderType || "Order"}`]),
    "SEP",
    columnHeader(),
    "SEP",
    ...sectionLabel("STOP"),
    ...itemRows("LEFTDH:", (previewData.items || []) as KotPreviewItem[], { showNote: false }),
    "BLANK",
    "CUT",
  ];
}

/** New items, cancellations, or both, as one kitchen ticket. */
export function buildKitchenUpdateLines(
  previewData: KotPreviewData,
  orderData: { items?: KotPreviewItem[]; notes?: string } | null | undefined,
  tableNum: number | string | null,
  brandingInput?: KotTicketBranding | null,
): string[] {
  const foodItems = previewData.items || [];
  const voidItems = previewData.voidItems || [];
  if (voidItems.length && !foodItems.length) {
    return buildKotVoidLines(
      {
        ...previewData,
        items: voidItems,
      },
      brandingInput,
    );
  }
  return buildKotLines(
    {
      ...previewData,
      items: foodItems,
      voidItems,
    },
    orderData,
    tableNum,
    brandingInput,
  );
}
