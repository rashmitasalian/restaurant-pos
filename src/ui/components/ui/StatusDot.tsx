import React from "react";

type Tone = "neutral" | "occupied" | "attention" | "success" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "",
  occupied: "ui-dot-occupied",
  attention: "ui-dot-attention",
  success: "ui-dot-success",
  danger: "ui-dot-danger",
};

export function StatusDot({
  tone = "neutral",
  label,
  decorative = false,
}: {
  tone?: Tone;
  label: string;
  decorative?: boolean;
}) {
  return (
    <span
      className={`ui-dot ${TONE[tone]}`.trim()}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
    />
  );
}
