import React from "react";
import { Minus, Plus, X } from "lucide-react";
import { Icon } from "./Icon";

export function OrderItemRow({
  title,
  modifiers,
  rateLabel,
  qty,
  lineTotalLabel,
  editingQty,
  editingRate,
  decreaseDisabled,
  variantChoices,
  selectedVariantName,
  onChangeVariant,
  onDecrease,
  onIncrease,
  onStartEditQty,
  onStartEditRate,
  onQtyChange,
  onRateChange,
  onCommitQty,
  onCommitRate,
  onRemove,
}: {
  title: string;
  modifiers?: string[];
  rateLabel: string;
  qty: number | string;
  lineTotalLabel: string;
  editingQty?: string;
  editingRate?: string;
  decreaseDisabled?: boolean;
  variantChoices?: Array<{ id?: string; name: string; price: number }>;
  selectedVariantName?: string;
  onChangeVariant?: (variantName: string) => void;
  onDecrease: () => void;
  onIncrease: () => void;
  onStartEditQty: () => void;
  onStartEditRate: () => void;
  onQtyChange: (value: string) => void;
  onRateChange: (value: string) => void;
  onCommitQty: () => void;
  onCommitRate: () => void;
  onRemove: () => void;
}) {
  const name = String(title || "").trim() || "Item";
  const hasVariants = Array.isArray(variantChoices) && variantChoices.length > 0;

  return (
    <div className="ui-order-row">
      <div>
        <div className="ui-order-row-name" title={name}>
          {name}
        </div>
        {hasVariants && onChangeVariant ? (
          <select
            value={selectedVariantName || ""}
            onChange={(e) => onChangeVariant(e.target.value)}
            title="Switch variant"
            aria-label={`Variant for ${name}`}
            style={{ marginTop: 4, maxWidth: "100%" }}
            className="pos-input"
          >
            {variantChoices!.map((variant) => (
              <option key={variant.id || variant.name} value={variant.name}>
                {variant.name} · ₹{variant.price}
              </option>
            ))}
          </select>
        ) : null}
        {modifiers && modifiers.length > 0 ? (
          <ul className="ui-order-row-mod">
            {modifiers.map((mod) => (
              <li key={mod}>{mod}</li>
            ))}
          </ul>
        ) : null}
        {editingRate !== undefined ? (
          <input
            type="number"
            step="0.01"
            value={editingRate}
            onChange={(e) => onRateChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={onCommitRate}
            aria-label={`Rate for ${name}`}
            className="pos-input"
            style={{ marginTop: 6, width: 120, textAlign: "right" }}
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={onStartEditRate}
            title="Click to edit rate"
            aria-label={`Rate ${rateLabel} for ${name}. Click to edit.`}
            style={{
              marginTop: 4,
              padding: 0,
              border: "none",
              background: "none",
              color: "var(--pos-tx-sub)",
              fontSize: "var(--pos-type-11)",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {rateLabel}
          </button>
        )}
      </div>

      <div className="ui-order-row-qty">
        <button
          type="button"
          onClick={onDecrease}
          disabled={decreaseDisabled}
          aria-label={`Decrease quantity of ${name}`}
          className="ui-order-row-qty-btn"
        >
          <Icon icon={Minus} size="sm" />
        </button>
        {editingQty !== undefined ? (
          <input
            type="number"
            value={editingQty}
            onChange={(e) => onQtyChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={onCommitQty}
            min={1}
            aria-label={`Quantity of ${name}`}
            className="pos-input"
            style={{ width: 44, textAlign: "center" }}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="ui-order-row-qty-value"
            onClick={onStartEditQty}
            aria-label={`Quantity of ${name}: ${qty}. Press Enter to edit.`}
          >
            {qty}
          </button>
        )}
        <button
          type="button"
          onClick={onIncrease}
          aria-label={`Increase quantity of ${name}`}
          className="ui-order-row-qty-btn"
        >
          <Icon icon={Plus} size="sm" />
        </button>
      </div>

      <div className="ui-order-row-total">{lineTotalLabel}</div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="ui-order-row-remove"
        title="Remove"
      >
        <Icon icon={X} size="sm" />
      </button>
    </div>
  );
}
