import React from "react";
import { formatKotAge } from "../../shared/kotAge";

export type CaptainKotTicket = {
  orderId: string;
  tableId: number;
  tableName: string;
  kotStatus: string;
  lastSendAt: number | null;
  sentSummary: string;
  sentCount: number;
  unsentCount: number;
};

type KotFilter = "all" | "new" | "sent";

function matchesFilter(ticket: CaptainKotTicket, filter: KotFilter) {
  if (filter === "new") {
    return ticket.unsentCount > 0;
  }
  if (filter === "sent") {
    return ticket.unsentCount === 0 && ticket.sentCount > 0;
  }
  return true;
}

export function KotsScreen({
  tickets,
  loading,
  onOpenTable,
}: {
  tickets: CaptainKotTicket[];
  loading?: boolean;
  onOpenTable: (tableId: number) => void;
}) {
  const [filter, setFilter] = React.useState<KotFilter>("all");
  const visible = tickets.filter((ticket) => matchesFilter(ticket, filter));

  if (loading && tickets.length === 0) {
    return (
      <div className="cap-stack">
        <h2 className="cap-page-title">KOT Queue</h2>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="cap-skeleton-row" />
        ))}
      </div>
    );
  }

  return (
    <div className="cap-stack">
      <h2 className="cap-page-title">KOT Queue</h2>
      <div className="cap-cats" role="tablist" aria-label="KOT status">
        {(
          [
            ["all", "All"],
            ["new", "Send KOT"],
            ["sent", "KOT sent"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`cap-chip ${filter === id ? "active" : ""}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tickets.length === 0 ? (
        <div className="cap-empty">
          <strong>No kitchen tickets</strong>
          <span>Send an order from a table and it will show up here.</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="cap-empty">
          <strong>Nothing here</strong>
          <span>Try another filter.</span>
        </div>
      ) : (
        <div className="cap-kot-list">
          {visible.map((ticket) => (
            <button
              key={ticket.orderId}
              type="button"
              className="cap-kot-row"
              onClick={() => onOpenTable(ticket.tableId)}
            >
              <div className="cap-kot-copy">
                <div className="cap-kot-title">
                  <strong>{ticket.tableName}</strong>
                  <span
                    className={`cap-kot-status ${ticket.unsentCount > 0 ? "cap-kot-status-pending" : "cap-kot-status-sent"}`}
                  >
                    {ticket.unsentCount > 0 ? `${ticket.unsentCount} to send` : "KOT sent"}
                  </span>
                </div>
                <div className="cap-meta">
                  {ticket.unsentCount > 0
                    ? "Items waiting for kitchen"
                    : ticket.lastSendAt
                      ? `Kitchen received · ${formatKotAge(ticket.lastSendAt)} ago`
                      : "KOT sent to kitchen"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
