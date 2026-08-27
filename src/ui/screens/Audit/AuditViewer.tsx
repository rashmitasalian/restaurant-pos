import React from "react";
import { countAudits, getAudits } from "../../../app/db/posRepository";
import { Icon } from "../../components/ui/Icon";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { DataTable } from "../../components/ui/DataTable";
import { ManageShell } from "../Manager/ManageShell";
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

function getActionColor(action: string): { bg: string; color: string; icon: LucideIcon } {
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
}

function detailText(detail: unknown): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  try {
    const s = JSON.stringify(detail);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return String(detail);
  }
}

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

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

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

  const columns = [
    { key: "when", header: "When", sortable: true, sortKey: "ts" },
    { key: "action", header: "Action", sortable: true, sortKey: "action" },
    { key: "order", header: "Order", sortable: true, sortKey: "orderId" },
    { key: "user", header: "User", sortable: true, sortKey: "user" },
    { key: "detail", header: "Detail" },
  ];

  const rows = items.map((a) => {
    const actionColor = getActionColor(a.action || "");
    return [
      a.timestamp
        ? new Date(a.timestamp).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
      <span key="action" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            background: actionColor.bg,
            color: actionColor.color,
            width: 28,
            height: 28,
            borderRadius: 7,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon icon={actionColor.icon} size="sm" />
        </span>
        {a.action || "—"}
      </span>,
      a.orderId || "—",
      a.user || "—",
      detailText(a.detail) || "—",
    ];
  });

  const sortValues = items.map((a) => ({
    ts: Number(a.timestamp || 0),
    action: String(a.action || ""),
    orderId: String(a.orderId || ""),
    user: String(a.user || ""),
  }));

  return (
    <ManageShell
      title="Audit Log"
      description="Track system activities and transactions"
      width="full"
      toolbar={
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", width: "100%" }}>
          <div style={{ flex: "1 1 180px", minWidth: 160 }}>
            <Input
              label="Search"
              placeholder="Filter by action/order/user"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div style={{ flex: "0 1 140px" }}>
            <Input
              label="From"
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div style={{ flex: "0 1 140px" }}>
            <Input
              label="To"
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div style={{ flex: "0 1 110px" }}>
            <Select
              label="Per page"
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </Select>
          </div>
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            <Icon icon={RefreshCw} size="sm" /> Refresh
          </Button>
          <Button
            variant="secondary"
            onClick={() => downloadCSV(items)}
            disabled={items.length === 0}
          >
            <Icon icon={Download} size="sm" /> Export Page CSV
          </Button>
          <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--pos-tx-muted)" }}>
            {totalCount} result{totalCount !== 1 ? "s" : ""}
          </span>
        </div>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        sortValues={sortValues}
        loading={loading}
        empty={
          filter || dateFrom || dateTo
            ? "No entries match your filters"
            : "No audit logs available yet"
        }
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 14,
        }}
      >
        <div style={{ fontSize: 13, color: "var(--pos-tx-muted)" }}>
          Page {page} of {totalPages} · {totalCount} records
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            <Icon icon={ChevronLeft} size="sm" /> Prev
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            Next <Icon icon={ChevronRight} size="sm" />
          </Button>
        </div>
      </div>
    </ManageShell>
  );
}
