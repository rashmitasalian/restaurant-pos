import React from "react";
import { getOrderById } from "../../../../app/db/posRepository";
import styles from "../Billing.module.css";
import TabButton from "./TabButton";
import OrderRow from "./OrderRow";
import ScrollableList from "./ScrollableList";

interface TableInfo {
  status?: string;
  count?: number;
  total?: number;
  waiter?: string;
  updatedAt?: string;
}

interface BillingSidebarProps {
  open: boolean;
  view: "tables" | "takeaway" | "delivery";
  onViewChange: (v: "tables" | "takeaway" | "delivery") => void;
  tableNumbers: number[];
  tableInfos: Record<number, TableInfo>;
  tableNum: number | null;
  activeOrderType: "table" | "takeaway" | "delivery";
  onLoadTable: (tn: number) => void;
  takeawayOrders: any[];
  deliveryOrders: any[];
  currentOrderId: string | undefined;
  onSelectOrder: (order: any) => void;
  onNewTakeaway: () => void;
  onNewDelivery: () => void;
  formatCurrency: (v: number) => string;
}

export default function BillingSidebar({
  open,
  view,
  onViewChange,
  tableNumbers,
  tableInfos,
  tableNum,
  activeOrderType,
  onLoadTable,
  takeawayOrders,
  deliveryOrders,
  currentOrderId,
  onSelectOrder,
  onNewTakeaway,
  onNewDelivery,
  formatCurrency,
}: BillingSidebarProps) {
  const selectOrder = async (o: any) => {
    const full = await getOrderById(o._id);
    if (full) {
onSelectOrder(full);
}
  };

  return (
    <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}>
      {open && (
        <div className={styles.sidebarInner}>
          <div className={styles.tabBar} role="group" aria-label="Order type">
            {(
              [
                { key: "tables" as const, label: "Tables", count: null },
                { key: "takeaway" as const, label: "Takeaway", count: takeawayOrders.length },
                { key: "delivery" as const, label: "Delivery", count: deliveryOrders.length },
              ] as const
            ).map(({ key, label, count }) => (
              <TabButton
                key={key}
                label={label}
                count={count}
                active={view === key}
                onClick={() => onViewChange(key)}
              />
            ))}
          </div>

          {/* Tables panel */}
          {view === "tables" && (
            <div className={styles.tableGrid}>
              <div className={styles.tableGridInner}>
                {tableNumbers.map((t) => {
                  const info = tableInfos[t] || { status: "", count: 0, total: 0 };
                  const active = tableNum === t && activeOrderType === "table";
                  return (
                    <button
                      key={t}
                      onClick={() => onLoadTable(t)}
                      title={
                        info.status
                          ? `${info.count} items · ${formatCurrency(info.total || 0)}`
                          : `Table ${t}`
                      }
                      className={`
                        ${styles.tableButton}
                        ${active ? styles.tableActive : ""}
                        ${info.status === "held" ? styles.tableHeld : ""}
                        ${info.status ? styles.tableHasOrder : ""}
                      `}
                    >
                      <span>{t}</span>
                      {info.status && (info.count ?? 0) > 0 && (
                        <>
                          <span
                            className={`${styles.tableItemCount} ${
                              info.status === "ready"
                                ? styles.statusReady
                                : info.status === "held"
                                  ? styles.statusHeld
                                  : ""
                            }`}
                          >
                            {info.count}
                          </span>
                          <span className={styles.tableTotal}>
                            {formatCurrency(info.total || 0)}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Takeaway panel */}
          {view === "takeaway" && (
            <div className={styles.panelColumn}>
              <button
                onClick={onNewTakeaway}
                className={`${styles.pickBtn} ${styles.pickTakeaway} ${styles.flexCenterGap}`}
              >
                New Takeaway Order
              </button>
              <ScrollableList className={styles.panelColumn}>
                {takeawayOrders.length === 0 ? (
                  <div className={styles.emptyPanel}>
                    <div className={styles.emptyEmoji}>🛍️</div>
                    No active takeaway orders
                  </div>
                ) : (
                  <div className={styles.gridList}>
                    {takeawayOrders.map((o: any) => (
                      <OrderRow
                        key={o._id}
                        order={o}
                        isActive={currentOrderId === o._id}
                        onSelect={() => selectOrder(o)}
                        type="takeaway"
                      />
                    ))}
                  </div>
                )}
              </ScrollableList>
            </div>
          )}

          {/* Delivery panel */}
          {view === "delivery" && (
            <div className={styles.panelColumn}>
              <button
                onClick={onNewDelivery}
                className={`${styles.pickBtn} ${styles.pickDelivery} ${styles.flexCenterGap}`}
              >
                <span style={{ fontSize: 16 }}>＋</span> New Delivery Order
              </button>
              <ScrollableList className={styles.panelColumn}>
                {deliveryOrders.length === 0 ? (
                  <div className={styles.emptyPanel}>
                    <div className={styles.emptyEmoji}>🚚</div>
                    No active delivery orders
                  </div>
                ) : (
                  <div className={styles.gridList}>
                    {deliveryOrders.map((o: any) => (
                      <OrderRow
                        key={o._id}
                        order={o}
                        isActive={currentOrderId === o._id}
                        onSelect={() => selectOrder(o)}
                        type="delivery"
                      />
                    ))}
                  </div>
                )}
              </ScrollableList>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
