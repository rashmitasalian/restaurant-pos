import React from "react";
import { ChevronDown, Search } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import { TableTile } from "../../ui/components/ui/TableTile";
import { formatKotAge } from "../../shared/kotAge";
import { formatTableLabel } from "../../shared/floorLayout";
import { money } from "../money";
import { greetingFor } from "../copy";
import { tableKotAppearance } from "../../shared/kot";
import type { CaptainKotTicket } from "./KotsScreen";
import { AreaSheet } from "../sheets/AreaSheet";

export type TableRow = {
  id: number;
  name?: string;
  areaId: string;
  areaName: string;
  occupied?: boolean;
  status?: string;
  count?: number;
  total?: number;
  openedAt?: number | null;
  activityAt?: number | null;
  orderId?: string | null;
  seats?: number | null;
  unsentCount?: number;
  sentCount?: number;
};

export function TablesScreen({
  waiterName,
  waiterUsername,
  areas,
  tables,
  areaId,
  setAreaId,
  kotTickets,
  busyTableId,
  loading,
  activeTableId,
  resume,
  onResume,
  onRegisterBack,
  onOpenTable,
}: {
  waiterName?: string;
  waiterUsername?: string;
  areas: Array<{ id: string; name: string }>;
  tables: TableRow[];
  areaId: string | null;
  setAreaId: (id: string | null) => void;
  kotTickets: CaptainKotTicket[];
  busyTableId?: number | null;
  loading?: boolean;
  activeTableId?: number | null;
  resume?: { label: string; meta: string } | null;
  onResume?: () => void;
  onRegisterBack?: (handler: (() => boolean) | null) => void;
  onOpenTable: (table: TableRow) => void;
}) {
  const [areaOpen, setAreaOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [floorFilter, setFloorFilter] = React.useState<"all" | "send">("all");
  const kotByTable = React.useMemo(() => {
    const map = new Map<number, CaptainKotTicket>();
    for (const ticket of kotTickets) {
      map.set(ticket.tableId, ticket);
    }
    return map;
  }, [kotTickets]);

  const filtered = (areaId ? tables.filter((table) => table.areaId === areaId) : tables).filter(
    (table) => {
      const title = formatTableLabel(table.id, table.name).toLowerCase();
      if (query.trim() && !title.includes(query.trim().toLowerCase())) {
        return false;
      }
      if (query.trim()) {
        return true;
      }
      if (floorFilter === "send") {
        return Boolean(table.occupied) && Number(table.unsentCount || 0) > 0;
      }
      return true;
    },
  );
  const occupiedCount = filtered.filter((table) => table.occupied).length;
  const areaLabel = areaId ? areas.find((area) => area.id === areaId)?.name || "Area" : "All areas";
  const showAreaTitles = !areaId && areas.length > 1;
  const grouped = React.useMemo(() => {
    const byId = new Map<string, TableRow[]>();
    for (const table of filtered) {
      const key = table.areaId || "area:main";
      const list = byId.get(key) || [];
      list.push(table);
      byId.set(key, list);
    }
    const ordered: Array<{ id: string; name: string; tables: TableRow[] }> = [];
    const seen = new Set<string>();
    for (const area of areas) {
      const list = byId.get(area.id);
      if (list?.length) {
        ordered.push({ id: area.id, name: area.name || "Area", tables: list });
        seen.add(area.id);
      }
    }
    for (const [id, list] of byId) {
      if (!seen.has(id) && list.length) {
        ordered.push({
          id,
          name: list[0]?.areaName || "Area",
          tables: list,
        });
      }
    }
    return ordered;
  }, [areas, filtered]);

  React.useEffect(() => {
    onRegisterBack?.(() => {
      if (areaOpen) {
        setAreaOpen(false);
        return true;
      }
      return false;
    });
    return () => onRegisterBack?.(null);
  }, [areaOpen, onRegisterBack]);

  if (loading && tables.length === 0) {
    return (
      <div className="cap-stack">
        <div className="cap-table-grid" aria-busy="true" aria-label="Loading tables">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="cap-skeleton-tile" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="cap-stack cap-floor">
      <div className="cap-floor-head">
        <div className="cap-floor-title-row">
          <div className="cap-floor-title-block">
            <p className="cap-greet">{greetingFor(waiterName, waiterUsername)}</p>
            <h2 className="cap-page-title">Tables</h2>
          </div>
          {areas.length > 1 ? (
            <button type="button" className="cap-area-btn" onClick={() => setAreaOpen(true)}>
              <span>{areaLabel}</span>
              <Icon icon={ChevronDown} size="sm" />
            </button>
          ) : (
            <span className="cap-area-static">{areas[0]?.name || "Floor"}</span>
          )}
        </div>
        <div className="cap-floor-toolbar">
          <div className="cap-legend" aria-label="Table status">
            <span>
              <span className="cap-legend-dot is-free" />
              Available
            </span>
            <span>
              <span className="cap-legend-dot is-send" />
              Send KOT
            </span>
            <span>
              <span className="cap-legend-dot is-sent" />
              KOT sent
            </span>
          </div>
          <span className="cap-occupancy-quiet">
            {occupiedCount}/{filtered.length} occupied
          </span>
        </div>
        <div className="cap-floor-filters">
          {(
            [
              ["all", "All"],
              ["send", "Needs send"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`cap-chip ${floorFilter === id ? "active" : ""}`}
              onClick={() => setFloorFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="cap-search-wrap">
          <Icon icon={Search} size="md" />
          <input
            className="cap-search"
            placeholder="Search table"
            value={query}
            aria-label="Search table"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {resume && onResume ? (
        <button type="button" className="cap-resume" onClick={onResume}>
          <span>Resume {resume.label}</span>
          <span className="cap-resume-meta">{resume.meta}</span>
        </button>
      ) : null}

      {filtered.length === 0 ? (
        <div className="cap-empty">
          {floorFilter === "send" && !query.trim() ? (
            <>
              <strong>Nothing to send</strong>
              <span>Every table here has already gone to the kitchen.</span>
            </>
          ) : (
            <>
              <strong>No tables here</strong>
              <span>Try another area, or check table setup on the POS.</span>
            </>
          )}
        </div>
      ) : (
        grouped.map((section) => (
          <section key={section.id} className="cap-floor-section">
            {showAreaTitles ? <div className="cap-area-title">{section.name}</div> : null}
            <div className="cap-table-grid">
              {section.tables.map((table) => {
                const ticket = kotByTable.get(table.id);
                const occupied = Boolean(table.occupied);
                const appearance = tableKotAppearance({
                  occupied,
                  unsentCount: table.unsentCount ?? ticket?.unsentCount,
                  sentCount: table.sentCount ?? ticket?.sentCount,
                  itemCount: table.count,
                  elapsed: occupied && table.openedAt ? formatKotAge(table.openedAt) : undefined,
                });
                const title = formatTableLabel(table.id, table.name);
                return (
                  <TableTile
                    key={table.id}
                    number={title}
                    variant="floor"
                    state={appearance.state}
                    stateLabel={appearance.stateLabel}
                    seats={Number(table.seats) > 0 ? Number(table.seats) : null}
                    itemCount={occupied ? Number(table.count || 0) : null}
                    amountLabel={occupied ? money(Number(table.total || 0)) : undefined}
                    elapsed={appearance.elapsed}
                    metaLabel={appearance.metaLabel}
                    idleLabel={occupied ? undefined : "Tap to start"}
                    disabled={busyTableId === table.id}
                    active={activeTableId === table.id}
                    onClick={() => onOpenTable(table)}
                    aria-label={`${title}, ${appearance.stateLabel}`}
                  />
                );
              })}
            </div>
          </section>
        ))
      )}

      {areaOpen ? (
        <AreaSheet
          areas={areas}
          areaId={areaId}
          onSelect={(id) => {
            setAreaId(id);
            setAreaOpen(false);
          }}
          onClose={() => setAreaOpen(false)}
        />
      ) : null}
    </div>
  );
}
