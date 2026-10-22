import React from "react";
import {
  CUSTOMER_NAME_LIMIT,
  CUSTOMER_PHONE_LIMIT,
  PAYMENT_TXN_REF_LIMIT,
  normalizePhone,
} from "../../../../shared/validation";
import { TEXT_LIMITS } from "../../../../shared/textLimits";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import styles from "../Billing.module.css";
import {
  CANCEL_REASON_OTHER,
  CANCEL_REASON_PRESETS,
  resolveCancelReason,
} from "../../../../shared/cancelReasons";
import { formatTableLabel } from "../../../../shared/floorLayout";
import { getTablesSnapshot, previewSplitOrder } from "../../../../app/db/posRepository";

interface FormatCurrency {
  (v: number): string;
}

type SnapshotTable = {
  id: number;
  name?: string;
  occupied?: boolean;
  orderId?: string | null;
  activityAt?: number | null;
  count?: number;
};

function useTableSnapshot() {
  const [tables, setTables] = React.useState<SnapshotTable[] | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    getTablesSnapshot()
      .then((snapshot) => {
        if (!cancelled) {
          setTables(snapshot.tables || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTables([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return tables;
}

function TableChoices({
  name,
  tables,
  value,
  disabled,
  emptyText,
  onChange,
}: {
  name: string;
  tables: Array<{ value: string; label: string; disabled?: boolean }>;
  value: string;
  disabled?: boolean;
  emptyText: string;
  onChange: (value: string) => void;
}) {
  if (!tables.length) {
    return <p className={styles.modalPara}>{emptyText}</p>;
  }
  return (
    <select
      className={`${styles.modalInput} ${styles.tableSelect}`}
      aria-label={name}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Select a table</option>
      {tables.map((table) => (
        <option key={table.value} value={table.value} disabled={table.disabled}>
          {table.label}
        </option>
      ))}
    </select>
  );
}

function DialogShell({
  ariaLabel,
  className,
  onClose,
  children,
  style,
}: {
  ariaLabel: string;
  className: string;
  onClose?: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const items = React.Children.toArray(children);
  const footerIndex = items.findIndex((child) => {
    if (!React.isValidElement(child)) {
      return false;
    }
    const className = String((child.props as { className?: string }).className || "");
    return className.split(/\s+/).includes(styles.modalFooter);
  });
  const body = footerIndex >= 0 ? items.filter((_, index) => index !== footerIndex) : items;
  const footer = footerIndex >= 0 ? items[footerIndex] : null;
  return (
    <div className={styles.modalOverlay}>
      <div
        ref={dialogRef}
        className={`${className} ${styles.modalFrame}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        style={style}
      >
        <div className={styles.modalBody}>{body}</div>
        {footer}
      </div>
    </div>
  );
}

interface VariantPickerModalProps {
  itemName: string;
  variants: Array<{ id?: string; name: string; price: number }>;
  onClose: () => void;
  onSelect: (variant: { id?: string; name: string; price: number }) => void;
}

export function VariantPickerModal({
  itemName,
  variants,
  onClose,
  onSelect,
}: VariantPickerModalProps) {
  return (
    <DialogShell
      ariaLabel="Select item variant"
      className={styles.modalDialogMedium}
      onClose={onClose}
    >
      <h3 className={styles.modalTitle}>Choose Variant</h3>
      <p className={styles.modalPara} style={{ marginTop: 6, marginBottom: 12 }}>
        {itemName}
      </p>
      <div className={styles.kotList}>
        {variants.map((variant, index) => (
          <button
            key={`${variant.id || variant.name}-${index}`}
            onClick={() => onSelect(variant)}
            className={styles.orderButton}
            style={{ marginBottom: 8 }}
          >
            <div className={styles.orderRowTop}>
              <span className={styles.itemTitle}>{variant.name}</span>
              <span className={styles.headerValue}>₹{variant.price}</span>
            </div>
          </button>
        ))}
      </div>
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn}>
          Cancel
        </button>
      </div>
    </DialogShell>
  );
}

// ── Confirm Pay Modal ───────────────────────────────────────────────────────

interface ConfirmPayProps {
  order: any;
  subtotal: number;
  cgst: number;
  sgst: number;
  discountPercent: number;
  discountAmt: number;
  finalTotal: number;
  gstHalfPct: number;
  formatCurrency: FormatCurrency;
  onClose: () => void;
  onProceed: () => void;
}

export function ConfirmPayModal({
  order,
  subtotal,
  cgst,
  sgst,
  discountPercent,
  discountAmt,
  finalTotal,
  gstHalfPct,
  formatCurrency,
  onClose,
  onProceed,
}: ConfirmPayProps) {
  return (
    <DialogShell ariaLabel="Confirm payment" className={styles.modalDialogLarge} onClose={onClose}>
      <h3 className={styles.modalTitle}>Confirm Payment</h3>
      <div className={styles.kotList}>
        {(order.items || []).map((it: any, idx: number) => (
          <div key={idx} className={styles.kotItem}>
            <div className={styles.kotItemTitle}>{it.name}</div>
            <div className={styles.textMuted}>
              {it.qty} × ₹{it.rate} = <strong>₹{(it.qty || 0) * (it.rate || 0)}</strong>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, borderTop: "1px dashed var(--pos-line)", paddingTop: 10 }}>
        <div className={styles.totalsRow}>
          <span>Subtotal</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>
        <div className={styles.totalsRow}>
          <span>CGST ({gstHalfPct}%)</span>
          <span>{formatCurrency(cgst)}</span>
        </div>
        <div className={styles.totalsRow}>
          <span>SGST ({gstHalfPct}%)</span>
          <span>{formatCurrency(sgst)}</span>
        </div>
        {discountPercent > 0 && (
          <div className={styles.totalsRow}>
            <span>Discount ({discountPercent}%)</span>
            <span>−{formatCurrency(discountAmt)}</span>
          </div>
        )}
        <div className={styles.totalsRowStrong} style={{ fontSize: 18 }}>
          <span>Grand Total</span>
          <span>{formatCurrency(finalTotal)}</span>
        </div>
      </div>
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn}>
          Cancel
        </button>
        <button onClick={onProceed} className={styles.btnPrimary}>
          → Select Payment Method
        </button>
      </div>
    </DialogShell>
  );
}

// ── Confirm Cancel Modal ────────────────────────────────────────────────────

interface ConfirmCancelProps {
  tableNum: number | null;
  tableLabel?: string;
  activeOrderType: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  processing?: boolean;
}

export function ConfirmCancelModal({
  tableNum,
  tableLabel,
  activeOrderType,
  onClose,
  onConfirm,
  processing = false,
}: ConfirmCancelProps) {
  const [preset, setPreset] = React.useState<string>(CANCEL_REASON_PRESETS[0]);
  const [otherText, setOtherText] = React.useState("");
  const cleanReason = resolveCancelReason(preset, otherText);
  const targetLabel = tableNum
    ? tableLabel || `Table ${tableNum}`
    : activeOrderType === "delivery"
      ? "this delivery order"
      : "this order";
  return (
    <DialogShell
      ariaLabel="Cancel order confirmation"
      className={styles.modalDialogLarge}
      onClose={processing ? undefined : onClose}
    >
      <h3 className={styles.modalTitle}>Cancel Order?</h3>
      <p className={styles.modalPara}>
        This cancels <strong>{targetLabel}</strong>. The order stays in records for review and is
        no longer active on the floor.
      </p>
      <label className={styles.modalLabel} style={{ marginTop: 14 }}>
        Reason
      </label>
      <div className={styles.kotList} style={{ marginTop: 8 }}>
        {CANCEL_REASON_PRESETS.map((option) => (
          <label
            key={option}
            className={`${styles.kotItem} ${styles.tableChoice} ${preset === option ? styles.tableChoiceSelected : ""}`}
          >
            <input
              type="radio"
              name="order-cancel-reason"
              value={option}
              checked={preset === option}
              disabled={processing}
              onChange={() => setPreset(option)}
            />
            {option}
          </label>
        ))}
      </div>
      {preset === CANCEL_REASON_OTHER ? (
        <input
          value={otherText}
          onChange={(event) => setOtherText(event.target.value)}
          placeholder="Describe the reason"
          maxLength={TEXT_LIMITS.reason}
          autoFocus
          className={styles.modalInput}
          style={{ marginTop: 10 }}
          disabled={processing}
        />
      ) : null}
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn} disabled={processing}>
          No, Keep
        </button>
        <button
          onClick={() => onConfirm(cleanReason)}
          className={styles.btnDanger}
          disabled={processing || !cleanReason}
        >
          {processing ? "Cancelling..." : "Yes, Cancel"}
        </button>
      </div>
    </DialogShell>
  );
}

const TRANSFER_REASONS = ["Customer requested", "Table too small", "Guest moved", "Other"];

export function TransferTableModal({
  currentTableId,
  currentTableLabel,
  foodSent,
  billPrinted,
  processing = false,
  onClose,
  onConfirm,
}: {
  currentTableId: number;
  currentTableLabel: string;
  foodSent: boolean;
  billPrinted: boolean;
  processing?: boolean;
  onClose: () => void;
  onConfirm: (destinationTableId: number, reason: string) => void;
}) {
  const [preset, setPreset] = React.useState(TRANSFER_REASONS[0]);
  const [otherText, setOtherText] = React.useState("");
  const [destinationId, setDestinationId] = React.useState("");
  const tables = useTableSnapshot();
  const reason = preset === "Other" ? otherText.trim() : preset;
  const destination = (tables || []).find((table) => String(table.id) === destinationId);
  const destinationLabel = destination
    ? formatTableLabel(destination.id, destination.name)
    : "the selected table";
  return (
    <DialogShell
      ariaLabel="Transfer table"
      className={styles.modalDialogLarge}
      onClose={processing ? undefined : onClose}
    >
      <h3 className={styles.modalTitle}>Transfer table?</h3>
      <p className={styles.modalPara}>
        Move this order from <strong>{currentTableLabel}</strong> to {destinationLabel}. The same
        order, items, and prices stay on the new table.
      </p>
      {foodSent ? (
        <p className={styles.modalPara}>
          The kitchen already has this food. It will get a transfer slip, not a new food order.
        </p>
      ) : null}
      {billPrinted ? (
        <p className={styles.modalPara}>
          A bill was already printed. Reprint it after the move. This does not create a new invoice.
        </p>
      ) : null}
      <label className={styles.modalLabel} style={{ marginTop: 14 }}>
        New table
      </label>
      {tables === null ? (
        <p className={styles.modalPara}>Loading tables...</p>
      ) : (
        <TableChoices
          name="transfer-table"
          value={destinationId}
          disabled={processing}
          emptyText="No other table is available."
          onChange={setDestinationId}
          tables={tables
            .filter((table) => Number(table.id) !== Number(currentTableId))
            .map((table) => ({
              value: String(table.id),
              disabled: Boolean(table.occupied),
              label: `${formatTableLabel(table.id, table.name)}${table.occupied ? " (in use)" : ""}`,
            }))}
        />
      )}
      <label className={styles.modalLabel} style={{ marginTop: 14 }}>
        Reason
      </label>
      <div className={styles.kotList} style={{ marginTop: 8 }}>
        {TRANSFER_REASONS.map((option) => (
          <label
            key={option}
            className={`${styles.kotItem} ${styles.tableChoice} ${preset === option ? styles.tableChoiceSelected : ""}`}
          >
            <input
              type="radio"
              name="transfer-reason"
              checked={preset === option}
              disabled={processing}
              onChange={() => setPreset(option)}
            />
            {option}
          </label>
        ))}
      </div>
      {preset === "Other" ? (
        <input
          value={otherText}
          onChange={(event) => setOtherText(event.target.value)}
          placeholder="Describe the reason"
          maxLength={TEXT_LIMITS.reason}
          className={styles.modalInput}
          style={{ marginTop: 10 }}
          disabled={processing}
        />
      ) : null}
      <p className={styles.modalPara} style={{ marginTop: 12 }}>
        {destinationId && reason
          ? `Move to ${destinationLabel}. Reason: ${reason}.`
          : "Choose a free table and a reason."}
      </p>
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn} disabled={processing}>
          Keep table
        </button>
        <button
          onClick={() => onConfirm(Number(destinationId), reason)}
          className={styles.btnPrimary}
          disabled={processing || !destinationId || !reason || Boolean(destination?.occupied)}
        >
          {processing ? "Moving..." : "Transfer"}
        </button>
      </div>
    </DialogShell>
  );
}

function ReasonChoices({
  name,
  preset,
  otherText,
  processing,
  onPreset,
  onOther,
}: {
  name: string;
  preset: string;
  otherText: string;
  processing?: boolean;
  onPreset: (value: string) => void;
  onOther: (value: string) => void;
}) {
  return (
    <>
      <label className={styles.modalLabel} style={{ marginTop: 14 }}>
        Reason
      </label>
      <div className={styles.kotList} style={{ marginTop: 8 }}>
        {TRANSFER_REASONS.map((option) => (
          <label
            key={option}
            className={`${styles.kotItem} ${styles.tableChoice} ${preset === option ? styles.tableChoiceSelected : ""}`}
          >
            <input
              type="radio"
              name={name}
              checked={preset === option}
              disabled={processing}
              onChange={() => onPreset(option)}
            />
            {option}
          </label>
        ))}
      </div>
      {preset === "Other" ? (
        <input
          value={otherText}
          onChange={(event) => onOther(event.target.value)}
          placeholder="Describe the reason"
          maxLength={TEXT_LIMITS.reason}
          className={styles.modalInput}
          style={{ marginTop: 10 }}
          disabled={processing}
        />
      ) : null}
    </>
  );
}

export function MergeTableModal({
  currentTableId,
  currentTableLabel,
  processing = false,
  onClose,
  onConfirm,
}: {
  currentTableId: number;
  currentTableLabel: string;
  processing?: boolean;
  onClose: () => void;
  onConfirm: (sourceOrderId: string, sourceBaseUpdatedAt: number, reason: string) => void;
}) {
  const [preset, setPreset] = React.useState(TRANSFER_REASONS[0]);
  const [otherText, setOtherText] = React.useState("");
  const [sourceId, setSourceId] = React.useState("");
  const tables = useTableSnapshot();
  const reason = preset === "Other" ? otherText.trim() : preset;
  const mergeCandidates = (tables || []).filter(
    (table) =>
      Number(table.id) !== Number(currentTableId) &&
      Boolean(table.orderId) &&
      (Boolean(table.occupied) || Number(table.count || 0) > 0),
  );
  const source = sourceId
    ? mergeCandidates.find((table) => String(table.orderId) === sourceId)
    : undefined;
  const sourceLabel = source ? formatTableLabel(source.id, source.name) : "";
  return (
    <DialogShell ariaLabel="Merge another table" className={styles.modalDialogLarge} onClose={processing ? undefined : onClose}>
      <h3 className={styles.modalTitle}>Merge another table?</h3>
      <p className={styles.modalPara}>
        {sourceLabel ? (
          <>
            Add the items from <strong>{sourceLabel}</strong> onto <strong>{currentTableLabel}</strong>.
          </>
        ) : (
          <>
            Add another table's items onto <strong>{currentTableLabel}</strong>.
          </>
        )}{" "}
        That table's order is cancelled. This order keeps its number.
      </p>
      <label className={styles.modalLabel} style={{ marginTop: 14 }}>
        Table to merge
      </label>
      {tables === null ? (
        <p className={styles.modalPara}>Loading tables...</p>
      ) : (
        <TableChoices
          name="merge-table"
          value={sourceId}
          disabled={processing}
          emptyText="No other table has an open order."
          onChange={setSourceId}
          tables={mergeCandidates.map((table) => {
            const count = Number(table.count || 0);
            return {
              value: String(table.orderId),
              label: `${formatTableLabel(table.id, table.name)}${count > 0 ? ` · ${count} item${count === 1 ? "" : "s"}` : ""}`,
            };
          })}
        />
      )}
      <ReasonChoices
        name="merge-reason"
        preset={preset}
        otherText={otherText}
        processing={processing}
        onPreset={setPreset}
        onOther={setOtherText}
      />
      <p className={styles.modalPara} style={{ marginTop: 12 }}>
        {source && reason
          ? `Merge ${sourceLabel} into ${currentTableLabel}. Reason: ${reason}.`
          : "Choose an occupied table and a reason."}
      </p>
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn} disabled={processing}>
          Keep separate
        </button>
        <button
          onClick={() => onConfirm(String(source?.orderId || ""), Number(source?.activityAt || 0), reason)}
          className={styles.btnPrimary}
          disabled={processing || !source?.orderId || !Number(source?.activityAt) || !reason}
        >
          {processing ? "Merging..." : "Merge"}
        </button>
      </div>
    </DialogShell>
  );
}

export function SplitOrderModal({
  orderId,
  currentTableId,
  currentTableLabel,
  lines,
  processing = false,
  onClose,
  onConfirm,
}: {
  orderId: string;
  currentTableId: number;
  currentTableLabel: string;
  lines: Array<{ id: string; name: string; qty: number }>;
  processing?: boolean;
  onClose: () => void;
  onConfirm: (destinationTableId: number, reason: string, moves: Array<{ lineId: string; qty: number }>) => void;
}) {
  const [preset, setPreset] = React.useState(TRANSFER_REASONS[0]);
  const [otherText, setOtherText] = React.useState("");
  const [destinationId, setDestinationId] = React.useState("");
  const [qtyByLine, setQtyByLine] = React.useState<Record<string, string>>({});
  const tables = useTableSnapshot();
  const [preview, setPreview] = React.useState<{
    source: { subtotal: number; discount: number; tax: number; roundOff: number; total: number };
    destination: { subtotal: number; discount: number; tax: number; roundOff: number; total: number };
    discountNote: string | null;
  } | null>(null);
  const [previewError, setPreviewError] = React.useState("");
  const reason = preset === "Other" ? otherText.trim() : preset;
  const moves = lines
    .map((line) => ({ lineId: line.id, qty: Math.max(0, Math.trunc(Number(qtyByLine[line.id] || 0))) }))
    .filter((move) => move.qty > 0);
  const moveKey = JSON.stringify(moves);
  const destination = (tables || []).find((table) => String(table.id) === destinationId);
  React.useEffect(() => {
    if (!destinationId || moveKey === "[]") {
      setPreview(null);
      setPreviewError("");
      return;
    }
    let cancelled = false;
    const requested = JSON.parse(moveKey) as Array<{ lineId: string; qty: number }>;
    previewSplitOrder(orderId, Number(destinationId), requested)
      .then((result) => {
        if (!cancelled) {
          setPreview(result);
          setPreviewError("");
        }
      })
      .catch((error: { message?: string }) => {
        if (!cancelled) {
          const code = String(error?.message || "");
          const text =
            code.includes("table-occupied") || code.includes("table-print-pending")
              ? "This table is no longer available."
              : code.includes("discount-amount")
                ? "Remove the rupee discount before splitting."
                : code.includes("split-entire-order")
                  ? "Moving the whole order is a transfer."
                  : code.includes("split-print-pending")
                    ? "A kitchen ticket is still waiting. Retry it in Settings first."
                    : code.includes("split-qty")
                      ? "Enter a whole number no higher than the quantity on this order."
                      : code.includes("order-not-splittable")
                        ? "This order can't be split."
                        : "This split is not available.";
          setPreview(null);
          setPreviewError(text);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, destinationId, moveKey]);
  const money = (value: number) => `₹${Number(value || 0).toFixed(2)}`;
  const side = (label: string, totals: NonNullable<typeof preview>["source"]) => (
    <p className={styles.modalPara}>
      {label}: items {money(totals.subtotal)}, discount {money(totals.discount)}, GST {money(totals.tax)},
      round-off {money(totals.roundOff)}, total {money(totals.total)}.
    </p>
  );
  return (
    <DialogShell ariaLabel="Split order" className={styles.modalDialogLarge} onClose={processing ? undefined : onClose}>
      <h3 className={styles.modalTitle}>Split order?</h3>
      <p className={styles.modalPara}>
        Move some quantities from <strong>{currentTableLabel}</strong> onto a free table. This order
        stays here.
      </p>
      <div className={styles.splitLines}>
        {lines.map((line) => (
          <label key={line.id} className={styles.splitLine}>
            <span>
              <span className={styles.splitLineName}>{line.name}</span>
              <span className={styles.splitLineMeta}>{line.qty} here</span>
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label={`Quantity to move for ${line.name}`}
              placeholder="0"
              value={qtyByLine[line.id] ?? ""}
              disabled={processing}
              className={`${styles.modalInput} ${styles.splitQty}`}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "");
                const parsed = digits === "" ? 0 : Math.trunc(Number(digits));
                const next = digits === "" ? "" : String(Math.min(line.qty, parsed));
                setQtyByLine((current) => ({ ...current, [line.id]: next }));
              }}
            />
          </label>
        ))}
      </div>
      <label className={styles.modalLabel} style={{ marginTop: 14 }}>
        New table
      </label>
      {tables === null ? (
        <p className={styles.modalPara}>Loading tables...</p>
      ) : (
        <TableChoices
          name="split-table"
          value={destinationId}
          disabled={processing}
          emptyText="No free table is available."
          onChange={setDestinationId}
          tables={tables
            .filter((table) => Number(table.id) !== Number(currentTableId) && !table.occupied)
            .map((table) => ({
              value: String(table.id),
              label: formatTableLabel(table.id, table.name),
            }))}
        />
      )}
      <ReasonChoices
        name="split-reason"
        preset={preset}
        otherText={otherText}
        processing={processing}
        onPreset={setPreset}
        onOther={setOtherText}
      />
      {preview ? (
        <>
          {side("This table", preview.source)}
          {side("New table", preview.destination)}
          {preview.discountNote ? <p className={styles.modalPara}>{preview.discountNote}</p> : null}
        </>
      ) : null}
      {previewError ? <p className={styles.modalPara}>{previewError}</p> : null}
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn} disabled={processing}>
          Keep together
        </button>
        <button
          onClick={() => onConfirm(Number(destinationId), reason, moves)}
          className={styles.btnPrimary}
          disabled={processing || !destinationId || !reason || !preview || Boolean(destination?.occupied)}
        >
          {processing ? "Splitting..." : "Split"}
        </button>
      </div>
    </DialogShell>
  );
}

// ── KOT Preview Modal ───────────────────────────────────────────────────────

interface KotPreviewProps {
  data: any;
  onClose: () => void;
  onPrint: () => void;
  printing?: boolean;
}

export function KotPreviewModal({ data, onClose, onPrint, printing = false }: KotPreviewProps) {
  return (
    <DialogShell
      ariaLabel="KOT preview"
      className={styles.modalDialogMedium}
      onClose={printing ? undefined : onClose}
    >
      <h3 className={styles.modalTitle}>KOT Preview</h3>
      <div className={styles.modalGrid}>
        <div className={styles.kotList}>
          <div className={styles.kotHead}>
            <span>Item</span>
            <span>Qty</span>
          </div>
          {(data.voidItems || []).length > 0 && <div className={styles.kotSection}>Stop</div>}
          {(data.voidItems || []).map((it: any, idx: number) => (
            <div key={`void-${idx}`} className={styles.kotItem}>
              <div className={styles.kotItemTitle}>{it.name}</div>
              <span className={styles.kotQty}>{it.qty}</span>
            </div>
          ))}
          {(data.items || []).length > 0 && (data.voidItems || []).length > 0 && (
            <div className={styles.kotSection}>Make</div>
          )}
          {(data.items || []).map((it: any, idx: number) => (
            <div key={idx} className={styles.kotItem}>
              <div className={styles.kotItemTitle}>{it.name}</div>
              <span className={styles.kotQty}>{it.qty}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn} disabled={printing}>
          Close
        </button>
        <button
          onClick={onPrint}
          disabled={printing}
          className={`${styles.actionBtn} ${styles.actionPrimary} ${styles.actionPrimaryLarge}`}
        >
          {printing ? "Printing..." : "Print KOT"}
        </button>
      </div>
    </DialogShell>
  );
}

// ── Void Sent KOT Modal ─────────────────────────────────────────────────────

interface KotVoidProps {
  itemName: string;
  voidQty: number;
  finalQty: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  processing?: boolean;
}

export function KotVoidModal({
  itemName,
  voidQty,
  finalQty,
  onClose,
  onConfirm,
  processing = false,
}: KotVoidProps) {
  const [preset, setPreset] = React.useState<string>(CANCEL_REASON_PRESETS[0]);
  const [otherText, setOtherText] = React.useState("");
  const cleanReason = resolveCancelReason(preset, otherText);
  return (
    <DialogShell
      ariaLabel="Void sent KOT item"
      className={styles.modalDialogMedium}
      onClose={processing ? undefined : onClose}
    >
      <h3 className={styles.modalTitle}>Void Sent KOT Item</h3>
      <p className={styles.modalPara}>
        This item has already been sent to the kitchen. The bill updates now. Send KOT when the
        changes are ready, and the kitchen gets them on one ticket.
      </p>
      <div className={styles.kotList}>
        <div className={styles.kotItem}>
          <div className={styles.kotItemTitle}>{itemName}</div>
          <div className={styles.textMuted}>
            Cancel x{voidQty}
            {finalQty > 0 ? `, keep x${finalQty}` : ""}
          </div>
        </div>
      </div>
      <label className={styles.modalLabel} style={{ marginTop: 14 }}>
        Reason
      </label>
      <div className={styles.kotList} style={{ marginTop: 8 }}>
        {CANCEL_REASON_PRESETS.map((option) => (
          <label
            key={option}
            className={`${styles.kotItem} ${styles.tableChoice} ${preset === option ? styles.tableChoiceSelected : ""}`}
          >
            <input
              type="radio"
              name="kot-void-reason"
              value={option}
              checked={preset === option}
              disabled={processing}
              onChange={() => setPreset(option)}
            />
            {option}
          </label>
        ))}
      </div>
      {preset === CANCEL_REASON_OTHER ? (
        <input
          value={otherText}
          onChange={(event) => setOtherText(event.target.value)}
          placeholder="Describe the reason"
          maxLength={TEXT_LIMITS.reason}
          autoFocus
          className={styles.modalInput}
          style={{ marginTop: 10 }}
          disabled={processing}
        />
      ) : null}
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn} disabled={processing}>
          Keep Item
        </button>
        <button
          onClick={() => onConfirm(cleanReason)}
          disabled={!cleanReason || processing}
          className={styles.btnDanger}
        >
          {processing ? "Saving..." : "Update bill"}
        </button>
      </div>
    </DialogShell>
  );
}

// ── New Takeaway Order Modal ────────────────────────────────────────────────

interface NewTakeawayProps {
  title?: string;
  name: string;
  phone: string;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onClose: () => void;
  onCreate: () => void;
  processing?: boolean;
  requiresCustomer?: boolean;
}

export function NewTakeawayModal({
  title = "Takeaway",
  name,
  phone,
  onNameChange,
  onPhoneChange,
  onClose,
  onCreate,
  processing = false,
  requiresCustomer = false,
}: NewTakeawayProps) {
  const hasCustomer = Boolean(name.trim() || phone.trim());
  const canCreate = !requiresCustomer || hasCustomer;

  const submit = () => {
    if (canCreate && !processing) {
      onCreate();
    }
  };

  return (
    <DialogShell
      ariaLabel="New takeaway order"
      className={styles.modalDialog}
      onClose={processing ? undefined : onClose}
    >
      <div className={styles.modalHeader}>
        <span style={{ fontSize: 28 }}></span>
        <h3 className={styles.modalTitle}>New {title} Order</h3>
      </div>
      <div>
        <label className={styles.modalLabel}>
          Customer Name
          {!requiresCustomer ? (
            <span style={{ color: "var(--pos-tx-muted)", fontWeight: 400 }}> (optional)</span>
          ) : null}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submit();
            }
            if (e.key === "Escape") {
              if (!processing) {
                onClose();
              }
            }
          }}
          placeholder="e.g. Priya, Walk-in 1…"
          maxLength={TEXT_LIMITS.personName}
          autoFocus
          className={styles.modalInput}
        />
        <p className={styles.textMuted}>
          {requiresCustomer
            ? "Enter a customer name or phone to start this order"
            : "You can leave this blank for anonymous counter orders"}
        </p>
        <label className={styles.modalLabel} style={{ marginTop: 14 }}>
          Customer Phone
          {!requiresCustomer ? (
            <span style={{ color: "var(--pos-tx-muted)", fontWeight: 400 }}> (optional)</span>
          ) : null}
        </label>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) =>
            onPhoneChange(normalizePhone(e.target.value).slice(0, TEXT_LIMITS.phoneStored))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submit();
            }
            if (e.key === "Escape") {
              if (!processing) {
                onClose();
              }
            }
          }}
          placeholder="e.g. 9876543210"
          maxLength={TEXT_LIMITS.phoneEntry}
          className={styles.modalInput}
        />
        {requiresCustomer ? <p className={styles.textMuted}>Name or phone is required</p> : null}
      </div>
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn} disabled={processing}>
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canCreate || processing}
          className={`${styles.btnPrimary} ${styles.modalShadowGreen}`}
        >
          Start Order →
        </button>
      </div>
    </DialogShell>
  );
}

// ── New Delivery Order Modal ────────────────────────────────────────────────

interface NewDeliveryProps {
  platform: string;
  onPlatformChange: (v: string) => void;
  code: string;
  onCodeChange: (v: string) => void;
  customerName: string;
  onCustomerNameChange: (v: string) => void;
  customerPhone: string;
  onCustomerPhoneChange: (v: string) => void;
  onClose: () => void;
  onCreate: () => void;
  processing?: boolean;
  requiresCustomer?: boolean;
}

export function NewDeliveryModal({
  platform,
  onPlatformChange,
  code,
  onCodeChange,
  customerName,
  onCustomerNameChange,
  customerPhone,
  onCustomerPhoneChange,
  onClose,
  onCreate,
  processing = false,
  requiresCustomer = false,
}: NewDeliveryProps) {
  // Track whether a preset button is selected vs. a custom name
  const presets = ["Swiggy", "Zomato"] as const;
  const isPreset = presets.includes(platform as any);
  const [customName, setCustomName] = React.useState(isPreset ? "" : platform);
  const hasCustomer = Boolean(customerName.trim() || customerPhone.trim());
  const canCreate =
    (isPreset || customName.trim().length > 0) && (!requiresCustomer || hasCustomer);

  const handlePreset = (p: string) => {
    onPlatformChange(p);
    setCustomName("");
  };

  const handleCustomChange = (val: string) => {
    setCustomName(val);
    onPlatformChange(val || "Other");
  };

  const submit = () => {
    if (canCreate && !processing) {
      onCreate();
    }
  };

  return (
    <DialogShell
      ariaLabel="New delivery order"
      className={styles.modalDialogMedium}
      onClose={processing ? undefined : onClose}
    >
      <div className={styles.modalHeader}>
        <span style={{ fontSize: 28 }}></span>
        <h3 className={styles.modalTitle}>New Delivery Order</h3>
      </div>
      <div className={styles.modalGrid}>
        <div>
          <label className={styles.modalLabel}>Platform</label>
          <div className={styles.platformGroup}>
            {(["Swiggy", "Zomato", "Other"] as const).map((p) => (
              <button
                key={p}
                onClick={() => (p === "Other" ? handlePreset("Other") : handlePreset(p))}
                disabled={processing}
                className={`${styles.platformBtn} ${
                  (p === "Other" ? !isPreset : platform === p)
                    ? p === "Swiggy"
                      ? styles.platformSwiggySelected
                      : p === "Zomato"
                        ? styles.platformZomatoSelected
                        : styles.platformOtherSelected
                    : ""
                }`}
              >
                {p === "Swiggy" ? " " : p === "Zomato" ? " " : " "}
                {p}
              </button>
            ))}
          </div>
          {!isPreset && (
            <input
              type="text"
              value={customName}
              onChange={(e) => handleCustomChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submit();
                }
                if (e.key === "Escape") {
                  if (!processing) {
                    onClose();
                  }
                }
              }}
              placeholder="Platform name…"
              maxLength={CUSTOMER_NAME_LIMIT}
              autoFocus
              className={styles.modalInput}
              style={{ marginTop: 8 }}
            />
          )}
        </div>
        <div>
          <label className={styles.modalLabel}>
            Order Code{" "}
            <span style={{ color: "var(--pos-tx-muted)", fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                submit();
              }
              if (e.key === "Escape") {
                if (!processing) {
                  onClose();
                }
              }
            }}
            placeholder="e.g. ABC123"
            maxLength={PAYMENT_TXN_REF_LIMIT}
            autoFocus={isPreset}
            className={`${styles.modalInput} ${styles.monoInput}`}
          />
        </div>
        <div>
          <label className={styles.modalLabel}>
            Customer Name
            {!requiresCustomer ? (
              <span style={{ color: "var(--pos-tx-muted)", fontWeight: 400 }}> (optional)</span>
            ) : null}
          </label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => onCustomerNameChange(e.target.value)}
            placeholder="e.g. Priya"
            maxLength={CUSTOMER_NAME_LIMIT}
            className={styles.modalInput}
          />
        </div>
        <div>
          <label className={styles.modalLabel}>
            Customer Phone
            {!requiresCustomer ? (
              <span style={{ color: "var(--pos-tx-muted)", fontWeight: 400 }}> (optional)</span>
            ) : null}
          </label>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={customerPhone}
            onChange={(e) =>
              onCustomerPhoneChange(normalizePhone(e.target.value).slice(0, CUSTOMER_PHONE_LIMIT))
            }
            placeholder="e.g. 9876543210"
            maxLength={TEXT_LIMITS.phoneEntry}
            className={styles.modalInput}
          />
          {requiresCustomer ? (
            <p className={styles.textMuted} style={{ marginTop: 8 }}>
              Name or phone is required to start
            </p>
          ) : null}
        </div>
      </div>
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn} disabled={processing}>
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canCreate || processing}
          className={`${styles.btnPrimary} ${styles.modalShadowPurple}`}
        >
          Start Order →
        </button>
      </div>
    </DialogShell>
  );
}

// ── Assign Rider Modal ──────────────────────────────────────────────────────

interface AssignRiderProps {
  riderName: string;
  riderPhone: string;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  processing?: boolean;
}

export function AssignRiderModal({
  riderName,
  riderPhone,
  onNameChange,
  onPhoneChange,
  onClose,
  onConfirm,
  processing = false,
}: AssignRiderProps) {
  return (
    <DialogShell
      ariaLabel="Assign rider"
      className={styles.modalDialog}
      onClose={processing ? undefined : onClose}
    >
      <h3 className={styles.modalTitle}>Assign Rider</h3>
      <div className={styles.modalGrid}>
        <div>
          <label className={styles.modalLabel}>Rider Name</label>
          <input
            type="text"
            value={riderName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Rajan"
            maxLength={TEXT_LIMITS.personName}
            autoFocus
            className={styles.modalInput}
          />
        </div>
        <div>
          <label className={styles.modalLabel}>Rider Phone</label>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={riderPhone}
            onChange={(e) =>
              onPhoneChange(normalizePhone(e.target.value).slice(0, TEXT_LIMITS.phoneStored))
            }
            placeholder="e.g. 9876543210"
            maxLength={TEXT_LIMITS.phoneEntry}
            className={styles.modalInput}
          />
        </div>
      </div>
      <div className={styles.modalFooter}>
        <button onClick={onClose} className={styles.btn} disabled={processing}>
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={!riderName.trim() || processing}
          className={styles.btnPrimary}
        >
          {processing ? "Saving..." : "Assign"}
        </button>
      </div>
    </DialogShell>
  );
}

// ── Print Failed Modal ──────────────────────────────────────────────────────
// Blocking modal shown when payment succeeds but receipt printing fails.
// Requires explicit user action — cannot be dismissed by clicking outside.

interface PrintFailedProps {
  amount: string; // formatted amount already collected
  method: string; // e.g. "cash", "card", "upi"
  onRetry: () => void;
  onSkip: () => void; // "finish without receipt"
  processing?: boolean;
}

export function PrintFailedModal({
  amount,
  method,
  onRetry,
  onSkip,
  processing = false,
}: PrintFailedProps) {
  return (
    <DialogShell
      ariaLabel="Receipt print failed"
      className={styles.modalDialog}
      style={{ maxWidth: 420 }}
    >
      {/* Payment success banner */}
      <div
        style={{
          background: "var(--pos-success-tint)",
          border: "1.5px solid var(--pos-success-line)",
          borderRadius: 10,
          padding: "14px 18px",
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 28 }}></span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "var(--pos-success-text)" }}>
            Payment Recorded
          </div>
          <div style={{ fontSize: 13, color: "var(--pos-success)", marginTop: 2 }}>
            {amount} collected via {method}
          </div>
        </div>
      </div>

      {/* Print failure notice */}
      <div
        style={{
          background: "var(--pos-saffron-tint)",
          border: "1.5px solid var(--pos-saffron-line)",
          borderRadius: 10,
          padding: "14px 18px",
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 24 }}></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--pos-saffron-text)" }}>
            Receipt could not be printed
          </div>
          <div style={{ fontSize: 12, color: "var(--pos-saffron-deep)", marginTop: 2 }}>
            Check printer connection, then retry.
          </div>
        </div>
      </div>

      <div className={styles.modalFooter}>
        <button
          onClick={onSkip}
          disabled={processing}
          className={styles.btn}
          title="Payment is saved. Skip receipt and finish."
        >
          Finish (No Receipt)
        </button>
        <button onClick={onRetry} disabled={processing} className={styles.btnPrimary}>
          {processing ? "Printing..." : " Retry Print"}
        </button>
      </div>
    </DialogShell>
  );
}
