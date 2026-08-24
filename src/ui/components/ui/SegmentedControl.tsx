import React from "react";

export type SegmentOption = {
  id: string;
  label: string;
};

export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentOption[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = options[(index + delta + options.length) % options.length];
    if (next) {
      onChange(next.id);
    }
  };
  return (
    <div className="ui-seg" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-pressed={active}
            tabIndex={active ? 0 : -1}
            className={`ui-seg-btn${active ? " ui-seg-active" : ""}`}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
