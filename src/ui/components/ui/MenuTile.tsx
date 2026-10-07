import React from "react";
import { dietName } from "../../../shared/menuDiet";
import { DietMark } from "./DietMark";

export function MenuTile({
  name,
  priceLabel,
  meta,
  diet,
  onClick,
  disabled = false,
  className = "",
}: {
  name: string;
  priceLabel: string;
  meta?: string;
  diet?: string | null;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const label = String(name || "").trim() || "Item";
  const dietLabel = dietName(diet);
  const accessible = dietLabel
    ? `Add ${label}, ${dietLabel}, ${priceLabel}`
    : `Add ${label}, ${priceLabel}`;
  return (
    <button
      type="button"
      className={`ui-menu-tile ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={accessible}
    >
      <p className="ui-menu-tile-name">
        <DietMark diet={diet} decorative />
        <span className="ui-menu-tile-name-text">{label}</span>
      </p>
      <div className="ui-menu-tile-foot">
        <span className="ui-menu-tile-meta">{meta || ""}</span>
        <span className="ui-menu-tile-price">{priceLabel}</span>
      </div>
    </button>
  );
}
