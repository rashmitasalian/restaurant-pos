import type { OrderDto, OrderLineDto } from "./pos";

export type KotSentLine = {
  id: string;
  sentQty: number;
};

/** Lines that still have quantity not yet sent to kitchen. */
export function getUnsentKotLines(lines: OrderLineDto[] | null | undefined): OrderLineDto[] {
  return (lines || []).filter((line) => Number(line.qty || 0) > Number(line.kotPrintedQty || 0));
}

export function pendingKotQty(line: Pick<OrderLineDto, "qty" | "kotPrintedQty">) {
  return Math.max(0, Number(line.qty || 0) - Number(line.kotPrintedQty || 0));
}

export function kotLineCounts(lines: Array<Pick<OrderLineDto, "qty" | "kotPrintedQty">> | null | undefined) {
  return (lines || []).reduce(
    (counts, line) => ({
      sentCount: counts.sentCount + Math.max(0, Number(line.kotPrintedQty || 0)),
      unsentCount: counts.unsentCount + pendingKotQty(line),
    }),
    { sentCount: 0, unsentCount: 0 },
  );
}

/** Kitchen already has a ticket. Never-sent table orders stay on the floor. */
export function isKotQueueTicket(order: {
  items?: Array<Pick<OrderLineDto, "qty" | "kotPrintedQty">> | null;
  kotStatus?: string | null;
}) {
  const { sentCount } = kotLineCounts(order.items);
  return (
    sentCount > 0 ||
    order.kotStatus === "sent" ||
    order.kotStatus === "printed" ||
    order.kotStatus === "failed"
  );
}

export type TableKotAppearance = {
  state: "available" | "occupied" | "attention";
  stateLabel: string;
  needsKot: boolean;
  metaLabel?: string;
  elapsed?: string;
};

/** Shared floor/rail tile mapping: Available, Send KOT, KOT sent. Bill-ready stays Pending. */
export function tableKotAppearance(input: {
  occupied: boolean;
  unsentCount?: number | null;
  sentCount?: number | null;
  billPending?: boolean;
  itemCount?: number | null;
  elapsed?: string;
}): TableKotAppearance {
  const occupied = Boolean(input.occupied);
  const unsent = Math.max(0, Number(input.unsentCount || 0));
  const sent = Math.max(0, Number(input.sentCount || 0));
  const needsKot = occupied && (unsent > 0 || sent === 0);
  if (!occupied) {
    return { state: "available", stateLabel: "Available", needsKot: false };
  }
  if (needsKot) {
    return {
      state: "attention",
      stateLabel: "Send KOT",
      needsKot: true,
      metaLabel: unsent > 0 ? `${unsent} to send` : "Not sent",
    };
  }
  const items = Math.max(0, Number(input.itemCount || 0));
  const metaLabel = [items > 0 ? `${items} item${items === 1 ? "" : "s"}` : "", input.elapsed]
    .filter(Boolean)
    .join(" · ") || undefined;
  if (input.billPending) {
    return { state: "attention", stateLabel: "Pending", needsKot: false, metaLabel, elapsed: input.elapsed };
  }
  return { state: "occupied", stateLabel: "KOT sent", needsKot: false, metaLabel, elapsed: input.elapsed };
}

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
