import React from "react";
import { CANCEL_REASON_OTHER, CANCEL_REASON_PRESETS } from "../../shared/cancelReasons";

export function VoidSheet({
  lineName,
  sentQty,
  targetQty,
  preset,
  other,
  busy,
  onPreset,
  onOther,
  onConfirm,
  onClose,
}: {
  lineName: string;
  sentQty: number;
  targetQty: number;
  preset: string;
  other: string;
  busy: boolean;
  onPreset: (value: string) => void;
  onOther: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const voidQty = Math.max(0, sentQty - targetQty);
  const canConfirm = Boolean(preset && (preset !== CANCEL_REASON_OTHER || other.trim()));

  return (
    <div
      className="cap-modal cap-modal-elevated"
      role="dialog"
      aria-modal="true"
      aria-label="Void sent KOT item"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div className="cap-modal-card">
        <h3>Void Sent KOT Item</h3>
        <p className="cap-meta">
          This item has already been sent to the kitchen. A void KOT will print before the order is
          updated.
        </p>
        <div className="cap-void-summary">
          <strong>{lineName}</strong>
          <span>
            Cancel ×{voidQty}
            {targetQty > 0 ? ` · keep ×${targetQty}` : ""}
          </span>
        </div>
        <div className="cap-reason">
          <div className="cap-ticket-label">Reason</div>
          {CANCEL_REASON_PRESETS.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="void-reason"
                checked={preset === option}
                disabled={busy}
                onChange={() => onPreset(option)}
              />
              {option}
            </label>
          ))}
          {preset === CANCEL_REASON_OTHER ? (
            <input
              className="cap-search"
              placeholder="Describe the reason"
              value={other}
              disabled={busy}
              onChange={(e) => onOther(e.target.value)}
            />
          ) : null}
        </div>
        <button
          type="button"
          className="cap-btn cap-btn-danger"
          disabled={busy || !canConfirm || voidQty <= 0}
          onClick={onConfirm}
        >
          {busy ? "Printing…" : "Print Void KOT"}
        </button>
        <button type="button" className="cap-btn cap-btn-quiet" disabled={busy} onClick={onClose}>
          Keep item
        </button>
      </div>
    </div>
  );
}
