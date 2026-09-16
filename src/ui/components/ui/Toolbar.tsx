import React from "react";

export function Toolbar({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`ui-toolbar ${className}`.trim()}>{children}</div>;
}
