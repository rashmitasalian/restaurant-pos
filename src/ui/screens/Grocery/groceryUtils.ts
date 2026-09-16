import type { GroceryListStatus, GroceryListType } from "../../../shared/pos";

export type GroceryTab = "lists" | "purchases" | "vendors" | "items";
export type HistoryPreset = "active" | "today" | "7d" | "30d" | "custom";

export const GROCERY_TAB_HASH: Record<GroceryTab, string> = {
  lists: "#manage-grocery-lists",
  purchases: "#manage-grocery-purchases",
  vendors: "#manage-grocery-vendors",
  items: "#manage-grocery-items",
};

export const GROCERY_TABS: Array<{ id: GroceryTab; label: string }> = [
  { id: "lists", label: "Buying Lists" },
  { id: "purchases", label: "Purchases" },
  { id: "vendors", label: "Vendors" },
  { id: "items", label: "Grocery Items" },
];

/** Whole-list purchase sentinel (matches electron/services/posService). */
export const LIST_TOTAL_ITEM_NAME = "Buying List Total";
export const LIST_TOTAL_CATEGORY = "List Total";

export const GROCERY_UNITS = [
  "kg",
  "g",
  "L",
  "ml",
  "unit",
  "packet",
  "box",
  "dozen",
  "bunch",
] as const;
export const GROCERY_PAYMENT_METHODS = ["cash", "upi", "card", "online", "other"] as const;

export function groceryRecordKey(line: { groceryItemId?: string | null; itemName: string }) {
  return `${line.groceryItemId || ""}::${String(line.itemName || "")
    .trim()
    .toLowerCase()}`;
}

export function isListTotalPurchase(purchase: {
  itemName?: string | null;
  category?: string | null;
}) {
  return (
    String(purchase.itemName || "")
      .trim()
      .toLowerCase() === LIST_TOTAL_ITEM_NAME.toLowerCase() &&
    String(purchase.category || "")
      .trim()
      .toLowerCase() === LIST_TOTAL_CATEGORY.toLowerCase()
  );
}

export function parseMoney(value: string) {
  if (value.trim() === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function lineProgress(lines: Array<{ lineStatus?: string | null }>) {
  const actionable = lines.filter((l) => l.lineStatus !== "skipped");
  const purchased = actionable.filter((l) => l.lineStatus === "purchased").length;
  return {
    total: actionable.length,
    purchased,
    pct: actionable.length ? purchased / actionable.length : 0,
  };
}

export function groceryTabFromHash(hash: string): GroceryTab {
  const normalized = String(hash || "").toLowerCase();
  if (normalized.includes("purchase")) {
    return "purchases";
  }
  if (normalized.includes("vendor")) {
    return "vendors";
  }
  if (normalized.includes("item") || normalized.includes("template")) {
    return "items";
  }
  // Insights retired — route old hashes to lists
  if (
    normalized.includes("insight") ||
    normalized.includes("summary") ||
    normalized.includes("spend")
  ) {
    return "lists";
  }
  return "lists";
}

export function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/** Active = last 7 days through +14 days (includes scheduled lists). */
export function getHistoryRange(preset: HistoryPreset): { from: number; to: number } {
  const now = new Date();
  if (preset === "active") {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    const to = new Date(now);
    to.setDate(to.getDate() + 14);
    return { from: startOfDay(from).getTime(), to: endOfDay(to).getTime() };
  }
  if (preset === "7d") {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    return { from: startOfDay(from).getTime(), to: endOfDay(now).getTime() };
  }
  if (preset === "30d") {
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    return { from: startOfDay(from).getTime(), to: endOfDay(now).getTime() };
  }
  return { from: startOfDay(now).getTime(), to: endOfDay(now).getTime() };
}

export function toInputDate(ts: number) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function fromInputDate(value: string, end = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return Date.now();
  }
  return end ? endOfDay(date).getTime() : startOfDay(date).getTime();
}

export function formatCurrency(amount: number) {
  return `₹${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatListTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function formatListDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDayHeading(ts: number) {
  const day = startOfDay(new Date(ts)).getTime();
  const today = startOfDay(new Date()).getTime();
  const yesterday = today - 24 * 60 * 60 * 1000;
  if (day > today) {
    return new Date(ts)
      .toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
      .toUpperCase();
  }
  if (day === today) {
    return "Today";
  }
  if (day === yesterday) {
    return "Yesterday";
  }
  return new Date(ts)
    .toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
}

export function statusLabel(status: GroceryListStatus | string) {
  switch (status) {
    case "draft":
      return "Draft";
    case "open":
      return "Open";
    case "partial":
      return "Partially Purchased";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return String(status);
  }
}

export function statusTone(
  status: GroceryListStatus | string,
): "neutral" | "occupied" | "attention" | "success" | "danger" {
  switch (status) {
    case "completed":
      return "success";
    case "partial":
      return "attention";
    case "cancelled":
      return "danger";
    case "open":
      return "occupied";
    default:
      return "neutral";
  }
}

export function listTypeLabel(type: GroceryListType | string) {
  switch (type) {
    case "refill":
      return "Refill";
    case "emergency":
      return "Emergency";
    case "custom":
      return "Custom";
    default:
      return "Regular";
  }
}

export function suggestListName(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) {
    return "Morning Procurement";
  }
  if (hour < 17) {
    return "Afternoon Refill";
  }
  return "Evening Refill";
}

export function plannedTotal(lines: Array<{ estimatedTotal?: number | null; quantity?: number }>) {
  return lines.reduce((sum, line) => sum + Number(line.estimatedTotal || 0), 0);
}

/** True when at least one line has a usable estimated total. */
export function hasEstimatedCost(lines: Array<{ estimatedTotal?: number | null }>): boolean {
  return lines.some((line) => line.estimatedTotal != null && Number(line.estimatedTotal) > 0);
}

/** Show ₹— when estimates are missing so ₹0 does not read as “nothing planned”. */
export function formatEstimatedAmount(
  amount: number,
  lines: Array<{ estimatedTotal?: number | null }>,
) {
  if (!hasEstimatedCost(lines)) {
    return "₹—";
  }
  return formatCurrency(amount);
}

/**
 * Actual − estimated. Negative = under estimate.
 * Null when there is no estimate to compare against.
 */
export function costVariance(
  estimated: number,
  purchased: number,
  lines: Array<{ estimatedTotal?: number | null }>,
): number | null {
  if (!hasEstimatedCost(lines)) {
    return null;
  }
  return +(purchased - estimated).toFixed(2);
}

export function formatVariance(variance: number | null) {
  if (variance == null) {
    return "—";
  }
  if (variance === 0) {
    return formatCurrency(0);
  }
  const sign = variance > 0 ? "+" : "−";
  return `${sign}${formatCurrency(Math.abs(variance))}`;
}

export function itemsPendingCount(lines: Array<{ lineStatus?: string | null }>) {
  const progress = lineProgress(lines);
  return Math.max(0, progress.total - progress.purchased);
}

/** List fully purchased by item progress (not by rupee remaining). */
export function isFullyPurchased(lines: Array<{ lineStatus?: string | null }>) {
  const progress = lineProgress(lines);
  return progress.total > 0 && progress.purchased >= progress.total;
}
