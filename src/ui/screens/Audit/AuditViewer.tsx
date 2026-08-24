import React from "react";
import { countAudits, getAudits } from "../../../app/db/posRepository";
import { PageHeader } from "../../components/ui/PageHeader";
import { Icon } from "../../components/ui/Icon";
import {
  CircleDot,
  Download,
  IndianRupee,
  Minus,
  Pencil,
  Percent,
  Plus,
  PlusCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export default function AuditViewer() {
  const [items, setItems] = React.useState<any[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState<string>("");
  const [dateFrom, setDateFrom] = React.useState<string>("");
  const [dateTo, setDateTo] = React.useState<string>("");
  const [page, setPage] = React.useState<number>(1);
  const [pageSize, setPageSize] = React.useState<number>(25);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const fromTs = dateFrom ? new Date(dateFrom).setHours(0, 0, 0, 0) : undefined;
      const toTs = dateTo ? new Date(dateTo).setHours(23, 59, 59, 999) : undefined;
      const search = filter.trim() || undefined;
      const safePageSize = Math.min(100, Math.max(1, pageSize));
      const offset = Math.max(0, page - 1) * safePageSize;
      const [docs, total] = await Promise.all([
        getAudits({ from: fromTs, to: toTs, search, limit: safePageSize, offset }),
        countAudits({ from: fromTs, to: toTs, search }),
      ]);
      const audits = (docs || []).filter((d: any) => d && d.type === "audit");
      setItems(audits);
      setTotalCount(Number(total || 0));
    } catch (e) {
      console.error("Failed to load audits:", e);
      setItems([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [dateFrom, dateTo, filter, page, pageSize]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageItems = items;

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  // CSV helpers
  const toCSV = (rows: any[]) => {
    const header = ["timestamp", "action", "orderId", "user", "detail"];
    const esc = (s: any) => {
      if (s === null || s === undefined) {
        return "";
      }
      const str = typeof s === "string" ? s : JSON.stringify(s);
      if (str.includes(",") || str.includes("\n") || str.includes('"')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          new Date(r.timestamp || 0).toISOString(),
          esc(r.action),
          esc(r.orderId),
          esc(r.user),
          esc(r.detail || ""),
        ].join(","),
      );
    }
    return lines.join("\n");
  };

  const downloadCSV = (rows: any[]) => {
    const csv = toCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const getActionColor = (action: string): { bg: string; color: string; icon: LucideIcon } => {
    if (action.includes("created")) {
      return { bg: "var(--pos-success-tint)", color: "var(--pos-success)", icon: Plus };
    }
    if (action.includes("paid")) {
      return { bg: "var(--pos-success-tint)", color: "var(--pos-success)", icon: IndianRupee };
    }
    if (action.includes("cancelled")) {
      return { bg: "var(--pos-danger-tint)", color: "var(--pos-danger)", icon: X };
    }
    if (action.includes("removed")) {
      return { bg: "var(--pos-danger-tint)", color: "var(--pos-danger)", icon: Minus };
    }
    if (action.includes("added")) {
      return { bg: "var(--pos-saffron-tint)", color: "var(--pos-saffron-deep)", icon: PlusCircle };
    }
    if (action.includes("updated")) {
      return { bg: "var(--pos-teal-tint)", color: "var(--pos-teal)", icon: Pencil };
    }
    if (action.includes("discount")) {
      return { bg: "var(--pos-success-tint)", color: "var(--pos-success)", icon: Percent };
    }
    return { bg: "var(--pos-surface-sunken)", color: "var(--pos-tx-sub)", icon: CircleDot };
  };

  return (
    <div className="pos-page pos-page-lg">
      <PageHeader title="Audit Log" subtitle="Track all system activities and transactions" />

      {/* Filter Controls */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 20 }}>
        {/* Filter inputs row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <label className="pos-label">Search</label>
            <input
              placeholder="Filter by action/order/user"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
              className="pos-input"
            />
          </div>
          <div>
            <label className="pos-label">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="pos-input"
            />
          </div>
          <div>
            <label className="pos-label">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="pos-input"
            />
          </div>
          <div>
            <label className="pos-label">Per Page</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="pos-select"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            paddingTop: 14,
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
          }}
        >
          <button onClick={load} disabled={loading} className="pos-btn pos-btn-secondary">
            {loading ? (
              "Loading…"
            ) : (
              <>
                <Icon icon={RefreshCw} size="sm" /> Refresh
              </>
            )}
          </button>
          <button
            onClick={() => downloadCSV(pageItems)}
            disabled={pageItems.length === 0}
            className="pos-btn pos-btn-amber-outline"
          >
            <Icon icon={Download} size="sm" /> Export Page CSV
          </button>
          <div
            style={{
              marginLeft: "auto",
              fontSize: 13,
              color: "var(--pos-muted,var(--pos-tx-muted))",
              fontWeight: 500,
            }}
          >
            {totalCount} result{totalCount !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Audit Entries Table */}
      <div className="pos-card" style={{ overflow: "hidden", marginBottom: 16 }}>
        {pageItems.length === 0 ? (
          <div className="pos-empty">
            <div style={{ fontSize: 16, marginBottom: 8 }}> No audit entries</div>
            <div style={{ fontSize: 13 }}>
              {filter || dateFrom || dateTo
                ? "No entries match your filters"
                : "No audit logs available yet"}
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: "calc(100vh - 380px)", overflow: "auto" }}>
            {pageItems.map((a, idx) => {
              const actionColor = getActionColor(a.action || "");
              return (
                <div
                  key={a._id}
                  style={{
                    padding: "14px 18px",
                    borderBottom:
                      idx !== pageItems.length - 1
                        ? "1px solid var(--pos-border-light,var(--pos-surface-sunken))"
                        : "none",
                    display: "grid",
                    gridTemplateColumns: "40px 1fr auto",
                    gap: 14,
                    alignItems: "start",
                  }}
                >
                  {/* Icon */}
                  <div
                    style={{
                      background: actionColor.bg,
                      color: actionColor.color,
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      textAlign: "center",
                      fontSize: 16,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon icon={actionColor.icon} size="md" />
                  </div>

                  {/* Content */}
                  <div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: "var(--pos-tx,var(--pos-tx))",
                        marginBottom: 4,
                      }}
                    >
                      {a.action}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "4px 14px",
                        fontSize: 12,
                        color: "var(--pos-tx-sub,var(--pos-tx-sub))",
                      }}
                    >
                      {a.orderId && (
                        <span>
                          Order: <b style={{ color: "var(--pos-tx,var(--pos-tx))" }}>{a.orderId}</b>
                        </span>
                      )}
                      {a.user && (
                        <span>
                          By: <b style={{ color: "var(--pos-tx,var(--pos-tx))" }}>{a.user}</b>
                        </span>
                      )}
                      {a.detail && typeof a.detail === "string" && (
                        <span style={{ color: "var(--pos-muted,var(--pos-tx-muted))" }}>{a.detail}</span>
                      )}
                      {a.detail && typeof a.detail === "object" && (
                        <span
                          style={{
                            color: "var(--pos-muted,var(--pos-tx-muted))",
                            fontFamily: "monospace",
                            fontSize: 11,
                          }}
                        >
                          {JSON.stringify(a.detail).slice(0, 80)}
                          {JSON.stringify(a.detail).length > 80 ? "…" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Timestamp */}
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--pos-muted,var(--pos-tx-muted))",
                      whiteSpace: "nowrap",
                      textAlign: "right",
                      marginTop: 2,
                    }}
                  >
                    {a.timestamp
                      ? new Date(a.timestamp).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, color: "var(--pos-muted,var(--pos-tx-muted))" }}>
          Page {page} of {totalPages} · {totalCount} records
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="pos-btn pos-btn-sm pos-btn-secondary"
          >
            <Icon icon={ChevronLeft} size="sm" /> Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="pos-btn pos-btn-sm pos-btn-secondary"
          >
            Next <Icon icon={ChevronRight} size="sm" />
          </button>
        </div>
      </div>
    </div>
  );
}
