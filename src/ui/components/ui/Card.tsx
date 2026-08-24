import React from "react";

export function Card({
  children,
  padded = false,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={`ui-card ${padded ? "ui-card-p" : ""} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
