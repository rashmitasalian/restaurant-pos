import React from "react";
import { ENV } from "../../../config/env";
import {
  createOrder as createPosOrder,
  getActiveOrders,
  getOrderById,
  addItemToOrder,
  getOrCreateOrderForTable,
  getOpenOrderForTable,
  setOrderPaid,
  cancelOrder,
  getItems,
  seedItems,
  seedTables,
  updateOrderLines,
  setOrderDiscount,
  setOrderStatus,
  markOrderKotFailed,
  markOrderKotSent,
  voidOrderKotLine,
  getConfiguredTableCount,
  getConfigPrinters,
  getConfigGst,
  getConfigBranding,
  nextKotSeq,
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
import styles from "./Billing.module.css";
import PaymentsModal, { type PaymentConfirm } from "../../components/PaymentsModal";
import { AuthContext } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import OrderList from "./components/OrderList";
import PickButtons from "./components/PickButtons";
import ItemSearch from "./components/ItemSearch";
import BillingSidebar from "./components/BillingSidebar";
import {
  ConfirmCancelModal,
  KotPreviewModal,
  KotVoidModal,
  NewTakeawayModal,
  NewDeliveryModal,
  AssignRiderModal,
  PrintFailedModal,
  AdminOverrideModal,
} from "./components/BillingModals";
import { buildReceiptLines, buildKotLines, buildKotVoidLines } from "./utils/receiptBuilder";
import type { ReceiptBranding } from "./utils/receiptBuilder";

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_KOT_PRINTER = "kitchen";
const QUICK_FAVORITE_SHORTCUT_LIMIT = 6;

type KotVoidRequest = {
  lineId: string;
  itemName: string;
  finalQty: number;
  voidQty: number;
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

function deriveOrderType(order: any, tableNum: number | null): "table" | "takeaway" | "delivery" {
  if (!order) {
    return "table";
  }
  if (order.orderType) {
    return order.orderType as any;
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

async function resolveKitchenPrinter() {
  try {
    const cfg = await getConfigPrinters();
    return cfg?.kitchenPrinterIp?.trim() || DEFAULT_KOT_PRINTER;
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
  const [qty, setQty] = React.useState(1);
  const [lastAddedId, setLastAddedId] = React.useState<string | null>(null);
  const [discountPercent, setDiscountPercent] = React.useState(0);
  const [gstConfig, setGstConfig] = React.useState(() => normalizeGstConfig(DEFAULT_GST_CONFIG));
  const [branding, setBranding] = React.useState<ReceiptBranding | null>(null);

  // ── Sidebar state ───────────────────────────────────────────────────────
  const [tablesOpen, setTablesOpen] = React.useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem("tablesOpen") === "1";
    } catch {
      return false;
    }
  });
  const setTablesOpenPersisted = (val: boolean) => {
    setTablesOpen(val);
    try {
      window.localStorage.setItem("tablesOpen", val ? "1" : "0");
    } catch {}
  };
  const [view, setView] = React.useState<"tables" | "takeaway" | "delivery">("tables");
  const [takeawayOrders, setTakeawayOrders] = React.useState<any[]>([]);
  const [deliveryOrders, setDeliveryOrders] = React.useState<any[]>([]);
  const [tableCount, setTableCount] = React.useState(0);
  const tableNumbers = React.useMemo(
    () => Array.from({ length: tableCount }, (_, i) => i + 1),
    [tableCount],
  );
  const [tableInfos, setTableInfos] = React.useState<Record<number, any>>({});

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
  const [newDeliveryOpen, setNewDeliveryOpen] = React.useState(false);
  const [newDeliveryPlatform, setNewDeliveryPlatform] = React.useState("Swiggy");
  const [newDeliveryCode, setNewDeliveryCode] = React.useState("");
  const [assignRiderOpen, setAssignRiderOpen] = React.useState(false);
  const [riderName, setRiderName] = React.useState("");
  const [riderPhone, setRiderPhone] = React.useState("");
  const [printFailed, setPrintFailed] = React.useState<{
    amount: string;
    method: string;
    retry: () => void;
    finish: () => void;
  } | null>(null);

  // ── Bill-printed fraud guard ────────────────────────────────────────────
  // Tracks which order ID had its bill printed. Any removal/reduction after
  // bill print requires manager credentials.
  const billPrintedOrderRef = React.useRef<string | null>(null);
  const [adminOverrideOpen, setAdminOverrideOpen] = React.useState(false);
  const [adminOverrideDesc, setAdminOverrideDesc] = React.useState("");
  const pendingOverrideRef = React.useRef<(() => Promise<void>) | null>(null);

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
  const gstFullPct = formatGstRate(totals.gstRateBps);
  const favorites = React.useMemo(
    () => (items || []).filter((it) => it.favorite === true && it.available !== false),
    [items],
  );
  const quickFavoriteShortcuts = React.useMemo(
    () => favorites.slice(0, QUICK_FAVORITE_SHORTCUT_LIMIT),
    [favorites],
  );
  const hasItems = Boolean(order && (order.items || []).length > 0);
  const unsentKotItems = React.useMemo(() => getUnsentKotItems(order), [order]);
  const isPaid = order?.status === "paid";
  const canCancel = hasItems && !isPaid;
  const canKot =
    hasItems && !isPaid && unsentKotItems.length > 0 && !kotPrinting && !kotPreviewOpen;
  // Delivery orders are paid through the aggregator app — no in-POS payment needed
  const canPay = hasItems && !isPaid && activeOrderType !== "delivery";
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
  const canPrintBill = hasItems && !isPaid && !billPrinting;

  // ── Data loading ────────────────────────────────────────────────────────
  const loadQueues = React.useCallback(async () => {
    try {
      const orders = await getActiveOrders();
      setTakeawayOrders(
        orders.filter(
          (o: any) => (o.orderType || o.meta?.orderType || "").toLowerCase() === "takeaway",
        ),
      );
      setDeliveryOrders(
        orders.filter(
          (o: any) =>
            (o.orderType || o.meta?.orderType || "").toLowerCase() === "delivery" ||
            (o.meta?.platform || "")
              .toString()
              .toLowerCase()
              .match(/swiggy|zomato|dunzo|zepto/),
        ),
      );
    } catch (e) {
      logger.error("Billing: failed to load queues", e as Error);
      setTakeawayOrders([]);
      setDeliveryOrders([]);
    }
  }, []);

  const loadTableStatuses = React.useCallback(async () => {
    const acc: Record<number, any> = {};
    for (const t of tableNumbers) {
      try {
        const o = await getOpenOrderForTable(t);
        if (o) {
          const count = (o.items || []).length;
          const total =
            typeof o.total === "number"
              ? o.total
              : (o.items || []).reduce(
                  (s: number, it: any) => s + (it.qty || 0) * (it.rate || 0),
                  0,
                );
          acc[t] = {
            status: count > 0 ? (o.status === "held" ? "held" : "open") : "",
            count,
            total,
          };
        } else {
          acc[t] = { status: "", count: 0, total: 0 };
        }
      } catch {
        acc[t] = { status: "", count: 0, total: 0 };
      }
    }
    setTableInfos(acc);
  }, [tableNumbers]);

  React.useEffect(() => {
    loadQueues();
    const h = () => loadQueues();
    window.addEventListener("orders-changed", h);
    return () => window.removeEventListener("orders-changed", h);
  }, [loadQueues]);

  React.useEffect(() => {
    loadTableStatuses();
    const h = () => loadTableStatuses();
    window.addEventListener("orders-changed", h);
    return () => window.removeEventListener("orders-changed", h);
  }, [loadTableStatuses]);

  React.useEffect(() => {
    const h = async () => {
      const count = await getConfiguredTableCount();
      await seedTables(count);
      setTableCount(count);
    };
    window.addEventListener("orders-changed", h);
    return () => window.removeEventListener("orders-changed", h);
  }, []);

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
        setTableCount(await getConfiguredTableCount());
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
  }, []);

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
      setTimeout(() => searchRef.current?.focus(), 10);
      setTimeout(() => loadTableStatuses(), 50);
    } catch (error) {
      logger.error("Failed to load table", error as Error, { tableNumber: tn });
    }
  };
  // Keep the ref in sync so the select-table event handler always calls
  // the latest version (which closes over the current loadTableStatuses).
  loadTableRef.current = loadTable;

  const addToOrder = async (item: any, quantity = 1, refocus = true) => {
    if (!order) {
      showToast("Open or select a table first", "error");
      return;
    }
    try {
      const res = await addItemToOrder(order._id, {
        menuItemId: item._id || null,
        name: item.name,
        categoryName: item.category || null,
        qty: quantity,
        rate: item.price,
      });
      setOrder(res);
      // find the item by name (may have been merged, not necessarily the last row)
      const addedLine = [...(res.items || [])]
        .reverse()
        .find((l: any) => l.name.toLowerCase() === item.name.toLowerCase());
      setLastAddedId(addedLine?.id ?? null);
      window.dispatchEvent(new Event("orders-changed"));
      if (refocus) {
        setTimeout(() => searchRef.current?.focus(), 10);
      }
    } catch (e: any) {
      logger.error("Failed to add item", e);
      showToast(e?.message || "Failed to add item", "error");
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

  // If the bill has been printed for this order, intercept remove/reduce actions
  // and require manager credentials before proceeding.
  const requireBillPrintedOverride = (description: string, action: () => Promise<void>): boolean => {
    if (billPrintedOrderRef.current !== order?._id || !order) {
      return false; // not intercepted, caller should proceed normally
    }
    pendingOverrideRef.current = action;
    setAdminOverrideDesc(description);
    setAdminOverrideOpen(true);
    return true; // intercepted — waiting for manager approval
  };

  const handleAdminOverrideConfirm = async (adminUsername: string, adminPassword: string) => {
    // throws on bad credentials — AdminOverrideModal catches and shows the error
    await (window as any).pos?.auth?.verifyAdmin?.(adminUsername, adminPassword);
    setAdminOverrideOpen(false);
    const action = pendingOverrideRef.current;
    pendingOverrideRef.current = null;
    if (action) {
      await action();
    }
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
        showToast(e?.message || "Failed to remove item", "error");
      }
    };
    if (requireBillPrintedOverride(`Remove: ${line?.name || "item"}`, doRemove)) {
      return false;
    }
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
        showToast(e?.message || "Failed to update quantity", "error");
      }
    };
    if (delta < 0 && requireBillPrintedOverride(
      `Reduce: ${line.name} (qty ${Number(line.qty || 1)} → ${nextQty})`,
      doUpdate,
    )) {
      return;
    }
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
        showToast(e?.message || "Failed to save quantity", "error");
      }
    };
    const prevQty = Number(line?.qty || 1);
    if (rawQty < prevQty && requireBillPrintedOverride(
      `Reduce: ${line?.name || "item"} (qty ${prevQty} → ${rawQty})`,
      doCommit,
    )) {
      return;
    }
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
      showToast(e?.message || "Failed to save rate", "error");
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
    orderType: "takeaway" | "delivery",
    meta: Record<string, any>,
  ) => {
    if (!beginBusyAction("creatingOrder")) {
      return null;
    }
    try {
      const fresh = await createPosOrder({
        tableId: null,
        orderType,
        customerId: meta.customerId || null,
        meta,
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
      logger.error(`Failed to create ${orderType} order`, error as Error);
      showToast(`Failed to create ${orderType} order`, "error");
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

  const createTakeawayOrder = async () => {
    const enteredName = normalizeText(newTakeawayName);
    if (enteredName && !isValidPersonName(enteredName)) {
      showToast(validationMessage("customer-name-invalid"), "error");
      return;
    }
    let customer: any = null;
    try {
      customer = await resolveTakeawayCustomer();
    } catch (error: any) {
      showToast(validationMessage(error, "Could not save customer"), "error");
      return;
    }
    if (customer === undefined) {
      return;
    }
    const takeawayName = enteredName || customer?.name || "";
    const created = await createStandaloneOrder("takeaway", {
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
    const code = normalizeText(newDeliveryCode);
    const created = await createStandaloneOrder("delivery", { platform, code, orderCode: code });
    if (!created) {
      return;
    }
    setNewDeliveryOpen(false);
    setNewDeliveryCode("");
  };

  // ── Select non-table order (from sidebar) ───────────────────────────────
  const handleSelectOrder = (fullOrder: any) => {
    setOrder(null); // clear immediately to avoid stale flash
    setTableNum(null);
    setDiscountPercent(0);
    setOrder(fullOrder);
    window.localStorage.setItem("currentOrderId", fullOrder._id);
    window.localStorage.removeItem("currentTable");
  };

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
          const updated = await markOrderKotFailed(order._id, e?.message || String(e));
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
          e?.message || "Void KOT could not be sent to the printer. Bill was not changed.",
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
          validationMessage(e, "Void KOT was printed but the bill could not be updated. Please refresh."),
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
      billPrintedOrderRef.current = order._id;
      showToast("Bill printed");
    } catch (e: any) {
      logger.error("Bill print failed", e);
      showToast(e?.message || "Bill could not be printed. Please try again.", "error");
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
        if (Number(order.discountPercent || 0) !== Number(discountPercent || 0)) {
          await setOrderDiscount(order._id, discountPercent);
        }
        paidOrder = await setOrderPaid(order._id, {
          amount: finalTotal,
          method: payment.method,
          amountPaid: payment.amountPaid,
          change: payment.change,
          txnRef: payment.txnRef,
          splitBreakdown: payment.splitBreakdown,
        });
      } catch (e: any) {
        logger.error("Payment failed", e);
        showToast(e?.message || "Payment failed. Please try again.", "error");
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

      const attemptPrint = async () => {
        setPrintFailed(null); // close any existing print-failed modal before retry
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
      if (payment.printReceipt) {
        await attemptPrint();
      } else {
        finishTransaction();
      }
    } finally {
      endBusyAction("payment");
    }
  };

  const handleConfirmCancel = async () => {
    if (!order) {
      return;
    }
    if (!beginBusyAction("cancel")) {
      return;
    }
    try {
      await cancelOrder(order._id);
      window.dispatchEvent(new Event("orders-changed"));
      setConfirmCancelOpen(false);
      setOrder(null);
      setTableNum(null);
      window.localStorage.removeItem("currentOrderId");
      window.localStorage.removeItem("currentTable");
    } catch (e) {
      console.error("Cancel failed", e);
      showToast("Cancel failed: " + ((e as any)?.message || String(e)), "error");
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
        showToast(e?.message || "Failed to mark delivered", "error");
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
        showToast(e?.message || "Failed to finish delivered order", "error");
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
      showToast("Could not mark as ready: " + ((e as any)?.message || String(e)), "error");
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
      showToast("Could not assign rider: " + ((e as any)?.message || String(e)), "error");
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
      const lines = buildReceiptLines(
        order,
        tableNum,
        discountPercent || 0,
        totals,
        gstConfig,
        branding,
      );
      await printReceipt({ lines });
    } catch (e) {
      console.warn("printAggregatorReceipt failed", e);
      showToast("Print failed: " + ((e as any)?.message || String(e)), "error");
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
        {/* Header bar */}
        <div className={styles.headerBar}>
          <div className={styles.headerLeft}>
            <button
              onClick={() => setTablesOpenPersisted(!tablesOpen)}
              aria-label="Toggle tables"
              title="Toggle tables (T)"
              className={styles.toggleBtn}
            >
              ☰
            </button>
            <div>
              <div className={styles.headerTitle}>
                {tableNum
                  ? `Table ${tableNum}`
                  : order && activeOrderType === "delivery"
                    ? `🚚 ${order.meta?.platform || order.meta?.orderSource || "Delivery"}${order.meta?.code ? ` #${order.meta.code}` : ""}`
                    : order && activeOrderType === "takeaway"
                      ? `🛍️ ${order.meta?.parcelName || order.meta?.customerName || "Takeaway"}`
                      : "Billing"}
              </div>
              {order && (
                <div className={styles.headerMeta}>
                  {(order.items || []).length} item{(order.items || []).length !== 1 ? "s" : ""}
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

          {/* Live totals */}
          {order && (order.items || []).length > 0 && (
            <div className={styles.headerTotals}>
              <div className={styles.textRight}>
                <div className={styles.textMuted}>SUBTOTAL</div>
                <div className={styles.headerValue}>{formatCurrency(subtotal)}</div>
              </div>
              {gstEnabled && (
                <div className={styles.textRight}>
                  <div className={styles.textMuted}>GST {gstFullPct}</div>
                  <div className={styles.headerValue}>{formatCurrency(taxTotal)}</div>
                </div>
              )}
              <div className={styles.totalsBadge}>
                <div className={styles.textMuted}>TOTAL</div>
                <div className={styles.largeValue}>{formatCurrency(finalTotal)}</div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className={styles.actionGroup}>
            <button
              onClick={sendKOT}
              disabled={!canKot}
              aria-disabled={!canKot}
              title={unsentKotItems.length > 0 ? "Send KOT (K)" : "No new KOT items to send"}
              className={`${styles.actionBtn} ${styles.actionPrimary}`}
            >
              {kotPrinting ? "Printing..." : "KOT"}
            </button>
            <button
              onClick={handlePrintBill}
              disabled={!canPrintBill}
              aria-disabled={!canPrintBill}
              title="Print bill for customer to review (B)"
              className={`${styles.actionBtn} ${styles.actionSecondary}`}
            >
              {billPrinting ? "Printing..." : "Print Bill"}
            </button>
            {activeOrderType !== "delivery" && (
              <button
                onClick={() => setPayModalOpen(true)}
                disabled={!canStartPayment}
                aria-disabled={!canStartPayment}
                title="Settle bill and clear table (P)"
                className={`${styles.actionBtn} ${styles.actionPay}`}
              >
                {paymentProcessing ? "Processing..." : "Settle"}
              </button>
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
            {order && activeOrderType !== "table" && (
              <>
                <button
                  onClick={markReady}
                  disabled={markReadyProcessing}
                  title="Mark order as ready"
                  className={styles.actionTertiary}
                  style={
                    order.status === "ready" ? { background: "#16a34a", color: "#fff" } : undefined
                  }
                >
                  {markReadyProcessing
                    ? "Saving..."
                    : order.status === "ready"
                      ? "✓ Ready"
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

        {/* Body */}
        <div className={styles.bodyRow}>
          <BillingSidebar
            open={tablesOpen}
            view={view}
            onViewChange={(newView) => {
              setView(newView);
              // Clear the active order when switching to a different tab type
              // so the main panel shows the overview for the selected tab.
              if (order) {
                const orderBelongsToView =
                  (newView === "tables" && activeOrderType === "table") ||
                  (newView === "takeaway" && activeOrderType === "takeaway") ||
                  (newView === "delivery" && activeOrderType === "delivery");
                if (!orderBelongsToView) {
                  setOrder(null);
                  setTableNum(null);
                  setDiscountPercent(0);
                  window.localStorage.removeItem("currentOrderId");
                  window.localStorage.removeItem("currentTable");
                }
              }
            }}
            tableNumbers={tableNumbers}
            tableInfos={tableInfos}
            tableNum={tableNum}
            activeOrderType={activeOrderType}
            onLoadTable={loadTable}
            takeawayOrders={takeawayOrders}
            deliveryOrders={deliveryOrders}
            currentOrderId={order?._id}
            onSelectOrder={handleSelectOrder}
            onNewTakeaway={() => setNewTakeawayOpen(true)}
            onNewDelivery={() => setNewDeliveryOpen(true)}
            formatCurrency={formatCurrency}
          />

          <div className={styles.mainContent}>
            {/* ── No active order: welcome card ──────────────────────────── */}
            {!order && (
              <div className={styles.noOrderBox}>
                <div className={styles.noOrderCard}>
                  <div className={styles.noOrderEmoji}>🍽️</div>
                  <div className={styles.noOrderTitle}>No active order</div>
                  <div className={styles.noOrderText}>
                    Pick a table from the sidebar, or start a new order below
                  </div>
                  <PickButtons
                    onPickTable={() => {
                      setTablesOpenPersisted(true);
                      setView("tables");
                    }}
                    onNewTakeaway={() => {
                      setTablesOpenPersisted(true);
                      setView("takeaway");
                      setNewTakeawayOpen(true);
                    }}
                    onNewDelivery={() => {
                      setTablesOpenPersisted(true);
                      setView("delivery");
                      setNewDeliveryOpen(true);
                    }}
                  />
                </div>
              </div>
            )}

            {/* ── Active order: search + items ───────────────────────────── */}
            {order && (
              <>
                {/* Item search */}
                <ItemSearch
                  items={items}
                  onSelect={(item) => addToOrder(item, qty)}
                  inputRef={searchRef}
                />

                {/* Favorites */}
                {favorites.length > 0 && (
                  <div className={styles.favRow}>
                    {favorites.map((f, i) => {
                      const shortcutNumber = i < QUICK_FAVORITE_SHORTCUT_LIMIT ? i + 1 : null;
                      return (
                        <button
                          key={f._id}
                          type="button"
                          onClick={() => addToOrder(f, qty)}
                          className={styles.favButton}
                        >
                          <div className={styles.favTitle}>{f.name}</div>
                          <div className={styles.favMeta}>
                            {formatCurrency(f.price)}
                            {shortcutNumber ? ` · [${shortcutNumber}]` : ""}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Order items + totals */}
                <section>
                  {(order?.items || []).length > 0 ? (
                    <div className={styles.orderList}>
                      <OrderList
                        items={order?.items || []}
                        editingQty={editingQty}
                        editingRate={editingRate}
                        setEditingQty={setEditingQty}
                        setEditingRate={setEditingRate}
                        commitQty={commitQty}
                        commitRate={commitRate}
                        removeLine={removeLine}
                        updateOrderQty={updateOrderQty}
                      />
                    </div>
                  ) : (
                    <div
                      className={styles.textMuted}
                      style={{ textAlign: "center", padding: "28px 0", fontSize: 14 }}
                    >
                      No items yet &mdash; search above to add
                    </div>
                  )}
                  <div className={styles.totalsBox}>
                    <div className={styles.totalsRow}>
                      <span>Subtotal</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                    {gstEnabled && (
                      <>
                        <div className={styles.totalsRow}>
                          <span>Taxable value</span>
                          <span>{formatCurrency(totals.taxableSubtotal)}</span>
                        </div>
                        <div className={styles.totalsRow}>
                          <span>CGST ({gstHalfPct})</span>
                          <span>{formatCurrency(cgst)}</span>
                        </div>
                        <div className={styles.totalsRow}>
                          <span>SGST ({gstHalfPct})</span>
                          <span>{formatCurrency(sgst)}</span>
                        </div>
                      </>
                    )}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 10,
                      }}
                    >
                      <div className={styles.textMuted}>Discount</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={discountPercent}
                          onChange={(e) =>
                            setDiscountPercent(
                              Math.max(0, Math.min(100, Number(e.target.value || 0))),
                            )
                          }
                          className={styles.discountInput}
                        />
                        <div className={styles.textMuted} style={{ fontSize: 13 }}>
                          %
                        </div>
                      </div>
                    </div>
                    <div className={styles.totalsRow} style={{ marginBottom: 10 }}>
                      <span>Discount amount</span>
                      <span>−{formatCurrency(discountAmt)}</span>
                    </div>
                    <div className={styles.totalsRowStrong}>
                      <span>Total</span>
                      <span>{formatCurrency(finalTotal)}</span>
                    </div>
                  </div>
                </section>
              </>
            )}

            <div className={styles.keyboardHint}>
              K — KOT &nbsp;·&nbsp; B — Print Bill &nbsp;·&nbsp; P — Pay &nbsp;·&nbsp; C — Cancel &nbsp;·&nbsp; U / Ctrl+Z — Undo
              &nbsp;·&nbsp; 1-6 - Quick add first favorites
            </div>
          </div>
        </div>

        {/* ── Modals ────────────────────────────────────────────────────── */}
        {confirmCancelOpen && order && (
          <ConfirmCancelModal
            tableNum={tableNum}
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
            name={newTakeawayName}
            phone={newTakeawayPhone}
            onNameChange={setNewTakeawayName}
            onPhoneChange={setNewTakeawayPhone}
            onClose={() => {
              setNewTakeawayOpen(false);
              setNewTakeawayName("");
              setNewTakeawayPhone("");
            }}
            onCreate={createTakeawayOrder}
            processing={creatingOrder}
          />
        )}

        {newDeliveryOpen && (
          <NewDeliveryModal
            platform={newDeliveryPlatform}
            onPlatformChange={setNewDeliveryPlatform}
            code={newDeliveryCode}
            onCodeChange={setNewDeliveryCode}
            onClose={() => {
              setNewDeliveryOpen(false);
              setNewDeliveryCode("");
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

        {/* Manager approval required when removing/reducing items after bill print */}
        {adminOverrideOpen && (
          <AdminOverrideModal
            description={adminOverrideDesc}
            onClose={() => {
              setAdminOverrideOpen(false);
              pendingOverrideRef.current = null;
            }}
            onConfirm={handleAdminOverrideConfirm}
          />
        )}
      </div>

      <PaymentsModal
        open={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        amount={finalTotal}
        onConfirm={handleConfirmPay}
        processing={paymentProcessing}
      />
    </>
  );
}
