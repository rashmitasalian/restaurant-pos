import React from "react";
import {
  getTablesSnapshot,
  getOrCreateOrderForTable,
  getOpenOrders as listOpenOrders,
  getOrderById,
} from "../../../app/db/posRepository";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import styles from "./Tables.module.css";
import { getFloorTileStyle, normalizeLayoutMode, type LayoutMode } from "./tableLayoutUtils";

type TableInfo = {
  id: number;
  name?: string;
  seats: number;
  areaId: string;
  areaName: string;
  status?: string;
  count?: number;
  total?: number;
  occupied: boolean;
  orderSummary?: string;
};

export default function Tables() {
  const [query, setQuery] = React.useState("");
  const [tables, setTables] = React.useState<TableInfo[]>([]);
  const [areas, setAreas] = React.useState<Array<{ id: string; name: string; active?: boolean }>>([]);
  const [selectedAreaId, setSelectedAreaId] = React.useState<string>("all");
  const [layoutMode, setLayoutMode] = React.useState<LayoutMode>(() => {
    try {
      return normalizeLayoutMode(window.localStorage.getItem("tablesLayoutMode"));
    } catch {
      return "grid";
    }
  });
  const [openOrders, setOpenOrders] = React.useState<any[] | null>(null);
  const [openOrdersLoading, setOpenOrdersLoading] = React.useState(false);
  const [openingTableId, setOpeningTableId] = React.useState<number | null>(null);
  const openOrdersLoadingRef = React.useRef(false);
  const openOrdersPromiseRef = React.useRef<Promise<any[]> | null>(null);
  const openingBillingRef = React.useRef(false);

  // Refs for focus management
  const openOrdersBtnRef = React.useRef<HTMLButtonElement>(null);
  const closeModal = React.useCallback(() => {
    setOpenOrders(null);
  }, []);
  const openOrdersDialogRef = useFocusTrap<HTMLDivElement>(openOrders !== null, closeModal);

  const refresh = React.useCallback(async () => {
    const snapshot = await getTablesSnapshot();
    const mapped = (snapshot.tables || []).map((table) => {
      const count = Number(table.count || 0);
      const total = Number(table.total || 0);
      const occupied = Boolean(table.occupied) || count > 0;
      return {
        id: table.id,
        name: table.name,
        seats: table.seats,
        areaId: table.areaId,
        areaName: table.areaName || "Main Dining",
        status: table.status,
        count,
        total,
        occupied,
        orderSummary: occupied
          ? `${count} item${count !== 1 ? "s" : ""} · ₹${total.toLocaleString("en-IN")}`
          : undefined,
      } as TableInfo;
    });
    mapped.sort((a, b) => a.id - b.id);
    setAreas((snapshot.areas || []).map((area) => ({ id: area.id, name: area.name, active: area.active })));
    setTables(mapped);
  }, []);

  React.useEffect(() => {
    refresh();
    const onOrdersChanged = () => refresh();
    const onAreasChanged = () => refresh();
    window.addEventListener("orders-changed", onOrdersChanged);
    window.addEventListener("seating-areas-changed", onAreasChanged);
    return () => {
      window.removeEventListener("orders-changed", onOrdersChanged);
      window.removeEventListener("seating-areas-changed", onAreasChanged);
    };
  }, [refresh]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem("tablesLayoutMode", layoutMode);
    } catch {}
  }, [layoutMode]);

  const filtered = tables.filter(
    (t) =>
      (selectedAreaId === "all" || t.areaId === selectedAreaId) &&
      (String(t.id).includes(query) ||
        String(t.name || "")
          .toLowerCase()
          .includes(query.toLowerCase()) ||
        (t.orderSummary || "").toLowerCase().includes(query.toLowerCase())),
  );

  const grouped = React.useMemo(() => {
    const map = new Map<string, TableInfo[]>();
    for (const table of filtered) {
      const key = table.areaId || "area:main";
      const list = map.get(key) || [];
      list.push(table);
      map.set(key, list);
    }
    return map;
  }, [filtered]);

  const openBillingById = async (tableId: number, orderId: string) => {
    if (openingBillingRef.current) {
      return;
    }
    openingBillingRef.current = true;
    setOpeningTableId(tableId);
    window.localStorage.setItem("currentOrderId", orderId);
    window.localStorage.setItem("currentTable", String(tableId));
    setOpenOrders(null);
    window.dispatchEvent(new CustomEvent("select-table", { detail: { table: tableId } }));
    openingBillingRef.current = false;
    setOpeningTableId(null);
  };

  const openBilling = async (table: TableInfo) => {
    if (openingBillingRef.current) {
      return;
    }
    openingBillingRef.current = true;
    setOpeningTableId(table.id);
    try {
      // Check if there's already a pending order in localStorage for this table.
      // This can happen if payment succeeded but the print-failed modal was bypassed
      // (e.g. app reload). If the stored order is paid, clear it so we start fresh.
      const storedOrderId = window.localStorage.getItem("currentOrderId");
      const storedTable = window.localStorage.getItem("currentTable");
      if (storedOrderId && storedTable === String(table.id)) {
        const stored = await getOrderById(storedOrderId);
        if (stored && stored.status === "paid") {
          window.localStorage.removeItem("currentOrderId");
          window.localStorage.removeItem("currentTable");
        }
      }

      const order = await getOrCreateOrderForTable(table.id);
      window.localStorage.setItem("currentOrderId", order._id);
      window.localStorage.setItem("currentTable", String(table.id));
      window.dispatchEvent(new Event("orders-changed"));
    } catch (e) {
      console.error(e);
    } finally {
      openingBillingRef.current = false;
      setOpeningTableId(null);
    }
    window.dispatchEvent(new CustomEvent("select-table", { detail: { table: table.id } }));
  };

  const getOpenOrders = async () => {
    if (openOrdersPromiseRef.current) {
      return openOrdersPromiseRef.current;
    }
    openOrdersLoadingRef.current = true;
    setOpenOrdersLoading(true);
    const promise = listOpenOrders();
    openOrdersPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      openOrdersPromiseRef.current = null;
      openOrdersLoadingRef.current = false;
      setOpenOrdersLoading(false);
    }
  };

  const occupied = tables.filter((t) => t.occupied).length;
  const available = tables.filter((t) => !t.occupied).length;

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        {/* Page header */}
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Tables</h2>
            <p className={styles.meta}>
              <span style={{ color: "#ef4444", fontWeight: 700 }}>{occupied}</span> occupied
              &nbsp;·&nbsp;
              <span style={{ color: "#16a34a", fontWeight: 700 }}>{available}</span> available
            </p>
          </div>
          <div className={styles.controls}>
            <input
              aria-label="Search tables"
              placeholder="Search table…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={styles.input}
            />
            <button
              ref={openOrdersBtnRef}
              aria-label="View all open dine-in orders"
              onClick={async () => {
                const ops = await getOpenOrders();
                // Tables page only concerns dine-in — exclude takeaway/delivery
                setOpenOrders(
                  ops.filter((o) => o.tableId !== null && o.tableId !== undefined && (o.items || []).length > 0),
                );
              }}
              disabled={openOrdersLoading}
              className={styles.btn}
            >
              {openOrdersLoading ? "Loading..." : "Open Orders"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setSelectedAreaId("all")}
            style={selectedAreaId === "all" ? { background: "#fffbeb", borderColor: "#f59e0b" } : undefined}
          >
            All Areas
          </button>
          {areas
            .filter((area) => area.active !== false)
            .map((area) => (
              <button
                key={area.id}
                type="button"
                className={styles.btn}
                onClick={() => setSelectedAreaId(area.id)}
                style={
                  selectedAreaId === area.id ? { background: "#fffbeb", borderColor: "#f59e0b" } : undefined
                }
              >
                {area.name}
              </button>
            ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setLayoutMode("grid")}
            style={layoutMode === "grid" ? { background: "#fffbeb", borderColor: "#f59e0b" } : undefined}
          >
            Grid View
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setLayoutMode("floor")}
            style={layoutMode === "floor" ? { background: "#fffbeb", borderColor: "#f59e0b" } : undefined}
          >
            Floor Plan
          </button>
        </div>

        {/* Table grid */}
        {Array.from(grouped.entries()).map(([areaId, areaTables]) => {
          const areaName = areaTables[0]?.areaName || areas.find((area) => area.id === areaId)?.name || "Area";
          return (
            <section key={areaId} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7280", marginBottom: 8 }}>
                {areaName}
              </div>
              <div className={layoutMode === "floor" ? styles.floorPlan : styles.grid}>
                {areaTables.map((t, index) => {
                  const isOpening = openingTableId === t.id;
                  return (
                    <article
                      key={t.id}
                      role="button"
                      tabIndex={isOpening ? -1 : 0}
                      aria-disabled={isOpening}
                      aria-label={`Table ${t.id}, ${t.occupied ? "occupied" : "free"}, ${t.seats} seats${t.orderSummary ? `, ${t.orderSummary}` : ""}. Press to open billing.`}
                      onClick={() => !isOpening && openBilling(t)}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === " ") && !isOpening) {
                          e.preventDefault();
                          openBilling(t);
                        }
                      }}
                      className={styles.card + (t.occupied ? ` ${styles.occupied}` : "")}
                      style={
                        isOpening
                          ? { pointerEvents: "none", opacity: 0.7, ...(layoutMode === "floor" ? getFloorTileStyle(index) : {}) }
                          : layoutMode === "floor"
                            ? getFloorTileStyle(index)
                            : undefined
                      }
                    >
                      <div className={styles.headerInfo}>
                        <div>
                          <div className={styles.id}>{t.id}</div>
                          <div className={styles.subtle}>{t.seats} seats</div>
                        </div>
                        <span
                          aria-hidden="true"
                          style={{
                            padding: "4px 10px",
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 700,
                            background: t.occupied ? "#fee2e2" : "#dcfce7",
                            color: t.occupied ? "#dc2626" : "#16a34a",
                          }}
                        >
                          {t.occupied ? "Occupied" : "Free"}
                        </span>
                      </div>
                      <div className={t.occupied ? styles.orderSummaryOccupied : styles.orderSummary}>
                        {isOpening
                          ? "Opening..."
                          : t.orderSummary || (t.occupied ? "In progress" : "Tap to open")}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        {filtered.length === 0 && (
          <div className={styles.noMatch}>No tables match that search.</div>
        )}

        {/* Open Orders modal */}
        {openOrders && (
          <div className={styles.modalOverlay} onClick={closeModal}>
            <div
              ref={openOrdersDialogRef}
              className={styles.modalDialog}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="openOrdersTitle"
              tabIndex={-1}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <h3
                  id="openOrdersTitle"
                  style={{
                    margin: 0,
                    fontSize: 18,
                    fontWeight: 800,
                    color: "#111827",
                  }}
                >
                  Open Orders ({openOrders.length})
                </h3>
                <button
                  onClick={closeModal}
                  aria-label="Close dialog"
                  className={styles.modalClose}
                >
                  ×
                </button>
              </div>
              <div className={styles.modalList}>
                {openOrders.length === 0 && (
                  <p
                    style={{
                      color: "#9ca3af",
                      textAlign: "center",
                      padding: "24px 0",
                    }}
                  >
                    No open orders
                  </p>
                )}
                {openOrders.map((o) => {
                  const total =
                    typeof o.total === "number"
                      ? o.total
                      : (o.items || []).reduce(
                          (s: number, i: { qty: number; rate: number }) => s + i.qty * i.rate,
                          0,
                        );
                  const tableLabel = `Table ${o.tableId}`;
                  const timeStr = new Date(o.createdAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <div
                      key={o._id}
                      className={styles.modalItem}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      aria-label={`Open billing for Table ${o.tableId}, ${(o.items || []).length} items`}
                      onClick={() => openBillingById(o.tableId, o._id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openBillingById(o.tableId, o._id);
                        }
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>
                        {tableLabel}
                      </div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                        {(o.items || []).length} item{(o.items || []).length !== 1 ? "s" : ""}
                        {" · "}₹{total.toLocaleString("en-IN")}
                        {" · "}
                        {timeStr}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ textAlign: "right", marginTop: 16 }}>
                <button onClick={closeModal} className={styles.btn} style={{ padding: "9px 20px" }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
