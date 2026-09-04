import React from "react";
import { Minus, Plus } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import { money } from "../money";

export type Variant = {
  id: string;
  name: string;
  price: number;
};

export function VariantSheet({
  item,
  busy,
  onSelect,
  onClose,
}: {
  item: { name: string; price: number; variants: Variant[] };
  busy?: boolean;
  onSelect: (variant: Variant | null, qty: number) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = React.useState(1);
  const [picked, setPicked] = React.useState<Variant | "regular" | null>("regular");
  const price =
    picked && picked !== "regular" ? Number(picked.price || 0) : Number(item.price || 0);
  const canAdd = picked !== null;

  return (
    <div
      className="cap-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Choose options for ${item.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="cap-modal-card">
        <h3>{item.name}</h3>
        <div className="cap-meta">Choose a variant, then add</div>

        <div className="cap-qty cap-qty-block">
          <span>Quantity</span>
          <div className="cap-qty">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQty((value) => Math.max(1, value - 1))}
            >
              <Icon icon={Minus} size="md" />
            </button>
            <span>{qty}</span>
            <button type="button" aria-label="Increase quantity" onClick={() => setQty((value) => value + 1)}>
              <Icon icon={Plus} size="md" />
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`cap-choice ${picked === "regular" ? "cap-choice-active" : ""}`}
          onClick={() => setPicked("regular")}
        >
          <span>Regular</span>
          <strong>{money(Number(item.price || 0))}</strong>
        </button>
        {item.variants.map((variant) => (
          <button
            key={variant.id}
            type="button"
            className={`cap-choice ${picked !== "regular" && picked?.id === variant.id ? "cap-choice-active" : ""}`}
            onClick={() => setPicked(variant)}
          >
            <span>{variant.name}</span>
            <strong>{money(Number(variant.price || 0))}</strong>
          </button>
        ))}

        <button
          type="button"
          className="cap-btn cap-btn-primary"
          disabled={!canAdd || busy}
          onClick={() => onSelect(picked === "regular" ? null : picked, qty)}
        >
          Add to order · {money(price * qty)}
        </button>
        <button type="button" className="cap-btn cap-btn-quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
