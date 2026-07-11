import React from "react";
import styles from "../Billing.module.css";

interface OrderRowProps {
  order: any;
  isActive?: boolean;
  onSelect?: () => void;
  type?: "takeaway" | "delivery" | "table";
}

export default function OrderRow({
  order,
  isActive = false,
  onSelect,
  type = "takeaway",
}: OrderRowProps) {
  const platform = (
    order?.meta?.platform ||
    order?.meta?.orderSource ||
    "Delivery"
  ).toString();
  const code = order?.meta?.code || order?.meta?.orderCode || "";
  const total =
    typeof order?.total === "number"
      ? order.total
      : (order?.items || []).reduce(
          (s: number, it: any) => s + (it.qty || 0) * (it.rate || 0),
          0,
        );
  const platformColor = platform.toLowerCase().includes("swiggy")
    ? "#f97316"
    : platform.toLowerCase().includes("zomato")
    ? "#ef4444"
    : "#7c3aed";

  return (
    <button
      onClick={onSelect}
      className={`${styles.orderButton} ${isActive ? styles.orderActive : ""}`}
    >
      <div className={styles.orderRowTop}>
        <span
          className={
            type === "delivery" ? styles.deliveryTitle : styles.takeawayTitle
          }
        >
          {type === "delivery"
            ? `🚚 ${platform}`
            : type === "takeaway"
            ? `🛍️ ${
                order?.meta?.customerName ||
                order?.meta?.parcelName ||
                "Takeaway"
              }`
            : `Table ${order?.tableId || ""}`}
        </span>

        {order?.status && order.status !== "open" && (
          <span
            className={`${styles.statusBadge} ${
              order.status === "ready" ? styles.statusReady : styles.statusHeld
            }`}
          >
            {order.status}
          </span>
        )}
      </div>

      {code && <div className={styles.codeMono}>#{code}</div>}

      <div className={styles.orderRowMeta}>
        {(order?.items || []).length} items · ₹{total}
      </div>
    </button>
  );
}
