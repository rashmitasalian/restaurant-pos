import React from "react";
import { TableTile } from "../../ui/components/ui/TableTile";
import { formatKotAge, kotAgeTone } from "../../shared/kotAge";
import { money } from "../money";

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
};

export function TablesScreen({
  areas,
  tables,
  areaId,
  setAreaId,
  busy,
  loading,
  activeTableId,
  onOpenTable,
  onResume,
}: {
  areas: Array<{ id: string; name: string }>;
  tables: TableRow[];
  areaId: string | null;
  setAreaId: (id: string | null) => void;
  busy: boolean;
  loading?: boolean;
  activeTableId?: number | null;
  onOpenTable: (table: TableRow) => void;
  onResume?: (table: TableRow) => void;
}) {
  const filtered = areaId ? tables.filter((t) => t.areaId === areaId) : tables;
  const occupied = tables.filter((t) => t.occupied).length;
  const total = tables.length;
  const resumeTable =
    activeTableId !== null && activeTableId !== undefined ? tables.find((table) => table.id === activeTableId) : undefined;

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
    <div className="cap-stack">
      {resumeTable && onResume ? (
        <button type="button" className="cap-resume" onClick={() => onResume(resumeTable)}>
          <span>Resume {resumeTable.name || `T${resumeTable.id}`}</span>
          <span className="cap-resume-meta">Continue order</span>
        </button>
      ) : null}

      {areas.length > 1 ? (
        <div className="cap-cats cap-cats-sticky" role="tablist" aria-label="Floor areas">
          <button
            type="button"
            className={`cap-chip ${!areaId ? "active" : ""}`}
            onClick={() => setAreaId(null)}
          >
            All
          </button>
          {areas.map((area) => (
            <button
              key={area.id}
              type="button"
              className={`cap-chip ${areaId === area.id ? "active" : ""}`}
              onClick={() => setAreaId(area.id)}
            >
              {area.name}
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="cap-empty">
          <strong>No tables here</strong>
          <span>Try another area, or check table setup on the POS.</span>
        </div>
      ) : (
        <div className="cap-table-grid">
          {filtered.map((table) => {
            const pending =
              table.occupied && (table.status === "ready" || table.status === "held");
            const ageTone =
              table.occupied && table.openedAt ? kotAgeTone(table.openedAt) : "neutral";
            const state = pending
              ? "attention"
              : table.occupied
                ? "occupied"
                : "available";
            const elapsed =
              table.occupied && table.openedAt ? formatKotAge(table.openedAt) : undefined;
            const ageClass =
              !pending && ageTone === "danger"
                ? "cap-tile-age-danger"
                : !pending && ageTone === "attention"
                  ? "cap-tile-age-attention"
                  : "";
            return (
              <TableTile
                key={table.id}
                number={table.name || `T${table.id}`}
                state={state}
                itemCount={table.count || undefined}
                amountLabel={table.occupied ? money(Number(table.total || 0)) : undefined}
                elapsed={elapsed}
                idleLabel="Tap to start"
                variant="floor"
                disabled={busy}
                active={activeTableId === table.id}
                className={ageClass}
                onClick={() => onOpenTable(table)}
              />
            );
          })}
        </div>
      )}
      <p className="ui-sr-only">
        {occupied} of {total} occupied
      </p>
    </div>
  );
}
