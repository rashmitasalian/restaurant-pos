import React from "react";
import {
  getTablesSnapshot,
  getOrCreateOrderForTable,
  getOpenOrders as listOpenOrders,
  getOrderById,
} from "../../../app/db/posRepository";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import styles from "./Tables.module.css";
import { PageHeader } from "../../components/ui/PageHeader";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { TableTile } from "../../components/ui/TableTile";
import { formatKotAge } from "../../../shared/kotAge";
import { tableKotAppearance } from "../../../shared/kot";
import { formatTableTileLabel } from "../../../shared/floorLayout";

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
  openedAt?: number | null;
  unsentCount?: number;
  sentCount?: number;
};

export default function Tables() {
  const [query, setQuery] = React.useState("");
  const [tables, setTables] = React.useState<TableInfo[]>([]);
  const [areas, setAreas] = React.useState<Array<{ id: string; name: string; active?: boolean }>>(
    [],
  );
  const [selectedAreaId, setSelectedAreaId] = React.useState<string>("all");
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
        openedAt: Number(table.openedAt || 0) || null,
        unsentCount: Number(table.unsentCount || 0),
        sentCount: Number(table.sentCount || 0),
        orderSummary: occupied
          ? `${count} item${count !== 1 ? "s" : ""} · ₹${total.toLocaleString("en-IN")}`
          : undefined,
      } as TableInfo;
    });
    mapped.sort((a, b) => a.id - b.id);
    setAreas(
      (snapshot.areas || []).map((area) => ({ id: area.id, name: area.name, active: area.active })),
    );
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
  const activeAreaCount = areas.filter((area) => area.active !== false).length;
  const showAreaTitles = selectedAreaId === "all" && activeAreaCount > 1;

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <PageHeader
          title="Tables"
          subtitle={
            <>
              <span className="ui-dot ui-dot-occupied" aria-hidden="true" /> {occupied} occupied
              &nbsp;·&nbsp;
              <span className="ui-dot" aria-hidden="true" /> {available} available
            </>
          }
          actions={
            <div className={styles.controls}>
              <div className={styles.filterInline}>
                <SegmentedControl
                  ariaLabel="Floor area"
                  value={selectedAreaId}
                  onChange={setSelectedAreaId}
                  options={[
                    { id: "all", label: "All Areas" },
                    ...areas
                      .filter((area) => area.active !== false)
                      .map((area) => ({ id: area.id, label: area.name })),
                  ]}
                />
              </div>
              <div className={styles.actions}>
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
                    setOpenOrders(
                      ops.filter(
                        (o) =>
                          o.tableId !== null &&
                          o.tableId !== undefined &&
                          (o.items || []).length > 0,
                      ),
                    );
                  }}
                  disabled={openOrdersLoading}
                  className={styles.btn}
                >
                  {openOrdersLoading ? "Loading..." : "Open Orders"}
                </button>
              </div>
            </div>
          }
        />

        <div className={styles.legend} aria-label="Table status">
          <span>
            <span className="ui-dot" aria-hidden="true" />
            Available
          </span>
          <span>
            <span className="ui-dot ui-dot-attention" aria-hidden="true" />
            Send KOT
          </span>
          <span>
            <span className="ui-dot ui-dot-occupied" aria-hidden="true" />
            KOT sent
          </span>
        </div>

        {Array.from(grouped.entries()).map(([areaId, areaTables]) => {
          const areaName =
            areaTables[0]?.areaName || areas.find((area) => area.id === areaId)?.name || "Area";
          return (
            <section key={areaId} className={styles.areaSection}>
              {showAreaTitles ? <div className={styles.areaTitle}>{areaName}</div> : null}
              <div className={styles.grid}>
                {areaTables.map((t) => {
                  const isOpening = openingTableId === t.id;
                  const billPending = t.occupied && (t.status === "ready" || t.status === "held");
                  const elapsed = t.occupied && t.openedAt ? formatKotAge(t.openedAt) : "";
                  const seats = Number(t.seats) > 0 ? Number(t.seats) : null;
                  const titleLabel = formatTableTileLabel(t.id, t.name);
                  const appearance = tableKotAppearance({
                    occupied: t.occupied,
                    unsentCount: t.unsentCount,
                    sentCount: t.sentCount,
                    billPending,
                    itemCount: t.count,
                    elapsed: elapsed || undefined,
                  });
                  const stateLabel = isOpening ? "Opening…" : appearance.stateLabel;
                  return (
                    <TableTile
                      key={t.id}
                      number={titleLabel}
                      variant="floor"
                      state={appearance.state}
                      stateLabel={stateLabel}
                      seats={seats}
                      itemCount={t.occupied ? Number(t.count || 0) : null}
                      amountLabel={
                        t.occupied ? `₹${Number(t.total || 0).toLocaleString("en-IN")}` : undefined
                      }
                      elapsed={appearance.elapsed}
                      metaLabel={appearance.metaLabel}
                      disabled={isOpening}
                      onClick={() => openBilling(t)}
                      aria-label={`Table ${titleLabel}, ${stateLabel}${
                        seats ? `, ${seats} seats` : ""
                      }${t.orderSummary ? `, ${t.orderSummary}` : ""}${
                        elapsed ? `, open ${elapsed}` : ""
                      }. Press to open billing.`}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}

        {filtered.length === 0 && <div className={styles.noMatch}>No tables match “{query}”</div>}
      </div>

      {/* Open Orders Modal */}
      {openOrders !== null && (
        <div
          className={styles.modalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeModal();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              closeModal();
            }
          }}
        >
          <div
            ref={openOrdersDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-orders-title"
            className={styles.modalDialog}
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
                id="open-orders-title"
                style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--pos-tx)" }}
              >
                Open Orders
              </h3>
              <button onClick={closeModal} aria-label="Close" className={styles.modalClose}>
                ×
              </button>
            </div>
            {openOrders.length === 0 ? (
              <div style={{ color: "var(--pos-tx-muted)", fontSize: 14 }}>
                No open dine-in orders
              </div>
            ) : (
              <div className={styles.modalList}>
                {openOrders.map((o) => (
                  <div
                    key={o._id}
                    role="button"
                    tabIndex={0}
                    className={styles.modalItem}
                    onClick={() => openBillingById(o.tableId, o._id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openBillingById(o.tableId, o._id);
                      }
                    }}
                  >
                    <div style={{ fontWeight: 800, color: "var(--pos-tx)" }}>Table {o.tableId}</div>
                    <div style={{ fontSize: 13, color: "var(--pos-tx-sub)", marginTop: 4 }}>
                      {(o.items || []).length} items · ₹
                      {Number(
                        (o.items || []).reduce(
                          (s: number, it: any) => s + Number(it.qty || 0) * Number(it.rate || 0),
                          0,
                        ),
                      ).toLocaleString("en-IN")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
