import React from "react";
import styles from "../Billing.module.css";

interface PickButtonsProps {
  onPickTable: () => void;
  onNewTakeaway: () => void;
  onNewDelivery: () => void;
}

export default function PickButtons({
  onPickTable,
  onNewTakeaway,
  onNewDelivery,
}: PickButtonsProps) {
  return (
    <div className={styles.pickBtns}>
      <button
        onClick={onPickTable}
        className={`${styles.pickBtn} ${styles.pickTable}`}
      >
        🪑 Pick Table
      </button>
      <button
        onClick={onNewTakeaway}
        className={`${styles.pickBtn} ${styles.pickTakeaway}`}
      >
        🛍️ New Takeaway
      </button>
      <button
        onClick={onNewDelivery}
        className={`${styles.pickBtn} ${styles.pickDelivery}`}
      >
        🚚 New Delivery
      </button>
    </div>
  );
}
