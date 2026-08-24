import React from "react";

type Tone = "neutral" | "occupied" | "attention" | "success" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "ui-badge-neutral",
  occupied: "ui-badge-occupied",
  attention: "ui-badge-attention",
  success: "ui-badge-success",
  danger: "ui-badge-danger",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return <span className={`ui-badge ${TONE[tone]} ${className}`.trim()}>{children}</span>;
}
