import type { OrderDto } from "./pos";

export type KotSentLine = {
  id: string;
  sentQty: number;
};

export function kotSentLinesNeedPrint(
  order: Pick<OrderDto, "items"> | null | undefined,
  sentLines: KotSentLine[] | null | undefined,
) {
  const requested = (sentLines || [])
    .map((line) => ({
      id: String(line?.id || ""),
      sentQty: Math.max(0, Number(line?.sentQty) || 0),
    }))
    .filter((line) => line.id && line.sentQty > 0);

  if (requested.length === 0) {
    return true;
  }
  if (!order) {
    return false;
  }

  return requested.some((requestedLine) => {
    const current = (order.items || []).find((line) => line.id === requestedLine.id);
    if (!current) {
      return false;
    }
    const currentQty = Math.max(0, Number(current.qty || 0));
    const sentQty = Math.max(0, Number(current.kotPrintedQty || 0));
    const qtyNeededForRequest = Math.min(currentQty, requestedLine.sentQty);
    return qtyNeededForRequest > sentQty;
  });
}
