import React from "react";
import {
  isValidIndianMobile,
  isValidPersonName,
  normalizePhone,
  normalizeText,
  validationMessage,
} from "../../../shared/validation";
import { CREDIT_CONFIG_KEY, normalizeCreditConfig } from "../../../shared/customerCredit";
import { getConfigBranding } from "../../../app/db/posRepository";
import { printReceipt } from "../../../app/services/printer";
import { useToast } from "../../context/ToastContext";
import { AuthContext } from "../../context/AuthContext";
import { canManageCustomerCredit, roleHasPermission } from "../../../shared/permissions";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { VirtualScrollList } from "../../components/VirtualScrollList";
import { Drawer } from "../../components/ui/Drawer";
import { DataTable } from "../../components/ui/DataTable";
import { Stat } from "../../components/ui/Stat";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { buildCreditCollectionLines, buildCreditStatementLines } from "./creditPrintBuilders";

const CUSTOMER_ROW_HEIGHT = 112;
const LEDGER_PAGE_SIZE = 20;

interface Customer {
  id: string;
  name: string;
  phone: string;
  createdAt: string | number;
  creditEnabled?: boolean;
  creditBlocked?: boolean;
  creditLimit?: number;
  defaultCreditDays?: number | null;
  outstanding?: number;
  overdue?: number;
}

type CustomerFilter = "all" | "outstanding" | "overdue";

type AccountSummary = {
  outstanding: number;
  overdue: number;
  creditLimit: number;
  availableCredit: number;
  creditEnabled: boolean;
  creditBlocked: boolean;
  defaultCreditDays: number | null;
  entryCount?: number;
  entries?: Array<{
    id: string;
    entryType: string;
    amount: number;
    runningBalance: number;
    invoiceNumber?: string | null;
    description?: string | null;
    dueDate?: string | null;
    remaining?: number | null;
    paymentMethod?: string | null;
    createdAt: number;
    createdBy?: string | null;
  }>;
};

type LedgerEntry = {
  id: string;
  entryType: string;
  amount: number;
  runningBalance: number;
  invoiceNumber?: string | null;
  description?: string | null;
  dueDate?: string | null;
  remaining?: number | null;
  paymentMethod?: string | null;
  createdAt: number;
};

function formatMoney(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatEntryDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export default function Customers() {
  const { showToast } = useToast();
  const auth = React.useContext(AuthContext);
  const role = auth?.session?.role;
  const canManageCredit = canManageCustomerCredit(role);
  const canReceive = Boolean(role && roleHasPermission(role, "order:pay"));

  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<CustomerFilter>("all");
  const [restaurantDefaultDays, setRestaurantDefaultDays] = React.useState(15);
  const [creditFeatureEnabled, setCreditFeatureEnabled] = React.useState(false);

  const loadCustomers = React.useCallback(async () => {
    try {
      // Always load the full list; filters apply in the UI so controls never disappear.
      const list = (await window.pos?.customers?.list({ filter: "all" })) || [];
      setCustomers(list);
      setLoadError(null);
    } catch (e: any) {
      setCustomers([]);
      setLoadError(validationMessage(e, "Could not load customers"));
    }
  }, []);

  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editPhone, setEditPhone] = React.useState("");
  const [editNameError, setEditNameError] = React.useState<string | null>(null);
  const [editPhoneError, setEditPhoneError] = React.useState<string | null>(null);
  const [savingAdd, setSavingAdd] = React.useState(false);
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const savingAddRef = React.useRef(false);
  const savingEditRef = React.useRef(false);
  const deletingRef = React.useRef<string | null>(null);

  const [selectedCustomer, setSelectedCustomer] = React.useState<Customer | null>(null);
  const [account, setAccount] = React.useState<AccountSummary | null>(null);
  const [ledgerEntries, setLedgerEntries] = React.useState<LedgerEntry[]>([]);
  const [ledgerHasMore, setLedgerHasMore] = React.useState(false);
  const [ledgerLoadingMore, setLedgerLoadingMore] = React.useState(false);
  const [accountLoading, setAccountLoading] = React.useState(false);
  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const [receiveAmount, setReceiveAmount] = React.useState("");
  const [receiveMethod, setReceiveMethod] = React.useState<"cash" | "upi" | "card" | "other">(
    "upi",
  );
  const [receiveNotes, setReceiveNotes] = React.useState("");
  const [receivePrintSlip, setReceivePrintSlip] = React.useState(true);
  const [receiving, setReceiving] = React.useState(false);
  const [creditLimitEdit, setCreditLimitEdit] = React.useState("");
  const [creditDaysEdit, setCreditDaysEdit] = React.useState("");
  const [savingCredit, setSavingCredit] = React.useState(false);
  const [hotelName, setHotelName] = React.useState("Restaurant");
  const [printingStatement, setPrintingStatement] = React.useState(false);
  const [voidTarget, setVoidTarget] = React.useState<LedgerEntry | null>(null);
  const [voidReason, setVoidReason] = React.useState("");
  const [voiding, setVoiding] = React.useState(false);

  React.useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  React.useEffect(() => {
    (async () => {
      try {
        const cfg = normalizeCreditConfig(await window.pos?.settings?.get?.(CREDIT_CONFIG_KEY));
        setCreditFeatureEnabled(cfg.enabled);
        setRestaurantDefaultDays(cfg.defaultCreditDays);
      } catch {
        setCreditFeatureEnabled(false);
      }
      try {
        const branding = await getConfigBranding();
        if (branding?.hotelName) {
          setHotelName(branding.hotelName);
        }
      } catch {
        // keep default
      }
    })();
  }, []);

  const loadLedgerPage = async (customerId: string, offset = 0, append = false) => {
    const page = await window.pos!.customers!.accountEntries(customerId, {
      limit: LEDGER_PAGE_SIZE,
      offset,
    });
    setLedgerEntries((prev) => (append ? [...prev, ...page.entries] : page.entries));
    setLedgerHasMore(Boolean(page.hasMore));
    return page;
  };

  const openAccount = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setAccountLoading(true);
    setReceiveOpen(false);
    setLedgerEntries([]);
    setLedgerHasMore(false);
    try {
      const summary = await window.pos!.customers!.account(customer.id);
      setAccount(summary);
      setCreditLimitEdit(String(summary.creditLimit || 0));
      setCreditDaysEdit(
        summary.defaultCreditDays === null || summary.defaultCreditDays === undefined
          ? ""
          : String(summary.defaultCreditDays),
      );
      await loadLedgerPage(customer.id, 0, false);
    } catch (e: any) {
      showToast(validationMessage(e, "Could not load account"), "error");
      setSelectedCustomer(null);
      setAccount(null);
    } finally {
      setAccountLoading(false);
    }
  };

  const loadMoreLedger = async () => {
    if (!selectedCustomer || ledgerLoadingMore || !ledgerHasMore) {
      return;
    }
    setLedgerLoadingMore(true);
    try {
      await loadLedgerPage(selectedCustomer.id, ledgerEntries.length, true);
    } catch (e: any) {
      showToast(validationMessage(e, "Could not load more ledger rows"), "error");
    } finally {
      setLedgerLoadingMore(false);
    }
  };

  const addCustomer = async () => {
    if (savingAddRef.current) {
      return;
    }
    setNameError(null);
    setPhoneError(null);

    const trimmedName = normalizeText(name);
    if (!isValidPersonName(trimmedName)) {
      setNameError(validationMessage("customer-name-invalid"));
      return;
    }

    const cleaned = normalizePhone(phone);
    if (!isValidIndianMobile(cleaned)) {
      setPhoneError(validationMessage("customer-phone-invalid"));
      return;
    }

    if (customers.some((c) => c.phone === cleaned)) {
      setPhoneError(validationMessage("customer-phone-duplicate"));
      return;
    }
    savingAddRef.current = true;
    setSavingAdd(true);
    try {
      await window.pos!.customers!.create({ name: trimmedName, phone: cleaned });
      await loadCustomers();
      setName("");
      setPhone("");
      showToast("Customer added");
    } catch (e: any) {
      setPhoneError(validationMessage(e, "Failed to add customer"));
    } finally {
      savingAddRef.current = false;
      setSavingAdd(false);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditPhone("");
    setEditNameError(null);
    setEditPhoneError(null);
  };

  const startEdit = (customer: Customer) => {
    setConfirmDeleteId(null);
    setEditingId(customer.id);
    setEditName(customer.name);
    setEditPhone(customer.phone);
    setEditNameError(null);
    setEditPhoneError(null);
  };

  const saveCustomer = async (customer: Customer) => {
    if (savingEditRef.current) {
      return;
    }
    setEditNameError(null);
    setEditPhoneError(null);
    const trimmedName = normalizeText(editName);
    if (!isValidPersonName(trimmedName)) {
      setEditNameError(validationMessage("customer-name-invalid"));
      return;
    }
    const cleaned = normalizePhone(editPhone);
    if (!isValidIndianMobile(cleaned)) {
      setEditPhoneError(validationMessage("customer-phone-invalid"));
      return;
    }
    if (customers.some((c) => c.id !== customer.id && c.phone === cleaned)) {
      setEditPhoneError(validationMessage("customer-phone-duplicate"));
      return;
    }
    savingEditRef.current = true;
    setSavingEdit(true);
    try {
      await window.pos!.customers!.update(customer.id, { name: trimmedName, phone: cleaned });
      await loadCustomers();
      cancelEdit();
      showToast("Customer updated", "success");
    } catch (e: any) {
      const message = validationMessage(e, "Failed to update customer");
      setEditPhoneError(message);
      showToast(message, "error");
    } finally {
      savingEditRef.current = false;
      setSavingEdit(false);
    }
  };

  const removeCustomer = async (id: string) => {
    if (deletingRef.current) {
      return;
    }
    deletingRef.current = id;
    setDeletingId(id);
    try {
      await window.pos!.customers!.delete(id);
      await loadCustomers();
      setConfirmDeleteId(null);
      if (editingId === id) {
        cancelEdit();
      }
      if (selectedCustomer?.id === id) {
        setSelectedCustomer(null);
        setAccount(null);
      }
      showToast("Customer removed", "success");
    } catch (e: any) {
      showToast(validationMessage(e, "Failed to remove customer"), "error");
    } finally {
      deletingRef.current = null;
      setDeletingId(null);
    }
  };

  const saveCreditSettings = async () => {
    if (!selectedCustomer || !canManageCredit) {
      return;
    }
    const limit = Number(creditLimitEdit || 0);
    if (!Number.isFinite(limit) || limit < 0) {
      showToast("Enter a valid credit limit", "error");
      return;
    }
    setSavingCredit(true);
    try {
      const daysRaw = creditDaysEdit.trim();
      const defaultCreditDays = daysRaw === "" ? null : Math.max(0, Math.round(Number(daysRaw)));
      if (daysRaw !== "" && !Number.isFinite(Number(daysRaw))) {
        showToast("Enter valid default days, or leave blank", "error");
        return;
      }
      const updated = await window.pos!.customers!.update(selectedCustomer.id, {
        creditEnabled: limit > 0,
        creditLimit: limit,
        defaultCreditDays,
        creditBlocked: account?.creditBlocked || false,
      });
      showToast(limit > 0 ? "Credit enabled for this customer" : "Credit limit cleared");
      await loadCustomers();
      if (updated) {
        await openAccount(updated as Customer);
      }
    } catch (e: any) {
      showToast(validationMessage(e, "Could not save credit settings"), "error");
    } finally {
      setSavingCredit(false);
    }
  };

  const toggleCreditBlocked = async () => {
    if (!selectedCustomer || !canManageCredit || !account) {
      return;
    }
    try {
      await window.pos!.customers!.update(selectedCustomer.id, {
        creditBlocked: !account.creditBlocked,
        creditEnabled: account.creditEnabled || account.creditLimit > 0,
      });
      await openAccount(selectedCustomer);
      await loadCustomers();
    } catch (e: any) {
      showToast(validationMessage(e, "Could not update credit status"), "error");
    }
  };

  const receivePayment = async () => {
    if (!selectedCustomer || !canReceive) {
      return;
    }
    setReceiving(true);
    try {
      const result = await window.pos!.customers!.receivePayment(selectedCustomer.id, {
        amount: Number(receiveAmount),
        method: receiveMethod,
        notes: receiveNotes || null,
      });
      const summary = result?.account || result;
      const paidAmount = Number(receiveAmount);
      setAccount(summary);
      setReceiveOpen(false);
      setReceiveAmount("");
      setReceiveNotes("");
      showToast(`Payment received: ${formatMoney(paidAmount)}`);
      await loadCustomers();
      await loadLedgerPage(selectedCustomer.id, 0, false);
      if (receivePrintSlip) {
        try {
          const lines = buildCreditCollectionLines({
            hotelName,
            customerName: selectedCustomer.name,
            customerPhone: selectedCustomer.phone,
            amount: paidAmount,
            method: receiveMethod,
            outstandingAfter: Number(summary?.outstanding || 0),
            allocations: result?.payment?.allocations || [],
          });
          await printReceipt({ lines });
        } catch {
          showToast("Payment saved, but collection slip could not print", "error");
        }
      }
    } catch (e: any) {
      showToast(validationMessage(e, "Could not receive payment"), "error");
    } finally {
      setReceiving(false);
    }
  };

  const confirmVoidCreditSale = async () => {
    if (!selectedCustomer || !voidTarget || !canManageCredit) {
      return;
    }
    setVoiding(true);
    try {
      const result = await window.pos!.customers!.voidCreditSale(voidTarget.id, {
        reason: voidReason.trim() || null,
      });
      setAccount(result?.account || account);
      setVoidTarget(null);
      setVoidReason("");
      showToast(
        `Voided ${formatMoney(Number(result?.voided?.amount || voidTarget.remaining || 0))}`,
      );
      await loadCustomers();
      await loadLedgerPage(selectedCustomer.id, 0, false);
    } catch (e: any) {
      showToast(validationMessage(e, "Could not void credit sale"), "error");
    } finally {
      setVoiding(false);
    }
  };

  const filteredCustomers = React.useMemo(() => {
    const query = normalizeText(search).toLowerCase();
    return customers.filter((customer) => {
      const outstanding = Number(customer.outstanding || 0);
      const overdue = Number(customer.overdue || 0);
      if (filter === "outstanding" && outstanding <= 0) {
        return false;
      }
      if (filter === "overdue" && overdue <= 0) {
        return false;
      }
      if (!query) {
        return true;
      }
      return `${customer.name} ${customer.phone}`.toLowerCase().includes(query);
    });
  }, [customers, search, filter]);

  const printStatement = async () => {
    if (!selectedCustomer || !account) {
      return;
    }
    setPrintingStatement(true);
    try {
      const openBills = (await window.pos!.customers!.openBills(selectedCustomer.id)) || [];
      const lastPayment =
        ledgerEntries.find((entry) => entry.entryType === "payment_received") || null;
      const lines = buildCreditStatementLines({
        hotelName,
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        outstanding: account.outstanding,
        overdue: account.overdue,
        openBills,
        lastPayment: lastPayment
          ? {
              amount: lastPayment.amount,
              method: lastPayment.paymentMethod,
              createdAt: lastPayment.createdAt,
            }
          : null,
      });
      await printReceipt({ lines });
      showToast("Statement sent to printer");
    } catch (e: any) {
      showToast(validationMessage(e, "Could not print statement"), "error");
    } finally {
      setPrintingStatement(false);
    }
  };

  const renderCustomerRow = (c: Customer) => {
    const isEditing = editingId === c.id;
    const isConfirmingDelete = confirmDeleteId === c.id;
    const outstanding = Number(c.outstanding || 0);
    const overdue = Number(c.overdue || 0);

    return (
      <div
        className="pos-card"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          flexWrap: "wrap",
          gap: 10,
          minHeight: CUSTOMER_ROW_HEIGHT - 10,
          boxSizing: "border-box",
          cursor: isEditing ? "default" : "pointer",
        }}
        onClick={() => {
          if (!isEditing) {
            openAccount(c);
          }
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: "1 1 300px",
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "var(--pos-teal)",
              color: "var(--pos-surface)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {c.name.charAt(0).toUpperCase()}
          </div>
          {isEditing ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                flex: 1,
                alignItems: "flex-start",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ flex: "1 1 160px" }}>
                <Input
                  label="Customer name"
                  labelHidden
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    if (editNameError) {
                      setEditNameError(null);
                    }
                  }}
                  placeholder="Customer name"
                  error={editNameError}
                />
              </div>
              <div style={{ flex: "1 1 160px" }}>
                <Input
                  label="Phone"
                  labelHidden
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={editPhone}
                  onChange={(e) => {
                    setEditPhone(normalizePhone(e.target.value));
                    if (editPhoneError) {
                      setEditPhoneError(null);
                    }
                  }}
                  placeholder="Phone (10 digits)"
                  error={editPhoneError}
                />
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--pos-tx)" }}>{c.name}</div>
              <div
                style={{
                  color: "var(--pos-tx-sub)",
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {c.phone}
              </div>
              {outstanding > 0 ? (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    fontWeight: 700,
                    color: overdue > 0 ? "var(--pos-danger)" : "var(--pos-tx-sec)",
                  }}
                >
                  {formatMoney(outstanding)} {overdue > 0 ? "overdue" : "outstanding"}
                </div>
              ) : c.creditEnabled ? (
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--pos-tx-muted)" }}>
                  Credit ready · limit {formatMoney(Number(c.creditLimit || 0))}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          onClick={(e) => e.stopPropagation()}
        >
          {isEditing ? (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => saveCustomer(c)}
                disabled={savingEdit}
              >
                {savingEdit ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="secondary" onClick={cancelEdit} disabled={savingEdit}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => openAccount(c)}>
                Account
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  try {
                    navigator.clipboard?.writeText(c.phone);
                    showToast("Phone copied");
                  } catch {
                    showToast("Copied");
                  }
                }}
              >
                Copy
              </Button>
              <Button size="sm" variant="secondary" onClick={() => startEdit(c)}>
                Edit
              </Button>
              {isConfirmingDelete ? (
                <>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => removeCustomer(c.id)}
                    disabled={deletingId === c.id}
                  >
                    {deletingId === c.id ? "Deleting..." : "Confirm Delete"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmDeleteId(null)}
                    disabled={deletingId === c.id}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="danger" onClick={() => setConfirmDeleteId(c.id)}>
                  Delete
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const emptyMessage =
    customers.length === 0
      ? loadError || "No customers yet. Add your first customer above."
      : filter === "outstanding"
        ? "No customers with outstanding balance."
        : filter === "overdue"
          ? "No overdue customers."
          : "No customers match your search.";

  return (
    <div
      className="pos-page pos-page-sm"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <PageHeader
          title="Customers"
          subtitle={
            creditFeatureEnabled
              ? "Customer list, credit accounts, and collections"
              : "Collect customer name & phone for promotions"
          }
        />
      </div>

      <div className="pos-card pos-card-p" style={{ marginBottom: 16, flexShrink: 0 }}>
        <p
          style={{
            margin: "0 0 14px",
            fontWeight: 700,
            fontSize: 13,
            color: "var(--pos-tx-sec)",
          }}
        >
          Add New Customer
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 180px", maxWidth: 280 }}>
            <Input
              label="Customer name"
              labelHidden
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) {
                  setNameError(null);
                }
              }}
              placeholder="Customer name"
              error={nameError}
            />
          </div>
          <div style={{ flex: "1 1 160px", maxWidth: 200 }}>
            <Input
              label="Phone"
              labelHidden
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(normalizePhone(e.target.value));
                if (phoneError) {
                  setPhoneError(null);
                }
              }}
              placeholder="Phone (10 digits)"
              error={phoneError}
            />
          </div>
          <Button
            onClick={addCustomer}
            variant="primary"
            disabled={
              !normalizeText(name) ||
              !isValidPersonName(name) ||
              !isValidIndianMobile(phone) ||
              Boolean(nameError) ||
              Boolean(phoneError) ||
              savingAdd
            }
          >
            {savingAdd ? "Adding..." : "Add Customer"}
          </Button>
        </div>
      </div>

      <div
        className="pos-card pos-card-p"
        style={{
          marginBottom: 16,
          flexShrink: 0,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <div style={{ flex: "1 1 220px", maxWidth: 360, minWidth: 180 }}>
          <Input
            label="Search customers"
            labelHidden
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or phone"
          />
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            paddingTop: 2,
          }}
        >
          {(
            [
              ["all", "All"],
              ["outstanding", "Outstanding"],
              ["overdue", "Overdue"],
            ] as Array<[CustomerFilter, string]>
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "primary" : "secondary"}
              onClick={() => setFilter(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div
          style={{
            marginLeft: "auto",
            paddingTop: 8,
            fontSize: 12,
            color: "var(--pos-tx-sub)",
            whiteSpace: "nowrap",
          }}
        >
          {filteredCustomers.length.toLocaleString()} of {customers.length.toLocaleString()}
          {loadError ? ` · ${loadError}` : ""}
        </div>
      </div>

      {filteredCustomers.length === 0 ? (
        <div className="pos-empty">{emptyMessage}</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <VirtualScrollList
            items={filteredCustomers}
            itemHeight={CUSTOMER_ROW_HEIGHT}
            fill
            getKey={(customer) => customer.id}
            renderItem={(customer) => renderCustomerRow(customer)}
          />
        </div>
      )}

      <Drawer
        open={Boolean(selectedCustomer)}
        onClose={() => {
          setSelectedCustomer(null);
          setAccount(null);
          setLedgerEntries([]);
          setReceiveOpen(false);
        }}
        title={selectedCustomer ? selectedCustomer.name : "Account"}
        wide
        footer={
          selectedCustomer && account && !accountLoading ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
              {canReceive && account.outstanding > 0 && !receiveOpen && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setReceiveAmount(String(account.outstanding));
                    setReceivePrintSlip(true);
                    setReceiveOpen(true);
                  }}
                >
                  Receive Payment
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={printStatement}
                disabled={printingStatement}
                loading={printingStatement}
              >
                Print statement
              </Button>
            </div>
          ) : undefined
        }
      >
        {accountLoading || !account || !selectedCustomer ? (
          <div style={{ padding: 8 }}>Loading account…</div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ color: "var(--pos-tx-sub)", fontSize: 13 }}>{selectedCustomer.phone}</div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Stat label="Outstanding" value={formatMoney(account.outstanding)} primary />
              <Stat
                label="Overdue"
                value={formatMoney(account.overdue)}
                sub={account.overdue > 0 ? "Past due bills" : undefined}
              />
              <Stat
                label="Credit left"
                value={formatMoney(account.availableCredit)}
                sub={
                  account.creditLimit > 0
                    ? `Limit ${formatMoney(account.creditLimit)} · for new bills`
                    : "Set a limit under Credit terms"
                }
              />
            </div>

            {receiveOpen && (
              <div className="pos-card pos-card-p" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 700 }}>Receive customer payment</div>
                <div style={{ fontSize: 12, color: "var(--pos-tx-sub)" }}>
                  Collecting against outstanding {formatMoney(account.outstanding)}. This is not the
                  credit limit.
                </div>
                <Input
                  label="Amount (₹)"
                  value={receiveAmount}
                  onChange={(e) => setReceiveAmount(e.target.value)}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(["cash", "upi", "card", "other"] as const).map((method) => (
                    <Button
                      key={method}
                      size="sm"
                      variant={receiveMethod === method ? "primary" : "secondary"}
                      onClick={() => setReceiveMethod(method)}
                    >
                      {method.toUpperCase()}
                    </Button>
                  ))}
                </div>
                <Input
                  label="Notes"
                  value={receiveNotes}
                  onChange={(e) => setReceiveNotes(e.target.value)}
                  placeholder="Optional"
                />
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: "var(--pos-tx-sec)",
                    fontWeight: 600,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={receivePrintSlip}
                    onChange={(e) => setReceivePrintSlip(e.target.checked)}
                  />
                  Print collection slip
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="primary" onClick={receivePayment} disabled={receiving}>
                    {receiving ? "Saving…" : "Receive"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setReceiveOpen(false)}
                    disabled={receiving}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {canManageCredit && creditFeatureEnabled && !receiveOpen && (
              <div className="pos-card pos-card-p" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Credit terms</div>
                <div style={{ fontSize: 12, color: "var(--pos-tx-sub)" }}>
                  Limit above ₹0 enables Credit on Billing. Due days apply to new bills only —
                  existing bills keep the date they were saved with. Leave days blank to use the
                  restaurant default ({restaurantDefaultDays} days).
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 140px" }}>
                    <Input
                      label="Credit limit (₹)"
                      value={creditLimitEdit}
                      onChange={(e) => setCreditLimitEdit(e.target.value)}
                    />
                  </div>
                  <div style={{ flex: "1 1 140px" }}>
                    <Input
                      label="Due in days (optional)"
                      value={creditDaysEdit}
                      onChange={(e) => setCreditDaysEdit(e.target.value)}
                      placeholder={`Blank = ${restaurantDefaultDays}`}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={saveCreditSettings}
                    disabled={savingCredit}
                  >
                    {savingCredit ? "Saving…" : "Save credit settings"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={toggleCreditBlocked}>
                    {account.creditBlocked ? "Unblock credit" : "Block credit"}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Ledger</div>
              {ledgerEntries.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--pos-tx-sub)" }}>
                  No account activity yet.
                </div>
              ) : (
                <>
                  <DataTable
                    dense
                    headers={["Date", "Details", "Debit", "Credit", "Bal", ""]}
                    rows={ledgerEntries.map((entry) => {
                      const isSale = entry.entryType === "credit_sale";
                      const isPay = entry.entryType === "payment_received";
                      const isVoid = entry.entryType === "void" || entry.entryType === "adjustment";
                      const openRemaining =
                        isSale && entry.remaining != null && entry.remaining > 0;
                      const detail = [
                        entry.invoiceNumber ||
                          (isPay ? "Payment" : isVoid ? "Void" : entry.entryType.replace("_", " ")),
                        entry.description || "",
                        entry.dueDate ? `due ${entry.dueDate}` : "",
                        openRemaining ? `left ${formatMoney(entry.remaining || 0)}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return [
                        formatEntryDate(entry.createdAt),
                        detail,
                        isSale ? formatMoney(entry.amount) : "—",
                        isPay || isVoid ? formatMoney(entry.amount) : "—",
                        formatMoney(entry.runningBalance),
                        openRemaining && canManageCredit ? (
                          <Button
                            key={`void-${entry.id}`}
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setVoidReason("");
                              setVoidTarget(entry);
                            }}
                          >
                            Void
                          </Button>
                        ) : (
                          ""
                        ),
                      ];
                    })}
                    empty="No account activity yet."
                  />
                  {ledgerHasMore && (
                    <div style={{ marginTop: 10 }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={loadMoreLedger}
                        disabled={ledgerLoadingMore}
                        loading={ledgerLoadingMore}
                      >
                        Load more
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmModal
        open={Boolean(voidTarget)}
        title="Void open credit sale?"
        confirmLabel={voiding ? "Voiding…" : "Void remaining"}
        variant="danger"
        loading={voiding}
        warning="This clears the unpaid balance on this bill. The original sale stays in History as paid credit; only the open receivable is removed."
        onClose={() => {
          if (!voiding) {
            setVoidTarget(null);
            setVoidReason("");
          }
        }}
        onConfirm={confirmVoidCreditSale}
      >
        {voidTarget ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, color: "var(--pos-tx-sec)" }}>
              {voidTarget.invoiceNumber || "Credit sale"} · remaining{" "}
              {formatMoney(Number(voidTarget.remaining || 0))}
            </div>
            <Input
              label="Reason (optional)"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Wrong bill, customer dispute…"
            />
          </div>
        ) : null}
      </ConfirmModal>
    </div>
  );
}
