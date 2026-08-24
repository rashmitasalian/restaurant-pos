import React from "react";

export function FavoriteTile({
  name,
  priceLabel,
  shortcut,
  onClick,
  disabled = false,
  className = "",
}: {
  name: string;
  priceLabel: string;
  shortcut?: number | null;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const label = String(name || "").trim() || "Item";
  const shortcutText = shortcut ? ` Shortcut ${shortcut}.` : "";
  return (
    <button
      type="button"
      className={`ui-favorite-tile ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={`Quick add ${label}, ${priceLabel}.${shortcutText}`}
    >
      <p className="ui-favorite-tile-name">{label}</p>
      <div className="ui-favorite-tile-foot">
        <span className="ui-favorite-tile-price">{priceLabel}</span>
        {shortcut ? <span className="ui-favorite-tile-shortcut">[{shortcut}]</span> : null}
      </div>
    </button>
  );
}
