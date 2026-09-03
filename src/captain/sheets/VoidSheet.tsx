import React from "react";
import {
  CANCEL_REASON_OTHER,
  CANCEL_REASON_PRESETS,
} from "../../shared/cancelReasons";

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
  return (
    <div
      className="cap-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Cancel item"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="cap-modal-card">
        <h3>Cancel item</h3>
        <div className="cap-meta">
          {lineName} · sent {sentQty} → {targetQty}
        </div>
        <div className="cap-reason">
          {CANCEL_REASON_PRESETS.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="void-reason"
                checked={preset === option}
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
              onChange={(e) => onOther(e.target.value)}
            />
          ) : null}
        </div>
        <button type="button" className="cap-btn cap-btn-danger" disabled={busy} onClick={onConfirm}>
          Cancel item
        </button>
        <button type="button" className="cap-btn cap-btn-quiet" onClick={onClose}>
          Back
        </button>
      </div>
    </div>
  );
}
