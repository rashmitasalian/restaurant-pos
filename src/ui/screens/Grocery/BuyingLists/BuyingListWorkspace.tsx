import React from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import {
  changeGroceryListLines,
  createGroceryList,
  createGroceryPurchaseHeader,
  deleteGroceryList,
  getConfigBranding,
  getGroceryList,
  listGroceryItems,
  listGroceryPurchaseHeaders,
  listVendors,
  updateGroceryList,
  updateGroceryPurchaseHeader,
  voidGroceryPurchaseHeader,
  type GroceryItemDoc,
  type GroceryListDoc,
} from "../../../../app/db/posRepository";
import { ENV } from "../../../../config/env";
import type {
  GroceryListLinesChange,
  GroceryPurchaseDto,
  GroceryUnit,
  VendorDto,
} from "../../../../shared/pos";
import { normalizeText, validationMessage } from "../../../../shared/validation";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { ConfirmModal } from "../../../components/ui/ConfirmModal";
import { Input } from "../../../components/ui/Input";
import { PortalMenu, PortalMenuItem } from "../../../components/ui/PortalMenu";
import { Select } from "../../../components/ui/Select";
import { buyingListHtml, buyingListPrintLines } from "../buyingListPrint";
import {
  buyingListShareText,
  formatCurrency,
  formatListDate,
  GROCERY_PAYMENT_METHODS,
  GROCERY_UNITS,
  groceryUnitLabel,
  parseItemEntry,
  parseMoney,
  statusLabel,
  statusTone,
  toInputDate,
} from "../groceryUtils";
import styles from "../Grocery.module.css";

const STATUS_CLEAR_MS = 4000;

function invalidReceivedQty(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const qty = Number(trimmed);
  return !Number.isFinite(qty) || qty <= 0;
}

function ReceivedQtyInput({
  value,
  planned,
  unit,
  itemName,
  onChange,
}: {
  value: string;
  planned: number;
  unit: string;
  itemName: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      className={`${styles.qtyBox} ${invalidReceivedQty(value) ? styles.qtyBoxInvalid : ""}`}
      onClick={(e) => e.stopPropagation()}
      title={`Leave empty to keep the planned ${planned} ${groceryUnitLabel(unit)}`}
    >
      <input
        value={value}
        placeholder={String(planned)}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-label={`Received quantity of ${itemName}, planned ${planned} ${groceryUnitLabel(unit)}`}
      />
      <span aria-hidden="true">{groceryUnitLabel(unit)}</span>
    </label>
  );
}

function purchaseLinePayload(
  coveredIds: string[],
  pricedLines: Array<{ listLineId: string; lineTotal: number }>,
  receivedQty: Record<string, string>,
  singleCovered: boolean,
  coverage: "pending" | "selected" | "none",
) {
  const lines = coveredIds.map((listLineId) => {
    const received = (receivedQty[listLineId] || "").trim();
    const priced = pricedLines.find((line) => line.listLineId === listLineId);
    const entry: { listLineId: string; lineTotal?: number | null; quantity?: number } = { listLineId };
    if (!singleCovered && priced) {
      entry.lineTotal = priced.lineTotal;
    }
    if (received) {
      entry.quantity = Number(received);
    }
    return entry;
  });
  if (coverage === "selected") {
    return lines;
  }
  const changed = lines.filter((line) => line.lineTotal != null || line.quantity != null);
  return changed.length ? changed : undefined;
}

type Props = {
  listId: string;
  startCompose?: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
};

type Line = GroceryListDoc["lines"][number];
type LinePatch = { quantity?: number; unit?: GroceryUnit };

function newLineId() {
  return `grocery-list-line:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
}

export function BuyingListWorkspace({ listId, startCompose = false, onClose, onChanged }: Props) {
  const [list, setList] = React.useState<GroceryListDoc | null>(null);
  const [items, setItems] = React.useState<GroceryItemDoc[]>([]);
  const [vendors, setVendors] = React.useState<VendorDto[]>([]);
  const [purchases, setPurchases] = React.useState<GroceryPurchaseDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const [composing, setComposing] = React.useState(false);
  const [savingPurchase, setSavingPurchase] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [vendorId, setVendorId] = React.useState("");
  const [newVendor, setNewVendor] = React.useState("");
  const [showNewVendor, setShowNewVendor] = React.useState(false);
  const [paymentMethod, setPaymentMethod] = React.useState("cash");
  const [purchaseDate, setPurchaseDate] = React.useState(toInputDate(Date.now()));
  const [invoice, setInvoice] = React.useState("");
  const [showMore, setShowMore] = React.useState(false);
  const [coverage, setCoverage] = React.useState<"pending" | "selected">("pending");
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [lineAmounts, setLineAmounts] = React.useState<Record<string, string>>({});
  const [receivedQty, setReceivedQty] = React.useState<Record<string, string>>({});
  const [amountTouched, setAmountTouched] = React.useState(false);
  const [qtyDrafts, setQtyDrafts] = React.useState<Record<string, string>>({});
  const [editingBill, setEditingBill] = React.useState<GroceryPurchaseDto | null>(null);
  const [voidOpen, setVoidOpen] = React.useState(false);
  const addRef = React.useRef<HTMLInputElement>(null);
  const menuAnchor = React.useRef<HTMLDivElement>(null);
  const updateTimer = React.useRef<number | null>(null);
  const pendingUpdates = React.useRef(new Map<string, LinePatch>());
  const changeQueue = React.useRef<Promise<void>>(Promise.resolve());
  const dirtyRef = React.useRef(false);
  const startComposeUsed = React.useRef(false);
  const linesRef = React.useRef<GroceryListDoc["lines"]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [doc, catalog, vendorRows, headers] = await Promise.all([
        getGroceryList(listId),
        listGroceryItems(),
        listVendors({ includeInactive: false }),
        listGroceryPurchaseHeaders({ listId, includeVoided: false, limit: 50 }),
      ]);
      if (!doc) {
        throw new Error("Buying list not found");
      }
      setList(doc);
      linesRef.current = doc.lines;
      setItems(catalog);
      setVendors(vendorRows as VendorDto[]);
      setPurchases(headers as GroceryPurchaseDto[]);
    } catch (error) {
      setStatus(validationMessage(error, "Could not load buying list"));
    } finally {
      setLoading(false);
    }
  }, [listId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const refreshBills = async () => {
    try {
      const [doc, headers] = await Promise.all([
        getGroceryList(listId),
        listGroceryPurchaseHeaders({ listId, includeVoided: false, limit: 50 }),
      ]);
      if (!doc) {
        throw new Error("Buying list not found");
      }
      setList(doc);
      linesRef.current = doc.lines;
      setPurchases(headers as GroceryPurchaseDto[]);
    } catch {
      await load();
    }
  };

  const rememberVendor = (bill: GroceryPurchaseDto) => {
    const id = bill.vendorId;
    const name = bill.vendorName;
    if (!id || !name) {
      return;
    }
    setVendors((current) => {
      if (current.some((vendor) => vendor.id === id)) {
        return current;
      }
      const at = Date.now();
      const added: VendorDto = { _id: id, id, type: "vendor", name, active: true, createdAt: at, updatedAt: at };
      return [...current, added].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  React.useEffect(() => {
    if (!status) {
      return;
    }
    const timer = window.setTimeout(() => setStatus(null), STATUS_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const close = React.useCallback(() => {
    if (document.activeElement instanceof HTMLInputElement) {
      document.activeElement.blur();
    }
    if (updateTimer.current) {
      window.clearTimeout(updateTimer.current);
      updateTimer.current = null;
    }
    if (pendingUpdates.current.size) {
      const update = Array.from(pendingUpdates.current, ([id, patch]) => ({ id, ...patch }));
      pendingUpdates.current = new Map();
      changeQueue.current = changeQueue.current.then(async () => {
        await changeGroceryListLines(listId, { update }).catch(() => undefined);
        dirtyRef.current = true;
      });
    }
    void changeQueue.current.then(() => {
      if (dirtyRef.current) {
        void onChanged();
      }
    });
    onClose();
  }, [listId, onChanged, onClose]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) {
        return;
      }
      if (composing) {
        setComposing(false);
        return;
      }
      if (editingBill) {
        setEditingBill(null);
        return;
      }
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [composing, editingBill, close]);

  const showLines = (nextLines: GroceryListDoc["lines"]) => {
    linesRef.current = nextLines;
    setList((current) => (current ? { ...current, lines: nextLines } : current));
  };

  const applyChange = async (change: GroceryListLinesChange) => {
    try {
      const updated = await changeGroceryListLines(listId, change);
      dirtyRef.current = true;
      const unsent = pendingUpdates.current;
      linesRef.current = updated.lines.map((line) =>
        unsent.has(line.id) ? { ...line, ...unsent.get(line.id) } : line,
      );
      setList({ ...updated, lines: linesRef.current });
    } catch (error) {
      setStatus(validationMessage(error, "Could not update buying list"));
      try {
        const fresh = await getGroceryList(listId);
        if (fresh) {
          setList(fresh);
          linesRef.current = fresh.lines;
        }
      } catch {
        // keep the error already shown
      }
    }
  };

  const runChange = (change: GroceryListLinesChange) => {
    changeQueue.current = changeQueue.current.then(() => applyChange(change));
    return changeQueue.current;
  };

  const sendPendingUpdates = () => {
    if (!pendingUpdates.current.size) {
      return changeQueue.current;
    }
    const update = Array.from(pendingUpdates.current, ([id, patch]) => ({ id, ...patch }));
    pendingUpdates.current = new Map();
    return runChange({ update });
  };

  const scheduleUpdate = (lineId: string, patch: LinePatch) => {
    showLines(linesRef.current.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
    pendingUpdates.current.set(lineId, { ...pendingUpdates.current.get(lineId), ...patch });
    if (updateTimer.current) {
      window.clearTimeout(updateTimer.current);
    }
    updateTimer.current = window.setTimeout(() => {
      updateTimer.current = null;
      void sendPendingUpdates();
    }, 300);
  };

  const flush = async () => {
    if (document.activeElement instanceof HTMLInputElement) {
      document.activeElement.blur();
    }
    if (updateTimer.current) {
      window.clearTimeout(updateTimer.current);
      updateTimer.current = null;
    }
    await sendPendingUpdates();
    await changeQueue.current;
  };

  const allLines = list?.lines || [];
  const pendingLines = allLines.filter(
    (line) => line.lineStatus !== "purchased" && line.lineStatus !== "skipped",
  );
  const boughtLines = allLines.filter((line) => line.lineStatus === "purchased");
  const cancelled = list?.status === "cancelled";
  const canRecord = Boolean(list && !cancelled && pendingLines.length > 0);
  const picking = composing && coverage === "selected";

  const entry = parseItemEntry(query);
  const normalizedQuery = normalizeText(entry.name);
  const entryQtyLabel = entry.quantity ? `${entry.quantity} ${groceryUnitLabel(entry.unit || "")}` : null;
  const matches = normalizedQuery
    ? items
        .filter((item) => item.name.toLowerCase().includes(normalizedQuery.toLowerCase()))
        .slice(0, 8)
    : [];
  const exactCatalog = items.find(
    (item) => item.name.toLowerCase() === normalizedQuery.toLowerCase(),
  );
  const suggestionCount = matches.length + (!exactCatalog && normalizedQuery ? 1 : 0);

  React.useEffect(() => {
    if (!loading && list && list.lines.length === 0 && !cancelled) {
      addRef.current?.focus();
    }
  }, [loading, list?.id]);

  const addItem = async (item?: GroceryItemDoc, customName?: string) => {
    const name = item?.name || customName || normalizedQuery;
    if (!name || !list) {
      return;
    }
    if (
      linesRef.current.some(
        (line) =>
          (item?.id && line.groceryItemId === item.id) ||
          normalizeText(line.itemName).toLowerCase() === name.toLowerCase(),
      )
    ) {
      setStatus(`${name} is already on this list`);
      return;
    }
    const line = {
        id: newLineId(),
        groceryItemId: item?.id || null,
        itemName: name,
        category: item?.category || null,
        quantity: entry.quantity || item?.defaultQuantity || 1,
        unit: (entry.unit || item?.defaultUnit || "kg") as GroceryUnit,
        vendorHint: item?.vendorHint || null,
        estimatedUnitPrice: null,
        estimatedTotal: null,
        purchasedQuantity: null,
        purchasedUnitPrice: null,
        purchasedTotal: null,
        lineStatus: "pending" as const,
      };
    setQuery("");
    setHighlight(0);
    showLines([...linesRef.current, line]);
    await runChange({ add: [line] });
    addRef.current?.focus();
  };

  const updatePendingLine = (lineId: string, patch: LinePatch) => {
    const line = linesRef.current.find((row) => row.id === lineId);
    if (!line || line.lineStatus === "purchased") {
      return;
    }
    scheduleUpdate(lineId, patch);
  };

  const commitQty = (lineId: string) => {
    const draft = qtyDrafts[lineId];
    setQtyDrafts(({ [lineId]: _drop, ...rest }) => rest);
    if (draft == null) {
      return;
    }
    const quantity = Number(draft.replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setStatus("Quantity must be more than 0.");
      return;
    }
    updatePendingLine(lineId, { quantity: Math.round(quantity * 1000) / 1000 });
  };

  const removePending = (lineId: string) => {
    const line = linesRef.current.find((row) => row.id === lineId);
    if (line?.lineStatus === "purchased") {
      setStatus("Void the purchase to change this item.");
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(lineId);
      return next;
    });
    pendingUpdates.current.delete(lineId);
    showLines(linesRef.current.filter((row) => row.id !== lineId));
    void runChange({ remove: [lineId] });
  };

  const toggleSelected = (lineId: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) {
      next.add(lineId);
    } else {
      next.delete(lineId);
    }
    setSelectedIds(next);
    recalcAutoAmount(
      lineAmounts,
      pendingLines.filter((line) => next.has(line.id)).map((line) => line.id),
    );
  };

  const chooseCoverage = (next: "pending" | "selected") => {
    setCoverage(next);
    setSelectedIds(new Set());
    recalcAutoAmount(lineAmounts, next === "pending" ? pendingLines.map((line) => line.id) : []);
  };

  const beginCompose = async () => {
    if (cancelled) {
      return;
    }
    await flush();
    const fresh = await getGroceryList(listId);
    if (fresh) {
      setList(fresh);
      linesRef.current = fresh.lines;
    }
    const pending = (fresh?.lines || []).filter(
      (line) => line.lineStatus !== "purchased" && line.lineStatus !== "skipped",
    );
    if (!pending.length) {
      setStatus("Add an item before recording another purchase.");
      addRef.current?.focus();
      return;
    }
    setAmount("");
    setVendorId("");
    setNewVendor("");
    setShowNewVendor(false);
    setPaymentMethod("cash");
    setPurchaseDate(toInputDate(Date.now()));
    setInvoice("");
    setShowMore(false);
    setCoverage("pending");
    setReceivedQty({});
    setSelectedIds(new Set());
    setLineAmounts({});
    setAmountTouched(false);
    setEditingBill(null);
    setComposing(true);
    setStatus(null);
  };

  React.useEffect(() => {
    if (!startCompose || !list || loading || startComposeUsed.current) {
      return;
    }
    startComposeUsed.current = true;
    void beginCompose();
  }, [startCompose, list, loading]);

  const coveredIds =
    coverage === "selected"
      ? pendingLines.filter((line) => selectedIds.has(line.id)).map((line) => line.id)
      : pendingLines.map((line) => line.id);
  const singleCovered = coveredIds.length === 1;
  const pricedLines = (singleCovered ? [] : coveredIds)
    .map((listLineId) => ({ listLineId, lineTotal: parseMoney(lineAmounts[listLineId] || "") }))
    .filter((line): line is { listLineId: string; lineTotal: number } => line.lineTotal != null && line.lineTotal > 0);
  const itemSum = +pricedLines.reduce((sum, line) => sum + line.lineTotal, 0).toFixed(2);

  const recalcAutoAmount = (nextAmounts: Record<string, string>, nextCovered: string[]) => {
    if (amountTouched) {
      return;
    }
    const sum = nextCovered.reduce((acc, id) => acc + (parseMoney(nextAmounts[id] || "") || 0), 0);
    setAmount(sum > 0 ? String(+sum.toFixed(2)) : "");
  };

  const setLineAmount = (lineId: string, value: string) => {
    const next = { ...lineAmounts, [lineId]: value };
    setLineAmounts(next);
    recalcAutoAmount(next, coveredIds);
  };

  const parsedAmount = parseMoney(amount);
  const saveBlocker = !canRecord
    ? "Nothing left to buy on this list."
    : parsedAmount == null || parsedAmount <= 0
      ? "Enter the bill amount, or item amounts on the left."
      : coverage === "selected" && selectedIds.size === 0
        ? "Tick the items this bill covers."
        : itemSum > parsedAmount
          ? "Item amounts add up to more than the bill."
          : coveredIds.some((id) => invalidReceivedQty(receivedQty[id] || ""))
            ? "Received quantity must be greater than zero."
            : null;

  const savePurchase = async () => {
    if (!list || savingPurchase) {
      return;
    }
    if (saveBlocker || parsedAmount == null) {
      setStatus(saveBlocker || "Enter the bill amount.");
      return;
    }
    await flush();
    setSavingPurchase(true);
    setStatus(null);
    try {
      const saved = await createGroceryPurchaseHeader({
        buyingListId: list.id,
        total: parsedAmount,
        vendorId: showNewVendor ? null : vendorId || null,
        vendorName: showNewVendor ? newVendor.trim() || null : null,
        paymentMethod,
        purchaseDate: new Date(`${purchaseDate}T12:00:00`).getTime(),
        invoiceNumber: invoice.trim() || null,
        coverage,
        lines: purchaseLinePayload(coveredIds, pricedLines, receivedQty, singleCovered, coverage),
      });
      setComposing(false);
      setStatus("Purchase recorded");
      dirtyRef.current = true;
      rememberVendor(saved);
      await refreshBills();
    } catch (error) {
      setStatus(validationMessage(error, "Could not save purchase"));
    } finally {
      setSavingPurchase(false);
    }
  };

  const beginEdit = (bill: GroceryPurchaseDto) => {
    if (composing || savingPurchase) {
      return;
    }
    setAmount(String(bill.total));
    setAmountTouched(true);
    setVendorId(bill.vendorId || "");
    setNewVendor("");
    setShowNewVendor(false);
    setPaymentMethod(bill.paymentMethod || "cash");
    setPurchaseDate(toInputDate(bill.purchaseDate));
    setInvoice(bill.invoiceNumber || "");
    setShowMore(Boolean(bill.invoiceNumber));
    setReceivedQty({});
    setLineAmounts(
      Object.fromEntries(
        (bill.lines || []).map((line) => [line.id, line.totalAmount > 0 ? String(line.totalAmount) : ""]),
      ),
    );
    setEditingBill(bill);
    setStatus(null);
  };

  const editLines = editingBill?.lines || [];
  const editSingle = editLines.length === 1;
  const editItemSum = +(editSingle ? [] : editLines)
    .reduce((sum, line) => sum + (parseMoney(lineAmounts[line.id] || "") || 0), 0)
    .toFixed(2);
  const editBlocker =
    parsedAmount == null || parsedAmount <= 0
      ? "Enter the bill amount."
      : editItemSum > parsedAmount
        ? "Item amounts add up to more than the bill."
        : editLines.some((line) => invalidReceivedQty(receivedQty[line.id] || ""))
          ? "Received quantity must be greater than zero."
          : null;

  const saveEdit = async () => {
    if (!editingBill || savingPurchase) {
      return;
    }
    if (editBlocker || parsedAmount == null) {
      setStatus(editBlocker || "Enter the bill amount.");
      return;
    }
    setSavingPurchase(true);
    try {
      const saved = await updateGroceryPurchaseHeader(editingBill.id, {
        total: parsedAmount,
        vendorId: showNewVendor ? null : vendorId || null,
        vendorName: showNewVendor ? newVendor.trim() || null : null,
        paymentMethod,
        purchaseDate: new Date(`${purchaseDate}T12:00:00`).getTime(),
        invoiceNumber: invoice.trim() || null,
        lines: editLines
          .map((line) => {
            const received = (receivedQty[line.id] || "").trim();
            return {
              purchaseLineId: line.id,
              ...(editSingle ? {} : { lineTotal: parseMoney(lineAmounts[line.id] || "") ?? null }),
              ...(received ? { quantity: Number(received) } : {}),
            };
          })
          .filter((line) => line.lineTotal !== undefined || line.quantity !== undefined),
      });
      setEditingBill(null);
      setStatus("Bill updated");
      dirtyRef.current = true;
      rememberVendor(saved);
      await refreshBills();
    } catch (error) {
      setStatus(validationMessage(error, "Could not update bill"));
    } finally {
      setSavingPurchase(false);
    }
  };

  const voidBill = async () => {
    if (!editingBill) {
      return;
    }
    try {
      await voidGroceryPurchaseHeader(editingBill.id);
      setVoidOpen(false);
      setEditingBill(null);
      setStatus("Bill voided — its items are back on the list to buy.");
      dirtyRef.current = true;
      await refreshBills();
    } catch (error) {
      setVoidOpen(false);
      setStatus(validationMessage(error, "Could not void bill"));
    }
  };

  const billByListLine = new Map<string, GroceryPurchaseDto>();
  for (const bill of purchases) {
    for (const line of bill.lines || []) {
      if (line.listLineId) {
        billByListLine.set(line.listLineId, bill);
      }
    }
  }

  const printList = async () => {
    await flush();
    const fresh = await updateGroceryList(listId, { recordPrint: true });
    dirtyRef.current = true;
    setList(fresh);
    linesRef.current = fresh.lines;
    if (!window.pos?.print) {
      setStatus("Print is unavailable.");
      return;
    }
    const result = await window.pos.print({
      type: "receipt",
      printer: "counter",
      data: { lines: buyingListPrintLines(fresh, false) },
    });
    setStatus(result?.ok ? "Buying list sent to printer" : result?.error || "print-failed");
  };

  const copyList = async () => {
    await flush();
    const fresh = (await getGroceryList(listId)) || list;
    if (!fresh) {
      return;
    }
    let restaurant = ENV.HOTEL_NAME || "Restaurant";
    try {
      const branding = await getConfigBranding();
      restaurant = branding.hotelName || restaurant;
    } catch {
      // use fallback name
    }
    const text = buyingListShareText(fresh, restaurant);
    try {
      if (window.pos?.copyText) {
        await window.pos.copyText(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setStatus("List copied — paste it into WhatsApp or SMS.");
    } catch {
      setStatus("Could not copy the list.");
    }
  };

  const exportPdf = async () => {
    setMenuOpen(false);
    await flush();
    const fresh = (await getGroceryList(listId)) || list;
    if (!fresh || !window.pos?.exportReportPdf) {
      return;
    }
    try {
      const result = await window.pos.exportReportPdf(
        buyingListHtml(fresh),
        `buying-list-${fresh.id.slice(-8)}`,
      );
      if (result?.ok) {
        setStatus("PDF exported");
      } else if (result?.reason !== "cancelled") {
        setStatus(result?.error || "Could not export PDF");
      }
    } catch (error) {
      setStatus(validationMessage(error, "Could not export PDF"));
    }
  };

  const duplicateList = async () => {
    if (!list) {
      return;
    }
    const copy = await createGroceryList({
      title: `${list.title}`,
      sourceListId: list.id,
      listDate: Date.now(),
    });
    setMenuOpen(false);
    setStatus(`Duplicated as ${copy.title}`);
    dirtyRef.current = true;
  };

  if (!list && loading) {
    return null;
  }

  const renderPendingRow = (line: Line) => (
    <div
      key={line.id}
      className={`${styles.ticketRow} ${picking ? styles.ticketRowPicking : ""} ${
        picking && selectedIds.has(line.id) ? styles.ticketRowPicked : ""
      }`}
      onClick={picking ? () => toggleSelected(line.id, !selectedIds.has(line.id)) : undefined}
    >
      {picking ? (
        <input
          type="checkbox"
          className={styles.ticketCheck}
          checked={selectedIds.has(line.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => toggleSelected(line.id, e.target.checked)}
          aria-label={`Cover ${line.itemName}`}
        />
      ) : null}
      {composing ? (
        <div className={styles.lineItem}>
          <span className={styles.ticketName}>{line.itemName}</span>
        </div>
      ) : (
        <div className={styles.ticketName}>{line.itemName}</div>
      )}
      {composing ? (
        <>
          {!picking || selectedIds.has(line.id) ? (
            <ReceivedQtyInput
              value={receivedQty[line.id] || ""}
              planned={line.quantity}
              unit={line.unit}
              itemName={line.itemName}
              onChange={(value) => setReceivedQty((current) => ({ ...current, [line.id]: value }))}
            />
          ) : (
            <span className={styles.qtyBoxSpacer} />
          )}
          {singleCovered && coveredIds[0] === line.id ? (
            <span className={`${styles.linePriceSpacer} ${styles.ticketMoneyMuted}`}>whole bill</span>
          ) : !picking || selectedIds.has(line.id) ? (
            <label className={styles.linePrice} onClick={(e) => e.stopPropagation()}>
              <span aria-hidden="true">₹</span>
              <input
                value={lineAmounts[line.id] || ""}
                onChange={(e) => setLineAmount(line.id, e.target.value)}
                inputMode="decimal"
                placeholder="Amount"
                aria-label={`Amount for ${line.itemName}`}
              />
            </label>
          ) : (
            <span className={styles.linePriceSpacer} />
          )}
        </>
      ) : cancelled ? (
        <div className={styles.ticketQty}>
          {line.quantity} {groceryUnitLabel(line.unit)}
        </div>
      ) : (
        <>
          <div className={styles.qtyEditor}>
            <input
              value={qtyDrafts[line.id] ?? String(line.quantity)}
              onChange={(e) => setQtyDrafts((current) => ({ ...current, [line.id]: e.target.value }))}
              onBlur={() => commitQty(line.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              onFocus={(e) => e.currentTarget.select()}
              inputMode="decimal"
              aria-label={`Quantity of ${line.itemName}`}
            />
            <select
              value={line.unit}
              onChange={(e) => updatePendingLine(line.id, { unit: e.target.value as GroceryUnit })}
              aria-label={`Unit for ${line.itemName}`}
            >
              {GROCERY_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {groceryUnitLabel(unit)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={styles.ticketRemove}
            onClick={() => removePending(line.id)}
            aria-label={`Remove ${line.itemName}`}
            title="Remove"
          >
            <Icon icon={X} size="sm" />
          </button>
        </>
      )}
    </div>
  );

  const renderBoughtRow = (line: Line) => {
    const bill = billByListLine.get(line.id);
    const inEditedBill = Boolean(editingBill && bill?.id === editingBill.id);
    const editedLine = inEditedBill
      ? editLines.find((row) => row.listLineId === line.id)
      : undefined;
    const liveAmount = inEditedBill
      ? editSingle
        ? parsedAmount
        : parseMoney(lineAmounts[editedLine?.id || ""] || "")
      : null;
    const shownAmount = liveAmount != null && liveAmount > 0 ? liveAmount : line.purchasedTotal;
    return (
      <button
        key={line.id}
        type="button"
        className={`${styles.ticketRow} ${styles.ticketRowPurchased} ${styles.ticketRowButton} ${
          inEditedBill ? styles.ticketRowPicked : ""
        }`}
        onClick={bill ? () => beginEdit(bill) : undefined}
        disabled={!bill || composing}
        title={bill ? "Open this bill to edit amounts" : undefined}
      >
        <span className={styles.ticketTick} aria-hidden="true">
          <Icon icon={Check} size="sm" />
        </span>
        <span className={styles.ticketName}>{line.itemName}</span>
        <span className={styles.ticketQty}>
          {line.purchasedQuantity ?? line.quantity} {groceryUnitLabel(line.unit)}
        </span>
        <span className={styles.ticketMoney}>
          {shownAmount ? (
            formatCurrency(shownAmount)
          ) : bill ? (
            <span className={styles.ticketMoneyMuted}>in {formatCurrency(bill.total)} bill</span>
          ) : (
            ""
          )}
        </span>
      </button>
    );
  };

  const billDetailFields = (
    <>
      <Select
        label="Vendor"
        value={showNewVendor ? "__new__" : vendorId}
        onChange={(e) => {
          if (e.target.value === "__new__") {
            setShowNewVendor(true);
            setVendorId("");
          } else {
            setShowNewVendor(false);
            setVendorId(e.target.value);
          }
        }}
      >
        <option value="">Not specified</option>
        {vendors.map((vendor) => (
          <option key={vendor.id} value={vendor.id}>
            {vendor.name}
          </option>
        ))}
        <option value="__new__">+ New vendor…</option>
      </Select>
      {showNewVendor ? (
        <Input
          label="New vendor name"
          value={newVendor}
          onChange={(e) => setNewVendor(e.target.value)}
          autoFocus
        />
      ) : null}

      <div className={styles.composeRow}>
        <Select
          label="Paid by"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
        >
          {GROCERY_PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </Select>
        <Input
          label="Date"
          type="date"
          value={purchaseDate}
          max={toInputDate(Date.now())}
          onChange={(e) => setPurchaseDate(e.target.value)}
        />
      </div>

      {showMore ? (
        <Input
          label="Invoice / bill no."
          value={invoice}
          onChange={(e) => setInvoice(e.target.value)}
        />
      ) : (
        <button type="button" className={styles.linkButton} onClick={() => setShowMore(true)}>
          + Add invoice number
        </button>
      )}
    </>
  );

  const editForm = editingBill ? (
    <div className={styles.composeForm}>
      <div className={styles.railHead}>
        <span className={styles.railTitle}>Edit bill</span>
      </div>
      <div className={styles.composeFields}>
        <label className={styles.amountField}>
          <span className="ui-label">Bill amount</span>
          <span className={styles.amountInputWrap}>
            <span aria-hidden="true">₹</span>
            <input
              className={styles.amountInput}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveEdit();
                }
              }}
              inputMode="decimal"
              autoFocus
            />
          </span>
          <span className={styles.amountHint}>
            {editSingle
              ? "One item — the whole bill goes to it."
              : editItemSum > 0 && parsedAmount != null && parsedAmount > editItemSum
              ? `Items ${formatCurrency(editItemSum)} · ${formatCurrency(
                  +(parsedAmount - editItemSum).toFixed(2),
                )} not split to items`
              : editItemSum > 0
                ? `Items add up to ${formatCurrency(editItemSum)}`
                : editLines.length === 1
                  ? "The whole bill goes to this item."
                  : "Optional: split the bill across items below."}
          </span>
        </label>

        <div className={styles.editItems}>
          <span className="ui-label">Items on this bill</span>
          <div className={`${styles.editItemRow} ${styles.editItemHead}`} aria-hidden="true">
            <span>Item</span>
            <span>Received</span>
            <span>Amount</span>
          </div>
          {editLines.map((line) => (
            <div key={line.id} className={styles.editItemRow}>
              <span className={styles.editItemName}>
                <span className={styles.editItemTitle}>{line.itemName}</span>
              </span>
              <ReceivedQtyInput
                value={receivedQty[line.id] || ""}
                planned={line.quantity}
                unit={line.unit}
                itemName={line.itemName}
                onChange={(value) => setReceivedQty((current) => ({ ...current, [line.id]: value }))}
              />
              {editSingle ? (
                <strong className={styles.editItemAmount}>
                  {parsedAmount != null ? formatCurrency(parsedAmount) : "—"}
                </strong>
              ) : (
                <label className={styles.linePrice}>
                  <span aria-hidden="true">₹</span>
                  <input
                    value={lineAmounts[line.id] || ""}
                    onChange={(e) =>
                      setLineAmounts((current) => ({ ...current, [line.id]: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder="Amount"
                    aria-label={`Amount for ${line.itemName}`}
                  />
                </label>
              )}
            </div>
          ))}
          <span className={styles.amountHint}>
            To change which items this bill covers, void it and record it again.
          </span>
        </div>

        {billDetailFields}

        <Button variant="danger-ghost" size="sm" className={styles.voidBill} onClick={() => setVoidOpen(true)}>
          Void this bill
        </Button>
      </div>
      <div className={styles.composeFooter}>
        {editBlocker ? <div className={styles.composeReason}>{editBlocker}</div> : null}
        <div className={styles.composeActions}>
          <Button variant="secondary" onClick={() => setEditingBill(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void saveEdit()}
            loading={savingPurchase}
            disabled={Boolean(editBlocker)}
          >
            Save changes
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  const body = (
    <div className={styles.editorOverlay} role="dialog" aria-modal="true" aria-label="Buying list">
      <div className={`${styles.editorPane} ${styles.workspacePane}`}>
        <header className={styles.workspaceHeader}>
          <div className={styles.workspaceHeading}>
            <div className={styles.workspaceTitleRow}>
              <h2 className={styles.editorTitle}>{list?.title || "Buying list"}</h2>
              {list ? (
                <Badge tone={statusTone(list.status)}>{statusLabel(list.status)}</Badge>
              ) : null}
            </div>
            {list ? <div className={styles.sessionMeta}>{formatListDate(list.listDate)}</div> : null}
          </div>
          <div className={styles.workspaceActions}>
            <Button variant="secondary" onClick={() => void printList()} disabled={!list}>
              Print
            </Button>
            <Button variant="secondary" onClick={() => void copyList()} disabled={!list}>
              Copy list
            </Button>
            {!cancelled && !composing && !editingBill ? (
              <Button
                variant="primary"
                onClick={() => void beginCompose()}
                disabled={!list}
              >
                Record purchase
              </Button>
            ) : null}
            <div ref={menuAnchor}>
              <Button
                variant="ghost"
                aria-haspopup="menu"
                aria-label="More actions"
                onClick={() => setMenuOpen((open) => !open)}
              >
                •••
              </Button>
            </div>
            <PortalMenu open={menuOpen} anchorRef={menuAnchor} onClose={() => setMenuOpen(false)} align="right">
              <PortalMenuItem onClick={() => void exportPdf()}>Export PDF</PortalMenuItem>
              <PortalMenuItem onClick={() => void duplicateList()}>Duplicate list</PortalMenuItem>
              {list?.status === "draft" ? (
                <PortalMenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  Delete draft
                </PortalMenuItem>
              ) : !cancelled ? (
                <PortalMenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    setCancelOpen(true);
                  }}
                >
                  Cancel list
                </PortalMenuItem>
              ) : null}
            </PortalMenu>
            <button
              type="button"
              className={styles.workspaceClose}
              onClick={close}
              aria-label="Close"
              title="Close (Esc)"
            >
              <Icon icon={X} size="md" />
            </button>
          </div>
        </header>

        {status ? (
          <div className={styles.workspaceToast} role="status">
            {status}
          </div>
        ) : null}

        <div className={styles.workspaceLayout}>
          <section className={styles.ticketCard} aria-label="Buying list items">
            {!cancelled && !composing ? (
              <div className={styles.ticketAdd}>
                <input
                  ref={addRef}
                  className="ui-input"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlight(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setHighlight((i) => Math.min(i + 1, Math.max(0, suggestionCount - 1)));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setHighlight((i) => Math.max(0, i - 1));
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      if (matches[highlight]) {
                        void addItem(matches[highlight]);
                      } else if (normalizedQuery) {
                        void addItem(undefined, normalizedQuery);
                      }
                    } else if (e.key === "Escape" && query) {
                      e.preventDefault();
                      setQuery("");
                    }
                  }}
                  placeholder="Add an item — e.g. Tomato 2 kg, 10 L oil, 250g jeera powder"
                  aria-label="Add an item"
                />
                {normalizedQuery ? (
                  <div className={styles.ticketSuggest} role="listbox">
                    {matches.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={index === highlight}
                        className={`${styles.ticketSuggestItem} ${
                          index === highlight ? styles.ticketSuggestActive : ""
                        }`}
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => void addItem(item)}
                      >
                        <span>{item.name}</span>
                        <span className={styles.addItemMeta}>
                          {entryQtyLabel || `${item.defaultQuantity} ${item.defaultUnit}`}
                        </span>
                      </button>
                    ))}
                    {!exactCatalog ? (
                      <button
                        type="button"
                        role="option"
                        aria-selected={highlight === matches.length}
                        className={`${styles.ticketSuggestItem} ${
                          highlight === matches.length ? styles.ticketSuggestActive : ""
                        }`}
                        onMouseEnter={() => setHighlight(matches.length)}
                        onClick={() => void addItem(undefined, normalizedQuery)}
                      >
                        <span>+ Add “{normalizedQuery}”</span>
                        <span className={styles.addItemMeta}>{entryQtyLabel || "1 kg · change after adding"}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {composing ? (
              <div className={styles.pickBanner}>
                {picking
                  ? `Tick the items this bill covers · ${selectedIds.size} of ${pendingLines.length} selected`
                  : "This bill covers every item below"}
                <span className={styles.pickBannerSub}>
                  Item amounts are optional. Type them if the bill shows them.
                </span>
              </div>
            ) : null}

            <div className={styles.ticketBody}>
              {allLines.length === 0 ? (
                <div className={styles.ticketEmpty}>
                  <strong>This list is empty</strong>
                  <span>Type an item above and press Enter. Add as many as you need.</span>
                </div>
              ) : (
                <>
                  {pendingLines.length ? (
                    <div className={styles.ticketSection}>
                      <div className={styles.ticketSectionHead}>
                        <span>To buy</span>
                        <span>{pendingLines.length}</span>
                      </div>
                      {composing ? (
                        <div className={styles.lineColumns} aria-hidden="true">
                          {picking ? <span className={styles.lineColumnsCheck} /> : null}
                          <span className={styles.lineColumnsItem}>Item</span>
                          <span className={styles.lineColumnsQty}>Received</span>
                          <span className={styles.lineColumnsAmount}>Amount</span>
                        </div>
                      ) : null}
                      {pendingLines.map(renderPendingRow)}
                    </div>
                  ) : null}
                  {boughtLines.length ? (
                    <div className={styles.ticketSection}>
                      <div className={styles.ticketSectionHead}>
                        <span>Bought</span>
                        <span>{boughtLines.length}</span>
                      </div>
                      {boughtLines.map(renderBoughtRow)}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>

          <aside className={styles.railCard}>
            {composing ? (
              <div className={styles.composeForm}>
                <div className={styles.railHead}>
                  <span className={styles.railTitle}>Record purchase</span>
                </div>
                <div className={styles.composeFields}>
                  <label className={styles.amountField}>
                    <span className="ui-label">Bill amount</span>
                    <span className={styles.amountInputWrap}>
                      <span aria-hidden="true">₹</span>
                      <input
                        className={styles.amountInput}
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          setAmountTouched(e.target.value.trim() !== "");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void savePurchase();
                          }
                        }}
                        inputMode="decimal"
                        placeholder="0"
                        autoFocus
                      />
                    </span>
                    <span className={styles.amountHint}>
                      {singleCovered
                        ? "One item — the whole bill goes to it."
                        : itemSum > 0
                        ? parsedAmount != null && parsedAmount > itemSum
                          ? `Items ${formatCurrency(itemSum)} · ${formatCurrency(
                              +(parsedAmount - itemSum).toFixed(2),
                            )} not split to items`
                          : `Items add up to ${formatCurrency(itemSum)}`
                        : "Optional: add item amounts next to each item."}
                    </span>
                  </label>

                  <div className={styles.coverageBlock}>
                    <span className="ui-label">This bill covers</span>
                    <div className={styles.segmented} role="radiogroup" aria-label="This bill covers">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={coverage === "pending"}
                        className={coverage === "pending" ? styles.segmentedActive : ""}
                        onClick={() => chooseCoverage("pending")}
                      >
                        All to buy ({pendingLines.length})
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={coverage === "selected"}
                        className={coverage === "selected" ? styles.segmentedActive : ""}
                        onClick={() => chooseCoverage("selected")}
                      >
                        Pick items
                      </button>
                    </div>
                  </div>

                  {billDetailFields}
                </div>

                <div className={styles.composeFooter}>
                  {saveBlocker ? <div className={styles.composeReason}>{saveBlocker}</div> : null}
                  <div className={styles.composeActions}>
                    <Button variant="secondary" onClick={() => setComposing(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => void savePurchase()}
                      loading={savingPurchase}
                      disabled={Boolean(saveBlocker)}
                    >
                      Save purchase
                    </Button>
                  </div>
                </div>
              </div>
            ) : editForm ? (
              editForm
            ) : (
              <div className={styles.railBody}>
                <div className={styles.spendStat}>
                  <span className="ui-label">Spent on this list</span>
                  <div className={styles.spendValue}>{formatCurrency(list?.spentTotal || 0)}</div>
                  <div className={styles.spendMeta}>
                    {pendingLines.length} to buy · {boughtLines.length} bought
                  </div>
                </div>
                <div className={styles.billStack}>
                  <div className={styles.ticketSectionHead}>
                    <span>Bills</span>
                    <span>{purchases.length || ""}</span>
                  </div>
                  {purchases.length === 0 ? (
                    <div className={styles.hint}>No purchases recorded yet.</div>
                  ) : (
                    purchases.map((bill) => (
                      <button
                        key={bill.id}
                        type="button"
                        className={`${styles.billRow} ${styles.billRowButton}`}
                        onClick={() => beginEdit(bill)}
                        title="Edit this bill"
                      >
                        <div className={styles.billMain}>
                          <span className={styles.billVendor}>{bill.vendorName || "Vendor not specified"}</span>
                          <span className={styles.billMeta}>
                            {formatListDate(bill.purchaseDate)}
                            {bill.lines?.length
                              ? ` · ${bill.lines.length} item${bill.lines.length === 1 ? "" : "s"}`
                              : ""}
                          </span>
                        </div>
                        <span className={styles.billAmount}>
                          <strong>{formatCurrency(bill.total)}</strong>
                          <span className={styles.billEdit}>Edit</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
                {!cancelled ? (
                  canRecord ? (
                    <Button variant="secondary" onClick={() => void beginCompose()}>
                      + Record purchase
                    </Button>
                  ) : allLines.length ? (
                    <div className={styles.hint}>Everything on this list is bought.</div>
                  ) : null
                ) : (
                  <div className={styles.hint}>This list was cancelled.</div>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>

      <ConfirmModal
        open={cancelOpen}
        title="Cancel buying list?"
        onClose={() => setCancelOpen(false)}
        onConfirm={async () => {
          await updateGroceryList(listId, { status: "cancelled" });
          setCancelOpen(false);
          await onChanged();
          onClose();
        }}
        confirmLabel="Cancel list"
      >
        <p style={{ margin: 0 }}>This list will stay in history as cancelled. Recorded purchases are kept.</p>
      </ConfirmModal>
      <ConfirmModal
        open={voidOpen}
        title="Void this bill?"
        onClose={() => setVoidOpen(false)}
        onConfirm={() => void voidBill()}
        confirmLabel="Void bill"
      >
        <p style={{ margin: 0 }}>
          {editingBill
            ? `${formatCurrency(editingBill.total)} is removed from spend and its ${editLines.length} item${
                editLines.length === 1 ? "" : "s"
              } go back to "To buy". The bill stays in Purchases as voided.`
            : null}
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={deleteOpen}
        title="Delete draft list?"
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await deleteGroceryList(listId);
          setDeleteOpen(false);
          await onChanged();
          onClose();
        }}
        confirmLabel="Delete permanently"
      >
        <p style={{ margin: 0 }}>This draft will be removed.</p>
      </ConfirmModal>
    </div>
  );

  return createPortal(body, document.body);
}
