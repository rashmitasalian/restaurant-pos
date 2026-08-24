import React from "react";
import {
  isValidIndianMobile,
  isValidPersonName,
  normalizePhone,
  normalizeText,
  validationMessage,
} from "../../../shared/validation";
import { useToast } from "../../context/ToastContext";
import { PageHeader } from "../../components/ui/PageHeader";

interface Customer {
  id: string;
  name: string;
  phone: string;
  createdAt: string | number;
}

export default function Customers() {
  const { showToast } = useToast();
  const [customers, setCustomers] = React.useState<Customer[]>([]);

  const loadCustomers = React.useCallback(async () => {
    try {
      setCustomers((await window.pos?.customers?.list()) || []);
    } catch (e) {
      setCustomers([]);
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
  const savingAddRef = React.useRef(false);
  const savingEditRef = React.useRef(false);
  const deletingRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const addCustomer = async () => {
    if (savingAddRef.current) {
      return;
    }
    // clear previous errors
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

    // check duplicate phone
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
      showToast("Customer removed", "success");
    } catch (e: any) {
      showToast(validationMessage(e, "Failed to remove customer"), "error");
    } finally {
      deletingRef.current = null;
      setDeletingId(null);
    }
  };

  return (
    <div className="pos-page pos-page-sm">
      <PageHeader title="Customers" subtitle="Collect customer name & phone for promotions" />

      {/* Add customer form */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
        <p
          style={{
            margin: "0 0 14px",
            fontWeight: 700,
            fontSize: 13,
            color: "var(--pos-tx-sec,var(--pos-tx-sec))",
          }}
        >
          Add New Customer
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 180px" }}>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) {
setNameError(null);
}
              }}
              placeholder="Customer name"
              className={`pos-input${nameError ? " pos-input-error" : ""}`}
            />
            {nameError && <div className="pos-field-error">{nameError}</div>}
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <input
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
              className={`pos-input${phoneError ? " pos-input-error" : ""}`}
            />
            {phoneError && <div className="pos-field-error">{phoneError}</div>}
          </div>
          <button
            onClick={addCustomer}
            disabled={
              !normalizeText(name) ||
              !isValidPersonName(name) ||
              !isValidIndianMobile(phone) ||
              Boolean(nameError) ||
              Boolean(phoneError) ||
              savingAdd
            }
            className="pos-btn pos-btn-primary"
          >
            {savingAdd ? "Adding..." : "Add Customer"}
          </button>
        </div>
      </div>

      {/* Customer list */}
      {customers.length === 0 ? (
        <div className="pos-empty">No customers yet. Add your first customer above.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {customers.map((c) => {
            const isEditing = editingId === c.id;
            const isConfirmingDelete = confirmDeleteId === c.id;

            return (
              <div
                key={c.id}
                className="pos-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  flexWrap: "wrap",
                  gap: 10,
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
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: 1 }}>
                      <div style={{ flex: "1 1 160px" }}>
                        <input
                          value={editName}
                          onChange={(e) => {
                            setEditName(e.target.value);
                            if (editNameError) {
                              setEditNameError(null);
                            }
                          }}
                          placeholder="Customer name"
                          className={`pos-input${editNameError ? " pos-input-error" : ""}`}
                        />
                        {editNameError && <div className="pos-field-error">{editNameError}</div>}
                      </div>
                      <div style={{ flex: "1 1 160px" }}>
                        <input
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
                          className={`pos-input${editPhoneError ? " pos-input-error" : ""}`}
                        />
                        {editPhoneError && <div className="pos-field-error">{editPhoneError}</div>}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div
                        style={{ fontWeight: 700, fontSize: 14, color: "var(--pos-tx,var(--pos-tx))" }}
                      >
                        {c.name}
                      </div>
                      <div
                        style={{
                          color: "var(--pos-tx-sub,var(--pos-tx-sub))",
                          fontSize: 13,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {c.phone}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => saveCustomer(c)}
                        disabled={savingEdit}
                        className="pos-btn pos-btn-sm pos-btn-primary"
                      >
                        {savingEdit ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={savingEdit}
                        className="pos-btn pos-btn-sm pos-btn-secondary"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          try {
                            navigator.clipboard?.writeText(c.phone);
                            showToast("Phone copied");
                          } catch (e) {
                            showToast("Copied");
                          }
                        }}
                        className="pos-btn pos-btn-sm pos-btn-secondary"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => startEdit(c)}
                        className="pos-btn pos-btn-sm pos-btn-secondary"
                      >
                        Edit
                      </button>
                      {isConfirmingDelete ? (
                        <>
                          <button
                            onClick={() => removeCustomer(c.id)}
                            disabled={deletingId === c.id}
                            className="pos-btn pos-btn-sm pos-btn-danger"
                          >
                            {deletingId === c.id ? "Deleting..." : "Confirm Delete"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={deletingId === c.id}
                            className="pos-btn pos-btn-sm pos-btn-secondary"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(c.id)}
                          className="pos-btn pos-btn-sm pos-btn-danger"
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
