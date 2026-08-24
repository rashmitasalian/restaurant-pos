import React from "react";
import type { ServiceMode } from "../../../../shared/serviceModes";
import styles from "../Billing.module.css";
import { Icon } from "../../../components/ui/Icon";
import { UtensilsCrossed, Bike, ShoppingBag } from "lucide-react";

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
          <Icon
            icon={mode.requiresTable ? UtensilsCrossed : mode.id === "delivery" ? Bike : ShoppingBag}
            size="sm"
          />
          {mode.name}
        </button>
      ))}
    </div>
  );
}
