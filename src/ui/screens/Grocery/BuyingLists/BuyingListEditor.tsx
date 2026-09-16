import React from "react";
import { createPortal } from "react-dom";
import {
  getGroceryList,
  listGroceryItems,
  listGroceryPurchases,
  listGroceryPurchaseHeaders,
  updateGroceryList,
  type GroceryItemDoc,
  type GroceryListDoc,
} from "../../../../app/db/posRepository";
import type { GroceryUnit } from "../../../../shared/pos";
import { normalizeText, validationMessage } from "../../../../shared/validation";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { buyingListHtml, buyingListPrintLines } from "../buyingListPrint";
import {
  formatCurrency,
  formatListDate,
  groceryRecordKey,
  GROCERY_UNITS,
  isListTotalPurchase,
  parseMoney,
  plannedTotal,
  statusLabel,
} from "../groceryUtils";
import styles from "../Grocery.module.css";

const ADD_ITEM_MIN_SEARCH_CHARS = 2;
const ADD_ITEM_RESULT_LIMIT = 15;
const LINE_GRID =
  "minmax(160px, 2fr) minmax(64px, 0.45fr) minmax(80px, 0.55fr) minmax(88px, 0.65fr) minmax(100px, 120px) minmax(72px, 90px)";
const PARTIAL_MONEY_INPUT = /^\d*\.?\d*$/;

function formatEstimatedRate(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) {
    return "";
  }
  return String(value);
}

type DraftLine = GroceryListDoc["lines"][number];

type Props = {
  listId: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onRecordPurchase?: (listId: string) => void;
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

export function BuyingListEditor({ listId, onClose, onChanged, onRecordPurchase }: Props) {
  const [list, setList] = React.useState<GroceryListDoc | null>(null);
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [items, setItems] = React.useState<GroceryItemDoc[]>([]);
  const [recordedKeys, setRecordedKeys] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [addQuery, setAddQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const [rateDrafts, setRateDrafts] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [doc, groceryItems, purchaseLines, purchaseHeaders] = await Promise.all([
        getGroceryList(listId),
        listGroceryItems(),
        listGroceryPurchases({ listId, limit: 200 }),
        listGroceryPurchaseHeaders({ listId, includeVoided: true, limit: 100 }),
      ]);
      if (!doc) {
        throw new Error("Buying list not found");
      }
      setList(doc);
      setLines(doc.lines.map((line) => ({ ...line })));
      setRateDrafts({});
      setTitle(doc.title);
      setNotes(doc.notes || "");
      setItems(groceryItems);
      const voidedHeaderIds = new Set(
        (purchaseHeaders as any[]).filter((h) => h.status === "voided").map((h) => h.id),
      );
      const activePurchases = purchaseLines.filter(
        (p: any) => !p.purchaseId || !voidedHeaderIds.has(p.purchaseId),
      );
      const itemPurchases = activePurchases.filter((p) => !isListTotalPurchase(p));
      setRecordedKeys(new Set(itemPurchases.map(groceryRecordKey)));
    } catch (error) {
      setStatus(validationMessage(error, "Could not load editor"));
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
    if (!list) {
      throw new Error("List not loaded");
    }
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
    if (saving) {
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const nextStatus = list?.status === "draft" && lines.length > 0 ? "open" : list?.status;
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
        if (i !== index) {
          return line;
        }
        const next = { ...line, ...updates };
        if (updates.estimatedUnitPrice !== undefined || updates.quantity !== undefined) {
          const qty = Number(next.quantity) || 0;
          const rawRate = next.estimatedUnitPrice;
          const rate = rawRate == null || Number.isNaN(Number(rawRate)) ? null : Number(rawRate);
          next.estimatedUnitPrice = rate;
          next.estimatedTotal = rate == null ? null : +(rate * qty).toFixed(2);
        }
        return next;
      }),
    );
  };

  const removeLine = (index: number) => {
    const lineId = lines[index]?.id;
    setLines((current) => current.filter((_, i) => i !== index));
    if (lineId) {
      setRateDrafts((current) => {
        const next = { ...current };
        delete next[lineId];
        return next;
      });
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
      if (!name) {
        return;
      }
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

  const printList = async () => {
    if (!list || saving) {
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      await persist(lines);
      const updated = await updateGroceryList(list.id, { recordPrint: true });
      setList(updated);
      if (!window.pos?.print) {
        throw new Error("Print is unavailable.");
      }
      const result = await window.pos.print({
        type: "receipt",
        printer: "counter",
        data: { lines: buyingListPrintLines(updated, false) },
      });
      if (!result?.ok) {
        throw new Error(result?.error || "print-failed");
      }
      setStatus("Buying list sent to printer");
      await onChanged();
    } catch (error) {
      setStatus(validationMessage(error, "Could not print buying list"));
    } finally {
      setSaving(false);
    }
  };

  const exportPdf = async () => {
    if (!list) {
      return;
    }
    try {
      await persist(lines);
      const fresh = await getGroceryList(list.id);
      if (!fresh) {
        throw new Error("Buying list not found");
      }
      if (!window.pos?.exportReportPdf) {
        throw new Error("PDF export is unavailable.");
      }
      await window.pos.exportReportPdf(buyingListHtml(fresh), `buying-list-${fresh.id.slice(-8)}`);
      setStatus("PDF exported");
    } catch (error) {
      setStatus(validationMessage(error, "Could not export PDF"));
    }
  };

  const canPurchase =
    list && list.status !== "cancelled" && list.status !== "completed" && lines.length > 0;

  const body = (
    <div
      className={styles.editorOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="Edit buying list"
    >
      <div className={styles.editorPane}>
        <header className={styles.editorHeader}>
          <div>
            <h2 className={styles.editorTitle}>{title || "Edit Buying List"}</h2>
            {list && (
              <div className={styles.sessionMeta}>
                {formatListDate(list.listDate)} · {statusLabel(list.status)} · {lines.length} items
                · {formatCurrency(plannedTotal(lines))} planned
                {list.printCount > 0 ? ` · Printed ${list.printCount}×` : ""}
              </div>
            )}
          </div>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={printList} disabled={saving || !list}>
              Print
            </Button>
            <Button variant="secondary" onClick={exportPdf} disabled={saving || !list}>
              PDF
            </Button>
            {canPurchase && onRecordPurchase ? (
              <Button
                variant="secondary"
                onClick={() => onRecordPurchase(listId)}
                disabled={saving}
              >
                Record Purchase
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={saving}>
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
              <Input label="List name" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Input
                label="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
              />
            </div>

            <div className={styles.editorToolbar}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAddOpen((open) => !open)}
                aria-expanded={addOpen}
              >
                {addOpen ? "Done adding" : "+ Add Items"}
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
                        if (matches[highlight]) {
                          addLine(matches[highlight]);
                        } else {
                          addLine();
                        }
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

            <div className={styles.listLineHeader} style={{ gridTemplateColumns: LINE_GRID }}>
              <span>Item</span>
              <span>Planned</span>
              <span>Unit</span>
              <span>Est. rate</span>
              <span>Purchased</span>
              <span />
            </div>
            <div className={styles.listLines}>
              {lines.length === 0 && (
                <div className={styles.addItemEmpty}>No items yet. Add items to continue.</div>
              )}
              {lines.map((line, index) => {
                const recorded =
                  recordedKeys.has(groceryRecordKey(line)) || line.lineStatus === "purchased";
                return (
                  <div
                    key={line.id}
                    className={styles.listLine}
                    style={{ gridTemplateColumns: LINE_GRID }}
                  >
                    <Input
                      label="Item"
                      labelHidden
                      value={line.itemName}
                      onChange={(e) => updateLine(index, { itemName: e.target.value })}
                      disabled={recorded}
                    />
                    <Input
                      label="Qty"
                      labelHidden
                      type="number"
                      min={0}
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLine(index, { quantity: Number(e.target.value) || 0 })}
                      disabled={recorded}
                    />
                    <Select
                      label="Unit"
                      labelHidden
                      value={line.unit}
                      onChange={(e) => updateLine(index, { unit: e.target.value as GroceryUnit })}
                      disabled={recorded}
                    >
                      {GROCERY_UNITS.map((unit) => (
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
                        line.id in rateDrafts
                          ? rateDrafts[line.id]
                          : formatEstimatedRate(line.estimatedUnitPrice)
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value !== "" && !PARTIAL_MONEY_INPUT.test(value)) {
                          return;
                        }
                        setRateDrafts((current) => ({ ...current, [line.id]: value }));
                        updateLine(index, { estimatedUnitPrice: parseMoney(value) });
                      }}
                      disabled={recorded}
                    />
                    <span className={styles.purchasedCell}>
                      {line.purchasedQuantity != null
                        ? `${line.purchasedQuantity} ${line.unit}`
                        : recorded
                          ? "Recorded"
                          : "—"}
                    </span>
                    <div className={styles.listLineActions}>
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
