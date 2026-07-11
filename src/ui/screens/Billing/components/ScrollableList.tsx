import React from "react";
import styles from "../Billing.module.css";

interface ScrollableListProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export default function ScrollableList({
  children,
  className = "",
  style,
}: ScrollableListProps) {
  return (
    <div className={`${styles.scrollArea} ${className}`} style={style}>
      {children}
    </div>
  );
}
