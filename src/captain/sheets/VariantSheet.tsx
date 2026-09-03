import React from "react";
import { money } from "../money";

export type Variant = {
  id: string;
  name: string;
  price: number;
};

export function VariantSheet({
  item,
  onSelect,
  onClose,
}: {
  item: { name: string; price: number; variants: Variant[] };
  onSelect: (variant: Variant | null) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="cap-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Choose variant"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="cap-modal-card">
        <h3>{item.name}</h3>
        <div className="cap-meta">Choose a variant</div>
        <button type="button" className="cap-choice" onClick={() => onSelect(null)}>
          <span>Regular</span>
          <strong>{money(Number(item.price || 0))}</strong>
        </button>
        {item.variants.map((variant) => (
          <button key={variant.id} type="button" className="cap-choice" onClick={() => onSelect(variant)}>
            <span>{variant.name}</span>
            <strong>{money(Number(variant.price || 0))}</strong>
          </button>
        ))}
        <button type="button" className="cap-btn cap-btn-quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
