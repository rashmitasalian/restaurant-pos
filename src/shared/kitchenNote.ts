const KITCHEN_NOTE_MAX = 80;

/** Kitchen instruction stored on an order line. Empty becomes null. */
export function normalizeKitchenNote(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, KITCHEN_NOTE_MAX);
  return text || null;
}

export function lineHasUnsentQty(line: { qty?: number | null; kotPrintedQty?: number | null }) {
  return Math.max(0, Number(line.qty || 0) - Number(line.kotPrintedQty || 0)) > 0;
}
