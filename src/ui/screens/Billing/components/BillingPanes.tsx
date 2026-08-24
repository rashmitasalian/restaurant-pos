import React from "react";
import styles from "../Billing.module.css";

export function BillingMenuBoard({ children }: { children: React.ReactNode }) {
  return <div className={styles.mainContent}>{children}</div>;
}

export function BillingTicketPane({ children }: { children: React.ReactNode }) {
  return (
    <aside className={`${styles.ticketPane} ${styles.headerBar}`} aria-label="Order ticket">
      {children}
    </aside>
  );
}
