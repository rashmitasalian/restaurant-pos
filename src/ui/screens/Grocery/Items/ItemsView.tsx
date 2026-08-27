import React from "react";
import {
  createBuyingListTemplate,
  createGroceryItem,
  deleteBuyingListTemplate,
  deleteGroceryItem,
  listBuyingListTemplates,
  listGroceryItems,
  updateGroceryItem,
  type GroceryItemDoc,
} from "../../../../app/db/posRepository";
import type { BuyingListTemplateDto, GroceryUnit } from "../../../../shared/pos";
import { validationMessage } from "../../../../shared/validation";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { DataTable } from "../../../components/ui/DataTable";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input } from "../../../components/ui/Input";
import { Modal } from "../../../components/ui/Modal";
import { Select } from "../../../components/ui/Select";
import { formatCurrency } from "../groceryUtils";
import styles from "../Grocery.module.css";

const UNITS: GroceryUnit[] = ["kg", "g", "L", "ml", "unit", "packet", "box", "dozen", "bunch"];

type ItemForm = {
  editingId: string;
  name: string;
  category: string;
  defaultQuantity: string;
  defaultUnit: GroceryUnit;
  vendorHint: string;
};

const EMPTY_ITEM_FORM: ItemForm = {
  editingId: "",
  name: "",
  category: "",
  defaultQuantity: "1",
  defaultUnit: "kg",
  vendorHint: "",
};

export function ItemsView() {
  const [items, setItems] = React.useState<GroceryItemDoc[]>([]);
  const [templates, setTemplates] = React.useState<BuyingListTemplateDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [itemModalOpen, setItemModalOpen] = React.useState(false);
  const [templateModalOpen, setTemplateModalOpen] = React.useState(false);
  const [itemForm, setItemForm] = React.useState<ItemForm>(EMPTY_ITEM_FORM);
  const [templateName, setTemplateName] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [itemRows, templateRows] = await Promise.all([
        listGroceryItems({ includeInactive: false }),
        listBuyingListTemplates(),
      ]);
      setItems(itemRows);
      setTemplates(templateRows as BuyingListTemplateDto[]);
    } catch (error) {
      setStatus(validationMessage(error, "Could not load grocery items"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = items.filter((item) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      (item.category || "").toLowerCase().includes(q) ||
      (item.vendorHint || "").toLowerCase().includes(q)
    );
  });

  const openCreateItem = () => {
    setItemForm(EMPTY_ITEM_FORM);
    setItemModalOpen(true);
  };

  const openEditItem = (item: GroceryItemDoc) => {
    setItemForm({
      editingId: item.id,
      name: item.name,
      category: item.category || "",
      defaultQuantity: String(item.defaultQuantity),
      defaultUnit: item.defaultUnit,
      vendorHint: item.vendorHint || "",
    });
    setItemModalOpen(true);
  };

  const saveItem = async () => {
    const name = itemForm.name.trim();
    const qty = Number(itemForm.defaultQuantity);
    if (!name) {
      setStatus("Item name is required");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setStatus("Default quantity must be greater than zero");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        category: itemForm.category.trim() || null,
        defaultUnit: itemForm.defaultUnit,
        defaultQuantity: qty,
        vendorHint: itemForm.vendorHint.trim() || null,
      };
      if (itemForm.editingId) {
        await updateGroceryItem(itemForm.editingId, payload);
        setStatus(`Updated ${name}`);
      } else {
        await createGroceryItem(payload);
        setStatus(`Added ${name}`);
      }
      setItemModalOpen(false);
      setItemForm(EMPTY_ITEM_FORM);
      await load();
    } catch (error) {
      setStatus(validationMessage(error, "Could not save item"));
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (item: GroceryItemDoc) => {
    if (!window.confirm(`Delete reusable item “${item.name}”?`)) return;
    setSaving(true);
    try {
      await deleteGroceryItem(item.id);
      setStatus(`Deleted ${item.name}`);
      await load();
    } catch (error) {
      setStatus(validationMessage(error, "Could not delete item"));
    } finally {
      setSaving(false);
    }
  };

  const createBlankTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      setStatus("Template name is required");
      return;
    }
    setSaving(true);
    try {
      await createBuyingListTemplate({ name, lines: [] });
      setTemplateName("");
      setTemplateModalOpen(false);
      setStatus(`Created template “${name}”`);
      await load();
    } catch (error) {
      setStatus(validationMessage(error, "Could not create template"));
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async (template: BuyingListTemplateDto) => {
    if (!window.confirm(`Delete template “${template.name}”?`)) return;
    setSaving(true);
    try {
      await deleteBuyingListTemplate(template.id);
      setStatus(`Deleted template ${template.name}`);
      await load();
    } catch (error) {
      setStatus(validationMessage(error, "Could not delete template"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.listPage}>
      <div className={styles.toolbarRow}>
        <Input
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <Button variant="primary" onClick={openCreateItem}>
          + Add Item
        </Button>
      </div>

      {status && <div className={styles.status}>{status}</div>}

      {loading ? (
        <div className={styles.status}>Loading items…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No grocery items yet"
          text="Add reusable items so buying lists can be built quickly."
          actionLabel="+ Add Item"
          onAction={openCreateItem}
        />
      ) : (
        <DataTable
          headers={["Item", "Default", "Category", "Last price", ""]}
          rows={filtered.map((item) => [
            <strong key={`${item.id}-name`}>{item.name}</strong>,
            `${item.defaultQuantity} ${item.defaultUnit}`,
            item.category || "—",
            item.priceHint?.lastUnitPrice
              ? `${formatCurrency(item.priceHint.lastUnitPrice)}/${item.priceHint.lastUnit || item.defaultUnit}`
              : "—",
            <div key={`${item.id}-actions`} className={styles.actions}>
              <Button variant="secondary" size="sm" onClick={() => openEditItem(item)} disabled={saving}>
                Edit
              </Button>
              <Button variant="danger-ghost" size="sm" onClick={() => void removeItem(item)} disabled={saving}>
                Delete
              </Button>
            </div>,
          ])}
        />
      )}

      <div className={`pos-card pos-card-p ${styles.templateCard}`}>
        <div className={styles.toolbarRow}>
          <div>
            <strong>Templates</strong>
            <p className={styles.hint} style={{ margin: "4px 0 0" }}>
              Starters for new buying lists.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setTemplateModalOpen(true)}>
            + Blank Template
          </Button>
        </div>
        <p className={styles.hint} style={{ marginTop: 0, marginBottom: 12 }}>
          Create a blank template here, or use “Save as template” from a buying list detail to capture its lines.
        </p>
        {templates.length === 0 ? (
          <EmptyState
            title="No templates yet"
            text="Start with a blank template, or save one from an existing buying list."
            actionLabel="+ Blank Template"
            onAction={() => setTemplateModalOpen(true)}
          />
        ) : (
          <DataTable
            headers={["Template", "Lines", ""]}
            rows={templates.map((template) => [
              <div key={`${template.id}-name`}>
                <strong>{template.name}</strong>
                {template.description ? (
                  <div className={styles.hint}>{template.description}</div>
                ) : null}
              </div>,
              <Badge key={`${template.id}-lines`} tone="neutral">
                {(template.lines || []).length} line{(template.lines || []).length === 1 ? "" : "s"}
              </Badge>,
              <Button
                key={`${template.id}-del`}
                variant="danger-ghost"
                size="sm"
                onClick={() => void removeTemplate(template)}
                disabled={saving}
              >
                Delete
              </Button>,
            ])}
          />
        )}
      </div>

      <Modal
        open={itemModalOpen}
        title={itemForm.editingId ? "Edit Item" : "Add Item"}
        onClose={() => setItemModalOpen(false)}
      >
        <div className="ui-form-stack">
          <Input
            label="Item name"
            value={itemForm.name}
            onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Tomato"
          />
          <Input
            label="Category"
            value={itemForm.category}
            onChange={(e) => setItemForm((f) => ({ ...f, category: e.target.value }))}
            placeholder="Vegetables"
          />
          <div className={styles.modalFormRow}>
            <Input
              label="Default qty"
              type="number"
              min={0.001}
              step="0.001"
              value={itemForm.defaultQuantity}
              onChange={(e) => setItemForm((f) => ({ ...f, defaultQuantity: e.target.value }))}
            />
            <Select
              label="Unit"
              value={itemForm.defaultUnit}
              onChange={(e) =>
                setItemForm((f) => ({ ...f, defaultUnit: e.target.value as GroceryUnit }))
              }
            >
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </div>
          <Input
            label="Vendor hint"
            value={itemForm.vendorHint}
            onChange={(e) => setItemForm((f) => ({ ...f, vendorHint: e.target.value }))}
            placeholder="Optional preferred vendor"
          />
          <div className="ui-form-actions">
            <Button variant="secondary" onClick={() => setItemModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveItem()} disabled={saving || !itemForm.name.trim()}>
              {saving ? "Saving…" : itemForm.editingId ? "Update Item" : "Add Item"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={templateModalOpen} title="Blank Template" onClose={() => setTemplateModalOpen(false)}>
        <div className="ui-form-stack">
          <Input
            label="Template name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Daily Morning"
          />
          <p className={styles.hint}>
            Creates an empty template. Add lines later via “Save as template” from a buying list, or start new lists
            from this name.
          </p>
          <div className="ui-form-actions">
            <Button variant="secondary" onClick={() => setTemplateModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void createBlankTemplate()}
              disabled={saving || !templateName.trim()}
            >
              {saving ? "Saving…" : "Create Template"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
