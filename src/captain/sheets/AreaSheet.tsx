import React from "react";
import { X } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import { useBackdropDismiss } from "../../ui/hooks/useBackdropDismiss";

export function AreaSheet({
  areas,
  areaId,
  onSelect,
  onClose,
}: {
  areas: Array<{ id: string; name: string }>;
  areaId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const backdrop = useBackdropDismiss(onClose);
  return (
    <div
      className="cap-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Select area"
      {...backdrop}
    >
      <div className="cap-modal-card">
        <div className="cap-sheet-head">
          <h3>Select area</h3>
          <button
            type="button"
            className="cap-icon-btn cap-icon-btn-light"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon icon={X} size="lg" />
          </button>
        </div>
        <button
          type="button"
          className={`cap-choice ${areaId === null ? "cap-choice-active" : ""}`}
          onClick={() => onSelect(null)}
        >
          <span>All areas</span>
          {areaId === null ? <strong>✓</strong> : null}
        </button>
        {areas.map((area) => (
          <button
            key={area.id}
            type="button"
            className={`cap-choice ${areaId === area.id ? "cap-choice-active" : ""}`}
            onClick={() => onSelect(area.id)}
          >
            <span>{area.name}</span>
            {areaId === area.id ? <strong>✓</strong> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
