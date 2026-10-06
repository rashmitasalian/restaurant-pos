import React from "react";
import { Minus, Plus, X } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import { netKitchenDelta, pendingKotQty, pendingKotVoidsFromMeta } from "../../shared/kot";
import { KITCHEN_NOTE_MAX } from "../../shared/kitchenNote";
import { useBackdropDismiss } from "../../ui/hooks/useBackdropDismiss";
import { money } from "../money";

export type KotSendPhase = "idle" | "confirm" | "sending" | "sent" | "failed";

export function OrderSheet({
  order,
  tableName,
  sendPhase,
  sendError,
  onChangeQty,
  onChangeNote,
  onSendKot,
  onConfirmSendKot,
  onCancelSendConfirm,
  onAddMore,
  onClose,
}: {
  order: any;
  tableName: string;
  sendPhase: KotSendPhase;
  sendError?: string | null;
  onChangeQty: (line: any, nextQty: number) => void;
  onChangeNote: (line: any, note: string) => void;
  onSendKot: () => void;
  onConfirmSendKot: () => void;
  onCancelSendConfirm: () => void;
  onAddMore: () => void;
  onClose: () => void;
}) {
  const items: any[] = order?.items || [];
  const pendingLines = items
    .map((line) => ({ line, pending: pendingKotQty(line) }))
    .filter((entry) => entry.pending > 0);
  const delta = netKitchenDelta(pendingKotVoidsFromMeta(order?.meta), items);
  const sentLines = items.filter(
    (line) => Number(line.kotPrintedQty || 0) > 0 && pendingKotQty(line) === 0,
  );
  const newCount =
    delta.stop.reduce((sum, row) => sum + row.qty, 0) +
    delta.make.reduce((sum, line) => sum + line.qty, 0);
  const sending = sendPhase === "sending";
  const confirming = sendPhase === "confirm";
  const dismissReview = useBackdropDismiss(onClose, !sending);
  const dismissPreview = useBackdropDismiss(onCancelSendConfirm);

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

  if (confirming) {
    return (
      <div
        className="cap-modal"
        role="dialog"
        aria-modal="true"
        aria-label="KOT preview"
        {...dismissPreview}
      >
        <div className="cap-modal-card cap-order-sheet">
          <div className="cap-sheet-head">
            <div>
              <h3>KOT Preview</h3>
              <div className="cap-meta">
                {tableName} · {newCount} to send
              </div>
            </div>
            <button
              type="button"
              className="cap-icon-btn cap-icon-btn-light"
              onClick={onCancelSendConfirm}
              aria-label="Close"
            >
              <Icon icon={X} size="lg" />
            </button>
          </div>
          <div className="cap-ticket">
            <section className="cap-ticket-group cap-ticket-new">
              <div className="cap-ticket-label">Items to kitchen</div>
              {delta.stop.map((row) => (
                <div key={`stop-${row.name}`} className="cap-line cap-line-new">
                  <div className="cap-line-copy">
                    <strong>Stop {row.name}</strong>
                  </div>
                  <strong>×{row.qty}</strong>
                </div>
              ))}
              {delta.make.map((line) => (
                <div key={line.id || line.name} className="cap-line cap-line-new">
                  <div className="cap-line-copy">
                    <strong>{line.name}</strong>
                    {line.note ? <div className="cap-meta">{line.note}</div> : null}
                  </div>
                  <strong>×{line.qty}</strong>
                </div>
              ))}
            </section>
          </div>
          <div className="cap-sheet-footer">
            <button type="button" className="cap-btn cap-btn-accent" onClick={onConfirmSendKot}>
              Send to kitchen
            </button>
            <button type="button" className="cap-btn cap-btn-quiet" onClick={onCancelSendConfirm}>
              Back
            </button>
          </div>
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
      {...dismissReview}
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
            {pendingLines.length > 0 ? (
              <section className="cap-ticket-group cap-ticket-new">
                <div className="cap-ticket-label">New — not sent</div>
                {pendingLines.map(({ line }) => (
                  <TicketLine
                    key={line.id}
                    line={line}
                    busy={sending}
                    onChangeQty={onChangeQty}
                    onChangeNote={onChangeNote}
                  />
                ))}
              </section>
            ) : null}
            {sentLines.length > 0 ? (
              <section className="cap-ticket-group">
                <div className="cap-ticket-label">KOT sent</div>
                {sentLines.map((line) => (
                  <TicketLine
                    key={line.id}
                    line={line}
                    sent
                    busy={sending}
                    onChangeQty={onChangeQty}
                    onChangeNote={onChangeNote}
                  />
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
          ) : (
            <p className="cap-meta">
              {newCount} item{newCount === 1 ? "" : "s"} ready for kitchen.
            </p>
          )}
          <button
            type="button"
            className="cap-btn cap-btn-accent"
            disabled={sending || newCount === 0}
            onClick={onConfirmSendKot}
          >
            {sending ? "Sending…" : sendPhase === "failed" ? "Try again" : "Send to kitchen"}
          </button>
          {newCount > 0 && sendPhase !== "sending" ? (
            <button type="button" className="cap-btn cap-btn-quiet" onClick={onSendKot}>
              Preview
            </button>
          ) : null}
          <button
            type="button"
            className="cap-btn cap-btn-quiet"
            disabled={sending}
            onClick={onAddMore}
          >
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
  onChangeNote,
}: {
  line: any;
  sent?: boolean;
  busy: boolean;
  onChangeQty: (line: any, nextQty: number) => void;
  onChangeNote: (line: any, note: string) => void;
}) {
  const qty = Number(line.qty || 0);
  const printed = Number(line.kotPrintedQty || 0);
  const pending = Math.max(0, qty - printed);
  const note = String(line.kitchenNote || "");
  const [draft, setDraft] = React.useState(note);
  React.useEffect(() => {
    setDraft(note);
  }, [note]);
  const canEditNote = pending > 0;
  return (
    <div className={`cap-line ${sent ? "cap-line-sent" : "cap-line-new"}`}>
      <div className="cap-line-copy">
        <strong>{line.name}</strong>
        <div className="cap-meta">
          {qty} × {money(Number(line.rate || 0))}
          {sent ? ` · sent ${printed}` : ""}
          {!sent && printed > 0 ? ` · ${printed} sent · ${pending} new` : ""}
        </div>
        {canEditNote ? (
          <input
            className="cap-note"
            value={draft}
            placeholder="Note for kitchen"
            aria-label={`Note for ${line.name}`}
            maxLength={KITCHEN_NOTE_MAX}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft.trim() !== note.trim()) {
                onChangeNote(line, draft);
              }
            }}
          />
        ) : note ? (
          <div className="cap-meta">{note}</div>
        ) : null}
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
