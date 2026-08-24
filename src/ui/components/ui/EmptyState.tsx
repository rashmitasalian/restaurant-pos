import React from "react";
import { Button } from "./Button";

export function EmptyState({
  title,
  text,
  actionLabel,
  onAction,
}: {
  title: string;
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="ui-empty">
      <h3 className="ui-empty-title">{title}</h3>
      {text ? <p style={{ margin: 0, color: "var(--pos-tx-sub)" }}>{text}</p> : null}
      {actionLabel && onAction ? (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
