import type { OrderDto, OrderLineDto } from "./pos";

export type KotSentLine = {
  id: string;
  sentQty: number;
};

/** A sent item removed from the bill, waiting for the next kitchen ticket. */
export type PendingKotVoid = {
  id: string;
  lineId: string;
  name: string;
  qty: number;
  reason: string;
};

export function pendingKotVoidsFromMeta(meta: unknown): PendingKotVoid[] {
  if (!meta || typeof meta !== "object") {
    return [];
  }
  const raw = (meta as { pendingKotVoids?: unknown }).pendingKotVoids;
  if (!Array.isArray(raw)) {
    return [];
  }
  const voids: PendingKotVoid[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const id = String(row.id || "").trim();
    const name = String(row.name || "").trim();
    const qty = Math.max(0, Number(row.qty) || 0);
    if (!id || !name || qty <= 0) {
      continue;
    }
    voids.push({
      id,
      lineId: String(row.lineId || ""),
      name,
      qty,
      reason: String(row.reason || "").trim(),
    });
  }
  return voids;
}

export function pendingKotVoidQty(meta: unknown) {
  return pendingKotVoidsFromMeta(meta).reduce((sum, row) => sum + row.qty, 0);
}

/** Lines that still have quantity not yet sent to kitchen. */
export function getUnsentKotLines(lines: OrderLineDto[] | null | undefined): OrderLineDto[] {
  return (lines || []).filter((line) => Number(line.qty || 0) > Number(line.kotPrintedQty || 0));
}

export function pendingKotQty(line: Pick<OrderLineDto, "qty" | "kotPrintedQty">) {
  return Math.max(0, Number(line.qty || 0) - Number(line.kotPrintedQty || 0));
}

export function kotLineCounts(
  lines: Array<Pick<OrderLineDto, "qty" | "kotPrintedQty">> | null | undefined,
) {
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
  meta?: unknown;
}) {
  const { sentCount } = kotLineCounts(order.items);
  const waitingVoids = pendingKotVoidsFromMeta(order.meta).length;
  return (
    sentCount > 0 ||
    waitingVoids > 0 ||
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
  const metaLabel =
    [items > 0 ? `${items} item${items === 1 ? "" : "s"}` : "", input.elapsed]
      .filter(Boolean)
      .join(" · ") || undefined;
  if (input.billPending) {
    return {
      state: "attention",
      stateLabel: "Pending",
      needsKot: false,
      metaLabel,
      elapsed: input.elapsed,
    };
  }
  return {
    state: "occupied",
    stateLabel: "KOT sent",
    needsKot: false,
    metaLabel,
    elapsed: input.elapsed,
  };
}

export type KitchenDeltaLine = {
  id?: string;
  name: string;
  qty: number;
  /** Printed qty to store after this ticket. Defaults to the line qty. */
  sentQty?: number;
  note?: string | null;
};

export type KitchenDelta = {
  stop: Array<{ name: string; qty: number }>;
  make: KitchenDeltaLine[];
  clearVoidIds: string[];
  sentLines: KotSentLine[];
};

function kitchenItemKey(name: string) {
  return String(name || "").trim().toLowerCase();
}

type KitchenBillLine = {
  id?: string;
  name: string;
  qty?: number;
  kotPrintedQty?: number;
  sentQty?: number;
  note?: string | null;
  kitchenNote?: string | null;
};

/**
 * Kitchen slip is only the change since the last ticket.
 * A dish still on the bill is made, never stopped. Changing full to half
 * stops the full and makes the half. Switching back before send prints nothing.
 */
export function netKitchenDelta(voids: PendingKotVoid[], lines: KitchenBillLine[]): KitchenDelta {
  const voidRows = (voids || [])
    .map((row) => ({
      id: String(row?.id || "").trim(),
      name: String(row?.name || "").trim(),
      qty: Math.max(0, Number(row?.qty) || 0),
      variantChange: String(row?.reason || "").trim().toLowerCase() === "variant changed",
    }))
    .filter((row) => row.name && row.qty > 0);

  const buckets = new Map<
    string,
    { name: string; bill: number; printed: number; lines: KitchenBillLine[] }
  >();
  for (const line of lines || []) {
    const name = String(line?.name || "").trim();
    const bill = Math.max(0, Number(line?.qty) || 0);
    if (!name || bill <= 0) {
      continue;
    }
    const key = kitchenItemKey(name);
    const bucket = buckets.get(key) || { name, bill: 0, printed: 0, lines: [] };
    bucket.bill += bill;
    bucket.printed += Math.max(0, Number(line?.kotPrintedQty) || 0);
    bucket.lines.push(line);
    buckets.set(key, bucket);
  }

  const voidByName = new Map<string, { name: string; variant: number; other: number }>();
  for (const row of voidRows) {
    const key = kitchenItemKey(row.name);
    const bucket = voidByName.get(key) || { name: row.name, variant: 0, other: 0 };
    if (row.variantChange) {
      bucket.variant += row.qty;
    } else {
      bucket.other += row.qty;
    }
    voidByName.set(key, bucket);
  }

  const stop: Array<{ name: string; qty: number }> = [];
  const make: KitchenDeltaLine[] = [];
  const sentIds = new Set<string>();
  const sentLines: KotSentLine[] = [];

  const rememberSent = (line: KitchenBillLine) => {
    const id = String(line.id || "").trim();
    const sentQty = Math.max(0, Number(line.sentQty ?? line.qty) || 0);
    if (!id || sentQty <= 0 || sentIds.has(id)) {
      return;
    }
    sentIds.add(id);
    sentLines.push({ id, sentQty });
  };

  const addMake = (bucketLines: KitchenBillLine[], makeQty: number) => {
    let left = makeQty;
    const open = bucketLines.filter(
      (line) => Math.max(0, Number(line.qty || 0) - Number(line.kotPrintedQty || 0)) > 0,
    );
    const pool = open.length ? open : bucketLines.slice(0, 1);
    for (const line of pool) {
      if (left <= 0) {
        break;
      }
      const room = open.length
        ? Math.max(0, Number(line.qty || 0) - Number(line.kotPrintedQty || 0))
        : left;
      const take = Math.min(left, room);
      if (take <= 0) {
        continue;
      }
      const name = String(line.name || "").trim();
      make.push({
        id: line.id,
        name,
        qty: take,
        sentQty: Math.max(0, Number(line.sentQty ?? line.qty) || 0),
        note: line.note ?? line.kitchenNote ?? null,
      });
      rememberSent(line);
      left -= take;
    }
  };

  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of voidRows) {
    const key = kitchenItemKey(row.name);
    if (!seen.has(key)) {
      seen.add(key);
      names.push(key);
    }
  }
  for (const key of buckets.keys()) {
    if (!seen.has(key)) {
      seen.add(key);
      names.push(key);
    }
  }

  for (const key of names) {
    const billLine = buckets.get(key);
    const pending = voidByName.get(key);
    const bill = billLine?.bill || 0;
    const printed = billLine?.printed || 0;
    let unsent = Math.max(0, bill - printed);
    let variantVoid = pending?.variant || 0;
    let otherVoid = pending?.other || 0;

    if (bill > 0) {
      const coveredByNew = Math.min(unsent, variantVoid);
      unsent -= coveredByNew;
      variantVoid -= coveredByNew;
      const coveredByKitchen = Math.min(unsent, otherVoid);
      unsent -= coveredByKitchen;
      otherVoid -= coveredByKitchen;
      let makeQty = unsent;
      if (makeQty === 0 && variantVoid > 0 && printed > 0) {
        makeQty = Math.min(bill, variantVoid);
      }
      if (makeQty > 0 && billLine) {
        addMake(billLine.lines, makeQty);
      } else if (billLine && bill > printed) {
        for (const line of billLine.lines) {
          if (Number(line.qty || 0) - Number(line.kotPrintedQty || 0) > 0) {
            rememberSent(line);
          }
        }
      }
      if (otherVoid > 0 && pending) {
        stop.push({ name: pending.name, qty: otherVoid });
      }
      continue;
    }

    const stopQty = variantVoid + otherVoid;
    if (stopQty > 0 && pending) {
      stop.push({ name: pending.name, qty: stopQty });
    }
  }

  return {
    stop,
    make,
    clearVoidIds: voidRows.map((row) => row.id).filter(Boolean),
    sentLines,
  };
}

/** Drop a pending stop when the same dish is added again before the kitchen is told. */
export function settleKitchenOverlap<T extends { name: string; qty?: number; kotPrintedQty?: number }>(
  lines: T[],
  voids: PendingKotVoid[],
): { lines: T[]; voids: PendingKotVoid[] } {
  const voidLeft = (voids || []).map((row) => ({ ...row, qty: Math.max(0, Number(row.qty) || 0) }));
  const nextLines = (lines || []).map((line) => ({ ...line }));
  for (const line of nextLines) {
    let unsent = Math.max(0, Number(line.qty || 0) - Number(line.kotPrintedQty || 0));
    const key = kitchenItemKey(line.name);
    if (!key || unsent <= 0) {
      continue;
    }
    for (const row of voidLeft) {
      if (unsent <= 0) {
        break;
      }
      if (row.qty <= 0 || kitchenItemKey(row.name) !== key) {
        continue;
      }
      const take = Math.min(unsent, row.qty);
      row.qty -= take;
      unsent -= take;
      line.kotPrintedQty = Number(line.kotPrintedQty || 0) + take;
    }
  }
  return {
    lines: nextLines,
    voids: voidLeft.filter((row) => row.qty > 0),
  };
}

export function kotSentLinesNeedPrint(
  order: Pick<OrderDto, "items" | "meta"> | null | undefined,
  sentLines: KotSentLine[] | null | undefined,
  clearPendingKotVoidIds?: string[] | null,
) {
  const requested = (sentLines || [])
    .map((line) => ({
      id: String(line?.id || ""),
      sentQty: Math.max(0, Number(line?.sentQty) || 0),
    }))
    .filter((line) => line.id && line.sentQty > 0);
  const clearIds = (Array.isArray(clearPendingKotVoidIds) ? clearPendingKotVoidIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const waitingVoidIds = new Set(pendingKotVoidsFromMeta(order?.meta).map((row) => row.id));
  const voidsStillWaiting = clearIds.some((id) => waitingVoidIds.has(id));

  if (requested.length === 0) {
    return clearIds.length > 0 ? voidsStillWaiting : true;
  }
  if (!order) {
    return false;
  }

  const linesStillWaiting = requested.some((requestedLine) => {
    const current = (order.items || []).find((line) => line.id === requestedLine.id);
    if (!current) {
      return false;
    }
    const currentQty = Math.max(0, Number(current.qty || 0));
    const sentQty = Math.max(0, Number(current.kotPrintedQty || 0));
    const qtyNeededForRequest = Math.min(currentQty, requestedLine.sentQty);
    return qtyNeededForRequest > sentQty;
  });
  return linesStillWaiting || voidsStillWaiting;
}
