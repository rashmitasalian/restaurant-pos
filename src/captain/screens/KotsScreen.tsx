import React from "react";
import { formatKotAge, kotAgeTone } from "../../shared/kotAge";

export type CaptainKotTicket = {
  orderId: string;
  tableId: number;
  tableName: string;
  kotStatus: string;
  openedAt?: number | null;
  activityAt?: number | null;
  lastSendAt: number | null;
  sentSummary: string;
  itemSummary?: string;
  sentCount: number;
  unsentCount: number;
};

export function KotsScreen({
  tickets,
  loading,
  onOpenTable,
}: {
  tickets: CaptainKotTicket[];
  loading?: boolean;
  onOpenTable: (tableId: number) => void;
}) {
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

      {tickets.length === 0 ? (
        <div className="cap-empty">
          <strong>No kitchen tickets</strong>
          <span>Send an order from a table and it will show up here.</span>
        </div>
      ) : (
        <div className="cap-kot-list">
          {tickets.map((ticket) => {
            const when = ticket.lastSendAt || ticket.activityAt || ticket.openedAt;
            const age = when ? kotAgeTone(when) : "neutral";
            return (
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
                {ticket.itemSummary ? <div className="cap-kot-items">{ticket.itemSummary}</div> : null}
                <div className={`cap-meta cap-age-${age}`}>
                  {ticket.unsentCount > 0
                    ? "Items waiting for kitchen"
                    : when
                      ? `Kitchen received · ${formatKotAge(when)} ago`
                      : "KOT sent to kitchen"}
                </div>
              </div>
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
