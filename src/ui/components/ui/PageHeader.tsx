import React from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="pos-ph">
      <div>
        <h2 className="pos-ph-title">{title}</h2>
        {subtitle ? <p className="pos-ph-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="pos-ph-actions">{actions}</div> : null}
    </div>
  );
}
