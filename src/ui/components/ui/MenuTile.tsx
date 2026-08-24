import React from "react";

export function MenuTile({
  name,
  priceLabel,
  meta,
  onClick,
  disabled = false,
  className = "",
}: {
  name: string;
  priceLabel: string;
  meta?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const label = String(name || "").trim() || "Item";
  return (
    <button
      type="button"
      className={`ui-menu-tile ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={`Add ${label}, ${priceLabel}`}
    >
      <p className="ui-menu-tile-name">{label}</p>
      <div className="ui-menu-tile-foot">
        <span className="ui-menu-tile-meta">{meta || ""}</span>
        <span className="ui-menu-tile-price">{priceLabel}</span>
      </div>
    </button>
  );
}
