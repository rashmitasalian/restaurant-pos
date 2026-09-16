import React from "react";
import { Check, Circle } from "lucide-react";
import { createPortal } from "react-dom";
import {
  createGroceryPurchase,
  getGroceryList,
  listGroceryPurchaseHeaders,
  listGroceryPurchases,
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
import { Modal } from "../../../components/ui/Modal";
import { Select } from "../../../components/ui/Select";
import {
  formatCurrency,
  formatListDate,
  fromInputDate,
  groceryRecordKey,
  GROCERY_PAYMENT_METHODS,
  GROCERY_UNITS,
  isListTotalPurchase,
  LIST_TOTAL_CATEGORY,
  LIST_TOTAL_ITEM_NAME,
  parseMoney,
  plannedTotal,
  toInputDate,
} from "../groceryUtils";
import { loadActiveVendors, VendorPicker } from "../Vendors/VendorPicker";
import styles from "../Grocery.module.css";

export type PurchaseMode = "item" | "total";

type Props = {
  listId: string;
  /** Skip mode chooser when known */
  initialMode?: PurchaseMode | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
};

type ItemDraft = {
  quantity: number;
  unit: GroceryUnit;
  unitPrice: string;
  totalAmount: string;
  vendor: string;
  paymentMethod: string;
  notes: string;
  purchasedDate: string;
  ready: boolean;
};

function emptyDraft(line: GroceryListDoc["lines"][number]): ItemDraft {
  return {
    quantity: Number(line.quantity) || 1,
    unit: line.unit,
    unitPrice: line.estimatedUnitPrice != null ? String(line.estimatedUnitPrice) : "",
    totalAmount: "",
    vendor: line.vendorHint || "",
    paymentMethod: "cash",
    notes: "",
    purchasedDate: toInputDate(Date.now()),
    ready: false,
  };
}

function draftTotal(draft: ItemDraft) {
  const qty = Number(draft.quantity) || 0;
  const unitPrice = parseMoney(draft.unitPrice);
  let total = parseMoney(draft.totalAmount);
  if (total == null && unitPrice != null) {
    total = +(unitPrice * qty).toFixed(2);
  }
  return { qty, unitPrice, total };
}

export function RecordPurchaseFlow({ listId, initialMode = null, onClose, onChanged }: Props) {
  const [list, setList] = React.useState<GroceryListDoc | null>(null);
  const [purchases, setPurchases] = React.useState<GroceryPurchaseLineDoc[]>([]);
  const [vendors, setVendors] = React.useState<VendorDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<PurchaseMode | null>(initialMode);
  const [activeLineId, setActiveLineId] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, ItemDraft>>({});
  const [totalForm, setTotalForm] = React.useState({
    totalAmount: "",
    vendor: "",
    paymentMethod: "cash",
    notes: "",
    purchasedDate: toInputDate(Date.now()),
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [doc, purchaseLines, purchaseHeaders, vendorRows] = await Promise.all([
        getGroceryList(listId),
        listGroceryPurchases({ listId, limit: 200 }),
        listGroceryPurchaseHeaders({ listId, includeVoided: true, limit: 100 }),
        loadActiveVendors(),
      ]);
      if (!doc) {
        throw new Error("Buying list not found");
      }
      const voided = new Set(
        (purchaseHeaders as any[]).filter((h) => h.status === "voided").map((h) => h.id),
      );
      const active = purchaseLines.filter((p: any) => !p.purchaseId || !voided.has(p.purchaseId));
      setList(doc);
      setPurchases(active);
      setVendors(vendorRows);
      const nextDrafts: Record<string, ItemDraft> = {};
      for (const line of doc.lines) {
        nextDrafts[line.id] = emptyDraft(line);
      }
      setDrafts(nextDrafts);
      const pending = doc.lines.find(
        (l) => l.lineStatus !== "purchased" && l.lineStatus !== "skipped",
      );
      setActiveLineId(pending?.id || doc.lines[0]?.id || null);
    } catch (error) {
      setStatus(validationMessage(error, "Could not load purchase workspace"));
    } finally {
      setLoading(false);
    }
  }, [listId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const listTotalPurchase = purchases.find(isListTotalPurchase) || null;
  const itemPurchases = purchases.filter((p) => !isListTotalPurchase(p));
  const recordedKeys = new Set(itemPurchases.map(groceryRecordKey));

  const pendingLines = (list?.lines || []).filter(
    (line) =>
      line.lineStatus !== "skipped" &&
      line.lineStatus !== "purchased" &&
      !recordedKeys.has(groceryRecordKey(line)),
  );

  const chooseMode = (next: PurchaseMode) => {
    if (next === "item" && listTotalPurchase) {
      setStatus("This buying list already has a whole-list amount recorded.");
      return;
    }
    if (next === "total" && itemPurchases.length > 0) {
      setStatus("Item-wise purchases already exist for this buying list.");
      return;
    }
    setStatus(null);
    setMode(next);
  };

  const updateDraft = (lineId: string, patch: Partial<ItemDraft>) => {
    setDrafts((current) => {
      const base = current[lineId];
      if (!base) {
        return current;
      }
      return { ...current, [lineId]: { ...base, ...patch } };
    });
  };

  const markReady = (lineId: string) => {
    const draft = drafts[lineId];
    if (!draft) {
      return;
    }
    const { qty, total } = draftTotal(draft);
    if (qty <= 0) {
      setStatus("Quantity must be greater than zero.");
      return;
    }
    if (total == null || total <= 0) {
      setStatus("Enter a total amount, or a unit price to calculate it.");
      return;
    }
    updateDraft(lineId, { ready: true });
    setStatus(null);
    const nextPending = pendingLines.find((l) => l.id !== lineId && !drafts[l.id]?.ready);
    if (nextPending) {
      setActiveLineId(nextPending.id);
    }
  };

  const readyLines = pendingLines.filter((line) => drafts[line.id]?.ready);
  const readyTotal = readyLines.reduce((sum, line) => {
    const { total } = draftTotal(drafts[line.id]!);
    return sum + (total || 0);
  }, 0);

  const saveItemPurchases = async () => {
    if (!list || readyLines.length === 0) {
      setStatus("Mark at least one item ready before saving.");
      return;
    }
    if (saving) {
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      for (const line of readyLines) {
        const draft = drafts[line.id]!;
        const { qty, unitPrice, total } = draftTotal(draft);
        await createGroceryPurchase({
          listId: list.id,
          groceryItemId: line.groceryItemId || null,
          itemName: normalizeText(line.itemName),
          category: normalizeCategoryName(line.category) || null,
          quantity: qty,
          unit: draft.unit,
          unitPrice,
          totalAmount: total!,
          vendor: normalizeText(draft.vendor) || null,
          paymentMethod: draft.paymentMethod,
          notes: normalizeText(draft.notes) || null,
          purchasedAt: fromInputDate(draft.purchasedDate),
        });
      }
      await onChanged();
      onClose();
    } catch (error) {
      setStatus(validationMessage(error, "Could not record purchase"));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const saveTotalPurchase = async () => {
    if (!list) {
      return;
    }
    if (listTotalPurchase) {
      setStatus("Whole-list amount already recorded.");
      return;
    }
    if (itemPurchases.length > 0) {
      setStatus("Item-level purchases already exist.");
      return;
    }
    const totalAmount = parseMoney(totalForm.totalAmount);
    if (totalAmount == null || totalAmount <= 0) {
      setStatus("Total amount must be greater than zero.");
      return;
    }
    if (saving) {
      return;
    }
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
      await onChanged();
      onClose();
    } catch (error) {
      setStatus(validationMessage(error, "Could not record list total"));
    } finally {
      setSaving(false);
    }
  };

  if (!mode) {
    return (
      <Modal open title="Record Purchase" onClose={onClose} large>
        <div className={styles.modeChooser}>
          {status && <div className={styles.status}>{status}</div>}
          <p className={styles.modeChooserLead}>
            {list
              ? `${list.title} · ${formatListDate(list.listDate)}`
              : "Choose how to record this purchase."}
          </p>
          <div className={styles.modeChooserGrid}>
            <button
              type="button"
              className={styles.modeCard}
              onClick={() => chooseMode("item")}
              disabled={Boolean(listTotalPurchase) || loading}
            >
              <strong>Item-wise</strong>
              <span>Enter actual qty, price and vendor for individual items.</span>
            </button>
            <button
              type="button"
              className={styles.modeCard}
              onClick={() => chooseMode("total")}
              disabled={itemPurchases.length > 0 || loading}
            >
              <strong>Whole List</strong>
              <span>Record the entire list as one purchase.</span>
            </button>
          </div>
          <div className="ui-form-actions">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  if (mode === "total") {
    return (
      <Modal open title="Record Whole List Purchase" onClose={onClose} large>
        <div className={styles.stack}>
          {status && <div className={styles.status}>{status}</div>}
          {loading || !list ? (
            <div className={styles.status}>Loading…</div>
          ) : (
            <>
              <div className={styles.sessionMeta}>
                Buying List · {list.title} · {formatListDate(list.listDate)} · {list.lines.length}{" "}
                items · {formatCurrency(plannedTotal(list.lines))} planned
              </div>
              <VendorPicker
                value={totalForm.vendor}
                onChange={(vendor) => setTotalForm((f) => ({ ...f, vendor }))}
                vendors={vendors}
                onVendorsChange={setVendors}
                disabled={saving}
              />
              <div className={styles.formGrid} style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <Input
                  label="Purchase Amount"
                  inputMode="decimal"
                  value={totalForm.totalAmount}
                  onChange={(e) => setTotalForm((f) => ({ ...f, totalAmount: e.target.value }))}
                />
                <Input
                  label="Purchase Date"
                  type="date"
                  value={totalForm.purchasedDate}
                  onChange={(e) => setTotalForm((f) => ({ ...f, purchasedDate: e.target.value }))}
                />
                <Select
                  label="Payment Method"
                  value={totalForm.paymentMethod}
                  onChange={(e) => setTotalForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                >
                  {GROCERY_PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                label="Notes"
                value={totalForm.notes}
                onChange={(e) => setTotalForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
              <div className={styles.purchaseSummaryBar}>
                <span>
                  {list.lines.length} items ·{" "}
                  {formatCurrency(parseMoney(totalForm.totalAmount) || 0)}
                </span>
                <div className={styles.actions}>
                  <Button variant="secondary" onClick={onClose} disabled={saving}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void saveTotalPurchase()}
                    loading={saving}
                  >
                    Save Purchase
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    );
  }

  const activeLine = (list?.lines || []).find((l) => l.id === activeLineId) || null;
  const activeDraft = activeLine ? drafts[activeLine.id] : null;

  const body = (
    <div
      className={styles.editorOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="Record purchase"
    >
      <div className={`${styles.editorPane} ${styles.purchasePane}`}>
        <header className={styles.editorHeader}>
          <div>
            <h2 className={styles.editorTitle}>Record Purchase · Item-wise</h2>
            {list && (
              <div className={styles.sessionMeta}>
                {list.title} · {formatListDate(list.listDate)} · {pendingLines.length} pending
              </div>
            )}
          </div>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void saveItemPurchases()}
              loading={saving}
              disabled={readyLines.length === 0}
            >
              Save Purchase
            </Button>
          </div>
        </header>

        {loading || !list ? (
          <div className={styles.status}>Loading…</div>
        ) : (
          <div className={styles.purchaseZones}>
            {status && (
              <div className={`${styles.status} ${styles.purchaseZonesStatus}`}>{status}</div>
            )}

            <aside className={styles.purchaseZone} aria-label="List items">
              <h3 className={styles.zoneTitle}>List Items</h3>
              {pendingLines.length === 0 ? (
                <div className={styles.hint}>All items are already recorded.</div>
              ) : (
                <ul className={styles.purchaseItemList}>
                  {pendingLines.map((line) => {
                    const ready = Boolean(drafts[line.id]?.ready);
                    return (
                      <li key={line.id}>
                        <button
                          type="button"
                          className={`${styles.purchaseItemBtn} ${
                            activeLineId === line.id ? styles.purchaseItemBtnActive : ""
                          }`}
                          onClick={() => setActiveLineId(line.id)}
                        >
                          <span className={styles.purchaseItemCheck} aria-hidden>
                            {ready ? <Check size={14} /> : <Circle size={14} />}
                          </span>
                          <span>
                            <strong>{line.itemName}</strong>
                            <span className={styles.hint}>
                              {line.quantity} {line.unit}
                              {ready ? " · ready" : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            <section className={styles.purchaseZone} aria-label="Purchase details">
              <h3 className={styles.zoneTitle}>Purchase Details</h3>
              {!activeLine || !activeDraft ? (
                <div className={styles.hint}>Select an item to enter purchase details.</div>
              ) : (
                <div className={styles.stack}>
                  <div>
                    <strong>{activeLine.itemName}</strong>
                    <div className={styles.hint}>
                      Planned {activeLine.quantity} {activeLine.unit}
                      {activeLine.estimatedUnitPrice != null
                        ? ` · est. ${formatCurrency(activeLine.estimatedUnitPrice)}/unit`
                        : ""}
                    </div>
                  </div>
                  <div className={styles.formGrid} style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <Input
                      label="Qty"
                      type="number"
                      min={0}
                      step="any"
                      value={activeDraft.quantity}
                      onChange={(e) =>
                        updateDraft(activeLine.id, {
                          quantity: Number(e.target.value) || 0,
                          ready: false,
                        })
                      }
                    />
                    <Select
                      label="Unit"
                      value={activeDraft.unit}
                      onChange={(e) =>
                        updateDraft(activeLine.id, {
                          unit: e.target.value as GroceryUnit,
                          ready: false,
                        })
                      }
                    >
                      {GROCERY_UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </Select>
                    <Input
                      label="Rate"
                      inputMode="decimal"
                      value={activeDraft.unitPrice}
                      onChange={(e) =>
                        updateDraft(activeLine.id, { unitPrice: e.target.value, ready: false })
                      }
                    />
                    <Input
                      label="Total"
                      inputMode="decimal"
                      value={activeDraft.totalAmount}
                      onChange={(e) =>
                        updateDraft(activeLine.id, { totalAmount: e.target.value, ready: false })
                      }
                    />
                  </div>
                  <VendorPicker
                    value={activeDraft.vendor}
                    onChange={(vendor) => updateDraft(activeLine.id, { vendor, ready: false })}
                    vendors={vendors}
                    onVendorsChange={setVendors}
                    disabled={saving}
                  />
                  <div className={styles.formGrid} style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <Select
                      label="Payment"
                      value={activeDraft.paymentMethod}
                      onChange={(e) =>
                        updateDraft(activeLine.id, {
                          paymentMethod: e.target.value,
                          ready: false,
                        })
                      }
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
                      value={activeDraft.purchasedDate}
                      onChange={(e) =>
                        updateDraft(activeLine.id, {
                          purchasedDate: e.target.value,
                          ready: false,
                        })
                      }
                    />
                  </div>
                  <Input
                    label="Notes"
                    value={activeDraft.notes}
                    onChange={(e) =>
                      updateDraft(activeLine.id, { notes: e.target.value, ready: false })
                    }
                  />
                  <Button variant="secondary" onClick={() => markReady(activeLine.id)}>
                    {activeDraft.ready ? "Update ready item" : "Mark ready"}
                  </Button>
                </div>
              )}
            </section>

            <aside className={styles.purchaseZone} aria-label="Summary">
              <h3 className={styles.zoneTitle}>Summary</h3>
              <div className={styles.stack}>
                <div className={styles.kpi}>
                  <div className={styles.kpiLabel}>Ready items</div>
                  <div className={styles.kpiValue}>{readyLines.length}</div>
                </div>
                <div className={styles.kpi}>
                  <div className={styles.kpiLabel}>Planned</div>
                  <div className={styles.kpiValue}>{formatCurrency(plannedTotal(list.lines))}</div>
                </div>
                <div className={styles.kpi}>
                  <div className={styles.kpiLabel}>Actual</div>
                  <div className={styles.kpiValue}>{formatCurrency(readyTotal)}</div>
                </div>
                <ul className={styles.hintList}>
                  {readyLines.map((line) => (
                    <li key={line.id}>
                      {line.itemName} · {formatCurrency(draftTotal(drafts[line.id]!).total || 0)}
                      {drafts[line.id]?.vendor
                        ? ` · ${drafts[line.id]!.vendor}`
                        : " · Not specified"}
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
