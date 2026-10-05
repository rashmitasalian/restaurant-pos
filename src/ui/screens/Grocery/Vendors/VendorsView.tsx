import React from "react";
import {
  createVendor,
  deleteVendor,
  listGroceryPurchaseHeaders,
  listVendors,
  updateVendor,
} from "../../../../app/db/posRepository";
import type { GroceryPurchaseDto, VendorDto } from "../../../../shared/pos";
import { validationMessage } from "../../../../shared/validation";
import { TEXT_LIMITS } from "../../../../shared/textLimits";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { ConfirmModal } from "../../../components/ui/ConfirmModal";
import { DataTable } from "../../../components/ui/DataTable";
import { Drawer } from "../../../components/ui/Drawer";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input } from "../../../components/ui/Input";
import { Modal } from "../../../components/ui/Modal";
import { formatCurrency, formatListDate } from "../groceryUtils";
import styles from "../Grocery.module.css";

type VendorForm = {
  editingId: string;
  name: string;
  phone: string;
  contactPerson: string;
  notes: string;
};

const EMPTY_FORM: VendorForm = {
  editingId: "",
  name: "",
  phone: "",
  contactPerson: "",
  notes: "",
};

type VendorDetailStats = {
  purchases: GroceryPurchaseDto[];
  purchaseCount: number;
  totalSpend: number;
};

export function VendorsView({
  addVendorRef,
}: {
  addVendorRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [vendors, setVendors] = React.useState<VendorDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [form, setForm] = React.useState<VendorForm>(EMPTY_FORM);
  const [selected, setSelected] = React.useState<VendorDto | null>(null);
  const [detail, setDetail] = React.useState<VendorDetailStats | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<VendorDto | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listVendors({
        includeInactive: false,
        search: search.trim() || undefined,
      });
      setVendors(rows as VendorDto[]);
    } catch (error) {
      setStatus(validationMessage(error, "Could not load vendors"));
    } finally {
      setLoading(false);
    }
  }, [search]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  React.useEffect(() => {
    if (!addVendorRef) {
      return;
    }
    addVendorRef.current = openCreate;
    return () => {
      addVendorRef.current = null;
    };
  }, [addVendorRef]);

  const openEdit = (vendor: VendorDto) => {
    setForm({
      editingId: vendor.id,
      name: vendor.name,
      phone: vendor.phone || "",
      contactPerson: vendor.contactPerson || "",
      notes: vendor.notes || "",
    });
    setModalOpen(true);
  };

  const saveVendor = async () => {
    const name = form.name.trim();
    if (!name) {
      setStatus("Vendor name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        phone: form.phone.trim() || null,
        contactPerson: form.contactPerson.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (form.editingId) {
        await updateVendor(form.editingId, payload);
        setStatus(`Updated ${name}`);
      } else {
        await createVendor(payload);
        setStatus(`Added ${name}`);
      }
      setModalOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (error) {
      setStatus(validationMessage(error, "Could not save vendor"));
    } finally {
      setSaving(false);
    }
  };

  const removeVendor = (vendor: VendorDto) => {
    setDeleteTarget(vendor);
  };

  const confirmDeleteVendor = async () => {
    if (!deleteTarget || saving) {
      return;
    }
    setSaving(true);
    try {
      await deleteVendor(deleteTarget.id);
      if (selected?.id === deleteTarget.id) {
        setSelected(null);
        setDetail(null);
      }
      setStatus(`Deleted ${deleteTarget.name}`);
      setDeleteTarget(null);
      await load();
    } catch (error) {
      setStatus(validationMessage(error, "Could not delete vendor"));
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (vendor: VendorDto) => {
    setSelected(vendor);
    setDetailLoading(true);
    setDetail(null);
    try {
      const headers = (await listGroceryPurchaseHeaders({
        vendorId: vendor.id,
        includeVoided: false,
        limit: 50,
      })) as GroceryPurchaseDto[];
      const active = headers.filter((h) => h.status !== "voided");
      const totalSpend = active.reduce((sum, h) => sum + Number(h.total || 0), 0);
      setDetail({
        purchases: headers.slice(0, 20),
        purchaseCount: active.length,
        totalSpend,
      });
    } catch (error) {
      setStatus(validationMessage(error, "Could not load vendor purchases"));
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const paymentTone = (statusValue: string): "neutral" | "attention" | "success" | "danger" => {
    if (statusValue === "paid") {
      return "success";
    }
    if (statusValue === "partial") {
      return "attention";
    }
    if (statusValue === "voided") {
      return "danger";
    }
    return "neutral";
  };

  return (
    <div className={styles.listPage}>
      <div className={styles.toolbarRow}>
        <Input
          placeholder="Search vendors…"
          maxLength={TEXT_LIMITS.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
      </div>

      {status && <div className={styles.status}>{status}</div>}

      {loading ? (
        <div className={styles.status}>Loading vendors…</div>
      ) : vendors.length === 0 ? (
        <EmptyState
          title="No vendors yet"
          text="Add suppliers so purchases can be tracked by vendor."
          actionLabel="+ Add Vendor"
          onAction={openCreate}
        />
      ) : (
        <DataTable
          headers={["Vendor", "Contact", "Phone", ""]}
          rows={vendors.map((vendor) => [
            <strong key={`${vendor.id}-name`}>{vendor.name}</strong>,
            vendor.contactPerson || "—",
            vendor.phone || "—",
            <div key={`${vendor.id}-actions`} className={styles.actions}>
              <Button variant="secondary" size="sm" onClick={() => void openDetail(vendor)}>
                Details
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openEdit(vendor)} disabled={saving}>
                Edit
              </Button>
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={() => void removeVendor(vendor)}
                disabled={saving}
              >
                Delete
              </Button>
            </div>,
          ])}
        />
      )}

      <Modal
        open={modalOpen}
        title={form.editingId ? "Edit Vendor" : "Add Vendor"}
        onClose={() => setModalOpen(false)}
      >
        <div className="ui-form-stack">
          <Input
            label="Name"
            value={form.name}
            maxLength={TEXT_LIMITS.vendorName}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Metro Foods"
          />
          <Input
            label="Phone"
            value={form.phone}
            maxLength={TEXT_LIMITS.vendorPhone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="98765 43210"
          />
          <Input
            label="Contact person"
            value={form.contactPerson}
            maxLength={TEXT_LIMITS.contactName}
            onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
            placeholder="Optional"
          />
          <Input
            label="Notes"
            value={form.notes}
            maxLength={TEXT_LIMITS.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Delivery days, credit terms…"
          />
          <div className="ui-form-actions">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void saveVendor()}
              disabled={saving || !form.name.trim()}
            >
              {saving ? "Saving…" : form.editingId ? "Update Vendor" : "Add Vendor"}
            </Button>
          </div>
        </div>
      </Modal>

      <Drawer
        open={Boolean(selected)}
        title={selected?.name || "Vendor"}
        onClose={() => {
          setSelected(null);
          setDetail(null);
        }}
        wide
      >
        {detailLoading || !detail || !selected ? (
          <div className={styles.status}>Loading vendor activity…</div>
        ) : (
          <div className={styles.stack}>
            <div
              className={styles.kpiGrid}
              style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
            >
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Purchases</div>
                <div className={styles.kpiValue}>{detail.purchaseCount}</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Total spend</div>
                <div className={styles.kpiValue}>{formatCurrency(detail.totalSpend)}</div>
              </div>
            </div>

            {(selected.phone || selected.contactPerson || selected.notes) && (
              <div className={styles.hint}>
                {[selected.contactPerson, selected.phone, selected.notes]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}

            <div className="pos-sect-label">Recent purchases</div>
            {detail.purchases.length === 0 ? (
              <EmptyState
                title="No purchases yet"
                text="Recorded purchases for this vendor will appear here."
              />
            ) : (
              <DataTable
                headers={["Date", "Total", "Payment", "Status"]}
                rows={detail.purchases.map((purchase) => [
                  formatListDate(purchase.purchaseDate),
                  formatCurrency(purchase.total),
                  <Badge key={`${purchase.id}-pay`} tone={paymentTone(purchase.paymentStatus)}>
                    {purchase.paymentStatus}
                  </Badge>,
                  <Badge
                    key={`${purchase.id}-st`}
                    tone={purchase.status === "voided" ? "danger" : "success"}
                  >
                    {purchase.status}
                  </Badge>,
                ])}
              />
            )}
          </div>
        )}
      </Drawer>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete vendor?"
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteVendor}
        confirmLabel="Delete vendor"
        loading={saving}
      >
        {deleteTarget ? (
          <p style={{ margin: 0 }}>
            Delete vendor <strong>{deleteTarget.name}</strong>?
          </p>
        ) : null}
      </ConfirmModal>
    </div>
  );
}
