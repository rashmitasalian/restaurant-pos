import React from "react";
import { Minus, Plus, X } from "lucide-react";
import { KITCHEN_NOTE_MAX } from "../../../shared/kitchenNote";
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
  kitchenNote,
  noteEditable = false,
  onCommitNote,
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
  kitchenNote?: string | null;
  noteEditable?: boolean;
  onCommitNote?: (note: string) => void;
}) {
  const name = String(title || "").trim() || "Item";
  const hasVariants = Array.isArray(variantChoices) && variantChoices.length > 0;
  const savedNote = String(kitchenNote || "");
  const [noteDraft, setNoteDraft] = React.useState(savedNote);
  const noteFocused = React.useRef(false);
  React.useEffect(() => {
    if (!noteFocused.current) {
      setNoteDraft(savedNote);
    }
  }, [savedNote]);
  const canEditNote = noteEditable && typeof onCommitNote === "function";
  const commitNote = () => {
    if (!onCommitNote || noteDraft.trim() === savedNote.trim()) {
      return;
    }
    onCommitNote(noteDraft);
  };

  return (
    <div className="ui-order-row">
      <div>
        <div className="ui-order-row-name" title={name}>
          {name}
        </div>
        {hasVariants && onChangeVariant
          ? variantChoices!
              .filter(
                (variant) =>
                  variant.name.trim().toLowerCase() !==
                  String(selectedVariantName || "").trim().toLowerCase(),
              )
              .map((variant) => (
                <button
                  key={variant.id || variant.name}
                  type="button"
                  onClick={() => onChangeVariant(variant.name)}
                  title={`Add ${variant.name} as its own line`}
                  aria-label={`Add ${variant.name} for ${name}`}
                  className="pos-input"
                  style={{
                    marginTop: 4,
                    width: "auto",
                    maxWidth: "100%",
                    padding: "2px 8px",
                    fontSize: 12,
                  }}
                >
                  Add {variant.name} · ₹{variant.price}
                </button>
              ))
          : null}
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

      <div className="ui-order-row-total" title={lineTotalLabel}>
        {lineTotalLabel}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="ui-order-row-remove"
        title="Remove"
      >
        <Icon icon={X} size="sm" />
      </button>
      {canEditNote ? (
        <input
          className="pos-input ui-order-row-note"
          value={noteDraft}
          placeholder="Kitchen note"
          aria-label={`Kitchen note for ${name}`}
          maxLength={KITCHEN_NOTE_MAX}
          autoComplete="off"
          onFocus={() => {
            noteFocused.current = true;
          }}
          onChange={(event) => setNoteDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              (event.target as HTMLInputElement).blur();
            }
          }}
          onBlur={() => {
            noteFocused.current = false;
            commitNote();
          }}
        />
      ) : savedNote ? (
        <ul className="ui-order-row-mod ui-order-row-note-locked">
          <li>{savedNote}</li>
        </ul>
      ) : null}
    </div>
  );
}
