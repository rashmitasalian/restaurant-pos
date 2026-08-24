import React from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

type IconSize = "sm" | "md" | "lg";

const SIZE: Record<IconSize, number> = {
  sm: 14,
  md: 16,
  lg: 20,
};

export function Icon({
  icon: Glyph,
  size = "md",
  label,
  className,
  ...rest
}: {
  icon: LucideIcon;
  size?: IconSize;
  label?: string;
  className?: string;
} & Omit<LucideProps, "size" | "strokeWidth">) {
  return (
    <Glyph
      size={SIZE[size]}
      strokeWidth={1.75}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      className={className}
      {...rest}
    />
  );
}
