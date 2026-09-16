/** Neutral Owner Review labels and derived-rule helpers. Not a source of truth. */

export const REPEATED_CANCELLATION_THRESHOLD = 3;

/** Audit actions that must survive retention prune so transaction timelines stay complete. */
export const ORDER_LIFECYCLE_AUDIT_ACTIONS = [
  "order.created",
  "item.added",
  "order.lines.updated",
  "order.kot.sent",
  "order.kot.failed",
  "order.kot.void",
  "order.kot.done",
  "order.kot.printed",
  "order.discount.updated",
  "order.bill.printed",
  "order.status.updated",
  "order.paid",
  "order.cancelled",
  "order.deleted",
  "order.restored",
] as const;

export type ReviewRuleId =
  | "cancellation_after_kot"
  | "item_void"
  | "discount_applied"
  | "repeated_cancellations";

export const REVIEW_RULE_LABELS: Record<ReviewRuleId, string> = {
  cancellation_after_kot: "Cancelled after KOT",
  item_void: "Item void",
  discount_applied: "Discount applied",
  repeated_cancellations: "Repeated cancellations",
};

export const REVIEW_RULE_SHORT_LABELS: Record<ReviewRuleId, string> = {
  cancellation_after_kot: "After KOT",
  item_void: "Item void",
  discount_applied: "Discount",
  repeated_cancellations: "Repeated",
};

export const REVIEW_RULE_WHY: Record<ReviewRuleId, string> = {
  cancellation_after_kot: "The order was cancelled after kitchen items had already been sent.",
  item_void: "A sent kitchen item was voided or reduced after KOT was sent.",
  discount_applied: "A discount was applied to this order.",
  repeated_cancellations: "This staff member cancelled multiple orders in this period.",
};

/** Primary queue rules. Repeated cancellations stay in staff context, not Needs Review. */
export const PRIMARY_REVIEW_RULES: ReviewRuleId[] = [
  "item_void",
  "discount_applied",
  "cancellation_after_kot",
];

export const TIMELINE_ACTION_LABELS: Record<string, string> = {
  "order.created": "Order created",
  "item.added": "Items added",
  "order.lines.updated": "Items changed",
  "order.kot.sent": "KOT sent",
  "order.kot.failed": "KOT failed",
  "order.kot.void": "Item voided",
  "order.kot.done": "KOT completed",
  "order.kot.printed": "KOT printed",
  "order.discount.updated": "Discount applied",
  "order.bill.printed": "Bill printed",
  "order.status.updated": "Status updated",
  "order.paid": "Payment recorded",
  "order.cancelled": "Order cancelled",
  "order.deleted": "Order deleted",
  "order.restored": "Order restored",
};

export type ReviewRangeQuery = {
  from?: number;
  to?: number;
  actor?: string | null;
};

export type ReviewOrderSnapshot = {
  _id: string;
  tableId: number | null;
  tableName?: string | null;
  total: number;
  createdAt: number;
  cancelledAt?: number | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  createdBy?: string | null;
  kotStatus?: string | null;
  items: Array<{ kotPrintedQty?: number }>;
  meta?: Record<string, unknown>;
  kotSentAt?: number | null;
  billPrintedAt?: number | null;
};

export type ReviewVoidEvent = {
  auditId: string;
  orderId: string;
  timestamp: number;
  actor: string | null;
  reason?: string | null;
  itemName?: string | null;
  voidQty?: number | null;
  amount?: number;
  tableId?: number | null;
  tableName?: string | null;
  createdAt?: number | null;
  kotSentAt?: number | null;
  meta?: Record<string, unknown>;
};

export type ReviewDiscountEvent = {
  auditId: string;
  orderId: string;
  timestamp: number;
  actor: string | null;
  previousDiscountPercent?: number | null;
  discountPercent?: number | null;
  amount?: number;
  tableId?: number | null;
  tableName?: string | null;
  createdAt?: number | null;
  meta?: Record<string, unknown>;
};

export type ReviewItemDto = {
  id: string;
  rule: ReviewRuleId;
  label: string;
  why: string;
  orderId: string;
  orderLabel: string;
  tableId: number | null;
  tableName?: string | null;
  actor: string | null;
  createdAt: number;
  kotSentAt?: number | null;
  billPrintedAt?: number | null;
  occurredAt: number;
  cancelledAt?: number | null;
  reason?: string | null;
  amount: number;
  itemName?: string | null;
  voidQty?: number | null;
  discountPercent?: number | null;
  previousDiscountPercent?: number | null;
};

export type ReviewSummaryDto = {
  paidOrders: number;
  cancelledOrders: number;
  needsReview: number;
  itemVoids: number;
  discountsApplied: number;
  cancellationAfterKot: number;
  repeatedCancellations: number;
};

export type StaffActivityRowDto = {
  username: string;
  displayName?: string | null;
  orders: number;
  voids: number;
  discounts: number;
  afterKot: number;
};

export type OrderTimelineEventDto = {
  timestamp: number;
  action: string;
  label: string;
  actor: string | null;
  detail: unknown;
};

export type ReviewTimelineRow = OrderTimelineEventDto & {
  highlight?: boolean;
};

export type ReviewMilestone = {
  label: string;
  timestamp: number;
};

/** Events an owner needs in the drawer. Kitchen print/done and line-count updates are noise. */
const OWNER_TIMELINE_ACTIONS = new Set([
  "order.created",
  "item.added",
  "order.kot.sent",
  "order.kot.failed",
  "order.kot.void",
  "order.discount.updated",
  "order.bill.printed",
  "order.paid",
  "order.cancelled",
  "order.deleted",
  "order.restored",
]);

const ITEM_ADD_COLLAPSE_MS = 90_000;

export function orderHadKotSent(order: {
  kotStatus?: string | null;
  items?: Array<{ kotPrintedQty?: number }>;
}): boolean {
  if (order.kotStatus === "sent" || order.kotStatus === "printed") {
    return true;
  }
  return (order.items || []).some((line) => Number(line.kotPrintedQty || 0) > 0);
}

export function reviewOrderLabel(order: {
  _id?: string;
  meta?: Record<string, unknown>;
  tableName?: string | null;
  tableId?: number | null;
}): string {
  const table =
    String(order.tableName || "").trim() ||
    (typeof order.tableId === "number" ? `Table ${order.tableId}` : "");
  const seq = Number(order.meta?.orderSeq);
  const seqLabel = Number.isFinite(seq) && seq > 0 ? `#${seq}` : "";
  if (table && seqLabel) {
    return `${seqLabel} · ${table}`;
  }
  if (seqLabel) {
    return seqLabel;
  }
  if (table) {
    return table;
  }
  return "Order";
}

function namedItem(name?: string | null, qty?: number | null): string {
  const label = String(name || "").trim();
  if (!label) {
    return "";
  }
  const count = Number(qty);
  if (Number.isFinite(count) && count > 0 && count !== 1) {
    return `${label} ×${count}`;
  }
  return label;
}

export function reviewWhatHappened(
  item: Pick<
    ReviewItemDto,
    "rule" | "itemName" | "voidQty" | "discountPercent" | "previousDiscountPercent"
  >,
): string {
  if (item.rule === "item_void") {
    return namedItem(item.itemName, item.voidQty) || "Kitchen item voided";
  }
  if (item.rule === "discount_applied") {
    const next = Number(item.discountPercent);
    const previous = Number(item.previousDiscountPercent);
    if (Number.isFinite(previous) && Number.isFinite(next)) {
      return `${previous}% → ${next}%`;
    }
    if (Number.isFinite(next)) {
      return `${next}%`;
    }
    return "Discount applied";
  }
  if (item.rule === "cancellation_after_kot") {
    return "Cancelled after kitchen ticket";
  }
  return "One of several cancellations";
}

export function reviewHeadline(
  item: Pick<ReviewItemDto, "rule" | "actor" | "itemName" | "voidQty" | "discountPercent">,
  actorDisplay?: string | null,
): string {
  const who = String(actorDisplay || item.actor || "Staff").trim() || "Staff";
  if (item.rule === "item_void") {
    const what = namedItem(item.itemName, item.voidQty) || "a kitchen item";
    return `${who} voided ${what} after KOT was sent.`;
  }
  if (item.rule === "discount_applied") {
    const percent = Number(item.discountPercent);
    const amount = Number.isFinite(percent) ? ` a ${percent}% discount` : " a discount";
    return `${who} applied${amount}.`;
  }
  if (item.rule === "cancellation_after_kot") {
    return `${who} cancelled this order after KOT was sent. No payment was recorded.`;
  }
  return `${who} cancelled this order. This staff member cancelled multiple orders in this period.`;
}

export function reviewQueueFact(
  item: Pick<
    ReviewItemDto,
    | "rule"
    | "actor"
    | "reason"
    | "itemName"
    | "voidQty"
    | "kotSentAt"
    | "billPrintedAt"
    | "discountPercent"
    | "previousDiscountPercent"
  >,
  actorDisplay?: string | null,
): string {
  const who = String(actorDisplay || item.actor || "Staff").trim() || "Staff";
  if (item.rule === "item_void") {
    return [who, namedItem(item.itemName, item.voidQty), item.reason].filter(Boolean).join(" · ");
  }
  if (item.rule === "discount_applied") {
    return [who, reviewWhatHappened(item)].filter(Boolean).join(" · ");
  }
  return [
    who,
    item.kotSentAt ? "KOT sent" : null,
    item.billPrintedAt ? "Bill printed" : null,
    item.reason || "No payment recorded",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function actorKey(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function buildReviewItems(input: {
  cancelledOrders: ReviewOrderSnapshot[];
  voidEvents: ReviewVoidEvent[];
  discountEvents?: ReviewDiscountEvent[];
  cancelCountsByActor: Record<string, number>;
  actorFilter?: string | null;
  threshold?: number;
}): ReviewItemDto[] {
  const filter = actorKey(input.actorFilter);
  const items: ReviewItemDto[] = [];

  for (const order of input.cancelledOrders) {
    const actor = order.cancelledBy || order.createdBy || null;
    if (filter && actorKey(actor) !== filter) {
      continue;
    }
    const base = {
      orderId: order._id,
      orderLabel: reviewOrderLabel(order),
      tableId: order.tableId,
      tableName: order.tableName || null,
      actor,
      createdAt: Number(order.createdAt || 0),
      kotSentAt: order.kotSentAt || null,
      billPrintedAt: order.billPrintedAt || null,
      cancelledAt: order.cancelledAt || null,
      occurredAt: Number(order.cancelledAt || order.createdAt || 0),
      reason: order.cancellationReason || null,
      amount: Number(order.total || 0),
      itemName: null as string | null,
      voidQty: null as number | null,
    };

    if (orderHadKotSent(order)) {
      items.push({
        ...base,
        id: `cancellation_after_kot:${order._id}`,
        rule: "cancellation_after_kot",
        label: REVIEW_RULE_LABELS.cancellation_after_kot,
        why: REVIEW_RULE_WHY.cancellation_after_kot,
      });
    }
  }

  for (const event of input.voidEvents) {
    if (filter && actorKey(event.actor) !== filter) {
      continue;
    }
    items.push({
      id: `item_void:${event.auditId}`,
      rule: "item_void",
      label: REVIEW_RULE_LABELS.item_void,
      why: REVIEW_RULE_WHY.item_void,
      orderId: event.orderId,
      orderLabel: reviewOrderLabel({
        _id: event.orderId,
        meta: event.meta,
        tableName: event.tableName,
        tableId: event.tableId,
      }),
      tableId: event.tableId ?? null,
      tableName: event.tableName || null,
      actor: event.actor,
      createdAt: Number(event.createdAt || event.timestamp || 0),
      kotSentAt: event.kotSentAt || null,
      occurredAt: Number(event.timestamp || 0),
      cancelledAt: null,
      reason: event.reason || null,
      amount: Number(event.amount || 0),
      itemName: event.itemName || null,
      voidQty: event.voidQty ?? null,
    });
  }

  const discountByOrder = new Map<string, ReviewDiscountEvent>();
  for (const event of input.discountEvents || []) {
    if (filter && actorKey(event.actor) !== filter) {
      continue;
    }
    const nextPercent = Number(event.discountPercent);
    if (!Number.isFinite(nextPercent) || nextPercent <= 0) {
      continue;
    }
    const orderKey = String(event.orderId || "").trim();
    if (!orderKey) {
      continue;
    }
    const existing = discountByOrder.get(orderKey);
    if (!existing || Number(event.timestamp || 0) >= Number(existing.timestamp || 0)) {
      discountByOrder.set(orderKey, event);
    }
  }

  for (const event of discountByOrder.values()) {
    const nextPercent = Number(event.discountPercent);
    items.push({
      id: `discount_applied:${event.auditId}`,
      rule: "discount_applied",
      label: REVIEW_RULE_LABELS.discount_applied,
      why: REVIEW_RULE_WHY.discount_applied,
      orderId: event.orderId,
      orderLabel: reviewOrderLabel({
        _id: event.orderId,
        meta: event.meta,
        tableName: event.tableName,
        tableId: event.tableId,
      }),
      tableId: event.tableId ?? null,
      tableName: event.tableName || null,
      actor: event.actor,
      createdAt: Number(event.createdAt || event.timestamp || 0),
      occurredAt: Number(event.timestamp || 0),
      cancelledAt: null,
      amount: Number(event.amount || 0),
      discountPercent: nextPercent,
      previousDiscountPercent:
        event.previousDiscountPercent != null ? Number(event.previousDiscountPercent) : null,
    });
  }

  return items.sort((a, b) => b.occurredAt - a.occurredAt || a.orderId.localeCompare(b.orderId));
}

export function summarizeReviewItems(
  items: ReviewItemDto[],
): Pick<
  ReviewSummaryDto,
  | "needsReview"
  | "cancellationAfterKot"
  | "repeatedCancellations"
  | "itemVoids"
  | "discountsApplied"
> {
  return {
    needsReview: items.length,
    cancellationAfterKot: items.filter((item) => item.rule === "cancellation_after_kot").length,
    repeatedCancellations: items.filter((item) => item.rule === "repeated_cancellations").length,
    itemVoids: items.filter((item) => item.rule === "item_void").length,
    discountsApplied: items.filter((item) => item.rule === "discount_applied").length,
  };
}

export function reviewCountForRule(
  counts: Pick<
    ReviewSummaryDto,
    "cancellationAfterKot" | "itemVoids" | "discountsApplied" | "repeatedCancellations"
  >,
  rule: ReviewRuleId,
): number {
  if (rule === "cancellation_after_kot") {
    return counts.cancellationAfterKot;
  }
  if (rule === "item_void") {
    return counts.itemVoids;
  }
  if (rule === "discount_applied") {
    return counts.discountsApplied;
  }
  return counts.repeatedCancellations;
}

export function timelineActionLabel(action: string): string {
  return TIMELINE_ACTION_LABELS[action] || action.replace(/^order\./, "").replace(/\./g, " ");
}

function detailObject(detail: unknown): Record<string, unknown> {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return detail as Record<string, unknown>;
  }
  return {};
}

function moneyText(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function timelineItemLine(detail: unknown): string {
  const rec = detailObject(detail);
  if (Array.isArray(rec.names)) {
    return rec.names
      .map((name) => String(name || "").trim())
      .filter(Boolean)
      .join(", ");
  }
  const nested =
    rec.item && typeof rec.item === "object" && !Array.isArray(rec.item)
      ? (rec.item as Record<string, unknown>)
      : rec;
  return namedItem(
    nested.name != null ? String(nested.name) : null,
    nested.qty != null
      ? Number(nested.qty)
      : nested.voidQty != null
        ? Number(nested.voidQty)
        : null,
  );
}

function itemAddLines(detail: unknown): string[] {
  const rec = detailObject(detail);
  if (Array.isArray(rec.names)) {
    return rec.names.map((name) => String(name || "").trim()).filter(Boolean);
  }
  const line = timelineItemLine(detail);
  return line ? [line] : [];
}

export function timelineEventDetail(
  event: Pick<OrderTimelineEventDto, "action" | "detail">,
): string {
  const detail = detailObject(event.detail);
  if (event.action === "item.added") {
    return timelineItemLine(detail);
  }
  if (event.action === "order.discount.updated") {
    const previous = detail.previousDiscountPercent;
    const next = detail.discountPercent;
    if (previous !== undefined && previous !== null && next !== undefined && next !== null) {
      return `${previous}% → ${next}%`;
    }
    if (next !== undefined && next !== null) {
      return `${next}%`;
    }
  }
  if (event.action === "order.kot.void") {
    return [
      namedItem(
        detail.name != null ? String(detail.name) : null,
        detail.voidQty != null ? Number(detail.voidQty) : null,
      ),
      detail.reason ? String(detail.reason) : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (event.action === "order.cancelled" && detail.reason) {
    return String(detail.reason);
  }
  if (event.action === "order.paid" && detail.payment && typeof detail.payment === "object") {
    const payment = detail.payment as Record<string, unknown>;
    return [
      payment.method,
      payment.amount !== undefined && payment.amount !== null
        ? moneyText(Number(payment.amount))
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return "";
}

function highlightActionForRule(rule: ReviewRuleId): string {
  if (rule === "item_void") {
    return "order.kot.void";
  }
  if (rule === "discount_applied") {
    return "order.discount.updated";
  }
  return "order.cancelled";
}

export function isReviewHighlightEvent(
  event: Pick<OrderTimelineEventDto, "action" | "timestamp" | "detail">,
  item: Pick<ReviewItemDto, "rule" | "occurredAt" | "itemName">,
): boolean {
  if (event.action !== highlightActionForRule(item.rule)) {
    return false;
  }
  if (Math.abs(Number(event.timestamp || 0) - Number(item.occurredAt || 0)) <= 5000) {
    return true;
  }
  if (
    item.itemName &&
    timelineItemLine(event.detail).toLowerCase().includes(item.itemName.toLowerCase())
  ) {
    return true;
  }
  return false;
}

export function collapseTimelineEvents(
  events: OrderTimelineEventDto[],
  item?: Pick<ReviewItemDto, "rule" | "occurredAt" | "itemName"> | null,
): ReviewTimelineRow[] {
  const rows: ReviewTimelineRow[] = [];
  for (const event of events) {
    if (!OWNER_TIMELINE_ACTIONS.has(event.action)) {
      continue;
    }
    const prev = rows[rows.length - 1];
    if (
      prev &&
      prev.action === "item.added" &&
      event.action === "item.added" &&
      actorKey(prev.actor) === actorKey(event.actor) &&
      Math.abs(Number(event.timestamp) - Number(prev.timestamp)) <= ITEM_ADD_COLLAPSE_MS
    ) {
      const names = [...new Set([...itemAddLines(prev.detail), ...itemAddLines(event.detail)])];
      prev.detail = names.length ? { names } : prev.detail;
      continue;
    }
    rows.push({ ...event, detail: event.detail });
  }
  return rows.map((row) => ({
    ...row,
    highlight: item ? isReviewHighlightEvent(row, item) : false,
  }));
}

export function timelineForReview(
  events: OrderTimelineEventDto[],
  item: Pick<ReviewItemDto, "rule" | "occurredAt" | "itemName">,
): ReviewTimelineRow[] {
  const rows = collapseTimelineEvents(events, item);
  const paid = events.some((event) => event.action === "order.paid");
  if (item.rule === "cancellation_after_kot" && !paid) {
    rows.push({
      timestamp: item.occurredAt,
      action: "review.unpaid",
      label: "No payment recorded",
      actor: null,
      detail: {},
      highlight: false,
    });
  }
  return rows;
}

export function reviewMilestones(
  item: Pick<
    ReviewItemDto,
    "rule" | "createdAt" | "kotSentAt" | "billPrintedAt" | "cancelledAt" | "occurredAt"
  >,
  events: Array<Pick<OrderTimelineEventDto, "action" | "timestamp">> = [],
): ReviewMilestone[] {
  const kotSentAt =
    item.kotSentAt || events.find((event) => event.action === "order.kot.sent")?.timestamp || null;
  const milestones: ReviewMilestone[] = [];
  if (item.createdAt) {
    milestones.push({ label: "Opened", timestamp: item.createdAt });
  }
  if (kotSentAt) {
    milestones.push({ label: "KOT sent", timestamp: kotSentAt });
  }
  const billPrintedAt =
    item.billPrintedAt ||
    events.find((event) => event.action === "order.bill.printed")?.timestamp ||
    null;
  if (billPrintedAt) {
    milestones.push({ label: "Bill printed", timestamp: billPrintedAt });
  }
  if (item.rule === "item_void" && item.occurredAt) {
    milestones.push({ label: "Voided", timestamp: item.occurredAt });
  }
  if (item.rule === "discount_applied" && item.occurredAt) {
    milestones.push({ label: "Discount", timestamp: item.occurredAt });
  }
  if (item.cancelledAt) {
    milestones.push({ label: "Cancelled", timestamp: item.cancelledAt });
  }
  return milestones;
}
