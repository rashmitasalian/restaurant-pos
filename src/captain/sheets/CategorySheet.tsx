import React from "react";
import { X } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";

export function CategorySheet({
  categories,
  selected,
  onSelect,
  onClose,
}: {
  categories: string[];
  selected: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="cap-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Menu categories"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="cap-modal-card">
        <div className="cap-sheet-head">
          <h3>Categories</h3>
          <button type="button" className="cap-icon-btn cap-icon-btn-light" onClick={onClose} aria-label="Close">
            <Icon icon={X} size="lg" />
          </button>
        </div>
        <div className="cap-choice-list">
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              className={`cap-choice ${selected === name ? "cap-choice-active" : ""}`}
              onClick={() => onSelect(name)}
            >
              <span>{name}</span>
              {selected === name ? <strong>✓</strong> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
