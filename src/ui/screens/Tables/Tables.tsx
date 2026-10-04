import React from "react";
import {
  getTablesSnapshot,
  getOrCreateOrderForTable,
  getOrderById,
} from "../../../app/db/posRepository";
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
  const [statusFilter, setStatusFilter] = React.useState<"all" | "available" | "open">("all");
  const [tables, setTables] = React.useState<TableInfo[]>([]);
  const [areas, setAreas] = React.useState<Array<{ id: string; name: string; active?: boolean }>>(
    [],
  );
  const [selectedAreaId, setSelectedAreaId] = React.useState<string>("all");
  const [openingTableId, setOpeningTableId] = React.useState<number | null>(null);
  const openingBillingRef = React.useRef(false);

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

  const filtered = tables.filter((t) => {
    if (selectedAreaId !== "all" && t.areaId !== selectedAreaId) {
      return false;
    }
    if (statusFilter === "available" && t.occupied) {
      return false;
    }
    if (statusFilter === "open" && !t.occupied) {
      return false;
    }
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return (
      String(t.id).includes(needle) ||
      String(t.name || "")
        .toLowerCase()
        .includes(needle) ||
      (t.orderSummary || "").toLowerCase().includes(needle)
    );
  });

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
                <div className={styles.filterInline}>
                  <SegmentedControl
                    ariaLabel="Table status"
                    value={statusFilter}
                    onChange={(id) => setStatusFilter(id as "all" | "available" | "open")}
                    options={[
                      { id: "all", label: "All" },
                      { id: "available", label: "Available" },
                      { id: "open", label: "Open" },
                    ]}
                  />
                </div>
                <input
                  aria-label="Search tables"
                  placeholder="Search table…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className={styles.input}
                />
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

        {filtered.length === 0 && (
          <div className={styles.noMatch}>
            {query.trim()
              ? `No tables match “${query.trim()}”`
              : statusFilter === "available"
                ? "No available tables"
                : statusFilter === "open"
                  ? "No open tables"
                  : "No tables in this area"}
          </div>
        )}
      </div>
    </div>
  );
}
