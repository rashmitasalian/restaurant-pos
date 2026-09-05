import React from "react";
import { ENV } from "../../../config/env";
import {
  createOrder as createPosOrder,
  getActiveOrders,
  getOrderById,
  addItemToOrder,
  getOrCreateOrderForTable,
  getTablesSnapshot,
  setOrderPaid,
  cancelOrder,
  getItems,
  seedItems,
  updateOrderLines,
  setOrderDiscount,
  setOrderStatus,
  markOrderKotFailed,
  markOrderKotSent,
  voidOrderKotLine,
  markOrderBillPrinted,
  getConfigPrinters,
  getConfigGst,
  getConfigBranding,
  nextKotSeq,
  getEnabledServiceModes,
} from "../../../app/db/posRepository";
import {
  DEFAULT_GST_CONFIG,
  calculateGstTotals,
  formatGstRate,
  getOrderGstConfig,
  normalizeGstConfig,
  type GstConfig,
} from "../../../shared/gst";
import { printReceipt, printKOT } from "../../../app/services/printer";
import { logger } from "../../../app/utils/logger";
import { CrashRecovery } from "../../../app/utils/crashRecovery";
import {
  isValidIndianMobile,
  isValidPersonName,
  normalizePhone,
  normalizeText,
  parseNonNegativeMoney,
  validationMessage,
} from "../../../shared/validation";
import { reportClientError } from "../../../app/utils/clientError";
import styles from "./Billing.module.css";
import PaymentsModal, { type PaymentConfirm } from "../../components/PaymentsModal";
import { AuthContext } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import OrderList from "./components/OrderList";
import PickButtons from "./components/PickButtons";
import ItemSearch from "./components/ItemSearch";
import BillingSidebar from "./components/BillingSidebar";
import { BillingMenuBoard, BillingTicketPane } from "./components/BillingPanes";
import { EmptyState } from "../../components/ui/EmptyState";
import { MenuTile } from "../../components/ui/MenuTile";
import { formatKotAge } from "../../../shared/kotAge";
import {
  ConfirmCancelModal,
  KotPreviewModal,
  KotVoidModal,
  NewTakeawayModal,
  NewDeliveryModal,
  AssignRiderModal,
  PrintFailedModal,
  VariantPickerModal,
} from "./components/BillingModals";
import { buildReceiptLines, buildKotLines, buildKotVoidLines } from "./utils/receiptBuilder";
import type { ReceiptBranding } from "./utils/receiptBuilder";
import {
  findServiceModeById,
  getDefaultServiceModes,
  type ServiceMode,
} from "../../../shared/serviceModes";
import {
  resolveCounterPrinterTarget,
  resolveKitchenPrinterTarget,
  samePrinterTarget,
} from "../../../shared/printerConfig";
import { formatTableTileLabel } from "../../../shared/floorLayout";

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_KOT_PRINTER = "kitchen";
const KITCHEN_PRINTER_CACHE_MS = 60_000;
let cachedKitchenPrinter: { value: string; expiresAt: number } | null = null;
let cachedPrinterTargets: { kitchen: string; counter: string; expiresAt: number } | null = null;
const QUICK_FAVORITE_SHORTCUT_LIMIT = 6;
const CATEGORY_VISIBLE = 6;

type KotVoidRequest = {
  lineId: string;
  itemName: string;
  finalQty: number;
  voidQty: number;
};

type VariantSelectionState = {
  item: any;
  quantity: number;
  refocus: boolean;
};

type BillingBusyAction =
  | "payment"
  | "cancel"
  | "voidKot"
  | "delivery"
  | "markReady"
  | "assignRider"
  | "aggregatorPrint"
  | "creatingOrder"
  | "receiptRetry"
  | "printBill";

function computeTotals(ord: any, discountPercent: number, gstConfig: Partial<GstConfig>) {
  return calculateGstTotals(ord?.items || [], discountPercent, getOrderGstConfig(ord, gstConfig));
}

function formatCurrency(v: number) {
  try {
    return new Intl.NumberFormat(ENV.CURRENCY_LOCALE, {
      style: "currency",
      currency: ENV.CURRENCY_CODE,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `₹${Math.round(v * 100) / 100}`;
  }
}

function itemPriceSummary(item: any, formatter: (value: number) => string) {
  const variants = Array.isArray(item?.variants) ? item.variants : [];
  if (!variants.length) {
    return formatter(Number(item?.price || 0));
  }
  const prices = variants
    .map((variant: any) => Number(variant?.price))
    .filter((price: number) => Number.isFinite(price) && price > 0);
  if (!prices.length) {
    return formatter(Number(item?.price || 0));
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) {
    return formatter(min);
  }
  return `${formatter(min)} - ${formatter(max)}`;
}

function extractVariantNameFromLine(lineName: string, baseName?: string) {
  const name = String(lineName || "").trim();
  const base = String(baseName || "").trim();
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = base ? new RegExp(`^${escapedBase}\\s*\\(([^)]+)\\)\\s*$`, "i") : null;
  const match = pattern ? pattern.exec(name) : null;
  return match?.[1]?.trim() || "";
}

function normalizeModeId(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

function deriveOrderType(order: any, tableNum: number | null): string {
  if (!order) {
    return "table";
  }
  if (order.orderType) {
    return normalizeModeId(order.orderType) || "table";
  }
  const meta = order.meta || {};
  const p = (meta.platform || meta.orderSource || meta.source || "").toString().toLowerCase();
  if (p.includes("swiggy") || p.includes("zomato")) {
    return "delivery";
  }
  if (tableNum) {
    return "table";
  }
  return "takeaway";
}

function getUnsentKotItems(orderData: any) {
  return (orderData?.items || [])
    .map((it: any) => {
      const qty = Number(it.qty || 0);
      const printedQty = Math.max(0, Number(it.kotPrintedQty || 0));
      const pendingQty = Math.max(0, qty - printedQty);
      return pendingQty > 0
        ? {
            ...it,
            qty: pendingQty,
            sentQty: printedQty + pendingQty,
          }
        : null;
    })
    .filter(Boolean);
}

function applyKotSentLocally(orderData: any, sentLines: Array<{ id: string; sentQty: number }>) {
  const requested = new Map(
    (sentLines || [])
      .map((line) => [String(line.id || ""), Math.max(0, Number(line.sentQty) || 0)] as const)
      .filter(([id, sentQty]) => Boolean(id) && sentQty > 0),
  );
  if (!orderData || requested.size === 0) {
    return orderData;
  }
  return {
    ...orderData,
    kotStatus: "sent",
    kotSent: true,
    items: (orderData.items || []).map((line: any) => {
      const requestedQty = requested.get(line.id);
      if (requestedQty === undefined) {
        return line;
      }
      const qty = Math.max(0, Number(line.qty || 0));
      const currentSentQty = Math.max(0, Number(line.kotPrintedQty || 0));
      return {
        ...line,
        kotPrintedQty: Math.min(qty, Math.max(currentSentQty, requestedQty)),
      };
    }),
  };
}

function buildKotPreview(
  orderData: any,
  tableNum: number | null,
  items: any[],
  sentBy?: string,
  kotSeqNum?: number,
) {
  const meta = orderData?.meta || {};
  const platformRaw = (meta.platform || meta.orderSource || meta.source || "").toString();
  const orderType = deriveOrderType(orderData, tableNum);
  return {
    kotId: kotSeqNum ? String(kotSeqNum) : `KOT-${String(Date.now()).slice(-6)}`,
    orderType,
    platform: platformRaw,
    platformCode: meta.code || meta.orderCode || meta.reference || "",
    customerName: meta.parcelName || meta.customerName || "",
    customerPhone: meta.customerPhone || "",
    items,
    tableNum,
    sentBy,
  };
}

function modeOrderLabel(mode: ServiceMode | null | undefined, orderData: any) {
  if (!mode) {
    return "Order";
  }
  if (mode.id === "delivery") {
    const platform = orderData?.meta?.platform || orderData?.meta?.orderSource || "Delivery";
    const code = orderData?.meta?.code ? ` #${orderData.meta.code}` : "";
    return `${platform}${code}`;
  }
  if (mode.id === "takeaway") {
    return orderData?.meta?.parcelName || orderData?.meta?.customerName || mode.name;
  }
  return mode.name;
}

function paymentFlowLabel(mode: ServiceMode | null | undefined) {
  const flow = mode?.paymentPrintSequence || "bill_only";
  if (flow === "kot_then_bill") {
    return "KOT -> Bill";
  }
  if (flow === "bill_then_kot") {
    return "Bill -> KOT";
  }
  return "Bill";
}

async function resolvePrinterTargets() {
  const now = Date.now();
  if (cachedPrinterTargets && cachedPrinterTargets.expiresAt > now) {
    return cachedPrinterTargets;
  }
  try {
    const cfg = await getConfigPrinters();
    const targets = {
      kitchen: resolveKitchenPrinterTarget(cfg),
      counter: resolveCounterPrinterTarget(cfg),
      expiresAt: now + KITCHEN_PRINTER_CACHE_MS,
    };
    cachedPrinterTargets = targets;
    return targets;
  } catch {
    return {
      kitchen: resolveKitchenPrinterTarget(null),
      counter: resolveCounterPrinterTarget(null),
      expiresAt: now + KITCHEN_PRINTER_CACHE_MS,
    };
  }
}

async function resolveKitchenPrinter() {
  const now = Date.now();
  if (cachedKitchenPrinter && cachedKitchenPrinter.expiresAt > now) {
    return cachedKitchenPrinter.value;
  }
  try {
    const cfg = await getConfigPrinters();
    const value = cfg?.kitchenPrinterIp?.trim() || DEFAULT_KOT_PRINTER;
    cachedKitchenPrinter = { value, expiresAt: now + KITCHEN_PRINTER_CACHE_MS };
    return value;
  } catch {
    return DEFAULT_KOT_PRINTER;
  }
}

async function printKOTDirect(data: { lines: string[]; printer: string }) {
  const result = await window.pos?.print?.({ type: "kot", data, printer: data.printer });
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Print failed");
  }
  return result;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function Billing() {
  const { showToast } = useToast();
  const auth = React.useContext(AuthContext);

  // ── Core state ──────────────────────────────────────────────────────────
  const [order, setOrder] = React.useState<any>(null);
  const [tableNum, setTableNum] = React.useState<number | null>(null);
  const [items, setItems] = React.useState<any[]>([]);
  const [menuCategory, setMenuCategory] = React.useState("favorites");
  const [categoryMoreOpen, setCategoryMoreOpen] = React.useState(false);
  const [qty, setQty] = React.useState(1);
  const [lastAddedId, setLastAddedId] = React.useState<string | null>(null);
  const [discountPercent, setDiscountPercent] = React.useState(0);
  const [gstConfig, setGstConfig] = React.useState(() => normalizeGstConfig(DEFAULT_GST_CONFIG));
  const [branding, setBranding] = React.useState<ReceiptBranding | null>(null);

  // ── Sidebar state ───────────────────────────────────────────────────────
  const [tablesOpen, setTablesOpen] = React.useState(() => {
    try {
      if (typeof window === "undefined") {
        return true;
      }
      // Default expanded. Only collapse when the cashier previously hid it.
      return window.localStorage.getItem("tablesOpen") !== "0";
    } catch {
      return true;
    }
  });
  const setTablesOpenPersisted = (val: boolean) => {
    setTablesOpen(val);
    try {
      window.localStorage.setItem("tablesOpen", val ? "1" : "0");
    } catch {}
  };
  const [serviceModes, setServiceModes] = React.useState<ServiceMode[]>(() =>
    getDefaultServiceModes().filter((mode) => mode.enabled),
  );
  const [view, setView] = React.useState<string>("table");
  const [modeOrders, setModeOrders] = React.useState<Record<string, any[]>>({});
  const [tableAreas, setTableAreas] = React.useState<Array<{ id: string; name: string; active?: boolean }>>([]);
  const [selectedAreaId, setSelectedAreaId] = React.useState<string>(() => {
    try {
      return window.localStorage.getItem("billingSelectedArea") || "area:main";
    } catch {
      return "area:main";
    }
  });
  const [tablesByArea, setTablesByArea] = React.useState<
    Record<
      string,
      Array<{
        id: number;
        name?: string;
        status?: string;
        occupied?: boolean;
        count?: number;
        total?: number;
        seats?: number;
        openedAt?: number | null;
        unsentCount?: number;
        sentCount?: number;
      }>
    >
  >({});

  React.useEffect(() => {
    try {
      window.localStorage.setItem("billingSelectedArea", selectedAreaId || "area:main");
    } catch {}
  }, [selectedAreaId]);

  React.useEffect(() => {
    if (!categoryMoreOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCategoryMoreOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [categoryMoreOpen]);

  // ── Modal state ─────────────────────────────────────────────────────────
  const [payModalOpen, setPayModalOpen] = React.useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = React.useState(false);
  const [kotPreviewOpen, setKotPreviewOpen] = React.useState(false);
  const [kotPreviewData, setKotPreviewData] = React.useState<any>(null);
  const [kotPrinting, setKotPrinting] = React.useState(false);
  const [kotVoidRequest, setKotVoidRequest] = React.useState<KotVoidRequest | null>(null);
  const kotPrintingRef = React.useRef(false);
  const [newTakeawayOpen, setNewTakeawayOpen] = React.useState(false);
  const [newTakeawayName, setNewTakeawayName] = React.useState("");
  const [newTakeawayPhone, setNewTakeawayPhone] = React.useState("");
  const [customerModeId, setCustomerModeId] = React.useState<string>("takeaway");
  const [newDeliveryOpen, setNewDeliveryOpen] = React.useState(false);
  const [newDeliveryPlatform, setNewDeliveryPlatform] = React.useState("Swiggy");
  const [newDeliveryCode, setNewDeliveryCode] = React.useState("");
  const [newDeliveryName, setNewDeliveryName] = React.useState("");
  const [newDeliveryPhone, setNewDeliveryPhone] = React.useState("");
  const [assignRiderOpen, setAssignRiderOpen] = React.useState(false);
  const [riderName, setRiderName] = React.useState("");
  const [riderPhone, setRiderPhone] = React.useState("");
  const [printFailed, setPrintFailed] = React.useState<{
    amount: string;
    method: string;
    retry: () => void;
    finish: () => void;
  } | null>(null);
  const [variantSelection, setVariantSelection] = React.useState<VariantSelectionState | null>(
    null,
  );

  const [busyActions, setBusyActions] = React.useState<Partial<Record<BillingBusyAction, boolean>>>(
    {},
  );
  const busyActionsRef = React.useRef(new Set<BillingBusyAction>());

  const beginBusyAction = React.useCallback((action: BillingBusyAction) => {
    if (busyActionsRef.current.has(action)) {
      return false;
    }
    busyActionsRef.current.add(action);
    setBusyActions((current) => ({ ...current, [action]: true }));
    return true;
  }, []);

  const endBusyAction = React.useCallback((action: BillingBusyAction) => {
    busyActionsRef.current.delete(action);
    setBusyActions((current) => {
      const next = { ...current };
      delete next[action];
      return next;
    });
  }, []);

  // ── Inline editing state ────────────────────────────────────────────────
  const [editingQty, setEditingQty] = React.useState<Record<string, string>>({});
  const [editingRate, setEditingRate] = React.useState<Record<string, string>>({});

  const searchRef = React.useRef<HTMLInputElement | null>(null);
  // Always holds the latest loadTable so the select-table event listener
  // (registered once on mount) never calls a stale closure.
  const loadTableRef = React.useRef<(tn: number) => Promise<void>>(async () => {});

  // ── Derived values ──────────────────────────────────────────────────────
  const activeOrderType = deriveOrderType(order, tableNum);
  const activeMode =
    findServiceModeById({ modes: serviceModes }, activeOrderType) ||
    findServiceModeById({ modes: getDefaultServiceModes() }, activeOrderType);
  const activeTableLabel = React.useMemo(() => {
    if (tableNum === null) {
      return "";
    }
    for (const tables of Object.values(tablesByArea)) {
      const match = tables.find((table) => table.id === tableNum);
      if (match) {
        return formatTableTileLabel(tableNum, match.name);
      }
    }
    return formatTableTileLabel(tableNum);
  }, [tableNum, tablesByArea]);
  const currentUserLabel =
    auth?.session?.displayName || auth?.session?.username || order?.createdBy || "";
  const totals = computeTotals(order, discountPercent, gstConfig);
  const subtotal = totals.itemSubtotal;
  const cgst = totals.cgst;
  const sgst = totals.sgst;
  const taxTotal = totals.taxTotal;
  const discountAmt = totals.discountTotal;
  const finalTotal = totals.total;
  const gstEnabled = totals.gstEnabled && taxTotal > 0;
  const gstHalfPct = formatGstRate(totals.gstHalfRateBps);
  const favorites = React.useMemo(
    () => (items || []).filter((it) => it.favorite === true && it.available !== false),
    [items],
  );
  const menuCategories = React.useMemo(() => {
    const cats = new Set<string>();
    for (const it of items || []) {
      if (it.available === false) {
        continue;
      }
      const category = String(it.category || "").trim();
      if (category) {
        cats.add(category);
      }
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [items]);
  const visibleMenuItems = React.useMemo(() => {
    const available = (items || []).filter((it) => it.available !== false);
    if (menuCategory === "favorites") {
      return available.filter((it) => it.favorite === true);
    }
    if (menuCategory === "all") {
      return available;
    }
    return available.filter((it) => String(it.category || "").trim() === menuCategory);
  }, [items, menuCategory]);
  const quickFavoriteShortcuts = React.useMemo(
    () => favorites.slice(0, QUICK_FAVORITE_SHORTCUT_LIMIT),
    [favorites],
  );
  const visibleCategories = React.useMemo(
    () => menuCategories.slice(0, CATEGORY_VISIBLE),
    [menuCategories],
  );
  const overflowCategories = React.useMemo(
    () => menuCategories.slice(CATEGORY_VISIBLE),
    [menuCategories],
  );
  const menuItemsById = React.useMemo(() => {
    const map: Record<string, any> = {};
    for (const item of items || []) {
      if (item?._id) {
        map[item._id] = item;
      }
    }
    return map;
  }, [items]);
  const hasItems = Boolean(order && (order.items || []).length > 0);
  const unsentKotItems = React.useMemo(() => getUnsentKotItems(order), [order]);
  const isPaid = order?.status === "paid";
  const canCancel = hasItems && !isPaid;
  const allowsManualKot = Boolean(activeMode?.supportsKOT) && !Boolean(activeMode?.immediateBilling);
  const allowsManualBillPrint = !Boolean(activeMode?.immediateBilling);
  const supportsMarkReady =
    Boolean(activeMode?.supportsOpenOrders) &&
    !Boolean(activeMode?.immediateBilling) &&
    !Boolean(activeMode?.requiresTable);
  const canKot =
    allowsManualKot &&
    hasItems &&
    !isPaid &&
    unsentKotItems.length > 0 &&
    !kotPrinting &&
    !kotPreviewOpen;
  // Delivery orders are paid through the aggregator app — no in-POS payment needed
  const canPay = hasItems && !isPaid && !activeMode?.externalPayment;
  const requiresOnPayPrintFlow =
    Boolean(activeMode?.immediateBilling) ||
    (Boolean(activeMode?.supportsKOT) &&
      (activeMode?.paymentPrintSequence || "bill_only") !== "bill_only");
  const showPaymentFlowHint =
    canPay &&
    Boolean(activeMode?.supportsKOT) &&
    activeMode?.paymentPrintSequence &&
    activeMode.paymentPrintSequence !== "bill_only";
  const paymentProcessing = Boolean(busyActions.payment);
  const cancelProcessing = Boolean(busyActions.cancel);
  const voidKotProcessing = Boolean(busyActions.voidKot);
  const deliveryProcessing = Boolean(busyActions.delivery);
  const markReadyProcessing = Boolean(busyActions.markReady);
  const assignRiderProcessing = Boolean(busyActions.assignRider);
  const aggregatorPrinting = Boolean(busyActions.aggregatorPrint);
  const creatingOrder = Boolean(busyActions.creatingOrder);
  const receiptRetrying = Boolean(busyActions.receiptRetry);
  const canStartPayment = canPay && !paymentProcessing && !payModalOpen;
  const canStartCancel = canCancel && !cancelProcessing;
  const billPrinting = Boolean(busyActions.printBill);
  const canPrintBill = allowsManualBillPrint && hasItems && !isPaid && !billPrinting;

  const persistDiscountIfNeeded = React.useCallback(
    async (nextPercent = discountPercent) => {
      if (!order || order.status === "paid" || order.status === "cancelled") {
        return order;
      }
      const safePercent = Math.max(0, Math.min(100, Number(nextPercent || 0)));
      if (Number(order.discountPercent || 0) === safePercent) {
        return order;
      }
      const updated = await setOrderDiscount(order._id, safePercent);
      setOrder(updated);
      setDiscountPercent(Number(updated.discountPercent || 0));
      return updated;
    },
    [order, discountPercent],
  );

  // ── Data loading ────────────────────────────────────────────────────────
  const loadQueues = React.useCallback(async () => {
    try {
      const orders = await getActiveOrders();
      const grouped: Record<string, any[]> = {};
      for (const candidate of orders) {
        const modeId = deriveOrderType(candidate, candidate?.tableId ?? null);
        grouped[modeId] = grouped[modeId] || [];
        grouped[modeId].push(candidate);
      }
      setModeOrders(grouped);
    } catch (e) {
      logger.error("Billing: failed to load queues", e as Error);
      setModeOrders({});
    }
  }, []);

  const loadServiceModeConfig = React.useCallback(async () => {
    try {
      const enabled = await getEnabledServiceModes();
      const next = enabled.length ? enabled : getDefaultServiceModes().filter((mode) => mode.enabled);
      setServiceModes(next);
      setView((current) => {
        if (next.some((mode) => mode.id === current)) {
          return current;
        }
        return next[0]?.id || "table";
      });
    } catch {
      const fallback = getDefaultServiceModes().filter((mode) => mode.enabled);
      setServiceModes(fallback);
      setView((current) => (fallback.some((mode) => mode.id === current) ? current : "table"));
    }
  }, []);

  const loadTableSnapshot = React.useCallback(async () => {
    try {
      const snapshot = await getTablesSnapshot();
      const activeAreas = (snapshot.areas || []).filter((area) => area.active !== false);
      setTableAreas(activeAreas.map((area) => ({ id: area.id, name: area.name, active: area.active })));
      const grouped: Record<
        string,
        Array<{
          id: number;
          name?: string;
          status?: string;
          occupied?: boolean;
          count?: number;
          total?: number;
          seats?: number;
          openedAt?: number | null;
          unsentCount?: number;
          sentCount?: number;
        }>
      > = {};
      for (const area of activeAreas) {
        grouped[area.id] = [];
      }
      for (const table of snapshot.tables || []) {
        const areaId = String(table.areaId || "area:main");
        grouped[areaId] = grouped[areaId] || [];
        const count = Number(table.count || 0);
        const occupied = Boolean((table as { occupied?: boolean }).occupied) || count > 0;
        grouped[areaId].push({
          id: table.id,
          name: table.name,
          status: table.status || "",
          occupied,
          count,
          total: Number(table.total || 0),
          seats: Number((table as { seats?: number }).seats || 0) || undefined,
          openedAt: occupied
            ? Number((table as { openedAt?: number }).openedAt || 0) || null
            : null,
          unsentCount: Number(table.unsentCount || 0),
          sentCount: Number(table.sentCount || 0),
        });
      }
      setTablesByArea(grouped);
      setSelectedAreaId((current) => {
        if (current && grouped[current]) {
          return current;
        }
        const currentTableArea =
          tableNum !== null
            ? (snapshot.tables || []).find((table) => table.id === tableNum)?.areaId || null
            : null;
        if (currentTableArea && grouped[currentTableArea]) {
          return currentTableArea;
        }
        return activeAreas[0]?.id || "area:main";
      });
    } catch (e) {
      logger.error("Billing: failed to load table snapshot", e as Error);
      setTablesByArea({});
    }
  }, [tableNum]);

  React.useEffect(() => {
    loadQueues();
    loadServiceModeConfig();
    loadTableSnapshot();
    const h = () => loadQueues();
    const hs = () => loadServiceModeConfig();
    const ht = () => loadTableSnapshot();
    window.addEventListener("orders-changed", h);
    window.addEventListener("service-modes-changed", hs);
    window.addEventListener("seating-areas-changed", ht);
    return () => {
      window.removeEventListener("orders-changed", h);
      window.removeEventListener("service-modes-changed", hs);
      window.removeEventListener("seating-areas-changed", ht);
    };
  }, [loadQueues, loadServiceModeConfig, loadTableSnapshot]);

  React.useEffect(() => {
    loadTableSnapshot();
    const h = () => loadTableSnapshot();
    window.addEventListener("orders-changed", h);
    return () => window.removeEventListener("orders-changed", h);
  }, [loadTableSnapshot]);

  // ── Initial load ────────────────────────────────────────────────────────
  React.useEffect(() => {
    const loadGst = async () => {
      try {
        setGstConfig(normalizeGstConfig(await getConfigGst()));
      } catch {
        setGstConfig(normalizeGstConfig(DEFAULT_GST_CONFIG));
      }
    };
    const loadBranding = async () => {
      try {
        setBranding(await getConfigBranding());
      } catch {
        setBranding(null);
      }
    };
    loadGst();
    loadBranding();
    window.addEventListener("orders-changed", loadGst);
    window.addEventListener("branding-changed", loadBranding);
    return () => {
      window.removeEventListener("orders-changed", loadGst);
      window.removeEventListener("branding-changed", loadBranding);
    };
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        // Load items first so favorites render immediately alongside the order
        await seedItems();
        setItems(await getItems());
        await loadTableSnapshot();
      } catch (e) {
        logger.error("Billing: failed to load items/config on mount", e as Error);
      }

      const tableStr = window.localStorage.getItem("currentTable");
      const orderId = window.localStorage.getItem("currentOrderId");
      try {
        if (orderId) {
          const o = await getOrderById(orderId);
          if (o && o.status === "paid") {
            // Payment succeeded previously (even if it appeared to fail).
            // Clear stale session references so Billing starts fresh.
            window.localStorage.removeItem("currentOrderId");
            window.localStorage.removeItem("currentTable");
          } else {
            setOrder(o);
            if (tableStr) {
              setTableNum(parseInt(tableStr, 10));
              setView("table");
            } else if (o) {
              setTableNum(null);
              setView(deriveOrderType(o, null));
              setDiscountPercent(Number(o.discountPercent || 0));
            }
          }
        } else if (tableStr) {
          const tn = parseInt(tableStr, 10);
          const o = await getOrCreateOrderForTable(tn);
          setOrder(o);
          setTableNum(tn);
          window.localStorage.setItem("currentOrderId", o._id);
        }
      } catch (e) {
        logger.error("Billing: failed to restore session order on mount", e as Error);
        // Clear stale references so Billing starts fresh rather than staying stuck.
        window.localStorage.removeItem("currentOrderId");
        window.localStorage.removeItem("currentTable");
      }
    })();
  }, [loadTableSnapshot]);

  // Listen for select-table events (fired by App.tsx when a table is chosen from the Tables tab)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.table) {
        loadTableRef.current(detail.table);
      }
    };
    window.addEventListener("select-table", handler);
    return () => window.removeEventListener("select-table", handler);
  }, []);

  // ── Order actions ───────────────────────────────────────────────────────
  const loadTable = async (tn: number) => {
    // Clear immediately so UI doesn't flash the previous table's order
    setOrder(null);
    setTableNum(tn);
    setDiscountPercent(0);
    try {
      const o = await getOrCreateOrderForTable(tn);
      setOrder(o);
      window.localStorage.setItem("currentOrderId", o._id);
      window.localStorage.setItem("currentTable", String(tn));
      CrashRecovery.saveState({
        currentOrderId: o._id,
        currentTable: tn,
        cartItems: o?.items || [],
        discountPercent: o?.discountPercent || 0,
      });
      const matchingAreaId = Object.entries(tablesByArea).find(([, list]) =>
        list.some((entry) => entry.id === tn),
      )?.[0];
      if (matchingAreaId) {
        setSelectedAreaId(matchingAreaId);
      }
      setTimeout(() => searchRef.current?.focus(), 10);
      setTimeout(() => loadTableSnapshot(), 50);
    } catch (error) {
      logger.error("Failed to load table", error as Error, { tableNumber: tn });
    }
  };
  // Keep the ref in sync so the select-table event handler always calls
  // the latest version (which closes over the current table snapshot state).
  loadTableRef.current = loadTable;

  const addToOrder = async (
    item: any,
    quantity = 1,
    refocus = true,
    selectedVariant?: { id?: string; name: string; price: number },
  ) => {
    if (!order) {
      showToast("Open or select a table first", "error");
      return;
    }
    const variants = Array.isArray(item?.variants) ? item.variants : [];
    if (!selectedVariant && variants.length > 0) {
      setVariantSelection({ item, quantity, refocus });
      return;
    }
    const lineName = selectedVariant ? `${item.name} (${selectedVariant.name})` : item.name;
    const lineRate = selectedVariant ? Number(selectedVariant.price) : Number(item.price);
    try {
      const res = await addItemToOrder(order._id, {
        menuItemId: item._id || null,
        name: lineName,
        categoryName: item.category || null,
        qty: quantity,
        rate: lineRate,
      });
      setOrder(res);
      // find the item by name (may have been merged, not necessarily the last row)
      const addedLine = [...(res.items || [])]
        .reverse()
        .find((l: any) => l.name.toLowerCase() === lineName.toLowerCase());
      setLastAddedId(addedLine?.id ?? null);
      window.dispatchEvent(new Event("orders-changed"));
      setVariantSelection(null);
      if (refocus) {
        setTimeout(() => searchRef.current?.focus(), 10);
      }
    } catch (e: any) {
      logger.error("Failed to add item", e);
      showToast(reportClientError("billing.add-item", e, "Failed to add item"), "error");
    }
  };

  const openKotVoidRequest = (line: any, finalQty: number) => {
    const sentQty = Math.max(0, Number(line?.kotPrintedQty || 0));
    const safeFinalQty = Math.max(0, Number(finalQty) || 0);
    const voidQty = sentQty - safeFinalQty;
    if (voidQty <= 0) {
      return false;
    }
    setKotVoidRequest({
      lineId: line.id,
      itemName: line.name,
      finalQty: safeFinalQty,
      voidQty,
    });
    return true;
  };

  const removeLine = async (lineId: string) => {
    if (!order) {
      return false;
    }
    const line = order.items.find((candidate: any) => candidate.id === lineId);
    if (line && openKotVoidRequest(line, 0)) {
      return false;
    }
    const doRemove = async () => {
      try {
        const updated = await updateOrderLines(
          order._id,
          order.items.filter((l: any) => l.id !== lineId),
        );
        setOrder(updated);
        window.dispatchEvent(new Event("orders-changed"));
      } catch (e: any) {
        logger.error("Failed to remove order line", e);
        showToast(reportClientError("billing.remove-item", e, "Failed to remove item"), "error");
      }
    };
    await doRemove();
    return true;
  };

  const updateOrderQty = async (id: string, delta: number) => {
    if (!order) {
      return;
    }
    const line = order.items.find((candidate: any) => candidate.id === id);
    if (!line) {
      return;
    }
    const nextQty = Math.max(1, Number(line.qty || 1) + delta);
    if (delta < 0 && openKotVoidRequest(line, nextQty)) {
      return;
    }
    const doUpdate = async () => {
      try {
        const updated = await updateOrderLines(
          order._id,
          order.items.map((l: any) => (l.id === id ? { ...l, qty: nextQty } : l)),
        );
        setOrder(updated);
        window.dispatchEvent(new Event("orders-changed"));
        setTimeout(() => searchRef.current?.focus(), 10);
      } catch (e: any) {
        logger.error("Failed to update order quantity", e);
        showToast(reportClientError("billing.update-qty", e, "Failed to update quantity"), "error");
      }
    };
    await doUpdate();
  };

  const commitQty = async (id: string) => {
    if (!order) {
      return;
    }
    const rawQty = Number(String(editingQty[id] ?? "").trim());
    if (!Number.isInteger(rawQty) || rawQty < 1) {
      showToast(validationMessage("qty-invalid"), "error");
      return;
    }
    const line = order.items.find((candidate: any) => candidate.id === id);
    if (line && openKotVoidRequest(line, rawQty)) {
      return;
    }
    const doCommit = async () => {
      try {
        const updated = await updateOrderLines(
          order._id,
          order.items.map((l: any) => (l.id === id ? { ...l, qty: rawQty } : l)),
        );
        setOrder(updated);
        setEditingQty((prev) => {
          const c = { ...prev };
          delete c[id];
          return c;
        });
        window.dispatchEvent(new Event("orders-changed"));
        setTimeout(() => searchRef.current?.focus(), 10);
      } catch (e: any) {
        logger.error("Failed to save order quantity", e);
        showToast(reportClientError("billing.save-qty", e, "Failed to save quantity"), "error");
      }
    };
    await doCommit();
  };

  const commitRate = async (id: string) => {
    if (!order) {
      return;
    }
    const parsed = parseNonNegativeMoney(editingRate[id]);
    if (parsed === null) {
      showToast(validationMessage("rate-invalid"), "error");
      return;
    }
    try {
      const updated = await updateOrderLines(
        order._id,
        order.items.map((l: any) => (l.id === id ? { ...l, rate: parsed } : l)),
      );
      setOrder(updated);
      setEditingRate((prev) => {
        const c = { ...prev };
        delete c[id];
        return c;
      });
      window.dispatchEvent(new Event("orders-changed"));
      setTimeout(() => searchRef.current?.focus(), 10);
    } catch (e: any) {
      logger.error("Failed to save order rate", e);
      showToast(reportClientError("billing.save-rate", e, "Failed to save rate"), "error");
    }
  };

  const changeLineVariant = async (lineId: string, variantName: string) => {
    if (!order) {
      return;
    }
    const line = (order.items || []).find((candidate: any) => candidate.id === lineId);
    if (!line || !line.menuItemId) {
      return;
    }
    if (Math.max(0, Number(line.kotPrintedQty || 0)) > 0) {
      showToast("Sent kitchen items cannot switch variant. Void and re-add this item.", "error");
      return;
    }
    const menuItem = menuItemsById[line.menuItemId];
    const variants = Array.isArray(menuItem?.variants) ? menuItem.variants : [];
    const nextVariant = variants.find(
      (variant: any) => String(variant?.name || "").toLowerCase() === variantName.toLowerCase(),
    );
    if (!nextVariant) {
      return;
    }
    const nextLineName = `${menuItem.name} (${nextVariant.name})`;
    const nextRate = Number(nextVariant.price);
    if (line.name === nextLineName && Number(line.rate) === nextRate) {
      return;
    }
    try {
      const mergeTarget = (order.items || []).find(
        (entry: any) =>
          entry.id !== lineId &&
          String(entry.name || "").toLowerCase() === nextLineName.toLowerCase() &&
          Number(entry.rate) === nextRate &&
          String(entry.menuItemId || "") === String(line.menuItemId || ""),
      );

      const nextLines = mergeTarget
        ? order.items
            .map((entry: any) => {
              if (entry.id === mergeTarget.id) {
                return { ...entry, qty: Number(entry.qty || 0) + Number(line.qty || 0) };
              }
              return entry;
            })
            .filter((entry: any) => entry.id !== lineId)
        : order.items.map((entry: any) =>
            entry.id === lineId ? { ...entry, name: nextLineName, rate: nextRate } : entry,
          );

      const updated = await updateOrderLines(
        order._id,
        nextLines,
      );
      setOrder(updated);
      window.dispatchEvent(new Event("orders-changed"));
      setTimeout(() => searchRef.current?.focus(), 10);
    } catch (e: any) {
      logger.error("Failed to switch line variant", e);
      showToast(reportClientError("billing.switch-variant", e, "Failed to switch variant"), "error");
    }
  };

  const undoLast = async () => {
    if (!order || !lastAddedId) {
      return;
    }
    const removed = await removeLine(lastAddedId);
    if (removed) {
      setLastAddedId(null);
    }
  };

  // ── Order creation ──────────────────────────────────────────────────────
  const createStandaloneOrder = async (
    serviceModeId: string,
    meta: Record<string, any>,
  ) => {
    if (!beginBusyAction("creatingOrder")) {
      return null;
    }
    try {
      const selectedMode =
        findServiceModeById({ modes: serviceModes }, serviceModeId) ||
        findServiceModeById({ modes: getDefaultServiceModes() }, serviceModeId);
      const fresh = await createPosOrder({
        tableId: null,
        orderType: serviceModeId,
        serviceModeId,
        customerId: meta.customerId || null,
        meta: {
          ...meta,
          serviceModeId,
          modeSnapshot: selectedMode
            ? {
                name: selectedMode.name,
                requiresCustomer: selectedMode.requiresCustomer,
                supportsKOT: selectedMode.supportsKOT,
                immediateBilling: selectedMode.immediateBilling,
                externalPayment: selectedMode.externalPayment,
                paymentPrintSequence: selectedMode.paymentPrintSequence,
              }
            : undefined,
        },
      });
      const id = fresh._id;
      setOrder(fresh);
      setTableNum(null);
      window.localStorage.setItem("currentOrderId", id);
      window.localStorage.removeItem("currentTable");
      CrashRecovery.saveState({ currentOrderId: id, cartItems: [], discountPercent: 0 });
      window.dispatchEvent(new Event("orders-changed"));
      setTimeout(() => searchRef.current?.focus(), 50);
      return fresh;
    } catch (error) {
      logger.error(`Failed to create ${serviceModeId} order`, error as Error);
      showToast(`Failed to create ${serviceModeId} order`, "error");
      return null;
    } finally {
      endBusyAction("creatingOrder");
    }
  };

  const resolveTakeawayCustomer = async () => {
    const phone = normalizePhone(newTakeawayPhone);
    if (!phone) {
      return null;
    }
    if (!isValidIndianMobile(phone)) {
      showToast(validationMessage("customer-phone-invalid"), "error");
      return undefined;
    }

    const name = normalizeText(newTakeawayName) || "Walk-in";
    const customers = (await window.pos?.customers?.list?.()) || [];
    const existing = customers.find((customer: any) => customer.phone === phone);
    if (existing) {
      return existing;
    }

    try {
      return await window.pos?.customers?.create?.({ name, phone });
    } catch (error: any) {
      if (String(error?.message || error).includes("customer-phone-duplicate")) {
        const latest = (await window.pos?.customers?.list?.()) || [];
        return latest.find((customer: any) => customer.phone === phone) || null;
      }
      throw error;
    }
  };

  const createCustomerModeOrder = async () => {
    const enteredName = normalizeText(newTakeawayName);
    if (enteredName && !isValidPersonName(enteredName)) {
      showToast(validationMessage("customer-name-invalid"), "error");
      return;
    }
    const selectedMode = findServiceModeById({ modes: serviceModes }, customerModeId);
    if (selectedMode?.requiresCustomer && !enteredName && !normalizePhone(newTakeawayPhone)) {
      showToast("Customer name or phone is required for this service mode", "error");
      return;
    }
    let customer: any = null;
    try {
      customer = await resolveTakeawayCustomer();
    } catch (error: any) {
      showToast(reportClientError("billing.save-customer", error, "Could not save customer"), "error");
      return;
    }
    if (customer === undefined) {
      return;
    }
    const takeawayName = enteredName || customer?.name || "";
    const created = await createStandaloneOrder(customerModeId, {
      customerName: takeawayName,
      customerPhone: normalizePhone(newTakeawayPhone),
      customerId: customer?.id || null,
    });
    if (!created) {
      return;
    }
    setNewTakeawayOpen(false);
    setNewTakeawayName("");
    setNewTakeawayPhone("");
  };

  const createDeliveryOrder = async () => {
    const platform = normalizeText(newDeliveryPlatform);
    if (!platform || platform.toLowerCase() === "other") {
      showToast(validationMessage("delivery-platform-required"), "error");
      return;
    }
    const customerName = normalizeText(newDeliveryName);
    const customerPhone = normalizePhone(newDeliveryPhone);
    if (customerName && !isValidPersonName(customerName)) {
      showToast(validationMessage("customer-name-invalid"), "error");
      return;
    }
    if (customerPhone && !isValidIndianMobile(customerPhone)) {
      showToast(validationMessage("customer-phone-invalid"), "error");
      return;
    }
    const code = normalizeText(newDeliveryCode);
    const created = await createStandaloneOrder("delivery", {
      platform,
      code,
      orderCode: code,
      customerName,
      customerPhone,
    });
    if (!created) {
      return;
    }
    setNewDeliveryOpen(false);
    setNewDeliveryCode("");
    setNewDeliveryName("");
    setNewDeliveryPhone("");
  };

  const beginNewModeOrder = (mode: ServiceMode) => {
    if (mode.requiresTable) {
      setView(mode.id);
      setTablesOpenPersisted(true);
      return;
    }
    setView(mode.id);
    if (mode.id === "delivery") {
      setNewDeliveryOpen(true);
      return;
    }
    // Takeaway always uses the customer popup (fields optional unless requiresCustomer).
    // Other non-table modes open it only when the mode requires customer details.
    if (mode.id === "takeaway" || mode.requiresCustomer) {
      setCustomerModeId(mode.id);
      setNewTakeawayOpen(true);
      return;
    }
    void createStandaloneOrder(mode.id, { serviceModeId: mode.id });
  };

  // ── Select non-table order (from sidebar) ───────────────────────────────
  const handleSelectOrder = React.useCallback((fullOrder: any) => {
    if (!fullOrder?._id) {
      return;
    }
    setOrder(fullOrder);
    setTableNum(null);
    setDiscountPercent(Number(fullOrder.discountPercent || 0));
    window.localStorage.setItem("currentOrderId", fullOrder._id);
    window.localStorage.removeItem("currentTable");
    const modeId = deriveOrderType(fullOrder, null);
    setView(modeId);
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);

  const activateQueueOrder = React.useCallback(
    async (summary: any) => {
      if (!summary?._id) {
        return false;
      }
      try {
        const full = await getOrderById(summary._id);
        if (!full || full.status === "paid" || full.status === "cancelled") {
          return false;
        }
        handleSelectOrder(full);
        return true;
      } catch (error) {
        logger.error("Billing: failed to open queue order", error as Error, {
          orderId: summary._id,
        });
        return false;
      }
    },
    [handleSelectOrder],
  );

  /** Prefer the most recently updated open order in a non-table mode queue. */
  const pickPreferredQueueOrder = React.useCallback((queue: any[]) => {
    if (!queue?.length) {
      return null;
    }
    return [...queue].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0];
  }, []);

  // When viewing a non-table mode, keep center/ticket synced with the sidebar queue.
  React.useEffect(() => {
    const mode = findServiceModeById({ modes: serviceModes }, view);
    if (!mode || mode.requiresTable) {
      return;
    }
    const queue = modeOrders[view] || [];
    if (queue.length === 0) {
      return;
    }
    const orderBelongsHere = Boolean(order) && deriveOrderType(order, tableNum) === view;
    if (orderBelongsHere) {
      return;
    }
    const preferred = pickPreferredQueueOrder(queue);
    if (!preferred) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const full = await getOrderById(preferred._id);
      if (cancelled || !full || full.status === "paid" || full.status === "cancelled") {
        return;
      }
      handleSelectOrder(full);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    view,
    modeOrders,
    serviceModes,
    order,
    tableNum,
    handleSelectOrder,
    pickPreferredQueueOrder,
  ]);

  // ── KOT ─────────────────────────────────────────────────────────────────
  const sendKOT = async () => {
    if (kotPrintingRef.current) {
      return;
    }
    if (!order) {
      return showToast("Open an order/table first", "error");
    }
    let latestOrder = order;
    try {
      latestOrder = (await getOrderById(order._id)) || order;
    } catch (e) {
      logger.warn("Could not refresh order before KOT preview", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (latestOrder !== order) {
      setOrder(latestOrder);
    }
    const pendingItems = getUnsentKotItems(latestOrder);
    if (pendingItems.length === 0) {
      return showToast("No new KOT items to send", "info");
    }
    let kotSeqNum: number | undefined;
    try {
      kotSeqNum = await nextKotSeq();
    } catch (e) {
      console.warn("Could not fetch KOT sequence number", e);
    }
    setKotPreviewData(
      buildKotPreview(latestOrder, tableNum, pendingItems, currentUserLabel, kotSeqNum),
    );
    setKotPreviewOpen(true);
  };

  const onConfirmPrintKOT = async () => {
    if (kotPrintingRef.current) {
      return;
    }
    if (!kotPreviewData || !order) {
      setKotPreviewOpen(false);
      return;
    }
    const itemsToSend = kotPreviewData.items || [];
    const sentLines = itemsToSend.map((it: any) => ({ id: it.id, sentQty: it.sentQty ?? it.qty }));
    kotPrintingRef.current = true;
    setKotPrinting(true);
    try {
      try {
        const lines = buildKotLines(kotPreviewData, order, tableNum, branding);
        await printKOT({
          lines,
          printer: await resolveKitchenPrinter(),
          orderId: order._id,
          sentLines,
        });
      } catch (e: any) {
        console.warn("KOT print failed", e);
        try {
          const updated = await markOrderKotFailed(
            order._id,
            reportClientError("billing.kot-print", e, "print-failed"),
          );
          setOrder(updated);
          window.dispatchEvent(new Event("orders-changed"));
        } catch (statusError) {
          console.warn("Failed to mark KOT as failed", statusError);
        }
        showToast("KOT could not be sent to the printer. Check the connection.", "error", {
          action: { label: "Retry", onClick: onConfirmPrintKOT },
        });
        return;
      }

      try {
        const updated = await markOrderKotSent(order._id, sentLines);
        setOrder(updated);
        window.dispatchEvent(new Event("orders-changed"));
      } catch (e: any) {
        console.warn("KOT printed but status could not be saved", e);
        try {
          const refreshed = await getOrderById(order._id);
          setOrder(applyKotSentLocally(refreshed || order, sentLines));
        } catch {
          setOrder(applyKotSentLocally(order, sentLines));
        }
        window.dispatchEvent(new Event("orders-changed"));
        showToast(
          "KOT printed, but status could not be saved. Please verify before printing again.",
          "error",
        );
        setKotPreviewOpen(false);
        setKotPreviewData(null);
        return;
      }

      setKotPreviewOpen(false);
      setKotPreviewData(null);
      showToast("KOT sent to kitchen", "success");
    } finally {
      kotPrintingRef.current = false;
      setKotPrinting(false);
    }
  };

  // ── Pay / Cancel ────────────────────────────────────────────────────────
  const confirmKotVoid = async (reason: string) => {
    if (!order || !kotVoidRequest) {
      setKotVoidRequest(null);
      return;
    }
    const cleanReason = normalizeText(reason);
    if (!cleanReason) {
      showToast(validationMessage("kot-void-reason-required"), "error");
      return;
    }
    const line = order.items.find((candidate: any) => candidate.id === kotVoidRequest.lineId);
    if (!line) {
      setKotVoidRequest(null);
      return;
    }
    const sentQty = Math.max(0, Number(line.kotPrintedQty || 0));
    const finalQty = Math.max(
      0,
      Math.min(Number(kotVoidRequest.finalQty || 0), Number(line.qty || 0)),
    );
    const voidQty = sentQty - finalQty;
    if (voidQty <= 0) {
      setKotVoidRequest(null);
      return;
    }
    if (!beginBusyAction("voidKot")) {
      return;
    }
    try {
      const lines = buildKotVoidLines(
        {
          orderType: activeOrderType,
          tableNum,
          reason: cleanReason,
          items: [{ name: line.name, qty: voidQty }],
          sentBy: currentUserLabel,
        },
        branding,
      );

      // Step 1: Print first — bill is only changed after successful print
      try {
        await printKOTDirect({ lines, printer: await resolveKitchenPrinter() });
      } catch (e: any) {
        logger.error("Void KOT print failed", e);
        showToast(
          reportClientError(
            "billing.kot-void-print",
            e,
            "Void KOT could not be sent to the printer. Bill was not changed.",
          ),
          "error",
        );
        return;
      }

      // Step 2: Update the bill (print already happened)
      try {
        const updated = await voidOrderKotLine(order._id, {
          lineId: line.id,
          finalQty,
          reason: cleanReason,
        });
        setOrder(updated);
        setKotVoidRequest(null);
        setEditingQty((prev) => {
          const next = { ...prev };
          delete next[line.id];
          return next;
        });
        if (lastAddedId === line.id && finalQty === 0) {
          setLastAddedId(null);
        }
        window.dispatchEvent(new Event("orders-changed"));
        showToast("Void KOT printed and bill updated");
      } catch (e: any) {
        logger.error("Void KOT printed but bill update failed", e);
        showToast(
          reportClientError(
            "billing.kot-void-update",
            e,
            "Void KOT was printed but the bill could not be updated. Please refresh.",
          ),
          "error",
        );
      }
    } finally {
      endBusyAction("voidKot");
    }
  };

  const handlePrintBill = async () => {
    if (!order || !hasItems) {
      return;
    }
    if (!beginBusyAction("printBill")) {
      return;
    }
    try {
      await persistDiscountIfNeeded();
      const lines = buildReceiptLines(
        order,
        tableNum,
        discountPercent,
        totals,
        undefined,
        branding,
        { preview: true },
      );
      await printReceipt({ lines });
      try {
        await markOrderBillPrinted(order._id);
      } catch (recordError) {
        logger.error("Bill printed but could not record it for review", recordError);
      }
      showToast("Bill printed");
    } catch (e: any) {
      logger.error("Bill print failed", e);
      showToast(reportClientError("billing.print-bill", e, "Bill could not be printed. Please try again."), "error");
    } finally {
      endBusyAction("printBill");
    }
  };


  const handleConfirmPay = async (payment: PaymentConfirm) => {
    if (!order) {
      return;
    }
    if (!beginBusyAction("payment")) {
      return;
    }
    try {
      let paidOrder: any;
      try {
        paidOrder = await (async () => {
          await persistDiscountIfNeeded();
          return setOrderPaid(order._id, {
            amount: finalTotal,
            method: payment.method,
            amountPaid: payment.amountPaid,
            change: payment.change,
            txnRef: payment.txnRef,
            splitBreakdown: payment.splitBreakdown,
          });
        })();
      } catch (e: any) {
        logger.error("Payment failed", e);
        showToast(reportClientError("billing.payment", e, "Payment failed. Please try again."), "error");
        return; // keep modal open so user can retry
      }

      // Payment saved — reflect paid status + close modal, but do NOT dispatch
      // orders-changed yet. Delaying keeps the table marked occupied in the
      // sidebar until we are fully done (print success or user navigates away).
      setOrder(paidOrder);
      setPayModalOpen(false);

      // Snapshot totals (state will be stale inside the async closure)
      const snapTableNum = tableNum;
      const snapDiscount = Number(paidOrder?.discountPercent ?? discountPercent);
      const snapTotals = computeTotals(paidOrder, snapDiscount, gstConfig);
      const snapMethod = payment.method;
      const snapAmountStr = formatCurrency(
        Number(paidOrder?.total || snapTotals.total || finalTotal),
      );

      // Called on both print success and explicit "Finish (No Receipt)" action
      const finishTransaction = () => {
        window.dispatchEvent(new Event("orders-changed"));
        window.localStorage.removeItem("currentOrderId");
        window.localStorage.removeItem("currentTable");
        setPrintFailed(null);
        setOrder(null);
        setTableNum(null);
      };

      const printKotAfterPaymentIfNeeded = async () => {
        if (!activeMode?.supportsKOT) {
          return { printed: false, copiedToCounter: false };
        }
        const sequence = activeMode.paymentPrintSequence || "bill_only";
        if (sequence === "bill_only") {
          return { printed: false, copiedToCounter: false };
        }
        const pendingItems = getUnsentKotItems(paidOrder);
        if (!pendingItems.length) {
          return { printed: false, copiedToCounter: false };
        }
        let kotSeqNum: number | undefined;
        try {
          kotSeqNum = await nextKotSeq();
        } catch {
          kotSeqNum = undefined;
        }
        const preview = buildKotPreview(
          paidOrder,
          snapTableNum,
          pendingItems,
          currentUserLabel,
          kotSeqNum,
        );
        const sentLines = pendingItems.map((it: any) => ({ id: it.id, sentQty: it.sentQty ?? it.qty }));
        const lines = buildKotLines(preview, paidOrder, snapTableNum, branding);
        const printerTargets = await resolvePrinterTargets();
        await printKOT({
          lines,
          printer: await resolveKitchenPrinter(),
          orderId: paidOrder._id,
          sentLines,
        });

        let copiedToCounter = false;
        if (
          activeMode?.id === "self_service" &&
          !samePrinterTarget(printerTargets.kitchen, printerTargets.counter)
        ) {
          await printKOT({
            lines,
            printer: "counter",
            orderId: paidOrder._id,
            sentLines,
          });
          copiedToCounter = true;
        }

        return { printed: true, copiedToCounter };
      };

      const attemptPrint = async () => {
        setPrintFailed(null); // close any existing print-failed modal before retry
        try {
          const sequence = activeMode?.paymentPrintSequence || "bill_only";
          let kotResult = { printed: false, copiedToCounter: false };
          if (sequence === "kot_then_bill") {
            kotResult = await printKotAfterPaymentIfNeeded();
          }
          const lines = buildReceiptLines(
            paidOrder,
            snapTableNum,
            snapDiscount || 0,
            snapTotals,
            undefined,
            branding,
          );
          await printReceipt({ lines, printer: "counter" });
          if (sequence === "bill_then_kot") {
            kotResult = await printKotAfterPaymentIfNeeded();
          }
          if (kotResult.printed && kotResult.copiedToCounter) {
            showToast("Payment settled. Bill printed on counter and KOT printed on kitchen + counter.", "success");
          } else if (kotResult.printed) {
            showToast("Payment settled. Bill and KOT printed.", "success");
          } else {
            showToast("Payment settled. Bill printed.", "success");
          }
          // Print succeeded — clear and navigate
          finishTransaction();
        } catch (e) {
          logger.error("Receipt print failed after payment", e as Error);
          // Show blocking modal — user must explicitly retry or confirm skip
          setPrintFailed({
            amount: snapAmountStr,
            method: snapMethod,
            retry: attemptPrint,
            finish: finishTransaction,
          });
        }
      };

      if (payment.printReceipt || requiresOnPayPrintFlow) {
        await attemptPrint();
      } else {
        finishTransaction();
      }
    } finally {
      endBusyAction("payment");
    }
  };

  const handleConfirmCancel = async (reason: string) => {
    if (!order) {
      return;
    }
    const cleanReason = normalizeText(reason);
    if (!cleanReason) {
      showToast(validationMessage("cancel-reason-required"), "error");
      return;
    }
    if (!beginBusyAction("cancel")) {
      return;
    }
    try {
      await cancelOrder(order._id, cleanReason);
      window.dispatchEvent(new Event("orders-changed"));
      setConfirmCancelOpen(false);
      setOrder(null);
      setTableNum(null);
      window.localStorage.removeItem("currentOrderId");
      window.localStorage.removeItem("currentTable");
    } catch (e) {
      console.error("Cancel failed", e);
      showToast(reportClientError("billing.cancel-order", e, "Could not cancel order"), "error");
    } finally {
      endBusyAction("cancel");
    }
  };

  const handleMarkDelivered = async () => {
    if (!order) {
      return;
    }
    if (!beginBusyAction("delivery")) {
      return;
    }
    try {
      let paidOrder: any;
      try {
        paidOrder = await setOrderPaid(order._id, {
          amount: finalTotal,
          method: "online",
          amountPaid: finalTotal,
        });
      } catch (e: any) {
        showToast(reportClientError("billing.mark-delivered", e, "Failed to mark delivered"), "error");
        return;
      }

      setOrder(paidOrder);
      const snapTableNum = tableNum;
      const snapDiscount = Number(paidOrder?.discountPercent ?? discountPercent);
      const snapTotals = computeTotals(paidOrder, snapDiscount, gstConfig);
      const snapAmountStr = formatCurrency(Number(paidOrder?.total || finalTotal));

      const finishDelivery = () => {
        window.dispatchEvent(new Event("orders-changed"));
        window.localStorage.removeItem("currentOrderId");
        window.localStorage.removeItem("currentTable");
        setPrintFailed(null);
        setOrder(null);
        setTableNum(null);
        showToast("Order marked as delivered", "success");
      };

      const attemptPrint = async () => {
        setPrintFailed(null);
        try {
          const lines = buildReceiptLines(
            paidOrder,
            snapTableNum,
            snapDiscount || 0,
            snapTotals,
            undefined,
            branding,
          );
          await printReceipt({ lines });
          finishDelivery();
        } catch (e: any) {
          logger.error("Delivery receipt print failed", e as Error);
          setPrintFailed({
            amount: snapAmountStr,
            method: "online",
            retry: attemptPrint,
            finish: finishDelivery,
          });
        }
      };

      try {
        await attemptPrint();
      } catch (e: any) {
        logger.error("Delivery completion failed", e as Error);
        showToast(reportClientError("billing.finish-delivered", e, "Failed to finish delivered order"), "error");
      }
    } finally {
      endBusyAction("delivery");
    }
  };

  // ── Quick actions (takeaway/delivery) ───────────────────────────────────
  const markReady = async () => {
    if (!order) {
      return;
    }
    if (!beginBusyAction("markReady")) {
      return;
    }
    try {
      const updated = await setOrderStatus(order._id, "ready");
      setOrder(updated);
      window.dispatchEvent(new Event("orders-changed"));
    } catch (e) {
      showToast(reportClientError("billing.mark-ready", e, "Could not mark as ready"), "error");
    } finally {
      endBusyAction("markReady");
    }
  };

  const openAssignRider = () => {
    const rider = (order?.meta as any)?.rider || {};
    setRiderName(String(rider.name || ""));
    setRiderPhone(String(rider.phone || ""));
    setAssignRiderOpen(true);
  };

  const confirmAssignRider = async () => {
    if (!order) {
      return;
    }
    const name = normalizeText(riderName);
    const phone = normalizePhone(riderPhone);
    if (!name) {
      showToast(validationMessage("rider-name-required"), "error");
      return;
    }
    if (!isValidPersonName(name)) {
      showToast(validationMessage("rider-name-invalid"), "error");
      return;
    }
    if (phone && !isValidIndianMobile(phone)) {
      showToast(validationMessage("rider-phone-invalid"), "error");
      return;
    }
    if (!beginBusyAction("assignRider")) {
      return;
    }
    try {
      const updated = await setOrderStatus(order._id, "assigned", {
        meta: {
          ...(order.meta || {}),
          rider: { name, phone },
        },
      });
      setOrder(updated);
      setAssignRiderOpen(false);
      setRiderName("");
      setRiderPhone("");
      window.dispatchEvent(new Event("orders-changed"));
    } catch (e) {
      showToast(reportClientError("billing.assign-rider", e, "Could not assign rider"), "error");
    } finally {
      endBusyAction("assignRider");
    }
  };

  const printAggregatorReceipt = async () => {
    if (!order) {
      return;
    }
    if (!beginBusyAction("aggregatorPrint")) {
      return;
    }
    try {
      await persistDiscountIfNeeded();
      const lines = buildReceiptLines(
        order,
        tableNum,
        discountPercent || 0,
        totals,
        gstConfig,
        branding,
      );
      await printReceipt({ lines });
      try {
        await markOrderBillPrinted(order._id);
      } catch (recordError) {
        logger.error("Bill printed but could not record it for review", recordError);
      }
    } catch (e) {
      console.warn("printAggregatorReceipt failed", e);
      showToast(reportClientError("billing.print", e, "Print failed"), "error");
    } finally {
      endBusyAction("aggregatorPrint");
    }
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "t") {
        e.preventDefault();
        setTablesOpenPersisted(!tablesOpen);
        setTimeout(() => searchRef.current?.focus(), 50);
        return;
      }
      if (key === "k") {
        e.preventDefault();
        if (canKot) {
          sendKOT();
        }
        return;
      }
      if (key === "p") {
        e.preventDefault();
        if (canStartPayment) {
          setPayModalOpen(true);
        }
      } else if (key === "b") {
        e.preventDefault();
        if (canPrintBill) {
          handlePrintBill();
        }
      } else if (key === "c") {
        e.preventDefault();
        if (canStartCancel) {
          setConfirmCancelOpen(true);
        }
      } else if (key === "u" || (e.ctrlKey && key === "z")) {
        e.preventDefault();
        undoLast();
      } else if (/^[1-6]$/.test(key)) {
        const fav = quickFavoriteShortcuts[Number(key) - 1];
        if (fav) {
          e.preventDefault();
          addToOrder(fav, qty, false); // don't steal focus from hotkeys
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    items,
    order,
    qty,
    lastAddedId,
    tablesOpen,
    canKot,
    canStartCancel,
    canStartPayment,
    canPrintBill,
    quickFavoriteShortcuts,
  ]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      <div className={styles.page}>
        <div className={styles.bodyRow}>
          <BillingSidebar
            open={tablesOpen}
            serviceModes={serviceModes}
            view={view}
            onViewChange={(newView) => {
              setView(newView);
              const targetMode = findServiceModeById({ modes: serviceModes }, newView);
              const orderBelongsToView =
                Boolean(order) &&
                ((activeMode?.requiresTable === true && targetMode?.requiresTable === true) ||
                  activeOrderType === newView);

              if (orderBelongsToView) {
                return;
              }

              // Leaving the current order's mode — clear, then auto-load for non-table queues.
              setOrder(null);
              setTableNum(null);
              setDiscountPercent(0);
              window.localStorage.removeItem("currentOrderId");
              window.localStorage.removeItem("currentTable");

              if (targetMode && !targetMode.requiresTable) {
                const preferred = pickPreferredQueueOrder(modeOrders[newView] || []);
                if (preferred) {
                  void activateQueueOrder(preferred);
                }
              }
            }}
            tableAreas={tableAreas}
            selectedAreaId={selectedAreaId}
            onSelectArea={setSelectedAreaId}
            tablesByArea={tablesByArea}
            tableNum={tableNum}
            activeOrderType={activeOrderType}
            modeOrders={modeOrders}
            onLoadTable={loadTable}
            currentOrderId={order?._id}
            onSelectOrder={handleSelectOrder}
            onCreateMode={beginNewModeOrder}
            formatCurrency={formatCurrency}
          />

          <BillingMenuBoard>
            {/* ── No active order: welcome card ──────────────────────────── */}
            {!order && (
              <div className={styles.noOrderBox}>
                <div className={styles.noOrderCard}>
                  <EmptyState
                    title={
                      !findServiceModeById({ modes: serviceModes }, view)?.requiresTable &&
                      (modeOrders[view] || []).length > 0
                        ? "Select an order"
                        : "No active order"
                    }
                    text={
                      !findServiceModeById({ modes: serviceModes }, view)?.requiresTable &&
                      (modeOrders[view] || []).length > 0
                        ? "Choose an order from the sidebar, or start a new one below"
                        : "Pick a service mode from the sidebar, or start a new order below"
                    }
                  />
                  <PickButtons
                    serviceModes={serviceModes}
                    onSelectMode={(mode) => {
                      setTablesOpenPersisted(true);
                      if (mode.requiresTable) {
                        setView(mode.id);
                        return;
                      }
                      const preferred = pickPreferredQueueOrder(modeOrders[mode.id] || []);
                      if (preferred) {
                        void activateQueueOrder(preferred);
                        return;
                      }
                      beginNewModeOrder(mode);
                    }}
                  />
                </div>
              </div>
            )}

            {/* ── Active order: search + categories + menu ─── */}
            {order && (
              <>
                <ItemSearch
                  items={items}
                  onSelect={(item) => addToOrder(item, qty)}
                  inputRef={searchRef}
                />

                <div className={styles.categoryRail} role="tablist" aria-label="Menu categories">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={menuCategory === "favorites"}
                    className={`${styles.categoryChip} ${menuCategory === "favorites" ? styles.categoryChipActive : ""}`}
                    onClick={() => {
                      setMenuCategory("favorites");
                      setCategoryMoreOpen(false);
                    }}
                  >
                    Favorites
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={menuCategory === "all"}
                    className={`${styles.categoryChip} ${menuCategory === "all" ? styles.categoryChipActive : ""}`}
                    onClick={() => {
                      setMenuCategory("all");
                      setCategoryMoreOpen(false);
                    }}
                  >
                    All
                  </button>
                  {visibleCategories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      role="tab"
                      aria-selected={menuCategory === category}
                      className={`${styles.categoryChip} ${menuCategory === category ? styles.categoryChipActive : ""}`}
                      onClick={() => {
                        setMenuCategory(category);
                        setCategoryMoreOpen(false);
                      }}
                    >
                      {category}
                    </button>
                  ))}
                  {overflowCategories.length > 0 ? (
                    <div className={styles.categoryMoreWrap}>
                      <button
                        type="button"
                        className={`${styles.categoryChip} ${
                          overflowCategories.includes(menuCategory) ? styles.categoryChipActive : ""
                        }`}
                        aria-expanded={categoryMoreOpen}
                        aria-haspopup="listbox"
                        aria-controls="category-more"
                        onClick={() => setCategoryMoreOpen((open) => !open)}
                      >
                        More ▾
                      </button>
                      {categoryMoreOpen ? (
                        <div
                          id="category-more"
                          className={styles.morePanel}
                          role="listbox"
                          aria-label="More categories"
                        >
                          {overflowCategories.map((category) => (
                            <button
                              key={category}
                              type="button"
                              role="option"
                              aria-selected={menuCategory === category}
                              className={`${styles.moreOption} ${
                                menuCategory === category ? styles.moreOptionActive : ""
                              }`}
                              onClick={() => {
                                setMenuCategory(category);
                                setCategoryMoreOpen(false);
                              }}
                            >
                              {category}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {visibleMenuItems.length > 0 ? (
                  <div className={styles.menuBoard} role="list" aria-label="Menu items">
                    {visibleMenuItems.map((f) => (
                      <MenuTile
                        key={f._id}
                        name={f.name}
                        priceLabel={itemPriceSummary(f, formatCurrency)}
                        meta={
                          Array.isArray(f.variants) && f.variants.length > 0
                            ? `${f.variants.length} option${f.variants.length !== 1 ? "s" : ""}`
                            : String(f.category || "").trim() || undefined
                        }
                        onClick={() => addToOrder(f, qty)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No items" text="Nothing in this category yet" />
                )}
              </>
            )}
          </BillingMenuBoard>
          <BillingTicketPane>
            <div className={styles.ticketContext}>
          <div className={styles.headerLeft}>
            <button
              onClick={() => setTablesOpenPersisted(!tablesOpen)}
              aria-label="Toggle tables"
              title="Toggle tables (T)"
              className={styles.toggleBtn}
            >
              Menu
            </button>
            <div>
              <div className={styles.headerTitle}>
                {tableNum
                  ? activeTableLabel
                  : order && activeOrderType === "delivery"
                    ? `${order.meta?.platform || order.meta?.orderSource || "Delivery"}${order.meta?.code ? ` #${order.meta.code}` : ""}`
                    : order && !activeMode?.requiresTable
                      ? `${modeOrderLabel(activeMode, order)}${order.meta?.customerName && activeMode?.id !== "takeaway" ? ` - ${order.meta.customerName}` : ""}`
                      : "Billing"}
              </div>
              {order && (
                <div className={styles.headerMeta}>
                  {(order.items || []).length} item{(order.items || []).length !== 1 ? "s" : ""}
                  {" · "}
                  <span title="Time since this order opened">
                    open {formatKotAge(Number(order.createdAt) || Date.now())}
                  </span>
                  {order.status && order.status !== "open" && (
                    <span
                      className={
                        order.status === "ready"
                          ? styles.statusReadyText
                          : order.status === "assigned"
                            ? styles.statusAssignedText
                            : styles.statusOtherText
                      }
                      style={{ marginLeft: 8, fontWeight: 700 }}
                    >
                      · {order.status}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
            </div>
            <div className={styles.ticketBody}>
                {/* Order items + totals */}
                <section>
                  {(order?.items || []).length > 0 ? (
                    <div className={styles.orderList}>
                      <OrderList
                        items={order?.items || []}
                        menuItemsById={menuItemsById}
                        editingQty={editingQty}
                        editingRate={editingRate}
                        setEditingQty={setEditingQty}
                        setEditingRate={setEditingRate}
                        commitQty={commitQty}
                        commitRate={commitRate}
                        removeLine={removeLine}
                        updateOrderQty={updateOrderQty}
                        onChangeVariant={changeLineVariant}
                      />
                    </div>
                  ) : (
                    <div
                      className={styles.textMuted}
                      style={{ textAlign: "center", padding: "28px 0", fontSize: 14 }}
                    >
                      {order
                        ? "No items yet — search above to add"
                        : "No order selected"}
                    </div>
                  )}
                  {(order?.items || []).length > 0 ? (
                    <div className={styles.discountBox}>
                      <div className={styles.discountRow}>
                        <span className={styles.textMuted}>Discount</span>
                        <div className={styles.discountControls}>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={discountPercent}
                            disabled={isPaid}
                            onChange={(e) =>
                              setDiscountPercent(
                                Math.max(0, Math.min(100, Number(e.target.value || 0))),
                              )
                            }
                            onBlur={() => {
                              void persistDiscountIfNeeded().catch((e) => {
                                logger.error("Failed to save discount", e);
                                showToast(
                                  reportClientError(
                                    "billing.discount",
                                    e,
                                    "Discount could not be saved.",
                                  ),
                                  "error",
                                );
                              });
                            }}
                            className={styles.discountInput}
                            aria-label="Discount percent"
                          />
                          <span className={styles.textMuted} style={{ fontSize: 13 }}>
                            %
                          </span>
                          <span className={styles.discountAmt}>−{formatCurrency(discountAmt)}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>
            </div>
            {(order?.items || []).length > 0 ? (
              <div className={styles.ticketSummary} aria-live="polite">
                <div className={styles.ticketSummaryRow}>
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {gstEnabled ? (
                  <>
                    {totals.priceIncludesTax ? (
                      <div className={styles.ticketSummaryRow}>
                        <span>Taxable value</span>
                        <span>{formatCurrency(totals.taxableSubtotal)}</span>
                      </div>
                    ) : null}
                    <div className={styles.ticketSummaryRow}>
                      <span>
                        CGST ({gstHalfPct}
                        {totals.priceIncludesTax ? " incl." : ""})
                      </span>
                      <span>{formatCurrency(cgst)}</span>
                    </div>
                    <div className={styles.ticketSummaryRow}>
                      <span>
                        SGST ({gstHalfPct}
                        {totals.priceIncludesTax ? " incl." : ""})
                      </span>
                      <span>{formatCurrency(sgst)}</span>
                    </div>
                  </>
                ) : null}
                {discountAmt > 0 ? (
                  <div className={styles.ticketSummaryRow}>
                    <span>Discount</span>
                    <span>−{formatCurrency(discountAmt)}</span>
                  </div>
                ) : null}
                <div className={styles.ticketSummaryTotal}>
                  <span>Total due</span>
                  <span>{formatCurrency(finalTotal)}</span>
                </div>
              </div>
            ) : null}
            <div className={styles.ticketActions}>
          <div className={styles.actionGroup}>
            {allowsManualKot && (
              <button
                onClick={sendKOT}
                disabled={!canKot}
                aria-disabled={!canKot}
                title={unsentKotItems.length > 0 ? "Send KOT (K)" : "No new KOT items to send"}
                className={`${styles.actionBtn} ${styles.actionPrimary}`}
              >
                {kotPrinting ? "Printing..." : "KOT"}
              </button>
            )}
            {allowsManualBillPrint && (
              <button
                onClick={handlePrintBill}
                disabled={!canPrintBill}
                aria-disabled={!canPrintBill}
                title="Print bill for customer to review (B)"
                className={`${styles.actionBtn} ${styles.actionSecondary}`}
              >
                {billPrinting ? "Printing..." : "Print Bill"}
              </button>
            )}
            {!activeMode?.externalPayment && (
              <button
                onClick={() => setPayModalOpen(true)}
                disabled={!canStartPayment}
                aria-disabled={!canStartPayment}
                title={`Settle bill and run payment print flow: ${paymentFlowLabel(activeMode)} (P)`}
                className={`${styles.actionBtn} ${styles.actionPay}`}
              >
                {paymentProcessing ? "Processing..." : "Settle"}
              </button>
            )}
            {showPaymentFlowHint && (
              <span className={styles.paymentFlowChip}>On pay: {paymentFlowLabel(activeMode)}</span>
            )}
            <button
              onClick={() => setConfirmCancelOpen(true)}
              disabled={!canStartCancel}
              aria-disabled={!canStartCancel}
              title="Cancel order (C)"
              className={`${styles.actionBtn} ${styles.actionDanger}`}
            >
              {cancelProcessing ? "Cancelling..." : "Cancel"}
            </button>
            {order && supportsMarkReady && (
              <>
                <button
                  onClick={markReady}
                  disabled={markReadyProcessing}
                  title="Mark order as ready"
                  className={styles.actionTertiary}
                  style={
                    order.status === "ready" ? { background: "var(--pos-success)", color: "var(--pos-surface)" } : undefined
                  }
                >
                  {markReadyProcessing
                    ? "Saving..."
                    : order.status === "ready"
                      ? "Ready"
                      : "Mark Ready"}
                </button>
                {activeOrderType === "delivery" && (
                  <>
                    <button
                      onClick={openAssignRider}
                      disabled={!order || isPaid || assignRiderProcessing}
                      title="Assign or update rider"
                      className={styles.actionSecondary}
                    >
                      {assignRiderProcessing
                        ? "Saving..."
                        : (order.meta as any)?.rider?.name
                          ? "Update Rider"
                          : "Assign Rider"}
                    </button>
                    <button
                      onClick={handleMarkDelivered}
                      disabled={!hasItems || isPaid || deliveryProcessing}
                      title="Mark order as delivered (paid via aggregator)"
                      className={`${styles.actionBtn} ${styles.actionPay}`}
                    >
                      {deliveryProcessing ? "Processing..." : "Delivered"}
                    </button>
                    <button
                      onClick={printAggregatorReceipt}
                      disabled={!order || aggregatorPrinting}
                      title="Print bill for delivery customer"
                      className={styles.actionSecondary}
                    >
                      {aggregatorPrinting ? "Printing..." : "Print Bill"}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
            </div>
          </BillingTicketPane>
        </div>


        {/* ── Modals ────────────────────────────────────────────────────── */}
        {confirmCancelOpen && order && (
          <ConfirmCancelModal
            tableNum={tableNum}
            tableLabel={activeTableLabel || undefined}
            activeOrderType={activeOrderType}
            onClose={() => setConfirmCancelOpen(false)}
            onConfirm={handleConfirmCancel}
            processing={cancelProcessing}
          />
        )}

        {kotPreviewOpen && kotPreviewData && (
          <KotPreviewModal
            data={kotPreviewData}
            onClose={() => {
              setKotPreviewOpen(false);
              setKotPreviewData(null);
            }}
            onPrint={onConfirmPrintKOT}
            printing={kotPrinting}
          />
        )}

        {kotVoidRequest && (
          <KotVoidModal
            itemName={kotVoidRequest.itemName}
            voidQty={kotVoidRequest.voidQty}
            finalQty={kotVoidRequest.finalQty}
            onClose={() => setKotVoidRequest(null)}
            onConfirm={confirmKotVoid}
            processing={voidKotProcessing}
          />
        )}

        {newTakeawayOpen && (
          <NewTakeawayModal
            title={
              findServiceModeById({ modes: serviceModes }, customerModeId)?.name || "Customer Order"
            }
            name={newTakeawayName}
            phone={newTakeawayPhone}
            onNameChange={setNewTakeawayName}
            onPhoneChange={setNewTakeawayPhone}
            requiresCustomer={Boolean(
              findServiceModeById({ modes: serviceModes }, customerModeId)?.requiresCustomer,
            )}
            onClose={() => {
              setNewTakeawayOpen(false);
              setNewTakeawayName("");
              setNewTakeawayPhone("");
            }}
            onCreate={createCustomerModeOrder}
            processing={creatingOrder}
          />
        )}

        {newDeliveryOpen && (
          <NewDeliveryModal
            platform={newDeliveryPlatform}
            onPlatformChange={setNewDeliveryPlatform}
            code={newDeliveryCode}
            onCodeChange={setNewDeliveryCode}
            customerName={newDeliveryName}
            onCustomerNameChange={setNewDeliveryName}
            customerPhone={newDeliveryPhone}
            onCustomerPhoneChange={setNewDeliveryPhone}
            requiresCustomer={false}
            onClose={() => {
              setNewDeliveryOpen(false);
              setNewDeliveryCode("");
              setNewDeliveryName("");
              setNewDeliveryPhone("");
            }}
            onCreate={createDeliveryOrder}
            processing={creatingOrder}
          />
        )}

        {assignRiderOpen && (
          <AssignRiderModal
            riderName={riderName}
            riderPhone={riderPhone}
            onNameChange={setRiderName}
            onPhoneChange={setRiderPhone}
            onClose={() => setAssignRiderOpen(false)}
            onConfirm={confirmAssignRider}
            processing={assignRiderProcessing}
          />
        )}

        {variantSelection && Array.isArray(variantSelection.item?.variants) && (
          <VariantPickerModal
            itemName={variantSelection.item.name}
            variants={variantSelection.item.variants}
            onClose={() => setVariantSelection(null)}
            onSelect={(variant) =>
              addToOrder(
                variantSelection.item,
                variantSelection.quantity,
                variantSelection.refocus,
                variant,
              )
            }
          />
        )}

        {/* Blocking modal when payment succeeded but receipt print failed */}
        {printFailed && (
          <PrintFailedModal
            amount={printFailed.amount}
            method={printFailed.method}
            onRetry={async () => {
              if (!beginBusyAction("receiptRetry")) {
                return;
              }
              try {
                await Promise.resolve(printFailed.retry());
              } finally {
                endBusyAction("receiptRetry");
              }
            }}
            onSkip={() => {
              if (!beginBusyAction("receiptRetry")) {
                return;
              }
              try {
                printFailed.finish();
              } finally {
                endBusyAction("receiptRetry");
              }
            }}
            processing={receiptRetrying}
          />
        )}

      </div>

      <PaymentsModal
        open={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        amount={finalTotal}
        onConfirm={handleConfirmPay}
        processing={paymentProcessing}
        forcePrintReceipt={requiresOnPayPrintFlow}
      />
    </>
  );
}
