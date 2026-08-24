import React from "react";
import { OrderItemRow } from "../../../components/ui/OrderItemRow";

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
  variantChoices?: Array<{ id?: string; name: string; price: number }>;
  selectedVariantName?: string;
  onChangeVariant: (id: string, variantName: string) => Promise<void>;
  displayName?: string;
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
  variantChoices = [],
  selectedVariantName = "",
  onChangeVariant,
  displayName,
}: Props) {
  const kotSentQty = Math.max(0, Number(it.kotPrintedQty || 0));
  const atMinQty = Number(it.qty || 1) <= 1;
  const decreaseDisabled = atMinQty && kotSentQty === 0;
  const title = String(displayName || it.name || "").trim() || "Item";
  const lineTotal = (Number(it.qty) || 0) * (Number(it.rate) || 0);

  return (
    <OrderItemRow
      title={title}
      rateLabel={`₹${it.rate} each`}
      qty={it.qty}
      lineTotalLabel={`₹${lineTotal}`}
      editingQty={editingQty[it.id]}
      editingRate={editingRate[it.id]}
      decreaseDisabled={decreaseDisabled}
      variantChoices={variantChoices}
      selectedVariantName={selectedVariantName}
      onChangeVariant={(variantName) => onChangeVariant(it.id, variantName)}
      onDecrease={() => updateOrderQty(it.id, -1)}
      onIncrease={() => updateOrderQty(it.id, +1)}
      onStartEditQty={() => setEditingQty((p: any) => ({ ...p, [it.id]: String(it.qty) }))}
      onStartEditRate={() => setEditingRate((p: any) => ({ ...p, [it.id]: String(it.rate) }))}
      onQtyChange={(value) => setEditingQty((prev: any) => ({ ...prev, [it.id]: value }))}
      onRateChange={(value) => setEditingRate((prev: any) => ({ ...prev, [it.id]: value }))}
      onCommitQty={() => {
        void commitQty(it.id);
      }}
      onCommitRate={() => {
        void commitRate(it.id);
      }}
      onRemove={() => {
        void removeLine(it.id);
      }}
    />
  );
}
