import React from "react";
import styles from "../Billing.module.css";

interface Props {
  it: any;
  editingQty: Record<string, string>;
  editingRate: Record<string, string>;
  setEditingQty: (v: any) => void;
  setEditingRate: (v: any) => void;
  commitQty: (id: string) => Promise<void>;
  commitRate: (id: string) => Promise<void>;
  removeLine: (id: string) => Promise<unknown>;
  updateOrderQty: (id: string, delta: number) => Promise<void>;
}

export default function OrderItem({
  it,
  editingQty,
  editingRate,
  setEditingQty,
  setEditingRate,
  commitQty,
  commitRate,
  removeLine,
  updateOrderQty,
}: Props) {
  // Disable − only when qty is already at minimum AND the item has never been
  // KOT-sent (if it has been sent, − triggers the void workflow, so keep it enabled).
  const kotSentQty = Math.max(0, Number(it.kotPrintedQty || 0));
  const atMinQty = Number(it.qty || 1) <= 1;
  const decreaseDisabled = atMinQty && kotSentQty === 0;

  const startEditRate = () =>
    setEditingRate((p: any) => ({ ...p, [it.id]: String(it.rate) }));
  const startEditQty = () =>
    setEditingQty((p: any) => ({ ...p, [it.id]: String(it.qty) }));

  return (
    <div
      className={styles.orderItem}
      onMouseEnter={(e: any) =>
        (e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)")
      }
      onMouseLeave={(e: any) =>
        (e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)")
      }
    >
      <button
        type="button"
        onClick={() => removeLine(it.id)}
        aria-label={`Remove ${it.name}`}
        className={styles.removeBtn}
      >
        ×
      </button>
      <div className={styles.itemInfo}>
        <div className={styles.itemTitle}>{it.name}</div>
        {editingRate[it.id] !== undefined ? (
          <input
            type="number"
            step="0.01"
            value={editingRate[it.id]}
            onChange={(e) =>
              setEditingRate((prev: any) => ({
                ...prev,
                [it.id]: e.target.value,
              }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={() => commitRate(it.id)}
            className={styles.modalInputSmall}
            style={{ marginTop: 6, width: 120, textAlign: "right" }}
            autoFocus
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={startEditRate}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                startEditRate();
              }
            }}
            title="Click to edit rate"
            style={{
              color: "#9ca3af",
              fontSize: 12,
              marginTop: 6,
              cursor: "text",
              display: "inline-block",
            }}
          >
            ₹{it.rate} each
          </div>
        )}
      </div>
      <div className={styles.itemQtyWrap}>
        <button
          type="button"
          onClick={() => updateOrderQty(it.id, -1)}
          disabled={decreaseDisabled}
          aria-label={`Decrease quantity of ${it.name}`}
          className={styles.qtyBtn}
        >
          −
        </button>
        {editingQty[it.id] !== undefined ? (
          <input
            type="number"
            value={editingQty[it.id]}
            onChange={(e) =>
              setEditingQty((prev: any) => ({
                ...prev,
                [it.id]: e.target.value,
              }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={() => commitQty(it.id)}
            min={1}
            className={styles.qtyInput}
            autoFocus
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={startEditQty}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                startEditQty();
              }
            }}
            aria-label={`Quantity of ${it.name}: ${it.qty}. Press Enter to edit.`}
            style={{
              minWidth: 44,
              textAlign: "center",
              fontWeight: 800,
              fontSize: 16,
              cursor: "text",
              padding: "0 4px",
              color: "#111827",
            }}
          >
            {it.qty}
          </div>
        )}
        <button
          type="button"
          onClick={() => updateOrderQty(it.id, +1)}
          aria-label={`Increase quantity of ${it.name}`}
          className={styles.qtyBtn}
        >
          +
        </button>
      </div>
      <div className={styles.itemTotal}>₹{(it.qty || 0) * (it.rate || 0)}</div>
    </div>
  );
}
