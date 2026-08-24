import React from "react";
import { StatusDot } from "./StatusDot";

export type TableTileState = "available" | "occupied" | "attention";

export function TableTile({
  number,
  state = "available",
  stateLabel,
  seats,
  itemCount,
  amountLabel,
  elapsed,
  active = false,
  variant = "rail",
  onClick,
  className = "",
  disabled = false,
  "aria-label": ariaLabel,
}: {
  number: number | string;
  state?: TableTileState;
  stateLabel?: string;
  seats?: number | null;
  itemCount?: number | null;
  amountLabel?: string;
  elapsed?: string;
  active?: boolean;
  variant?: "rail" | "floor";
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const tone =
    state === "attention" ? "attention" : state === "occupied" ? "occupied" : "neutral";
  const label =
    stateLabel ||
    (state === "attention" ? "Pending" : state === "occupied" ? "Occupied" : "Available");
  const stateClass =
    state === "attention"
      ? "ui-table-tile-attention"
      : state === "occupied"
        ? "ui-table-tile-occupied"
        : "";
  const countClass =
    state === "attention" ? "ui-table-tile-count ui-table-tile-count-attention" : "ui-table-tile-count";
  const isFloor = variant === "floor";
  const footMeta = [itemCount && itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? "s" : ""}` : "", elapsed]
    .filter(Boolean)
    .join(" · ");
  const showRailCount = !isFloor && itemCount !== null && itemCount !== undefined && itemCount > 0;

  return (
    <button
      type="button"
      className={`ui-table-tile ${isFloor ? "ui-table-tile-floor" : ""} ${stateClass} ${active ? "ui-table-tile-active" : ""} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || `Table ${number}, ${label}`}
      aria-pressed={active || undefined}
    >
      {isFloor ? (
        <span className="ui-table-tile-top">
          <span className="ui-table-tile-num">{number}</span>
          <span className="ui-table-tile-state">
            <StatusDot tone={tone} label={label} decorative />
            {label}
          </span>
        </span>
      ) : (
        <>
          <span className={`ui-table-tile-num${showRailCount ? " ui-table-tile-num-pad" : ""}`}>
            {number}
          </span>
          <span className="ui-table-tile-state">
            <StatusDot tone={tone} label={label} decorative />
            {label}
          </span>
        </>
      )}
      {seats ? <span className="ui-table-tile-meta">{seats} seats</span> : null}
      {isFloor || amountLabel || footMeta ? (
        <span className="ui-table-tile-foot">
          {amountLabel ? (
            <span className="ui-table-tile-amount">{amountLabel}</span>
          ) : (
            <span className="ui-table-tile-amount-empty" aria-hidden="true" />
          )}
          {footMeta ? <span className="ui-table-tile-foot-meta">{footMeta}</span> : null}
        </span>
      ) : null}
      {showRailCount ? (
        <span className={countClass} aria-hidden="true">
          {itemCount}
        </span>
      ) : null}
    </button>
  );
}
