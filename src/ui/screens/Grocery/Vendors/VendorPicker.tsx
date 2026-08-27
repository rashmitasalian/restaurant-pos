import React from "react";
import { createVendor, listVendors } from "../../../../app/db/posRepository";
import type { VendorDto } from "../../../../shared/pos";
import { normalizeText, validationMessage } from "../../../../shared/validation";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Modal } from "../../../components/ui/Modal";
import { Select } from "../../../components/ui/Select";
import styles from "../Grocery.module.css";

const NOT_SPECIFIED = "";

type Props = {
  label?: string;
  value: string;
  onChange: (vendorName: string) => void;
  disabled?: boolean;
  vendors: VendorDto[];
  onVendorsChange: (vendors: VendorDto[]) => void;
};

export function VendorPicker({
  label = "Vendor",
  value,
  onChange,
  disabled,
  vendors,
  onVendorsChange,
}: Props) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = async () => {
    const rows = (await listVendors({ includeInactive: false })) as VendorDto[];
    onVendorsChange(rows);
    return rows;
  };

  const saveVendor = async () => {
    const trimmed = normalizeText(name);
    if (!trimmed) {
      setError("Vendor name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = (await createVendor({
        name: trimmed,
        phone: normalizeText(phone) || null,
      })) as VendorDto;
      const rows = await refresh();
      const match = rows.find((v) => v.id === created.id) || created;
      onChange(match.name);
      setAddOpen(false);
      setName("");
      setPhone("");
    } catch (e) {
      setError(validationMessage(e, "Could not create vendor"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.vendorPicker}>
        <Select
          label={label}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value={NOT_SPECIFIED}>Not specified</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.name}>
              {vendor.name}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setError(null);
            setAddOpen(true);
          }}
        >
          + Add Vendor
        </Button>
      </div>

      <Modal open={addOpen} title="Add Vendor" onClose={() => !busy && setAddOpen(false)}>
        <div className="ui-form-stack">
          {error && <div className={styles.status}>{error}</div>}
          <Input
            label="Vendor name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Input
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Optional"
          />
          <div className="ui-form-actions">
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveVendor()} loading={busy}>
              Save Vendor
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export async function loadActiveVendors(): Promise<VendorDto[]> {
  return (await listVendors({ includeInactive: false })) as VendorDto[];
}
