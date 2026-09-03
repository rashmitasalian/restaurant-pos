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
  idleLabel = "Ready",
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
  idleLabel?: string;
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
  const isRail = !isFloor;
  const footMeta = [itemCount && itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? "s" : ""}` : "", elapsed]
    .filter(Boolean)
    .join(" · ");
  const showRailCount = isRail && itemCount !== null && itemCount !== undefined && itemCount > 0;

  return (
    <button
      type="button"
      className={`ui-table-tile ${isFloor ? "ui-table-tile-floor" : "ui-table-tile-rail"} ${stateClass} ${active ? "ui-table-tile-active" : ""} ${className}`.trim()}
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
        <span className="ui-table-tile-rail-head">
          <span className="ui-table-tile-num">{number}</span>
          {showRailCount ? (
            <span className={countClass} aria-hidden="true">
              {itemCount}
            </span>
          ) : (
            <span className="ui-table-tile-state ui-table-tile-state-rail">
              <StatusDot tone={tone} label={label} decorative />
            </span>
          )}
        </span>
      )}
      {!isRail && seats ? <span className="ui-table-tile-meta">{seats} seats</span> : null}
      {isFloor || amountLabel || footMeta || state === "available" ? (
        <span className="ui-table-tile-foot">
          {amountLabel ? (
            <span className="ui-table-tile-amount">{amountLabel}</span>
          ) : state === "available" ? (
            <span className="ui-table-tile-ready">{idleLabel}</span>
          ) : (
            <span className="ui-table-tile-amount-empty" aria-hidden="true" />
          )}
          {footMeta ? (
            <span className="ui-table-tile-foot-meta" title={footMeta}>
              {footMeta}
            </span>
          ) : null}
          {isRail && state === "available" && seats ? (
            <span className="ui-table-tile-foot-meta">{seats} seats</span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
