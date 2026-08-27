import React from "react";
import { createPortal } from "react-dom";
import {
  createGroceryPurchase,
  createVendor,
  getGroceryList,
  listGroceryItems,
  listGroceryPurchaseHeaders,
  listGroceryPurchases,
  listVendors,
  updateGroceryList,
  type GroceryItemDoc,
  type GroceryListDoc,
  type GroceryPurchaseLineDoc,
} from "../../../../app/db/posRepository";
import type { GroceryUnit, VendorDto } from "../../../../shared/pos";
import {
  normalizeCategoryName,
  normalizeText,
  validationMessage,
} from "../../../../shared/validation";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { buyingListHtml, buyingListPrintLines } from "../buyingListPrint";
import {
  formatCurrency,
  formatListDate,
  fromInputDate,
  plannedTotal,
  toInputDate,
} from "../groceryUtils";
import styles from "../Grocery.module.css";

const UNITS: GroceryUnit[] = ["kg", "g", "L", "ml", "unit", "packet", "box", "dozen", "bunch"];
const PAYMENT_METHODS = ["cash", "upi", "card", "online", "other"];
const LIST_TOTAL_ITEM_NAME = "Buying List Total";
const LIST_TOTAL_CATEGORY = "List Total";
const ADD_ITEM_MIN_SEARCH_CHARS = 2;
const ADD_ITEM_RESULT_LIMIT = 15;
const LINE_GRID =
  "minmax(160px, 2fr) minmax(64px, 0.45fr) minmax(80px, 0.55fr) minmax(88px, 0.65fr) minmax(160px, 180px)";

type ListRecordMode = "item" | "total";
type DraftLine = GroceryListDoc["lines"][number];

type Props = {
  listId: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
};

function newLineId() {
  return `grocery-list-line:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
}

function draftLineFromItem(item: GroceryItemDoc): DraftLine {
  return {
    id: newLineId(),
    groceryItemId: item.id,
    itemName: item.name,
    category: item.category || null,
    quantity: item.defaultQuantity || 1,
    unit: item.defaultUnit || "kg",
    vendorHint: item.vendorHint || null,
    estimatedUnitPrice: null,
    estimatedTotal: null,
    purchasedQuantity: null,
    purchasedUnitPrice: null,
    purchasedTotal: null,
    lineStatus: "pending",
  };
}

function draftCustomLine(name: string): DraftLine {
  return {
    id: newLineId(),
    groceryItemId: null,
    itemName: name,
    category: null,
    quantity: 1,
    unit: "kg",
    vendorHint: null,
    estimatedUnitPrice: null,
    estimatedTotal: null,
    purchasedQuantity: null,
    purchasedUnitPrice: null,
    purchasedTotal: null,
    lineStatus: "pending",
  };
}

function groceryRecordKey(line: { groceryItemId?: string | null; itemName: string }) {
  return `${line.groceryItemId || ""}::${normalizeText(line.itemName).toLowerCase()}`;
}

function isListTotalPurchase(purchase: GroceryPurchaseLineDoc) {
  return (
    normalizeText(purchase.itemName).toLowerCase() === LIST_TOTAL_ITEM_NAME.toLowerCase() &&
    normalizeText(purchase.category).toLowerCase() === LIST_TOTAL_CATEGORY.toLowerCase()
  );
}

function parseAmount(value: string) {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function BuyingListEditor({ listId, onClose, onChanged }: Props) {
  const [list, setList] = React.useState<GroceryListDoc | null>(null);
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [items, setItems] = React.useState<GroceryItemDoc[]>([]);
  const [purchases, setPurchases] = React.useState<GroceryPurchaseLineDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [addQuery, setAddQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const [recordMode, setRecordMode] = React.useState<ListRecordMode>("item");
  const [purchaseLineIndex, setPurchaseLineIndex] = React.useState<number | null>(null);
  const [purchaseForm, setPurchaseForm] = React.useState({
    quantity: 1,
    unit: "kg" as GroceryUnit,
    unitPrice: "",
    totalAmount: "",
    vendor: "",
    paymentMethod: "cash",
    notes: "",
    purchasedDate: toInputDate(Date.now()),
  });
  const [totalOpen, setTotalOpen] = React.useState(false);
  const [totalForm, setTotalForm] = React.useState({
    totalAmount: "",
    vendor: "",
    paymentMethod: "cash",
    notes: "",
    purchasedDate: toInputDate(Date.now()),
  });
  const [vendors, setVendors] = React.useState<VendorDto[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [doc, groceryItems, purchaseLines, vendorRows, purchaseHeaders] = await Promise.all([
        getGroceryList(listId),
        listGroceryItems(),
        listGroceryPurchases({ listId, limit: 200 }),
        listVendors({ includeInactive: false }),
        listGroceryPurchaseHeaders({ listId, includeVoided: true, limit: 100 }),
      ]);
      if (!doc) throw new Error("Buying list not found");
      setList(doc);
      setLines(doc.lines.map((line) => ({ ...line })));
      setTitle(doc.title);
      setNotes(doc.notes || "");
      setItems(groceryItems);
      const voidedHeaderIds = new Set(
        (purchaseHeaders as any[])
          .filter((h) => h.status === "voided")
          .map((h) => h.id),
      );
      const activePurchases = purchaseLines.filter(
        (p: any) => !p.purchaseId || !voidedHeaderIds.has(p.purchaseId),
      );
      setPurchases(activePurchases);
      setVendors(vendorRows as VendorDto[]);
      const hasTotal = activePurchases.some(isListTotalPurchase);
      const hasItem = activePurchases.some((p) => !isListTotalPurchase(p));
      setRecordMode(hasTotal ? "total" : "item");
      if (hasItem && hasTotal) setStatus("Mixed purchase modes detected for this list.");
    } catch (error) {
      setStatus(validationMessage(error, "Could not load editor"));
    } finally {
      setLoading(false);
    }
  }, [listId]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const listTotalPurchase = purchases.find(isListTotalPurchase) || null;
  const itemPurchases = purchases.filter((p) => !isListTotalPurchase(p));
  const recordedKeys = new Set(itemPurchases.map(groceryRecordKey));

  const normalizedQuery = normalizeText(addQuery);
  const shouldSearch = normalizedQuery.length >= ADD_ITEM_MIN_SEARCH_CHARS;
  const matches = shouldSearch
    ? items
        .filter((item) => item.name.toLowerCase().includes(normalizedQuery.toLowerCase()))
        .slice(0, ADD_ITEM_RESULT_LIMIT)
    : [];
  const existingIndex = lines.findIndex(
    (line) => normalizeText(line.itemName).toLowerCase() === normalizedQuery.toLowerCase(),
  );

  const persist = async (nextLines = lines, nextStatus?: GroceryListDoc["status"]) => {
    if (!list) throw new Error("List not loaded");
    const updated = await updateGroceryList(list.id, {
      title: title.trim() || list.title,
      notes: notes.trim() || null,
      lines: nextLines,
      ...(nextStatus ? { status: nextStatus } : {}),
    });
    setList(updated);
    setLines(updated.lines.map((line) => ({ ...line })));
    return updated;
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const nextStatus =
        list?.status === "draft" && lines.length > 0 ? "open" : list?.status;
      await persist(lines, nextStatus);
      await onChanged();
      setStatus("Buying list saved");
    } catch (error) {
      setStatus(validationMessage(error, "Could not save buying list"));
    } finally {
      setSaving(false);
    }
  };

  const updateLine = (index: number, updates: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...updates };
        if (
          updates.estimatedUnitPrice !== undefined ||
          updates.quantity !== undefined
        ) {
          const qty = Number(next.quantity) || 0;
          const rate =
            next.estimatedUnitPrice == null || Number.isNaN(Number(next.estimatedUnitPrice))
              ? null
              : Number(next.estimatedUnitPrice);
          next.estimatedTotal = rate == null ? null : +(rate * qty).toFixed(2);
        }
        return next;
      }),
    );
  };

  const removeLine = (index: number) => {
    setLines((current) => current.filter((_, i) => i !== index));
    if (purchaseLineIndex === index) setPurchaseLineIndex(null);
    else if (purchaseLineIndex != null && purchaseLineIndex > index) {
      setPurchaseLineIndex(purchaseLineIndex - 1);
    }
  };

  const addLine = (item?: GroceryItemDoc) => {
    if (item) {
      if (
        lines.some(
          (line) =>
            (line.groceryItemId && line.groceryItemId === item.id) ||
            normalizeText(line.itemName).toLowerCase() === item.name.toLowerCase(),
        )
      ) {
        setStatus(`${item.name} is already on this list`);
        return;
      }
      setLines((current) => [...current, draftLineFromItem(item)]);
    } else {
      const name = normalizedQuery;
      if (!name) return;
      if (existingIndex >= 0) {
        setStatus("Item is already on this list");
        return;
      }
      setLines((current) => [...current, draftCustomLine(name)]);
    }
    setAddQuery("");
    setHighlight(0);
    setStatus(null);
  };

  const chooseMode = (mode: ListRecordMode) => {
    if (mode === "item" && listTotalPurchase) {
      setStatus("This buying list already has a whole-list amount recorded.");
      return;
    }
    if (mode === "total" && itemPurchases.length > 0) {
      setStatus("Item-wise purchases already exist for this buying list.");
      return;
    }
    setRecordMode(mode);
    setPurchaseLineIndex(null);
    setStatus(null);
    if (mode === "total" && !listTotalPurchase) {
      setTotalOpen(true);
    } else {
      setTotalOpen(false);
    }
  };

  const startItemPurchase = (index: number) => {
    const line = lines[index];
    if (!line) return;
    if (recordMode !== "item") {
      setStatus("Switch to item-wise recording first.");
      return;
    }
    if (listTotalPurchase) {
      setStatus("This buying list already has a total amount recorded.");
      return;
    }
    if (recordedKeys.has(groceryRecordKey(line))) {
      setStatus("This item is already recorded.");
      return;
    }
    setPurchaseLineIndex(index);
    setPurchaseForm({
      quantity: Number(line.quantity) || 1,
      unit: line.unit,
      unitPrice: line.estimatedUnitPrice != null ? String(line.estimatedUnitPrice) : "",
      totalAmount: "",
      vendor: line.vendorHint || "",
      paymentMethod: "cash",
      notes: "",
      purchasedDate: toInputDate(Date.now()),
    });
    setStatus(null);
  };

  const saveItemPurchase = async () => {
    if (!list || purchaseLineIndex == null) return;
    const line = lines[purchaseLineIndex];
    if (!line || !normalizeText(line.itemName)) {
      setStatus("Item name is required before recording.");
      return;
    }
    const quantity = Number(purchaseForm.quantity) || 0;
    const unitPrice = parseAmount(purchaseForm.unitPrice);
    let totalAmount = parseAmount(purchaseForm.totalAmount);
    if (totalAmount == null && unitPrice != null) {
      totalAmount = +(unitPrice * quantity).toFixed(2);
    }
    if (quantity <= 0) {
      setStatus("Quantity must be greater than zero.");
      return;
    }
    if (totalAmount == null || totalAmount <= 0) {
      setStatus("Enter a total amount, or a unit price to calculate it.");
      return;
    }
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const nextLines = lines.map((candidate, i) =>
        i === purchaseLineIndex
          ? {
              ...candidate,
              purchasedQuantity: quantity,
              purchasedUnitPrice: unitPrice,
              purchasedTotal: totalAmount,
              lineStatus: "purchased" as const,
            }
          : candidate,
      );
      // Record purchase first — service updates line status and derives list status
      await createGroceryPurchase({
        listId: list.id,
        groceryItemId: line.groceryItemId || null,
        itemName: normalizeText(line.itemName),
        category: normalizeCategoryName(line.category) || null,
        quantity,
        unit: purchaseForm.unit,
        unitPrice,
        totalAmount,
        vendor: normalizeText(purchaseForm.vendor) || null,
        paymentMethod: purchaseForm.paymentMethod,
        notes: normalizeText(purchaseForm.notes) || null,
        purchasedAt: fromInputDate(purchaseForm.purchasedDate),
      });
      await persist(nextLines);
      if (normalizeText(purchaseForm.vendor)) {
        const name = normalizeText(purchaseForm.vendor);
        if (!vendors.some((v) => v.name.toLowerCase() === name.toLowerCase())) {
          try {
            const created = await createVendor({ name });
            setVendors((current) => [...current, created as VendorDto]);
          } catch {
            /* duplicate vendor name is fine */
          }
        }
      }
      setPurchaseLineIndex(null);
      await load();
      await onChanged();
      setStatus("Purchase recorded");
    } catch (error) {
      setStatus(validationMessage(error, "Could not record purchase"));
    } finally {
      setSaving(false);
    }
  };

  const saveTotalPurchase = async () => {
    if (!list) return;
    if (listTotalPurchase) {
      setStatus("Whole-list amount already recorded.");
      return;
    }
    if (itemPurchases.length > 0) {
      setStatus("Item-level purchases already exist.");
      return;
    }
    const totalAmount = parseAmount(totalForm.totalAmount);
    if (totalAmount == null || totalAmount <= 0) {
      setStatus("Total amount must be greater than zero.");
      return;
    }
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      await createGroceryPurchase({
        listId: list.id,
        groceryItemId: null,
        itemName: LIST_TOTAL_ITEM_NAME,
        category: LIST_TOTAL_CATEGORY,
        quantity: 1,
        unit: "unit",
        unitPrice: null,
        totalAmount,
        vendor: normalizeText(totalForm.vendor) || null,
        paymentMethod: totalForm.paymentMethod,
        notes: normalizeText(totalForm.notes) || null,
        purchasedAt: fromInputDate(totalForm.purchasedDate),
      });
      await persist(lines);
      if (normalizeText(totalForm.vendor)) {
        const name = normalizeText(totalForm.vendor);
        if (!vendors.some((v) => v.name.toLowerCase() === name.toLowerCase())) {
          try {
            const created = await createVendor({ name });
            setVendors((current) => [...current, created as VendorDto]);
          } catch {
            /* ignore duplicate */
          }
        }
      }
      setTotalOpen(false);
      setTotalForm({
        totalAmount: "",
        vendor: "",
        paymentMethod: "cash",
        notes: "",
        purchasedDate: toInputDate(Date.now()),
      });
      await load();
      await onChanged();
      setStatus("Buying list total recorded");
    } catch (error) {
      setStatus(validationMessage(error, "Could not record list total"));
    } finally {
      setSaving(false);
    }
  };

  const printList = async () => {
    if (!list || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      await persist(lines);
      const updated = await updateGroceryList(list.id, { recordPrint: true });
      setList(updated);
      if (!window.pos?.print) throw new Error("Print is unavailable.");
      const result = await window.pos.print({
        type: "receipt",
        printer: "counter",
        data: { lines: buyingListPrintLines(updated, false) },
      });
      if (!result?.ok) throw new Error(result?.error || "print-failed");
      setStatus("Buying list sent to printer");
      await onChanged();
    } catch (error) {
      setStatus(validationMessage(error, "Could not print buying list"));
    } finally {
      setSaving(false);
    }
  };

  const exportPdf = async () => {
    if (!list) return;
    try {
      await persist(lines);
      const fresh = await getGroceryList(list.id);
      if (!fresh) throw new Error("Buying list not found");
      if (!window.pos?.exportReportPdf) throw new Error("PDF export is unavailable.");
      await window.pos.exportReportPdf(
        buyingListHtml(fresh),
        `buying-list-${fresh.id.slice(-8)}`,
      );
      setStatus("PDF exported");
    } catch (error) {
      setStatus(validationMessage(error, "Could not export PDF"));
    }
  };

  const body = (
    <div className={styles.editorOverlay} role="dialog" aria-modal="true" aria-label="Edit buying list">
      <div className={styles.editorPane}>
        <header className={styles.editorHeader}>
          <div>
            <h2 className={styles.editorTitle}>{title || "Edit Buying List"}</h2>
            {list && (
              <div className={styles.sessionMeta}>
                {formatListDate(list.listDate)} · {lines.length} items ·{" "}
                {formatCurrency(plannedTotal(lines))} planned
                {list.printCount > 0 ? ` · Printed ${list.printCount}×` : ""}
              </div>
            )}
          </div>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={printList} disabled={saving || !list}>
              Print
            </Button>
            <Button variant="ghost" onClick={exportPdf} disabled={saving || !list}>
              PDF
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              Save
            </Button>
          </div>
        </header>

        {loading ? (
          <div className={styles.status}>Loading editor…</div>
        ) : (
          <div className={styles.editorBody}>
            {status && <div className={styles.status}>{status}</div>}

            <div className={styles.formGrid} style={{ gridTemplateColumns: "2fr 1fr" }}>
              <Input
                label="List name"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Input
                label="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
              />
            </div>

            <div className={styles.recordModePanel}>
              <div>
                <div className={styles.recordModeTitle}>Record purchase as</div>
                <div className={styles.recordModeHint}>
                  Vendors attach when you record a purchase — not on the planning list.
                </div>
              </div>
              <div className={styles.recordModeOptions} role="group" aria-label="Purchase record type">
                <button
                  type="button"
                  className={`${styles.recordModeButton} ${
                    recordMode === "item" ? styles.recordModeButtonActive : ""
                  }`}
                  onClick={() => chooseMode("item")}
                  disabled={saving || Boolean(listTotalPurchase)}
                  aria-pressed={recordMode === "item"}
                >
                  Item-wise
                </button>
                <button
                  type="button"
                  className={`${styles.recordModeButton} ${
                    recordMode === "total" ? styles.recordModeButtonActive : ""
                  }`}
                  onClick={() => chooseMode("total")}
                  disabled={saving || itemPurchases.length > 0}
                  aria-pressed={recordMode === "total"}
                >
                  Whole list
                </button>
              </div>
            </div>

            {listTotalPurchase && (
              <div className={styles.recordedTotal}>
                <span>
                  Whole-list amount recorded: {formatCurrency(listTotalPurchase.totalAmount)}
                </span>
              </div>
            )}

            {recordMode === "total" && totalOpen && !listTotalPurchase && (
              <div className={styles.inlinePurchasePanel}>
                <div className={styles.inlinePurchaseHeader}>
                  <div>
                    <div className={styles.inlinePurchaseTitle}>List Total Purchase</div>
                    <div className={styles.inlinePurchaseSub}>
                      Record one amount for the entire buying list.
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setTotalOpen(false)}>
                    Cancel
                  </Button>
                </div>
                <div className={styles.inlinePurchaseGrid}>
                  <Input
                    label="Total amount"
                    value={totalForm.totalAmount}
                    onChange={(e) =>
                      setTotalForm((f) => ({ ...f, totalAmount: e.target.value }))
                    }
                    inputMode="decimal"
                  />
                  <Input
                    label="Vendor"
                    list="buying-list-vendors"
                    value={totalForm.vendor}
                    onChange={(e) => setTotalForm((f) => ({ ...f, vendor: e.target.value }))}
                    placeholder="Select or type vendor"
                  />
                  <Select
                    label="Payment"
                    value={totalForm.paymentMethod}
                    onChange={(e) =>
                      setTotalForm((f) => ({ ...f, paymentMethod: e.target.value }))
                    }
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </Select>
                  <Input
                    label="Date"
                    type="date"
                    value={totalForm.purchasedDate}
                    onChange={(e) =>
                      setTotalForm((f) => ({ ...f, purchasedDate: e.target.value }))
                    }
                  />
                  <div className={styles.inlineSpan2}>
                    <Input
                      label="Notes"
                      value={totalForm.notes}
                      onChange={(e) => setTotalForm((f) => ({ ...f, notes: e.target.value }))}
                    />
                  </div>
                </div>
                <div className={styles.actions}>
                  <Button variant="primary" onClick={saveTotalPurchase} loading={saving}>
                    Record total
                  </Button>
                </div>
              </div>
            )}

            <div className={styles.editorToolbar}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAddOpen((open) => !open)}
                aria-expanded={addOpen}
              >
                {addOpen ? "Done adding" : "+ Add item"}
              </Button>
            </div>

            {addOpen && (
              <div className={styles.addItemPanel}>
                <div className="ui-input-shell">
                  <input
                    id="buying-list-add-item"
                    className="ui-input"
                    value={addQuery}
                    onChange={(e) => {
                      setAddQuery(e.target.value);
                      setHighlight(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setHighlight((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setHighlight((i) => Math.max(0, i - 1));
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        if (matches[highlight]) addLine(matches[highlight]);
                        else addLine();
                      }
                    }}
                    placeholder="Search catalog or type a custom item"
                    aria-label="Add item to buying list"
                    autoFocus
                  />
                </div>
                {existingIndex >= 0 && (
                  <div className={styles.addItemExisting}>
                    <div>
                      <strong>{lines[existingIndex]?.itemName}</strong> is already in this list.
                    </div>
                  </div>
                )}
                {shouldSearch && (
                  <div className={styles.addItemResults}>
                    {matches.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`${styles.addItemResult} ${
                          index === highlight ? styles.addItemResultActive : ""
                        }`}
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => addLine(item)}
                      >
                        <span className={styles.addItemName}>{item.name}</span>
                        <span className={styles.addItemMeta}>
                          {item.defaultQuantity} {item.defaultUnit}
                          {item.category ? ` · ${item.category}` : ""}
                        </span>
                      </button>
                    ))}
                    {!matches.length && existingIndex < 0 && (
                      <div className={styles.addItemEmpty}>
                        No catalog match — press Enter or Add custom.
                      </div>
                    )}
                  </div>
                )}
                <div className={styles.addItemActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => addLine()}
                    disabled={!normalizedQuery || existingIndex >= 0}
                  >
                    Add custom
                  </Button>
                </div>
              </div>
            )}

            <datalist id="buying-list-vendors">
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.name} />
              ))}
            </datalist>

            <div className={styles.listLineHeader} style={{ gridTemplateColumns: LINE_GRID }}>
              <span>Item</span>
              <span>Qty</span>
              <span>Unit</span>
              <span>Est. rate</span>
              <span>Actions</span>
            </div>
            <div className={styles.listLines}>
              {lines.length === 0 && (
                <div className={styles.addItemEmpty}>No items yet. Add items to continue.</div>
              )}
              {lines.map((line, index) => {
                const recorded = recordedKeys.has(groceryRecordKey(line));
                return (
                  <React.Fragment key={line.id}>
                    <div
                      className={`${styles.listLine} ${
                        purchaseLineIndex === index ? styles.listLineActive : ""
                      }`}
                      style={{ gridTemplateColumns: LINE_GRID }}
                    >
                      <Input
                        label="Item"
                        labelHidden
                        value={line.itemName}
                        onChange={(e) => updateLine(index, { itemName: e.target.value })}
                      />
                      <Input
                        label="Qty"
                        labelHidden
                        type="number"
                        min={0}
                        step="any"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(index, { quantity: Number(e.target.value) || 0 })
                        }
                      />
                      <Select
                        label="Unit"
                        labelHidden
                        value={line.unit}
                        onChange={(e) =>
                          updateLine(index, { unit: e.target.value as GroceryUnit })
                        }
                      >
                        {UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </Select>
                      <Input
                        label="Est. rate"
                        labelHidden
                        inputMode="decimal"
                        value={
                          line.estimatedUnitPrice == null ? "" : String(line.estimatedUnitPrice)
                        }
                        onChange={(e) => {
                          const value = e.target.value;
                          updateLine(index, {
                            estimatedUnitPrice: value.trim() === "" ? null : Number(value),
                          });
                        }}
                      />
                      <div className={styles.listLineActions}>
                        {recordMode === "item" && !listTotalPurchase && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className={styles.recordActionButton}
                            onClick={() => startItemPurchase(index)}
                            disabled={saving || recorded}
                          >
                            {recorded ? "Recorded" : "Record"}
                          </Button>
                        )}
                        <Button
                          variant="danger-ghost"
                          size="sm"
                          onClick={() => removeLine(index)}
                          disabled={saving || recorded}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>

                    {purchaseLineIndex === index && (
                      <div className={styles.inlinePurchasePanel}>
                        <div className={styles.inlinePurchaseHeader}>
                          <div>
                            <div className={styles.inlinePurchaseTitle}>
                              Record purchase · {line.itemName}
                            </div>
                            <div className={styles.inlinePurchaseSub}>
                              Planned {line.quantity} {line.unit}
                              {line.estimatedUnitPrice != null
                                ? ` · est. ${formatCurrency(line.estimatedUnitPrice)}/unit`
                                : ""}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPurchaseLineIndex(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                        <div className={styles.inlinePurchaseGrid}>
                          <Input
                            label="Qty"
                            type="number"
                            min={0}
                            step="any"
                            value={purchaseForm.quantity}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({
                                ...f,
                                quantity: Number(e.target.value) || 0,
                              }))
                            }
                          />
                          <Select
                            label="Unit"
                            value={purchaseForm.unit}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({
                                ...f,
                                unit: e.target.value as GroceryUnit,
                              }))
                            }
                          >
                            {UNITS.map((unit) => (
                              <option key={unit} value={unit}>
                                {unit}
                              </option>
                            ))}
                          </Select>
                          <Input
                            label="Unit price"
                            inputMode="decimal"
                            value={purchaseForm.unitPrice}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({ ...f, unitPrice: e.target.value }))
                            }
                          />
                          <Input
                            label="Total"
                            inputMode="decimal"
                            value={purchaseForm.totalAmount}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({ ...f, totalAmount: e.target.value }))
                            }
                          />
                          <Input
                            label="Vendor"
                            list="buying-list-vendors"
                            value={purchaseForm.vendor}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({ ...f, vendor: e.target.value }))
                            }
                            placeholder="Select or type vendor"
                          />
                          <Select
                            label="Payment"
                            value={purchaseForm.paymentMethod}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({
                                ...f,
                                paymentMethod: e.target.value,
                              }))
                            }
                          >
                            {PAYMENT_METHODS.map((method) => (
                              <option key={method} value={method}>
                                {method}
                              </option>
                            ))}
                          </Select>
                          <Input
                            label="Date"
                            type="date"
                            value={purchaseForm.purchasedDate}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({
                                ...f,
                                purchasedDate: e.target.value,
                              }))
                            }
                          />
                          <Input
                            label="Notes"
                            value={purchaseForm.notes}
                            onChange={(e) =>
                              setPurchaseForm((f) => ({ ...f, notes: e.target.value }))
                            }
                          />
                        </div>
                        <div className={styles.actions}>
                          <Button
                            variant="primary"
                            onClick={saveItemPurchase}
                            loading={saving}
                          >
                            Save purchase
                          </Button>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
