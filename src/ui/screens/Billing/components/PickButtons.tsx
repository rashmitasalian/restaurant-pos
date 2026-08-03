import React from "react";
import type { ServiceMode } from "../../../../shared/serviceModes";
import styles from "../Billing.module.css";

interface PickButtonsProps {
  serviceModes: ServiceMode[];
  onSelectMode: (mode: ServiceMode) => void;
}

export default function PickButtons({ serviceModes, onSelectMode }: PickButtonsProps) {
  return (
    <div className={styles.pickBtns}>
      {serviceModes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onSelectMode(mode)}
          className={`${styles.pickBtn} ${
            mode.requiresTable
              ? styles.pickTable
              : mode.id === "delivery"
                ? styles.pickDelivery
                : styles.pickTakeaway
          }`}
        >
          {mode.requiresTable ? "🪑" : mode.id === "delivery" ? "🚚" : "🧾"} {mode.name}
        </button>
      ))}
    </div>
  );
}
