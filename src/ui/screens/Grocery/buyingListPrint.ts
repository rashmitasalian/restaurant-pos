import type { GroceryListDoc } from "../../../app/db/posRepository";
import { formatListDate } from "./groceryUtils";

export function buyingListPrintLines(list: GroceryListDoc, withPurchaseDetails = false) {
  const lines = [
    "BIGBOLD:Buying List",
    `SUBHEADER:${list.title}`,
    `CENTER:${formatListDate(list.listDate)}`,
    "SEP",
    ...list.lines.map((line) => {
      const base = `LEFT:${line.itemName} - ${line.quantity} ${line.unit}`;
      if (!withPurchaseDetails) return base;
      const purchased =
        line.purchasedQuantity != null
          ? ` purchased ${line.purchasedQuantity} ${line.unit}`
          : "";
      return `${base}${purchased}`;
    }),
    "SEP",
    `LEFT:Items: ${list.lines.length}`,
  ];
  if (list.printCount > 0) {
    lines.push(`LEFT:Print #${list.printCount + 1}`);
  }
  lines.push("BLANK", "CUT");
  return lines;
}

export function buyingListHtml(list: GroceryListDoc) {
  const rows = list.lines
    .map(
      (line) =>
        `<tr><td>☐ ${escapeHtml(line.itemName)}</td><td>${line.quantity} ${escapeHtml(
          line.unit,
        )}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(
    list.title,
  )}</title>
  <style>
    body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#111}
    h1{font-size:20px;margin:0 0 4px}
    .meta{color:#666;font-size:13px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    td{padding:8px 4px;border-bottom:1px solid #e5e5e5;font-size:14px}
    td:last-child{text-align:right;white-space:nowrap}
  </style></head><body>
  <h1>${escapeHtml(list.title)}</h1>
  <div class="meta">${escapeHtml(formatListDate(list.listDate))} · ${list.lines.length} items</div>
  <table>${rows}</table>
  </body></html>`;
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
