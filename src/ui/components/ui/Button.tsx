import React from "react";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "danger-ghost";
type Size = "sm" | "md" | "lg";

export function Button({
  children,
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  disabled,
  type = "button",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}) {
  const variantClass =
    variant === "primary"
      ? "ui-btn-primary"
      : variant === "accent"
        ? "ui-btn-accent"
        : variant === "ghost"
          ? "ui-btn-ghost"
          : variant === "danger"
            ? "ui-btn-danger"
            : variant === "danger-ghost"
              ? "ui-btn-danger-ghost"
              : "ui-btn-secondary";
  const sizeClass = size === "sm" ? "ui-btn-sm" : size === "lg" ? "ui-btn-lg" : "";
  return (
    <button
      type={type}
      className={`ui-btn ${variantClass} ${sizeClass} ${loading ? "ui-btn-loading" : ""} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? "Working..." : children}
    </button>
  );
}
