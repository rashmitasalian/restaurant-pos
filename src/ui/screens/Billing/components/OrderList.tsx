import React from "react";
import OrderItem from "./OrderItem";
import styles from "../Billing.module.css";

interface Props {
  items: any[];
  menuItemsById: Record<string, any>;
  editingQty: Record<string, string>;
  editingRate: Record<string, string>;
  setEditingQty: (v: any) => void;
  setEditingRate: (v: any) => void;
  commitQty: (id: string) => Promise<void>;
  commitRate: (id: string) => Promise<void>;
  removeLine: (id: string) => Promise<unknown>;
  updateOrderQty: (id: string, delta: number) => Promise<void>;
  onChangeVariant: (id: string, variantName: string) => Promise<void>;
}

function detectSelectedVariant(line: any, menuItem: any) {
  const variants = Array.isArray(menuItem?.variants) ? menuItem.variants : [];
  if (!variants.length) {
    return "";
  }
  const escapedBase = String(menuItem?.name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byNameMatch = new RegExp(`^${escapedBase}\\s*\\(([^)]+)\\)\\s*$`, "i").exec(
    String(line?.name || ""),
  );
  const fromName = (byNameMatch?.[1] || "").trim().toLowerCase();
  if (fromName) {
    const exact = variants.find(
      (variant: any) => String(variant?.name || "").trim().toLowerCase() === fromName,
    );
    if (exact) {
      return exact.name;
    }
  }
  const byRate = variants.find((variant: any) => Number(variant?.price) === Number(line?.rate));
  return byRate?.name || variants[0]?.name || "";
}

export default function OrderList({
  items,
  menuItemsById,
  editingQty,
  editingRate,
  setEditingQty,
  setEditingRate,
  commitQty,
  commitRate,
  removeLine,
  updateOrderQty,
  onChangeVariant,
}: Props) {
  if (!items || items.length === 0) {
return (
      <div
        className={styles.textMuted}
        style={{ textAlign: "center", padding: "28px 0", fontSize: 14 }}
      >
        No items yet — search above to add
      </div>
    );
}
  return (
    <div className={styles.orderList}>
      {items.map((it) => {
        const menuItem = it?.menuItemId ? menuItemsById[it.menuItemId] : null;
        const variants = Array.isArray(menuItem?.variants) ? menuItem.variants : [];
        const selectedVariantName = detectSelectedVariant(it, menuItem);
        const displayName = String(it?.name || menuItem?.name || "").trim() || "Item";
        return (
          <OrderItem
            key={it.id}
            it={it}
            displayName={displayName}
            editingQty={editingQty}
            editingRate={editingRate}
            setEditingQty={setEditingQty}
            setEditingRate={setEditingRate}
            commitQty={commitQty}
            commitRate={commitRate}
            removeLine={removeLine}
            updateOrderQty={updateOrderQty}
            variantChoices={variants}
            selectedVariantName={selectedVariantName}
            onChangeVariant={onChangeVariant}
          />
        );
      })}
    </div>
  );
}
