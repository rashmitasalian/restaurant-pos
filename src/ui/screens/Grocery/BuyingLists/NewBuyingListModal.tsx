import React from "react";
import {
  createGroceryList,
  type GroceryListDoc,
} from "../../../../app/db/posRepository";
import type { BuyingListTemplateDto, GroceryListType } from "../../../../shared/pos";
import { validationMessage } from "../../../../shared/validation";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import {
  fromInputDate,
  listTypeLabel,
  suggestListName,
  toInputDate,
} from "../groceryUtils";
import styles from "../Grocery.module.css";

type StartFrom = "blank" | "template" | "previous";

type Props = {
  open: boolean;
  templates: BuyingListTemplateDto[];
  recentLists: GroceryListDoc[];
  onClose: () => void;
  onCreated: (list: GroceryListDoc) => void | Promise<void>;
};

export function NewBuyingListModal({
  open,
  templates,
  recentLists,
  onClose,
  onCreated,
}: Props) {
  const [title, setTitle] = React.useState(suggestListName());
  const [listDate, setListDate] = React.useState(toInputDate(Date.now()));
  const [listType, setListType] = React.useState<GroceryListType>("regular");
  const [startFrom, setStartFrom] = React.useState<StartFrom>("blank");
  const [templateId, setTemplateId] = React.useState("");
  const [sourceListId, setSourceListId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTitle(suggestListName());
    setListDate(toInputDate(Date.now()));
    setListType("regular");
    setStartFrom("blank");
    setTemplateId(templates[0]?.id || "");
    setSourceListId(recentLists[0]?.id || "");
    setError(null);
    setSaving(false);
  }, [open, templates, recentLists]);

  const create = async () => {
    if (saving) return;
    if (startFrom === "template" && !templateId) {
      setError("Select a template to start from.");
      return;
    }
    if (startFrom === "previous" && !sourceListId) {
      setError("Select a previous buying list.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const list = await createGroceryList({
        title: title.trim() || suggestListName(),
        listDate: fromInputDate(listDate),
        listType,
        ...(startFrom === "blank" ? { lines: [] } : {}),
        ...(startFrom === "template" ? { templateId } : {}),
        ...(startFrom === "previous" ? { sourceListId } : {}),
      });
      await onCreated(list);
    } catch (err) {
      setError(validationMessage(err, "Could not create buying list"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Create Buying List" onClose={onClose}>
      <div className={`ui-form-stack ${styles.modalForm}`}>
        <Input
          label="List name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={suggestListName()}
          autoFocus
        />
        <div className={styles.modalFormRow}>
          <Input
            label="Date"
            type="date"
            value={listDate}
            onChange={(e) => setListDate(e.target.value)}
          />
          <Select
            label="Type"
            value={listType}
            onChange={(e) => setListType(e.target.value as GroceryListType)}
          >
            {(["regular", "refill", "emergency", "custom"] as GroceryListType[]).map((type) => (
              <option key={type} value={type}>
                {listTypeLabel(type)}
              </option>
            ))}
          </Select>
        </div>

        <div className={styles.modalStartFrom}>
          <div className="ui-label">Start from</div>
          <div className={styles.recordModeOptions} role="radiogroup" aria-label="Start from">
            {(
              [
                ["blank", "Blank list"],
                ["template", "Reusable template"],
                ["previous", "Previous buying list"],
              ] as Array<[StartFrom, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${styles.recordModeButton} ${
                  startFrom === id ? styles.recordModeButtonActive : ""
                }`}
                aria-pressed={startFrom === id}
                onClick={() => setStartFrom(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {startFrom === "template" && (
          <Select
            label="Template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {!templates.length && <option value="">No templates yet</option>}
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
                {tpl.lines?.length ? ` (${tpl.lines.length} items)` : ""}
              </option>
            ))}
          </Select>
        )}

        {startFrom === "previous" && (
          <Select
            label="Previous list"
            value={sourceListId}
            onChange={(e) => setSourceListId(e.target.value)}
          >
            {!recentLists.length && <option value="">No recent lists</option>}
            {recentLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.title}
              </option>
            ))}
          </Select>
        )}

        {error && (
          <div className={styles.status} style={{ color: "var(--pos-danger)" }}>
            {error}
          </div>
        )}

        <div className="ui-form-actions">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} loading={saving}>
            Create List
          </Button>
        </div>
      </div>
    </Modal>
  );
}
