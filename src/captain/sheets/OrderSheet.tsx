import React from "react";
import { Minus, Plus, X } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import { pendingKotQty } from "../../shared/kot";
import { money } from "../money";

export function OrderSheet({
  order,
  tableName,
  busy,
  onChangeQty,
  onSendKot,
  onClose,
}: {
  order: any;
  tableName: string;
  busy: boolean;
  onChangeQty: (line: any, nextQty: number) => void;
  onSendKot: () => void;
  onClose: () => void;
}) {
  const items: any[] = order?.items || [];
  const sentLines = items.filter((line) => Number(line.kotPrintedQty || 0) > 0);
  const newLines = items.filter((line) => Number(line.kotPrintedQty || 0) === 0);
  const newCount = items.reduce((sum, line) => sum + pendingKotQty(line), 0);

  return (
    <div
      className="cap-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Review order"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="cap-modal-card cap-order-sheet">
        <div className="cap-sheet-head">
          <div>
            <h3>Order</h3>
            <div className="cap-meta">{tableName}</div>
          </div>
          <button type="button" className="cap-icon-btn cap-icon-btn-light" onClick={onClose} aria-label="Close">
            <Icon icon={X} size="lg" />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="cap-empty">
            <strong>No items yet</strong>
            <span>Add from the menu, then send to kitchen.</span>
          </div>
        ) : (
          <div className="cap-ticket">
            {newLines.length > 0 ? (
              <section className="cap-ticket-group cap-ticket-new">
                <div className="cap-ticket-label">New — not sent</div>
                {newLines.map((line) => (
                  <TicketLine key={line.id} line={line} busy={busy} onChangeQty={onChangeQty} />
                ))}
              </section>
            ) : null}
            {sentLines.length > 0 ? (
              <section className="cap-ticket-group">
                <div className="cap-ticket-label">Sent to kitchen</div>
                {sentLines.map((line) => (
                  <TicketLine key={line.id} line={line} sent busy={busy} onChangeQty={onChangeQty} />
                ))}
              </section>
            ) : null}
          </div>
        )}

        <div className="cap-sheet-footer">
          <div className="cap-sheet-total">
            <span>Total</span>
            <strong>{money(Number(order.total || 0))}</strong>
          </div>
          {newCount === 0 ? (
            <p className="cap-meta">Add new items to send a KOT.</p>
          ) : null}
          <button
            type="button"
            className="cap-btn cap-btn-accent"
            disabled={busy || newCount === 0}
            onClick={onSendKot}
          >
            {busy ? "Sending…" : `Send KOT${newCount ? ` · ${newCount}` : ""}`}
          </button>
          <button type="button" className="cap-btn cap-btn-quiet" onClick={onClose}>
            Keep adding
          </button>
        </div>
      </div>
    </div>
  );
}

function TicketLine({
  line,
  sent,
  busy,
  onChangeQty,
}: {
  line: any;
  sent?: boolean;
  busy: boolean;
  onChangeQty: (line: any, nextQty: number) => void;
}) {
  const qty = Number(line.qty || 0);
  const printed = Number(line.kotPrintedQty || 0);
  const pending = qty - printed;
  return (
    <div className={`cap-line ${sent ? "cap-line-sent" : "cap-line-new"}`}>
      <div className="cap-line-copy">
        <strong>{line.name}</strong>
        <div className="cap-meta">
          {money(Number(line.rate || 0))}
          {sent ? ` · sent ${printed}` : ""}
          {sent && pending > 0 ? ` (+${pending} new)` : ""}
        </div>
      </div>
      <div className="cap-qty">
        <button
          type="button"
          disabled={busy}
          aria-label={`Decrease ${line.name}`}
          onClick={() => onChangeQty(line, qty - 1)}
        >
          <Icon icon={Minus} size="md" />
        </button>
        <span>{qty}</span>
        <button
          type="button"
          disabled={busy}
          aria-label={`Increase ${line.name}`}
          onClick={() => onChangeQty(line, qty + 1)}
        >
          <Icon icon={Plus} size="md" />
        </button>
      </div>
    </div>
  );
}
