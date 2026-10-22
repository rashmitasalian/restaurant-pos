import type { OrderLineDto } from "./pos";

export type SplitMove = {
  lineId: string;
  qty: number;
};

export type SplitAllocation = {
  lineId: string;
  sourceQty: number;
  sourcePrinted: number;
  destinationQty: number;
  destinationPrinted: number;
};

/**
 * Unsent quantity moves first. Sent quantity moves only after that.
 * The caller recomputes money; this function never splits tax.
 */
export function allocateSplitQuantities(
  lines: Array<Pick<OrderLineDto, "id" | "qty" | "kotPrintedQty">>,
  moves: SplitMove[],
): SplitAllocation[] {
  const moveById = new Map<string, number>();
  for (const move of moves || []) {
    const lineId = String(move?.lineId || "").trim();
    const qty = Number(move?.qty);
    if (!lineId || !Number.isInteger(qty) || qty < 0) {
      throw new Error("split-qty");
    }
    if (moveById.has(lineId)) {
      throw new Error("split-qty");
    }
    if (qty > 0) {
      moveById.set(lineId, qty);
    }
  }
  if (moveById.size === 0) {
    throw new Error("split-empty");
  }

  let originalUnits = 0;
  let movedUnits = 0;
  const seen = new Set<string>();
  const result: SplitAllocation[] = [];
  for (const line of lines || []) {
    const lineId = String(line?.id || "").trim();
    const qty = Number(line?.qty);
    const printed = Number(line?.kotPrintedQty || 0);
    if (
      !lineId ||
      !Number.isInteger(qty) ||
      qty <= 0 ||
      !Number.isInteger(printed) ||
      printed < 0 ||
      printed > qty
    ) {
      throw new Error("split-qty");
    }
    seen.add(lineId);
    originalUnits += qty;
    const move = moveById.get(lineId) || 0;
    if (move > qty) {
      throw new Error("split-qty");
    }
    movedUnits += move;
    if (move === 0) {
      continue;
    }
    const unsent = qty - printed;
    const moveUnsent = Math.min(move, unsent);
    const moveSent = move - moveUnsent;
    const sourceQty = qty - move;
    const sourcePrinted = printed - moveSent;
    const destinationQty = move;
    const destinationPrinted = moveSent;
    if (
      sourceQty < 0 ||
      sourcePrinted < 0 ||
      destinationQty <= 0 ||
      destinationPrinted < 0 ||
      destinationPrinted > destinationQty ||
      (sourceQty > 0 && sourcePrinted > sourceQty)
    ) {
      throw new Error("split-qty");
    }
    result.push({
      lineId,
      sourceQty,
      sourcePrinted,
      destinationQty,
      destinationPrinted,
    });
  }
  for (const lineId of moveById.keys()) {
    if (!seen.has(lineId)) {
      throw new Error("split-qty");
    }
  }
  if (movedUnits === 0) {
    throw new Error("split-empty");
  }
  if (movedUnits === originalUnits) {
    throw new Error("split-entire-order");
  }
  return result;
}
