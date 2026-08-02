import React from "react";
import { normalizePhone } from "../../../../shared/validation";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import styles from "../Billing.module.css";

interface FormatCurrency {
  (v: number): string;
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
  return (
    <div className={styles.modalOverlay}>
      <div
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        style={style}
      >
        {children}
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

export function VariantPickerModal({ itemName, variants, onClose, onSelect }: VariantPickerModalProps) {
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
        <div style={{ marginTop: 12, borderTop: "1px dashed #e5e7eb", paddingTop: 10 }}>
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
  activeOrderType: string;
  onClose: () => void;
  onConfirm: () => void;
  processing?: boolean;
}

export function ConfirmCancelModal({
  tableNum,
  activeOrderType,
  onClose,
  onConfirm,
  processing = false,
}: ConfirmCancelProps) {
  return (
    <DialogShell
      ariaLabel="Cancel order confirmation"
      className={styles.modalDialogLarge}
      onClose={processing ? undefined : onClose}
    >
        <h3 className={styles.modalTitle}>Cancel Order?</h3>
        <p className={styles.modalPara}>
          This will clear all items for{" "}
          <strong>
            {tableNum
              ? `Table ${tableNum}`
              : activeOrderType === "delivery"
                ? "this delivery order"
                : "this order"}
          </strong>
          . The order will be marked as held.
        </p>
        <div className={styles.modalFooter}>
          <button onClick={onClose} className={styles.btn} disabled={processing}>
            No, Keep
          </button>
          <button onClick={onConfirm} className={styles.btnDanger} disabled={processing}>
            {processing ? "Cancelling..." : "Yes, Cancel"}
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
          <div className={styles.textMuted}>
            <div style={{ marginBottom: 8 }}>Items</div>
          </div>
          <div className={styles.kotList}>
            {data.items.map((it: any, idx: number) => (
              <div key={idx} className={styles.kotItem}>
                <div className={styles.kotItemTitle}>{it.name}</div>
                <div className={styles.textMuted}>x{it.qty}</div>
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

// ── New Takeaway Order Modal ────────────────────────────────────────────────

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
  const [reason, setReason] = React.useState("");
  const cleanReason = reason.trim();
  return (
    <DialogShell
      ariaLabel="Void sent KOT item"
      className={styles.modalDialogMedium}
      onClose={processing ? undefined : onClose}
    >
        <h3 className={styles.modalTitle}>Void Sent KOT Item</h3>
        <p className={styles.modalPara}>
          This item has already been sent to the kitchen. A void KOT will print before the bill is updated.
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
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Customer changed order"
          autoFocus
          className={styles.modalInput}
        />
        <div className={styles.modalFooter}>
          <button onClick={onClose} className={styles.btn} disabled={processing}>
            Keep Item
          </button>
          <button
            onClick={() => onConfirm(cleanReason)}
            disabled={!cleanReason || processing}
            className={styles.btnDanger}
          >
            {processing ? "Printing..." : "Print Void KOT"}
          </button>
        </div>
    </DialogShell>
  );
}

interface NewTakeawayProps {
  title?: string;
  name: string;
  phone: string;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onClose: () => void;
  onCreate: () => void;
  processing?: boolean;
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
}: NewTakeawayProps) {
  return (
    <DialogShell
      ariaLabel="New takeaway order"
      className={styles.modalDialog}
      onClose={processing ? undefined : onClose}
    >
        <div className={styles.modalHeader}>
          <span style={{ fontSize: 28 }}>🛍️</span>
          <h3 className={styles.modalTitle}>New {title} Order</h3>
        </div>
        <div>
          <label className={styles.modalLabel}>
            Customer Name <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (!processing) {
                  onCreate();
                }
}
              if (e.key === "Escape") {
                if (!processing) {
                  onClose();
                }
}
            }}
            placeholder="e.g. Priya, Walk-in 1…"
            autoFocus
            className={styles.modalInput}
          />
          <p className={styles.textMuted}>You can leave this blank for anonymous counter orders</p>
          <label className={styles.modalLabel} style={{ marginTop: 14 }}>
            Customer Phone <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => onPhoneChange(normalizePhone(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (!processing) {
                  onCreate();
                }
              }
              if (e.key === "Escape") {
                if (!processing) {
                  onClose();
                }
              }
            }}
            placeholder="e.g. 9876543210"
            className={styles.modalInput}
          />
        </div>
        <div className={styles.modalFooter}>
          <button onClick={onClose} className={styles.btn} disabled={processing}>
            Cancel
          </button>
          <button onClick={onCreate} disabled={processing} className={`${styles.btnPrimary} ${styles.modalShadowGreen}`}>
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
}: NewDeliveryProps) {
  // Track whether a preset button is selected vs. a custom name
  const presets = ["Swiggy", "Zomato"] as const;
  const isPreset = presets.includes(platform as any);
  const [customName, setCustomName] = React.useState(isPreset ? "" : platform);
  const canCreate = isPreset || customName.trim().length > 0;

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
          <span style={{ fontSize: 28 }}>🚚</span>
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
                  {p === "Swiggy" ? "🟠 " : p === "Zomato" ? "🔴 " : "📦 "}
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
                autoFocus
                className={styles.modalInput}
                style={{ marginTop: 8 }}
              />
            )}
          </div>
          <div>
            <label className={styles.modalLabel}>
              Order Code <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span>
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
              placeholder="e.g. #ABC123"
              autoFocus
              className={`${styles.modalInput} ${styles.monoInput}`}
            />
          </div>
          <div>
            <label className={styles.modalLabel}>
              Customer Name <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => onCustomerNameChange(e.target.value)}
              placeholder="e.g. Priya"
              className={styles.modalInput}
            />
          </div>
          <div>
            <label className={styles.modalLabel}>
              Customer Phone <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={customerPhone}
              onChange={(e) => onCustomerPhoneChange(normalizePhone(e.target.value))}
              placeholder="e.g. 9876543210"
              className={styles.modalInput}
            />
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
              onChange={(e) => onPhoneChange(normalizePhone(e.target.value))}
              placeholder="e.g. 9876543210"
              className={styles.modalInput}
            />
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button onClick={onClose} className={styles.btn} disabled={processing}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!riderName.trim() || processing} className={styles.btnPrimary}>
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

export function PrintFailedModal({ amount, method, onRetry, onSkip, processing = false }: PrintFailedProps) {
  return (
    <DialogShell
      ariaLabel="Receipt print failed"
      className={styles.modalDialog}
      style={{ maxWidth: 420 }}
    >
        {/* Payment success banner */}
        <div
          style={{
            background: "#f0fdf4",
            border: "1.5px solid #86efac",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 28 }}>✅</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#166534" }}>Payment Recorded</div>
            <div style={{ fontSize: 13, color: "#15803d", marginTop: 2 }}>
              {amount} collected via {method}
            </div>
          </div>
        </div>

        {/* Print failure notice */}
        <div
          style={{
            background: "#fff7ed",
            border: "1.5px solid #fdba74",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 24 }}>🖨️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#9a3412" }}>
              Receipt could not be printed
            </div>
            <div style={{ fontSize: 12, color: "#c2410c", marginTop: 2 }}>
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
            {processing ? "Printing..." : "🖨 Retry Print"}
          </button>
        </div>
    </DialogShell>
  );
}

