import React from "react";
import { getOrderById } from "../../../../app/db/posRepository";
import type { ServiceMode } from "../../../../shared/serviceModes";
import styles from "../Billing.module.css";
import TabButton from "./TabButton";
import OrderRow from "./OrderRow";
import ScrollableList from "./ScrollableList";

interface TableInfo {
  id: number;
  status?: string;
  count?: number;
  total?: number;
  waiter?: string;
  updatedAt?: string;
}

interface BillingSidebarProps {
  open: boolean;
  serviceModes: ServiceMode[];
  view: string;
  onViewChange: (v: string) => void;
  tableAreas: Array<{ id: string; name: string; active?: boolean }>;
  selectedAreaId: string;
  onSelectArea: (areaId: string) => void;
  tablesByArea: Record<string, TableInfo[]>;
  tableNum: number | null;
  activeOrderType: string;
  modeOrders: Record<string, any[]>;
  onLoadTable: (tn: number) => void;
  currentOrderId: string | undefined;
  onSelectOrder: (order: any) => void;
  onCreateMode: (mode: ServiceMode) => void;
  formatCurrency: (v: number) => string;
}

export default function BillingSidebar({
  open,
  serviceModes,
  view,
  onViewChange,
  tableAreas,
  selectedAreaId,
  onSelectArea,
  tablesByArea,
  tableNum,
  activeOrderType,
  modeOrders,
  onLoadTable,
  currentOrderId,
  onSelectOrder,
  onCreateMode,
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
            {serviceModes.map((mode) => (
              <TabButton
                key={mode.id}
                label={mode.name}
                count={mode.requiresTable ? null : (modeOrders[mode.id] || []).length}
                active={view === mode.id}
                onClick={() => onViewChange(mode.id)}
              />
            ))}
          </div>

          {serviceModes
            .filter((mode) => mode.id === view)
            .map((mode) =>
              mode.requiresTable ? (
                <div key={mode.id} className={styles.tableGrid}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {(tableAreas || [])
                      .filter((area) => area.active !== false)
                      .map((area) => (
                        <button
                          key={area.id}
                          type="button"
                          onClick={() => onSelectArea(area.id)}
                          className={styles.tabButton}
                          style={
                            selectedAreaId === area.id
                              ? {
                                  background: "#fff7ed",
                                  color: "#92400e",
                                  border: "1px solid #fdba74",
                                }
                              : {
                                  background: "#fff",
                                  border: "1px solid #e5e7eb",
                                }
                          }
                        >
                          {area.name}
                        </button>
                      ))}
                  </div>
                  <div className={styles.tableGridInner}>
                    {(tablesByArea[selectedAreaId] || []).map((info) => {
                      const t = info.id;
                      const active = tableNum === t && activeOrderType === mode.id;
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
              ) : (
                <div key={mode.id} className={styles.panelColumn}>
                  <button
                    onClick={() => onCreateMode(mode)}
                    className={`${styles.pickBtn} ${mode.id === "delivery" ? styles.pickDelivery : styles.pickTakeaway} ${styles.flexCenterGap}`}
                  >
                    New {mode.name} Order
                  </button>
                  <ScrollableList className={styles.panelColumn}>
                    {(modeOrders[mode.id] || []).length === 0 ? (
                      <div className={styles.emptyPanel}>
                        <div className={styles.emptyEmoji}>{mode.id === "delivery" ? "🚚" : "🧾"}</div>
                        No active {mode.name.toLowerCase()} orders
                      </div>
                    ) : (
                      <div className={styles.gridList}>
                        {(modeOrders[mode.id] || []).map((o: any) => (
                          <OrderRow
                            key={o._id}
                            order={o}
                            isActive={currentOrderId === o._id}
                            onSelect={() => selectOrder(o)}
                            mode={mode}
                          />
                        ))}
                      </div>
                    )}
                  </ScrollableList>
                </div>
              ),
            )}
        </div>
      )}
    </aside>
  );
}
