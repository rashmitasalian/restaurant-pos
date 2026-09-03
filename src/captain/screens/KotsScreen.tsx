import React from "react";
import { ChevronRight } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
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
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="cap-skeleton-row" />
        ))}
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="cap-empty">
        <strong>No kitchen tickets yet</strong>
        <span>Send a KOT from a table to see it here.</span>
      </div>
    );
  }

  return (
    <div className="cap-kot-list">
      {tickets.map((ticket) => (
        <button
          key={ticket.orderId}
          type="button"
          className="cap-kot-row"
          onClick={() => onOpenTable(ticket.tableId)}
        >
          <div className="cap-kot-copy">
            <div className="cap-kot-title">
              <strong>{ticket.tableName}</strong>
              <span className={`cap-kot-status cap-kot-status-${ticket.kotStatus}`}>
                {ticket.unsentCount > 0 ? `${ticket.unsentCount} unsent` : ticket.kotStatus}
              </span>
            </div>
            <div className="cap-meta">
              {ticket.sentSummary || "Nothing sent yet"}
              {ticket.lastSendAt ? ` · ${formatKotAge(ticket.lastSendAt)} ago` : ""}
            </div>
          </div>
          <Icon icon={ChevronRight} size="lg" />
        </button>
      ))}
    </div>
  );
}
