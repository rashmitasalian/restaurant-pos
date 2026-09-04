import React from "react";
import { Minus, Plus, X } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import { pendingKotQty } from "../../shared/kot";
import { money } from "../money";

export type KotSendPhase = "idle" | "sending" | "sent" | "failed";

export function OrderSheet({
  order,
  tableName,
  sendPhase,
  sendError,
  onChangeQty,
  onSendKot,
  onAddMore,
  onClose,
}: {
  order: any;
  tableName: string;
  sendPhase: KotSendPhase;
  sendError?: string | null;
  onChangeQty: (line: any, nextQty: number) => void;
  onSendKot: () => void;
  onAddMore: () => void;
  onClose: () => void;
}) {
  const items: any[] = order?.items || [];
  const sentLines = items.filter((line) => Number(line.kotPrintedQty || 0) > 0);
  const newLines = items.filter((line) => Number(line.kotPrintedQty || 0) === 0);
  const newCount = items.reduce((sum, line) => sum + pendingKotQty(line), 0);
  const sending = sendPhase === "sending";

  if (sendPhase === "sent") {
    return (
      <div className="cap-modal" role="dialog" aria-modal="true" aria-label="KOT sent">
        <div className="cap-modal-card cap-order-sheet cap-kot-success">
          <div className="cap-success-mark" aria-hidden="true">
            ✓
          </div>
          <h3>KOT sent</h3>
          <p className="cap-meta">{tableName}</p>
          <p>Kitchen has received your order.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="cap-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Review order"
      onClick={(event) => {
        if (event.target === event.currentTarget && !sending) {
          onClose();
        }
      }}
    >
      <div className="cap-modal-card cap-order-sheet">
        <div className="cap-sheet-head">
          <div>
            <h3>Review order</h3>
            <div className="cap-meta">{tableName}</div>
          </div>
          <button
            type="button"
            className="cap-icon-btn cap-icon-btn-light"
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
          >
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
                  <TicketLine key={line.id} line={line} busy={sending} onChangeQty={onChangeQty} />
                ))}
              </section>
            ) : null}
            {sentLines.length > 0 ? (
              <section className="cap-ticket-group">
                <div className="cap-ticket-label">KOT sent</div>
                {sentLines.map((line) => (
                  <TicketLine key={line.id} line={line} sent busy={sending} onChangeQty={onChangeQty} />
                ))}
              </section>
            ) : null}
          </div>
        )}

        <div className="cap-sheet-footer">
          <div className="cap-sheet-total">
            <span>{items.reduce((sum, line) => sum + Number(line.qty || 0), 0)} items</span>
            <strong>{money(Number(order.total || 0))}</strong>
          </div>
          {sendPhase === "failed" ? (
            <div className="cap-error">
              <strong>Couldn't send KOT</strong>
              <div>{sendError || "Your order has not been confirmed."}</div>
            </div>
          ) : newCount === 0 ? (
            <p className="cap-meta">Add new items to send a KOT.</p>
          ) : null}
          <button
            type="button"
            className="cap-btn cap-btn-accent"
            disabled={sending || newCount === 0}
            onClick={onSendKot}
          >
            {sending ? "Sending…" : sendPhase === "failed" ? "Try again" : "Send KOT"}
          </button>
          <button type="button" className="cap-btn cap-btn-quiet" disabled={sending} onClick={onAddMore}>
            Add more items
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
          {qty} × {money(Number(line.rate || 0))}
          {sent ? ` · sent ${printed}` : ""}
          {sent && pending > 0 ? ` (+${pending} new)` : ""}
        </div>
      </div>
      <div className="cap-qty cap-qty-compact">
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
