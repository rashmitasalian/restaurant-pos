import React from "react";

type Props = {
  label?: string;
  className?: string;
  rows?: number;
};

export function Skeleton({ label = "Loading…", className = "", rows = 0 }: Props) {
  if (rows > 0) {
    return (
      <div className={`ui-skeleton-stack ${className}`.trim()} role="status" aria-label={label}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="ui-skeleton-row" aria-hidden="true" />
        ))}
        <span className="ui-sr-only">{label}</span>
      </div>
    );
  }
  return (
    <div className={`pos-skeleton ${className}`.trim()} role="status" aria-live="polite">
      {label}
    </div>
  );
}
