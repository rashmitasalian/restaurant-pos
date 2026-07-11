import React from "react";
import OrderItem from "./OrderItem";
import styles from "../Billing.module.css";

interface Props {
  items: any[];
  editingQty: Record<string, string>;
  editingRate: Record<string, string>;
  setEditingQty: (v: any) => void;
  setEditingRate: (v: any) => void;
  commitQty: (id: string) => Promise<void>;
  commitRate: (id: string) => Promise<void>;
  removeLine: (id: string) => Promise<unknown>;
  updateOrderQty: (id: string, delta: number) => Promise<void>;
}

export default function OrderList({
  items,
  editingQty,
  editingRate,
  setEditingQty,
  setEditingRate,
  commitQty,
  commitRate,
  removeLine,
  updateOrderQty,
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
      {items.map((it) => (
        <OrderItem
          key={it.id}
          it={it}
          editingQty={editingQty}
          editingRate={editingRate}
          setEditingQty={setEditingQty}
          setEditingRate={setEditingRate}
          commitQty={commitQty}
          commitRate={commitRate}
          removeLine={removeLine}
          updateOrderQty={updateOrderQty}
        />
      ))}
    </div>
  );
}
