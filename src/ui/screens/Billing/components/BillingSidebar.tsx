import React from "react";
import { getOrderById } from "../../../../app/db/posRepository";
import type { ServiceMode } from "../../../../shared/serviceModes";
import { formatKotAge } from "../../../../shared/kotAge";
import { UtensilsCrossed, Bike, ShoppingBag, User } from "lucide-react";
import styles from "../Billing.module.css";
import TabButton from "./TabButton";
import OrderRow from "./OrderRow";
import ScrollableList from "./ScrollableList";
import { TableTile } from "../../../components/ui/TableTile";
import { tableKotAppearance } from "../../../../shared/kot";
import { formatTableTileLabel } from "../../../../shared/floorLayout";

interface TableInfo {
  id: number;
  name?: string;
  status?: string;
  occupied?: boolean;
  count?: number;
  total?: number;
  waiter?: string;
  updatedAt?: string;
  seats?: number;
  openedAt?: number | null;
  unsentCount?: number;
  sentCount?: number;
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

function modeIcon(mode: ServiceMode) {
  if (mode.requiresTable) {
    return UtensilsCrossed;
  }
  if (mode.icon === "bike" || mode.id === "delivery") {
    return Bike;
  }
  if (mode.icon === "person" || mode.id === "self_service") {
    return User;
  }
  return ShoppingBag;
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
                icon={modeIcon(mode)}
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
                  <div className={styles.areaRail}>
                    {(tableAreas || [])
                      .filter((area) => area.active !== false)
                      .map((area) => (
                        <button
                          key={area.id}
                          type="button"
                          onClick={() => onSelectArea(area.id)}
                          className={`${styles.areaChip} ${selectedAreaId === area.id ? styles.areaChipActive : ""}`}
                        >
                          {area.name}
                        </button>
                      ))}
                  </div>
                  <div className={styles.tableGridInner}>
                    {(tablesByArea[selectedAreaId] || []).map((info) => {
                      const t = info.id;
                      const titleLabel = formatTableTileLabel(t, info.name);
                      const active = tableNum === t && activeOrderType === mode.id;
                      const occupied =
                        Boolean(info.occupied) || Number(info.count || 0) > 0;
                      const elapsed =
                        occupied && info.openedAt ? formatKotAge(info.openedAt) : "";
                      const appearance = tableKotAppearance({
                        occupied,
                        unsentCount: info.unsentCount,
                        sentCount: info.sentCount,
                        billPending: occupied && (info.status === "held" || info.status === "ready"),
                        itemCount: info.count,
                        elapsed: elapsed || undefined,
                      });
                      const amount =
                        occupied
                          ? formatCurrency(info.total || 0).replace(/\.00$/, "")
                          : undefined;
                      return (
                        <TableTile
                          key={t}
                          number={titleLabel}
                          state={appearance.state}
                          stateLabel={appearance.stateLabel}
                          active={active}
                          seats={info.seats}
                          itemCount={occupied ? info.count ?? 0 : null}
                          amountLabel={amount}
                          elapsed={appearance.elapsed}
                          metaLabel={appearance.metaLabel}
                          idleLabel="Available"
                          onClick={() => onLoadTable(t)}
                          aria-label={
                            occupied
                              ? `Table ${titleLabel}, ${appearance.stateLabel}${info.seats ? `, ${info.seats} seats` : ""}, ${info.count || 0} items, ${formatCurrency(info.total || 0)}${elapsed ? `, open ${elapsed}` : ""}`
                              : `Table ${titleLabel}, Available${info.seats ? `, ${info.seats} seats` : ""}`
                          }
                        />
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
