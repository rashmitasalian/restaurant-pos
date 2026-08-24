import React from "react";

export function Stat({
  label,
  value,
  sub,
  primary = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <div className="ui-stat">
      <div className="ui-stat-label">{label}</div>
      <div className={`ui-stat-value${primary ? " ui-stat-value-primary" : ""}`}>{value}</div>
      {sub ? <div className="ui-stat-sub">{sub}</div> : null}
    </div>
  );
}
