import React from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { resolveCreditDueDate } from "../../shared/customerCredit";
import {
  isValidIndianMobile,
  isValidPersonName,
  normalizePhone,
  normalizeText,
  todayDateOnly,
  validationMessage,
} from "../../shared/validation";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import styles from "./PaymentsModal.module.css";

type SingleMethod = "cash" | "card" | "upi" | "voucher" | "other";
export type PaymentMethod = SingleMethod | "split" | "credit";

export interface PaymentConfirm {
  method: PaymentMethod;
  amountPaid: number;
  change?: number;
  txnRef?: string;
  splitBreakdown?: Array<{ method: SingleMethod; amount: number }>;
  printReceipt: boolean;
  dueDate?: string;
  customerId?: string | null;
}

export type CreditCustomerOption = {
  id: string;
  name: string;
  phone: string;
  outstanding?: number;
  creditLimit?: number;
  defaultCreditDays?: number | null;
  creditEnabled?: boolean;
  creditBlocked?: boolean;
};

interface SplitEntry {
  method: SingleMethod;
  amount: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  amount: number;
  onConfirm: (payment: PaymentConfirm) => void;
  processing?: boolean;
  forcePrintReceipt?: boolean;
  creditEnabled?: boolean;
  canManageCredit?: boolean;
  restaurantDefaultCreditDays?: number;
  orderCustomerId?: string | null;
  customers?: CreditCustomerOption[];
  onCustomersChanged?: (customers: CreditCustomerOption[]) => void;
}

const SINGLE_METHODS: SingleMethod[] = ["cash", "card", "upi", "voucher", "other"];

const QUICK_PAY: { method: SingleMethod; label: string; icon: string; shortcut: string }[] = [
  { method: "cash", label: "Cash", icon: "C", shortcut: "1" },
  { method: "card", label: "Card", icon: "R", shortcut: "2" },
  { method: "upi", label: "UPI", icon: "U", shortcut: "3" },
  { method: "other", label: "Other", icon: "O", shortcut: "4" },
];

export default function PaymentsModal({
  open,
  onClose,
  amount,
  onConfirm,
  processing = false,
  forcePrintReceipt = false,
  creditEnabled = false,
  canManageCredit = false,
  restaurantDefaultCreditDays = 15,
  orderCustomerId = null,
  customers = [],
  onCustomersChanged,
}: Props) {
  const [expanded, setExpanded] = React.useState(false);
  const [method, setMethod] = React.useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = React.useState<string>("");
  const [txnRef, setTxnRef] = React.useState<string>("");
  const [shouldPrintReceipt, setShouldPrintReceipt] = React.useState(false);
  const [splits, setSplits] = React.useState<[SplitEntry, SplitEntry]>([
    { method: "cash", amount: "" },
    { method: "upi", amount: "" },
  ]);
  const [creditCustomerId, setCreditCustomerId] = React.useState<string>("");
  const [creditDueDate, setCreditDueDate] = React.useState<string>(todayDateOnly());
  const [dueDateOverridden, setDueDateOverridden] = React.useState(false);
  const [showDueDateChange, setShowDueDateChange] = React.useState(false);
  const [customerSearch, setCustomerSearch] = React.useState("");
  const [localCustomers, setLocalCustomers] = React.useState<CreditCustomerOption[]>(customers);
  const [showNewCustomer, setShowNewCustomer] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newPhone, setNewPhone] = React.useState("");
  const [newLimit, setNewLimit] = React.useState("");
  const [newError, setNewError] = React.useState<string | null>(null);
  const [savingCustomer, setSavingCustomer] = React.useState(false);
  const [inlineLimit, setInlineLimit] = React.useState("");
  const [savingCreditSetup, setSavingCreditSetup] = React.useState(false);
  const [creditSetupError, setCreditSetupError] = React.useState<string | null>(null);

  const syncCustomers = React.useCallback(
    (next: CreditCustomerOption[]) => {
      setLocalCustomers(next);
      onCustomersChanged?.(next);
    },
    [onCustomersChanged],
  );

  const wasOpenRef = React.useRef(false);

  // Reset only when the modal opens — not when customers update mid-flow (e.g. Enable credit).
  React.useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) {
      return;
    }
    setExpanded(false);
    setMethod("cash");
    setCashReceived(String(amount));
    setTxnRef("");
    setShouldPrintReceipt(forcePrintReceipt);
    setSplits([
      { method: "cash", amount: String(amount) },
      { method: "upi", amount: "0" },
    ]);
    setCreditCustomerId(orderCustomerId || "");
    setCustomerSearch("");
    setLocalCustomers(customers);
    setShowNewCustomer(false);
    setNewName("");
    setNewPhone("");
    setNewLimit(String(Math.max(Math.ceil(amount), 1000)));
    setNewError(null);
    setInlineLimit(String(Math.max(Math.ceil(amount), 1000)));
    setCreditSetupError(null);
    setDueDateOverridden(false);
    setShowDueDateChange(false);
    const selected = customers.find((c) => c.id === (orderCustomerId || ""));
    setCreditDueDate(
      resolveCreditDueDate({
        customerDefaultDays: selected?.defaultCreditDays ?? null,
        restaurantDefaultDays: restaurantDefaultCreditDays,
      }),
    );
  }, [open, amount, forcePrintReceipt, orderCustomerId, customers, restaurantDefaultCreditDays]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    setLocalCustomers(customers);
  }, [customers, open]);

  React.useEffect(() => {
    if (method !== "credit") {
      return;
    }
    const selected = localCustomers.find((c) => c.id === creditCustomerId);
    if (!dueDateOverridden) {
      setCreditDueDate(
        resolveCreditDueDate({
          customerDefaultDays: selected?.defaultCreditDays ?? null,
          restaurantDefaultDays: restaurantDefaultCreditDays,
        }),
      );
    }
    if (selected) {
      const selectedLimit = Number(selected.creditLimit || 0);
      const selectedOutstanding = Number(selected.outstanding || 0);
      const selectedAvailable = Math.max(0, selectedLimit - selectedOutstanding);
      const needsHigherLimit =
        selectedLimit > 0 && Boolean(selected.creditEnabled) && amount > selectedAvailable + 0.0001;
      setInlineLimit(
        String(
          needsHigherLimit
            ? Math.max(Math.ceil(selectedOutstanding + amount), selectedLimit)
            : selectedLimit > 0
              ? selectedLimit
              : Math.max(Math.ceil(amount), 1000),
        ),
      );
      setCreditSetupError(null);
    }
  }, [
    method,
    creditCustomerId,
    localCustomers,
    restaurantDefaultCreditDays,
    amount,
    dueDateOverridden,
  ]);

  React.useEffect(() => {
    if (forcePrintReceipt) {
      setShouldPrintReceipt(true);
    }
  }, [forcePrintReceipt]);

  const effectivePrintReceipt = forcePrintReceipt || shouldPrintReceipt;

  const cashInputRef = React.useRef<HTMLInputElement>(null);
  const quickPayDialogRef = useFocusTrap<HTMLDivElement>(open && !expanded);
  const detailedPayDialogRef = useFocusTrap<HTMLDivElement>(open && expanded);
  React.useEffect(() => {
    if (open && expanded && method === "cash") {
      setTimeout(() => cashInputRef.current?.select(), 60);
    }
  }, [open, expanded, method]);

  const isCreditReady = React.useCallback(
    (c: CreditCustomerOption) =>
      Boolean(c.creditEnabled) && !c.creditBlocked && Number(c.creditLimit || 0) > 0,
    [],
  );

  const creditSearchMatches = React.useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    return localCustomers.filter((c) => {
      if (!q) {
        return true;
      }
      return `${c.name} ${c.phone}`.toLowerCase().includes(q);
    });
  }, [localCustomers, customerSearch]);

  const filteredCreditCustomers = React.useMemo(() => {
    return creditSearchMatches
      .filter(isCreditReady)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [creditSearchMatches, isCreditReady]);

  const unmatchedCreditSearch = React.useMemo(() => {
    const q = customerSearch.trim();
    if (!q || filteredCreditCustomers.length > 0) {
      return null as CreditCustomerOption | null;
    }
    const notReady = creditSearchMatches.filter((c) => !isCreditReady(c));
    if (notReady.length === 0) {
      return null;
    }
    // Prefer exact phone / name hits so the message is specific.
    const exact =
      notReady.find((c) => c.phone === normalizePhone(q)) ||
      notReady.find((c) => c.name.toLowerCase() === q.toLowerCase()) ||
      notReady[0];
    return exact;
  }, [customerSearch, filteredCreditCustomers.length, creditSearchMatches, isCreditReady]);

  if (!open) {
    return null;
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const numCash = parseFloat(cashReceived) || 0;
  const change = method === "cash" ? Math.max(0, +(numCash - amount).toFixed(2)) : 0;

  const splitA = parseFloat(splits[0].amount) || 0;
  const splitB = parseFloat(splits[1].amount) || 0;
  const splitTotal = +(splitA + splitB).toFixed(2);
  const splitBalance = +(amount - splitTotal).toFixed(2);
  const splitExact = Math.abs(splitBalance) < 0.01;

  const creditCustomer = localCustomers.find((c) => c.id === creditCustomerId) || null;
  const creditOutstanding = Number(creditCustomer?.outstanding || 0);
  const creditLimit = Number(creditCustomer?.creditLimit || 0);
  const availableCredit = Math.max(0, creditLimit - creditOutstanding);
  const creditNeedsSetup =
    Boolean(creditCustomer) &&
    !creditCustomer?.creditBlocked &&
    (!creditCustomer?.creditEnabled || creditLimit <= 0);
  const creditOk =
    Boolean(creditCustomerId) &&
    Boolean(creditCustomer?.creditEnabled) &&
    !creditCustomer?.creditBlocked &&
    creditLimit > 0 &&
    amount <= availableCredit + 0.0001;

  const creditTermDays =
    creditCustomer?.defaultCreditDays === null || creditCustomer?.defaultCreditDays === undefined
      ? restaurantDefaultCreditDays
      : Number(creditCustomer.defaultCreditDays);
  const creditTermSource =
    creditCustomer?.defaultCreditDays === null || creditCustomer?.defaultCreditDays === undefined
      ? "restaurant default"
      : "customer terms";
  const formatDueLabel = (dateOnly: string) => {
    const [y, m, d] = dateOnly.split("-").map(Number);
    if (!y || !m || !d) {
      return dateOnly;
    }
    return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const canConfirm =
    !processing &&
    !savingCustomer &&
    !savingCreditSetup &&
    (method === "cash"
      ? numCash >= amount
      : method === "split"
        ? splitExact
        : method === "credit"
          ? creditOk
          : true);

  const mapCustomerOption = (row: any): CreditCustomerOption => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    outstanding: Number(row.outstanding || 0),
    creditLimit: Number(row.creditLimit || 0),
    defaultCreditDays: row.defaultCreditDays ?? null,
    creditEnabled: Boolean(row.creditEnabled),
    creditBlocked: Boolean(row.creditBlocked),
  });

  const upsertLocalCustomer = (row: any) => {
    const mapped = mapCustomerOption(row);
    const next = [mapped, ...localCustomers.filter((c) => c.id !== mapped.id)];
    syncCustomers(next);
    return mapped;
  };

  const createCustomerWithCredit = async () => {
    setNewError(null);
    const name = normalizeText(newName);
    const phone = normalizePhone(newPhone);
    if (!isValidPersonName(name)) {
      setNewError(validationMessage("customer-name-invalid"));
      return;
    }
    if (!isValidIndianMobile(phone)) {
      setNewError(validationMessage("customer-phone-invalid"));
      return;
    }
    if (canManageCredit) {
      const limit = Number(newLimit || 0);
      if (!Number.isFinite(limit) || limit <= 0) {
        setNewError("Enter a credit limit above ₹0");
        return;
      }
    }
    setSavingCustomer(true);
    try {
      const created = await window.pos!.customers!.create(
        canManageCredit
          ? {
              name,
              phone,
              creditEnabled: true,
              creditLimit: Number(newLimit || 0),
              defaultCreditDays: null,
            }
          : { name, phone },
      );
      const mapped = upsertLocalCustomer(created);
      setCreditCustomerId(mapped.id);
      setCustomerSearch("");
      setShowNewCustomer(false);
      setNewName("");
      setNewPhone("");
      setNewError(null);
      setDueDateOverridden(false);
      setShowDueDateChange(false);
    } catch (e: any) {
      setNewError(validationMessage(e, "Could not create customer"));
    } finally {
      setSavingCustomer(false);
    }
  };

  const enableCreditForSelected = async () => {
    if (!creditCustomer || !canManageCredit) {
      return;
    }
    setCreditSetupError(null);
    const limit = Number(inlineLimit || 0);
    if (!Number.isFinite(limit) || limit <= 0) {
      setCreditSetupError("Enter a credit limit above ₹0");
      return;
    }
    setSavingCreditSetup(true);
    try {
      const updated = await window.pos!.customers!.update(creditCustomer.id, {
        creditEnabled: true,
        creditLimit: limit,
        creditBlocked: false,
      });
      upsertLocalCustomer(
        updated || { ...creditCustomer, creditEnabled: true, creditLimit: limit },
      );
    } catch (e: any) {
      setCreditSetupError(validationMessage(e, "Could not enable credit"));
    } finally {
      setSavingCreditSetup(false);
    }
  };

  // ── Quick pay — instant confirm with exact amount ──────────────────────────
  const quickPay = (m: SingleMethod) => {
    if (processing) {
      return;
    }
    onConfirm({ method: m, amountPaid: amount, printReceipt: effectivePrintReceipt });
  };

  // ── Detailed confirm ───────────────────────────────────────────────────────
  const handleConfirm = () => {
    if (!canConfirm || processing) {
      return;
    }
    if (method === "cash") {
      onConfirm({ method, amountPaid: numCash, change, printReceipt: effectivePrintReceipt });
    } else if (method === "split") {
      onConfirm({
        method,
        amountPaid: amount,
        splitBreakdown: splits.map((e) => ({
          method: e.method,
          amount: parseFloat(e.amount) || 0,
        })),
        printReceipt: effectivePrintReceipt,
      });
    } else if (method === "credit") {
      onConfirm({
        method: "credit",
        amountPaid: 0,
        customerId: creditCustomerId,
        dueDate: creditDueDate,
        printReceipt: effectivePrintReceipt,
      });
    } else {
      onConfirm({
        method,
        amountPaid: amount,
        txnRef: txnRef.trim() || undefined,
        printReceipt: effectivePrintReceipt,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (processing) {
        return;
      }
      onClose();
      return;
    }
    // In quick-pay view, number keys trigger instant payment
    if (!expanded && (e.target as HTMLElement)?.tagName !== "INPUT") {
      const qp = QUICK_PAY.find((q) => q.shortcut === e.key);
      if (qp) {
        e.preventDefault();
        quickPay(qp.method);
        return;
      }
    }
    if (e.key === "Enter" && expanded && canConfirm) {
      handleConfirm();
    }
  };

  const handleSplitChange = (idx: 0 | 1, val: string) => {
    const updated: [SplitEntry, SplitEntry] = [{ ...splits[0] }, { ...splits[1] }];
    updated[idx] = { ...updated[idx], amount: val };
    if (idx === 0) {
      const remainder = Math.max(0, +(amount - (parseFloat(val) || 0)).toFixed(2));
      updated[1] = { ...updated[1], amount: String(remainder) };
    }
    setSplits(updated);
  };

  // ── Styles ─────────────────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1.5px solid var(--pos-line-strong)",
    borderRadius: 8,
    fontSize: 15,
    boxSizing: "border-box",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--pos-tx-sub)",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };

  const methodBtn = (active: boolean): React.CSSProperties => ({
    padding: "10px 6px",
    border: active ? "2px solid var(--pos-saffron-text)" : "1.5px solid var(--pos-line)",
    borderRadius: 8,
    background: active ? "var(--pos-saffron-tint)" : "var(--pos-surface)",
    color: active ? "var(--pos-saffron-text)" : "var(--pos-tx-sec)",
    fontWeight: active ? 700 : 500,
    fontSize: 13,
    cursor: "pointer",
    transition: "all 0.1s",
    textAlign: "center" as const,
  });

  // ── Quick-pay view (default) ───────────────────────────────────────────────
  if (!expanded) {
    return (
      <div
        onKeyDown={handleKeyDown}
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--pos-overlay)",
          zIndex: 3000,
        }}
      >
        <div
          ref={quickPayDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Collect Payment"
          tabIndex={-1}
          style={{
            width: 440,
            maxWidth: "96vw",
            background: "var(--pos-surface)",
            borderRadius: 16,
            boxShadow: "var(--pos-shadow-overlay)",
            overflow: "hidden",
          }}
        >
          {/* Header with amount */}
          <div
            style={{
              padding: "20px 24px 16px",
              borderBottom: "1px solid var(--pos-surface-sunken)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--pos-tx-muted)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Amount Due
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 900,
                  color: "var(--pos-tx)",
                  lineHeight: 1.1,
                  marginTop: 4,
                }}
              >
                ₹{amount.toFixed(2)}
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={processing}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                fontSize: 22,
                cursor: processing ? "not-allowed" : "pointer",
                color: "var(--pos-tx-muted)",
                lineHeight: 1,
                padding: "0 4px",
              }}
            >
              ×
            </button>
          </div>

          {/* Quick-pay buttons */}
          <div style={{ padding: "20px 24px" }}>
            <div
              style={{
                fontSize: 12,
                color: "var(--pos-tx-sub)",
                fontWeight: 600,
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Tap to settle full amount
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 10,
              }}
            >
              {QUICK_PAY.map((qp) => (
                <button
                  key={qp.method}
                  onClick={() => quickPay(qp.method)}
                  disabled={processing}
                  style={{
                    padding: "18px 8px 14px",
                    border: "1.5px solid var(--pos-line)",
                    borderRadius: 12,
                    background: "var(--pos-surface)",
                    cursor: processing ? "not-allowed" : "pointer",
                    opacity: processing ? 0.6 : 1,
                    transition: "all 0.12s",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--pos-success)";
                    e.currentTarget.style.background = "var(--pos-success-tint)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--pos-line)";
                    e.currentTarget.style.background = "var(--pos-surface)";
                  }}
                >
                  <span style={{ fontSize: 28 }}>{qp.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--pos-tx)" }}>
                    {qp.label}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--pos-tx-muted)", fontWeight: 600 }}>
                    [{qp.shortcut}]
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* More options link */}
          <div
            style={{
              padding: "12px 24px 18px",
              borderTop: "1px solid var(--pos-surface-sunken)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                fontSize: 13,
                color: "var(--pos-tx-sec)",
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={effectivePrintReceipt}
                onChange={(e) => setShouldPrintReceipt(e.target.checked)}
                disabled={processing || forcePrintReceipt}
                style={{ width: 15, height: 15, cursor: processing ? "not-allowed" : "pointer" }}
              />
              {forcePrintReceipt ? "Print receipt (required by mode)" : "Print receipt"}
            </label>
            <button
              onClick={() => setExpanded(true)}
              disabled={processing}
              style={{
                background: "none",
                border: "none",
                color: "var(--pos-tx-sub)",
                fontSize: 13,
                fontWeight: 600,
                cursor: processing ? "not-allowed" : "pointer",
                padding: 0,
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              Custom amount, Split, or Voucher →
            </button>
            <button
              onClick={onClose}
              disabled={processing}
              style={{
                padding: "8px 16px",
                background: "transparent",
                color: "var(--pos-tx-sub)",
                border: "1.5px solid var(--pos-line)",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 13,
                cursor: processing ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Expanded / detailed view ───────────────────────────────────────────────
  return (
    <div
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--pos-overlay)",
        zIndex: 3000,
      }}
    >
      <div
        ref={detailedPayDialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Collect Payment"
        tabIndex={-1}
        className={styles.dialog}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--pos-surface-sunken)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => setExpanded(false)}
              disabled={processing}
              aria-label="Back to quick pay"
              style={{
                background: "none",
                border: "none",
                fontSize: 18,
                cursor: processing ? "not-allowed" : "pointer",
                color: "var(--pos-tx-sub)",
                padding: "0 4px",
              }}
            >
              ←
            </button>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--pos-tx)" }}>
              Settle Bill
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={processing}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              cursor: processing ? "not-allowed" : "pointer",
              color: "var(--pos-tx-muted)",
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        {/* ── Body ── */}
        <div className={styles.bodyRow}>
          {/* Left: method + inputs */}
          <div className={styles.mainCol}>
            {/* Method grid */}
            <label style={labelStyle}>Payment Method</label>
            <div className={styles.methodGrid}>
              {(
                (creditEnabled
                  ? ["cash", "card", "upi", "split", "voucher", "other", "credit"]
                  : ["cash", "card", "upi", "split", "voucher", "other"]) as PaymentMethod[]
              ).map((m) => (
                <button
                  key={m}
                  style={{ ...methodBtn(method === m), opacity: processing ? 0.6 : 1 }}
                  onClick={() => setMethod(m)}
                  disabled={processing}
                >
                  {m === "cash"
                    ? "Cash"
                    : m === "card"
                      ? "Card"
                      : m === "upi"
                        ? "UPI"
                        : m === "split"
                          ? "Split"
                          : m === "voucher"
                            ? "Voucher"
                            : m === "credit"
                              ? "Credit"
                              : "Other"}
                </button>
              ))}
            </div>

            {method === "credit" && (
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {!creditCustomer && !showNewCustomer && (
                  <>
                    <div className="ui-field-row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Input
                          label="Customer"
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          placeholder="Search name or phone"
                          disabled={processing || savingCustomer}
                          autoFocus
                        />
                      </div>
                      <div className="ui-field-row-action">
                        <span className="ui-label-spacer" aria-hidden>
                          .
                        </span>
                        <Button
                          type="button"
                          variant="accent"
                          size="sm"
                          disabled={processing || savingCustomer}
                          onClick={() => {
                            setShowNewCustomer(true);
                            setNewError(null);
                            const q = customerSearch.trim();
                            if (q) {
                              if (/^\d/.test(q)) {
                                setNewPhone(q);
                              } else {
                                setNewName(q);
                              }
                            }
                          }}
                        >
                          New customer
                        </Button>
                        <div className="ui-field-error" aria-hidden />
                      </div>
                    </div>
                    <div
                      style={{
                        border: "1.5px solid var(--pos-line-strong)",
                        borderRadius: 8,
                        background: "var(--pos-surface)",
                        overflow: "hidden",
                      }}
                    >
                      {filteredCreditCustomers.map((c) => {
                        const creditLeft = Math.max(
                          0,
                          Number(c.creditLimit || 0) - Number(c.outstanding || 0),
                        );
                        const owed = Number(c.outstanding || 0);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={processing || savingCustomer || savingCreditSetup}
                            onClick={() => {
                              setCreditCustomerId(c.id);
                              setCustomerSearch("");
                              setDueDateOverridden(false);
                              setShowDueDateChange(false);
                            }}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              padding: "10px 12px",
                              border: "none",
                              borderBottom: "1px solid var(--pos-surface-sunken)",
                              background: "transparent",
                              cursor: processing ? "not-allowed" : "pointer",
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--pos-tx)" }}>
                              {c.name}
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontWeight: 600,
                                  color: "var(--pos-tx-sub)",
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {c.phone}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--pos-tx-muted)",
                                marginTop: 2,
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              Credit left ₹{creditLeft.toFixed(0)}
                              {owed > 0 ? ` · owed ₹${owed.toFixed(0)}` : ""}
                            </div>
                          </button>
                        );
                      })}
                      {localCustomers.length === 0 && (
                        <div style={{ padding: 12, fontSize: 13, color: "var(--pos-tx-sub)" }}>
                          No customers yet. Add one to continue.
                        </div>
                      )}
                      {localCustomers.length > 0 &&
                        filteredCreditCustomers.length === 0 &&
                        !customerSearch.trim() && (
                          <div style={{ padding: 12, fontSize: 13, color: "var(--pos-tx-sub)" }}>
                            No credit-ready customers yet. Enable a limit on Customers
                            {canManageCredit ? ", or create one with a limit here." : "."}
                          </div>
                        )}
                      {localCustomers.length > 0 &&
                        filteredCreditCustomers.length === 0 &&
                        Boolean(customerSearch.trim()) &&
                        unmatchedCreditSearch && (
                          <div style={{ padding: 12, fontSize: 13, color: "var(--pos-tx-sub)" }}>
                            <div
                              style={{ fontWeight: 700, color: "var(--pos-tx)", marginBottom: 4 }}
                            >
                              {unmatchedCreditSearch.name}{" "}
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: "var(--pos-tx-sub)",
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {unmatchedCreditSearch.phone}
                              </span>
                            </div>
                            {unmatchedCreditSearch.creditBlocked
                              ? "Credit is blocked for this customer."
                              : canManageCredit
                                ? "Not credit-ready yet — select to set a limit."
                                : "Not credit-ready. Ask a manager to enable a credit limit on Customers."}
                            {canManageCredit && !unmatchedCreditSearch.creditBlocked ? (
                              <div style={{ marginTop: 8 }}>
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="sm"
                                  disabled={processing || savingCustomer || savingCreditSetup}
                                  onClick={() => {
                                    setCreditCustomerId(unmatchedCreditSearch.id);
                                    setCustomerSearch("");
                                    setDueDateOverridden(false);
                                    setShowDueDateChange(false);
                                  }}
                                >
                                  Select to enable
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        )}
                      {localCustomers.length > 0 &&
                        filteredCreditCustomers.length === 0 &&
                        Boolean(customerSearch.trim()) &&
                        !unmatchedCreditSearch && (
                          <div style={{ padding: 12, fontSize: 13, color: "var(--pos-tx-sub)" }}>
                            No match for “{customerSearch.trim()}”.{" "}
                            <button
                              type="button"
                              onClick={() => {
                                setShowNewCustomer(true);
                                const q = customerSearch.trim();
                                if (/^\d/.test(q)) {
                                  setNewPhone(q);
                                } else {
                                  setNewName(q);
                                }
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                color: "var(--pos-teal)",
                                fontWeight: 700,
                                cursor: "pointer",
                                fontSize: 13,
                              }}
                            >
                              Add as new customer
                            </button>
                          </div>
                        )}
                    </div>
                  </>
                )}

                {showNewCustomer && (
                  <div
                    style={{
                      padding: 12,
                      border: "1.5px solid var(--pos-line-strong)",
                      borderRadius: 8,
                      background: "var(--pos-surface-hover)",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13 }}>New customer</div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={processing || savingCustomer}
                        onClick={() => {
                          setShowNewCustomer(false);
                          setNewError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                    <Input
                      label="Name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      disabled={processing || savingCustomer}
                      autoFocus
                    />
                    <Input
                      label="Phone"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      inputMode="tel"
                      disabled={processing || savingCustomer}
                    />
                    {canManageCredit ? (
                      <>
                        <Input
                          label="Credit limit (₹)"
                          type="number"
                          min={1}
                          step="1"
                          value={newLimit}
                          onChange={(e) => setNewLimit(e.target.value)}
                          disabled={processing || savingCustomer}
                        />
                        <div style={{ fontSize: 12, color: "var(--pos-tx-sub)" }}>
                          Due in {restaurantDefaultCreditDays} days (restaurant default). Applies to
                          new bills only.
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--pos-tx-sub)" }}>
                        Creates the customer contact only. A manager must enable credit on Customers
                        before this bill can go on account.
                      </div>
                    )}
                    {newError ? (
                      <div style={{ color: "var(--pos-danger)", fontSize: 13, fontWeight: 600 }}>
                        {newError}
                      </div>
                    ) : null}
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      loading={savingCustomer}
                      disabled={processing}
                      onClick={createCustomerWithCredit}
                    >
                      Create & select
                    </Button>
                  </div>
                )}

                {creditCustomer && !showNewCustomer && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      border: "1.5px solid var(--pos-line-strong)",
                      background: "var(--pos-surface-hover)",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        alignItems: "flex-start",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--pos-tx)" }}>
                          {creditCustomer.name}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--pos-tx-sub)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {creditCustomer.phone}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={processing}
                        onClick={() => {
                          setCreditCustomerId("");
                          setCustomerSearch("");
                          setDueDateOverridden(false);
                          setShowDueDateChange(false);
                        }}
                      >
                        Change
                      </Button>
                    </div>
                    {!creditNeedsSetup && !creditCustomer.creditBlocked && (
                      <div style={{ fontSize: 13, color: "var(--pos-tx-sec)" }}>
                        Credit left ₹{availableCredit.toFixed(0)} · Outstanding ₹
                        {creditOutstanding.toFixed(0)}
                      </div>
                    )}
                    {creditCustomer.creditBlocked && (
                      <div style={{ color: "var(--pos-danger)", fontWeight: 700, fontSize: 13 }}>
                        Credit blocked — unblock from Customers if needed
                      </div>
                    )}
                    {creditNeedsSetup && (
                      <div style={{ display: "grid", gap: 10 }}>
                        {canManageCredit ? (
                          <>
                            <div style={{ fontSize: 13, color: "var(--pos-tx-sec)" }}>
                              Set a credit limit to save this bill on account.
                            </div>
                            <Input
                              label="Credit limit (₹)"
                              type="number"
                              min={1}
                              step="1"
                              value={inlineLimit}
                              onChange={(e) => setInlineLimit(e.target.value)}
                              disabled={processing || savingCreditSetup}
                            />
                            {creditSetupError ? (
                              <div
                                style={{
                                  color: "var(--pos-danger)",
                                  fontSize: 13,
                                  fontWeight: 600,
                                }}
                              >
                                {creditSetupError}
                              </div>
                            ) : null}
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              loading={savingCreditSetup}
                              disabled={processing}
                              onClick={enableCreditForSelected}
                            >
                              Enable credit
                            </Button>
                          </>
                        ) : (
                          <div
                            style={{ color: "var(--pos-danger)", fontWeight: 700, fontSize: 13 }}
                          >
                            Credit is not enabled for this customer. Ask a manager to enable a limit
                            on Customers.
                          </div>
                        )}
                      </div>
                    )}
                    {!creditCustomer.creditBlocked &&
                      creditCustomer.creditEnabled &&
                      creditLimit > 0 &&
                      amount > availableCredit && (
                        <div style={{ display: "grid", gap: 10 }}>
                          <div
                            style={{ color: "var(--pos-danger)", fontWeight: 700, fontSize: 13 }}
                          >
                            Exceeds available credit (need ₹{amount.toFixed(0)}, available ₹
                            {availableCredit.toFixed(0)})
                          </div>
                          {canManageCredit ? (
                            <>
                              <Input
                                label="Raise credit limit (₹)"
                                type="number"
                                min={1}
                                step="1"
                                value={inlineLimit}
                                onChange={(e) => setInlineLimit(e.target.value)}
                                disabled={processing || savingCreditSetup}
                              />
                              {creditSetupError ? (
                                <div
                                  style={{
                                    color: "var(--pos-danger)",
                                    fontSize: 13,
                                    fontWeight: 600,
                                  }}
                                >
                                  {creditSetupError}
                                </div>
                              ) : null}
                              <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                loading={savingCreditSetup}
                                disabled={processing}
                                onClick={enableCreditForSelected}
                              >
                                Update limit
                              </Button>
                            </>
                          ) : (
                            <div style={{ fontSize: 13, color: "var(--pos-tx-sec)" }}>
                              Ask a manager to raise this customer&apos;s credit limit.
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                )}

                {creditCustomer && !showNewCustomer && (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: 13,
                        color: "var(--pos-tx-sec)",
                      }}
                    >
                      <span>
                        Due {formatDueLabel(creditDueDate)} · {creditTermDays} days (
                        {creditTermSource})
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={processing}
                        onClick={() => setShowDueDateChange((v) => !v)}
                      >
                        {showDueDateChange ? "Hide" : "Change"}
                      </Button>
                    </div>
                    {showDueDateChange && (
                      <input
                        type="date"
                        style={inputStyle}
                        value={creditDueDate}
                        onChange={(e) => {
                          setDueDateOverridden(true);
                          setCreditDueDate(e.target.value);
                        }}
                        disabled={processing}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Cash */}
            {method === "cash" && (
              <div>
                <label style={labelStyle}>Amount Received (₹)</label>
                <input
                  ref={cashInputRef}
                  type="number"
                  min={0}
                  step="1"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  style={{ ...inputStyle, fontSize: 22, fontWeight: 800 }}
                />
                {change > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "10px 14px",
                      background: "var(--pos-success-tint)",
                      border: "1.5px solid var(--pos-success-line)",
                      borderRadius: 8,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{ fontWeight: 600, color: "var(--pos-success-text)", fontSize: 14 }}
                    >
                      Change to return
                    </span>
                    <span
                      style={{ fontWeight: 900, color: "var(--pos-success-text)", fontSize: 22 }}
                    >
                      ₹{change.toFixed(2)}
                    </span>
                  </div>
                )}
                {numCash > 0 && numCash < amount && (
                  <div
                    style={{
                      marginTop: 8,
                      color: "var(--pos-danger)",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    ₹{(amount - numCash).toFixed(2)} still needed
                  </div>
                )}
              </div>
            )}

            {/* Card */}
            {method === "card" && (
              <div>
                <label style={labelStyle}>Transaction Ref (optional)</label>
                <input
                  type="text"
                  value={txnRef}
                  onChange={(e) => setTxnRef(e.target.value)}
                  placeholder="Last 4 digits or approval code"
                  style={inputStyle}
                  autoFocus
                />
                <p style={{ marginTop: 8, fontSize: 12, color: "var(--pos-tx-muted)" }}>
                  Full amount of ₹{amount.toFixed(2)} will be recorded.
                </p>
              </div>
            )}

            {/* UPI */}
            {method === "upi" && (
              <div>
                <label style={labelStyle}>UPI Transaction ID (optional)</label>
                <input
                  type="text"
                  value={txnRef}
                  onChange={(e) => setTxnRef(e.target.value)}
                  placeholder="e.g. UPI123456789012"
                  style={inputStyle}
                  autoFocus
                />
                <p style={{ marginTop: 8, fontSize: 12, color: "var(--pos-tx-muted)" }}>
                  Full amount of ₹{amount.toFixed(2)} will be recorded.
                </p>
              </div>
            )}

            {/* Voucher */}
            {method === "voucher" && (
              <div>
                <label style={labelStyle}>Voucher Code</label>
                <input
                  type="text"
                  value={txnRef}
                  onChange={(e) => setTxnRef(e.target.value)}
                  placeholder="Enter voucher code"
                  style={inputStyle}
                  autoFocus
                />
              </div>
            )}

            {/* Other */}
            {method === "other" && (
              <div>
                <label style={labelStyle}>Reference (optional)</label>
                <input
                  type="text"
                  value={txnRef}
                  onChange={(e) => setTxnRef(e.target.value)}
                  placeholder="Reference number or note"
                  style={inputStyle}
                  autoFocus
                />
              </div>
            )}

            {/* Split */}
            {method === "split" && (
              <div>
                <label style={labelStyle}>Split Between Two Methods</label>
                {splits.map((s, idx) => (
                  <div
                    key={idx}
                    style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}
                  >
                    <select
                      value={s.method}
                      onChange={(e) => {
                        const updated: [SplitEntry, SplitEntry] = [
                          { ...splits[0] },
                          { ...splits[1] },
                        ];
                        updated[idx] = {
                          ...updated[idx],
                          method: e.target.value as SingleMethod,
                        };
                        setSplits(updated);
                      }}
                      style={{
                        flex: "0 0 100px",
                        padding: "10px 8px",
                        border: "1.5px solid var(--pos-line-strong)",
                        borderRadius: 8,
                        fontSize: 13,
                        background: "var(--pos-surface)",
                      }}
                    >
                      {SINGLE_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s.amount}
                      onChange={(e) => handleSplitChange(idx as 0 | 1, e.target.value)}
                      placeholder="₹ Amount"
                      style={{ ...inputStyle, flex: "1" }}
                    />
                  </div>
                ))}
                {splitBalance > 0 && (
                  <div style={{ color: "var(--pos-danger)", fontSize: 13, fontWeight: 600 }}>
                    Remaining: ₹{splitBalance.toFixed(2)}
                  </div>
                )}
                {splitBalance < 0 && (
                  <div style={{ color: "var(--pos-saffron)", fontSize: 13, fontWeight: 600 }}>
                    Overpaid by ₹{Math.abs(splitBalance).toFixed(2)}
                  </div>
                )}
                {splitBalance === 0 && splitTotal > 0 && (
                  <div style={{ color: "var(--pos-success)", fontSize: 13, fontWeight: 600 }}>
                    Fully covered
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: summary + actions */}
          <div className={styles.summaryCol}>
            <label style={labelStyle}>Summary</label>

            {/* Amount due */}
            <div
              style={{
                padding: 14,
                background: "var(--pos-surface)",
                border: "1.5px solid var(--pos-surface-sunken)",
                borderRadius: 10,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--pos-tx-muted)", marginBottom: 4 }}>
                Amount Due
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, color: "var(--pos-tx)", lineHeight: 1 }}>
                ₹{amount.toFixed(2)}
              </div>
            </div>

            {/* Cash received / change */}
            {method === "cash" && numCash > 0 && (
              <>
                <div
                  style={{
                    padding: "10px 14px",
                    background: "var(--pos-surface)",
                    border: "1.5px solid var(--pos-surface-sunken)",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--pos-tx-muted)", marginBottom: 2 }}>
                    Received
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--pos-tx-sec)" }}>
                    ₹{numCash.toFixed(2)}
                  </div>
                </div>
                {change > 0 && (
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "var(--pos-success-tint)",
                      border: "1.5px solid var(--pos-success-line)",
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{ fontSize: 11, color: "var(--pos-success-text)", marginBottom: 2 }}
                    >
                      Change
                    </div>
                    <div
                      style={{ fontSize: 20, fontWeight: 900, color: "var(--pos-success-text)" }}
                    >
                      ₹{change.toFixed(2)}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Split totals */}
            {method === "split" && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "var(--pos-surface)",
                  border: "1.5px solid var(--pos-surface-sunken)",
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: 11, color: "var(--pos-tx-muted)", marginBottom: 2 }}>
                  Collected
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: splitExact ? "var(--pos-success)" : "var(--pos-tx-sec)",
                  }}
                >
                  ₹{splitTotal.toFixed(2)}
                </div>
              </div>
            )}

            <div style={{ flex: 1 }} />

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                fontSize: 13,
                color: "var(--pos-tx-sec)",
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={effectivePrintReceipt}
                onChange={(e) => setShouldPrintReceipt(e.target.checked)}
                disabled={processing || forcePrintReceipt}
                style={{ width: 15, height: 15, cursor: processing ? "not-allowed" : "pointer" }}
              />
              {forcePrintReceipt ? "Print receipt (required by mode)" : "Print receipt"}
            </label>

            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              style={{
                padding: "13px",
                background: canConfirm ? "var(--pos-success)" : "var(--pos-line-strong)",
                color: canConfirm ? "var(--pos-surface)" : "var(--pos-tx-muted)",
                border: "none",
                borderRadius: 8,
                fontWeight: 800,
                fontSize: 15,
                cursor: canConfirm ? "pointer" : "not-allowed",
                transition: "background 0.15s",
              }}
            >
              {processing ? "Processing..." : method === "credit" ? " Save to account" : " Settle"}
            </button>

            <button
              onClick={onClose}
              disabled={processing}
              style={{
                padding: "10px",
                background: "transparent",
                color: "var(--pos-tx-sub)",
                border: "1.5px solid var(--pos-line)",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 13,
                cursor: processing ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
