import React from "react";
import {
  listGroceryLists,
  listGroceryPurchaseHeaders,
  listGroceryPurchases,
  voidGroceryPurchaseHeader,
  type GroceryListDoc,
  type GroceryPurchaseLineDoc,
} from "../../../../app/db/posRepository";
import type { GroceryPurchaseDto } from "../../../../shared/pos";
import { validationMessage } from "../../../../shared/validation";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { ConfirmModal } from "../../../components/ui/ConfirmModal";
import { DataTable } from "../../../components/ui/DataTable";
import { Drawer } from "../../../components/ui/Drawer";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input } from "../../../components/ui/Input";
import { Modal } from "../../../components/ui/Modal";
import { Select } from "../../../components/ui/Select";
import {
  formatCurrency,
  formatListDate,
  fromInputDate,
  getHistoryRange,
  toInputDate,
  type HistoryPreset,
} from "../groceryUtils";
import styles from "../Grocery.module.css";
import { RecordPurchaseFlow } from "./RecordPurchaseFlow";

function formatLinkedList(header: GroceryPurchaseDto) {
  if (header.buyingListTitle) {
    return header.buyingListTitle;
  }
  if (header.buyingListId) {
    return "Deleted list";
  }
  return "—";
}

function paymentTone(status: string): "neutral" | "attention" | "success" | "danger" {
  if (status === "paid") {
    return "success";
  }
  if (status === "partial") {
    return "attention";
  }
  return "neutral";
}

export function PurchasesView() {
  const [headers, setHeaders] = React.useState<GroceryPurchaseDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [preset, setPreset] = React.useState<HistoryPreset>("30d");
  const [fromTs, setFromTs] = React.useState(() => getHistoryRange("30d").from);
  const [toTs, setToTs] = React.useState(() => getHistoryRange("30d").to);
  const [includeVoided, setIncludeVoided] = React.useState(true);
  const [selected, setSelected] = React.useState<GroceryPurchaseDto | null>(null);
  const [lines, setLines] = React.useState<GroceryPurchaseLineDoc[]>([]);
  const [linesLoading, setLinesLoading] = React.useState(false);
  const [pickListOpen, setPickListOpen] = React.useState(false);
  const [openLists, setOpenLists] = React.useState<GroceryListDoc[]>([]);
  const [pickedListId, setPickedListId] = React.useState("");
  const [purchaseListId, setPurchaseListId] = React.useState<string | null>(null);
  const [voidTarget, setVoidTarget] = React.useState<GroceryPurchaseDto | null>(null);

  const applyPreset = (next: HistoryPreset) => {
    setPreset(next);
    if (next === "custom") {
      return;
    }
    const range = getHistoryRange(next);
    setFromTs(range.from);
    setToTs(range.to);
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await listGroceryPurchaseHeaders({
        from: fromTs,
        to: toTs,
        includeVoided,
        limit: 200,
      })) as GroceryPurchaseDto[];
      setHeaders(rows);
    } catch (error) {
      setStatus(validationMessage(error, "Could not load purchases"));
    } finally {
      setLoading(false);
    }
  }, [fromTs, toTs, includeVoided]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const openRecordPurchase = async () => {
    try {
      const range = getHistoryRange("active");
      const lists = await listGroceryLists({ from: range.from, to: range.to, limit: 80 });
      const eligible = lists.filter(
        (list) => list.status !== "cancelled" && list.status !== "completed",
      );
      setOpenLists(eligible);
      setPickedListId(eligible[0]?.id || "");
      setPickListOpen(true);
    } catch (error) {
      setStatus(validationMessage(error, "Could not load buying lists"));
    }
  };

  const openDetail = async (header: GroceryPurchaseDto) => {
    setSelected(header);
    setLinesLoading(true);
    setLines([]);
    try {
      if (header.lines?.length) {
        setLines(header.lines as GroceryPurchaseLineDoc[]);
      } else {
        const purchaseLines = await listGroceryPurchases({
          from: header.purchaseDate,
          to: header.purchaseDate,
          listId: header.buyingListId || undefined,
          limit: 200,
        });
        const matched = purchaseLines.filter(
          (line) =>
            line.purchaseId === header.id ||
            (!line.purchaseId && header.migrationSource === "legacy_grocery_purchase"),
        );
        setLines(matched.length ? matched : purchaseLines.slice(0, 50));
      }
    } catch (error) {
      setStatus(validationMessage(error, "Could not load purchase lines"));
    } finally {
      setLinesLoading(false);
    }
  };

  const requestVoidPurchase = (header: GroceryPurchaseDto) => {
    if (header.status === "voided") {
      return;
    }
    setVoidTarget(header);
  };

  const confirmVoidPurchase = async () => {
    if (!voidTarget || voidTarget.status === "voided" || saving) {
      return;
    }
    setSaving(true);
    try {
      await voidGroceryPurchaseHeader(voidTarget.id);
      setStatus("Purchase voided — linked buying list updated");
      if (selected?.id === voidTarget.id) {
        setSelected(null);
        setLines([]);
      }
      setVoidTarget(null);
      await load();
    } catch (error) {
      setStatus(validationMessage(error, "Could not void purchase"));
    } finally {
      setSaving(false);
    }
  };

  const recordedSpend = headers
    .filter((h) => h.status !== "voided")
    .reduce((sum, h) => sum + Number(h.total || 0), 0);

  const voidListLabel = voidTarget ? formatLinkedList(voidTarget) : "—";

  return (
    <div className={styles.listPage}>
      <div className={styles.toolbarRow}>
        <div className={styles.todaySummary}>
          <strong>Purchases</strong>
          <span>
            {headers.filter((h) => h.status !== "voided").length} recorded ·{" "}
            {formatCurrency(recordedSpend)} spend in range
          </span>
        </div>
        <Button variant="primary" onClick={() => void openRecordPurchase()}>
          + Record Purchase
        </Button>
      </div>

      {status && <div className={styles.status}>{status}</div>}

      <div className={styles.dateControls}>
        {(
          [
            ["today", "Today"],
            ["7d", "7 Days"],
            ["30d", "30 Days"],
            ["custom", "Custom"],
          ] as Array<[HistoryPreset, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`${styles.presetBtn} ${preset === id ? styles.presetActive : ""}`}
            onClick={() => applyPreset(id)}
          >
            {label}
          </button>
        ))}
        {preset === "custom" && (
          <>
            <Input
              type="date"
              value={toInputDate(fromTs)}
              onChange={(e) => setFromTs(fromInputDate(e.target.value))}
              aria-label="From date"
            />
            <Input
              type="date"
              value={toInputDate(toTs)}
              onChange={(e) => setToTs(fromInputDate(e.target.value, true))}
              aria-label="To date"
            />
          </>
        )}
        <label
          className={styles.hint}
          style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
        >
          <input
            type="checkbox"
            checked={includeVoided}
            onChange={(e) => setIncludeVoided(e.target.checked)}
          />
          Include voided
        </label>
      </div>

      {loading ? (
        <div className={styles.status}>Loading purchases…</div>
      ) : headers.length === 0 ? (
        <EmptyState
          title="No purchases in this range"
          text="Record a purchase from an open buying list, or widen the date filter."
          actionLabel="+ Record Purchase"
          onAction={() => void openRecordPurchase()}
        />
      ) : (
        <DataTable
          columns={[
            { header: "Date", nowrap: true },
            { header: "Vendor" },
            { header: "Total", align: "right", nowrap: true },
            { header: "Payment", nowrap: true },
            { header: "Status", nowrap: true },
            { header: "List" },
            { header: "", nowrap: true, align: "right" },
            { header: "", nowrap: true, align: "right" },
          ]}
          rows={headers.map((header) => [
            <div key={`${header.id}-date`}>
              {formatListDate(header.purchaseDate)}
              {header.migrationSource === "legacy_grocery_purchase" ? (
                <div style={{ marginTop: 4 }}>
                  <Badge tone="attention">Legacy purchase</Badge>
                </div>
              ) : null}
            </div>,
            header.vendorName || "Not specified",
            formatCurrency(header.total),
            <Badge key={`${header.id}-pay`} tone={paymentTone(header.paymentStatus)}>
              {header.paymentStatus}
            </Badge>,
            <Badge key={`${header.id}-st`} tone={header.status === "voided" ? "danger" : "success"}>
              {header.status}
            </Badge>,
            <span
              key={`${header.id}-list`}
              className={styles.listNameCell}
              title={formatLinkedList(header)}
            >
              {formatLinkedList(header)}
            </span>,
            <div key={`${header.id}-lines`} className={styles.tableActionCell}>
              <Button variant="ghost" size="sm" onClick={() => void openDetail(header)}>
                Lines
              </Button>
            </div>,
            <div key={`${header.id}-void`} className={styles.tableActionCell}>
              {header.status !== "voided" ? (
                <Button
                  variant="danger-ghost"
                  size="sm"
                  onClick={() => requestVoidPurchase(header)}
                  disabled={saving}
                >
                  Void
                </Button>
              ) : null}
            </div>,
          ])}
        />
      )}

      <Drawer
        open={Boolean(selected)}
        title={selected ? `Purchase · ${formatListDate(selected.purchaseDate)}` : "Purchase"}
        onClose={() => {
          setSelected(null);
          setLines([]);
        }}
        wide
        footer={
          selected && selected.status !== "voided" ? (
            <Button
              variant="danger-ghost"
              onClick={() => requestVoidPurchase(selected)}
              disabled={saving}
            >
              Void Purchase
            </Button>
          ) : undefined
        }
      >
        {!selected ? null : (
          <div className={styles.stack}>
            <div
              className={styles.kpiGrid}
              style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
            >
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Total</div>
                <div className={styles.kpiValue}>{formatCurrency(selected.total)}</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Vendor</div>
                <div className={styles.kpiValue} style={{ fontSize: 16 }}>
                  {selected.vendorName || "Not specified"}
                </div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Linked list</div>
                <div className={styles.kpiValue} style={{ fontSize: 16 }}>
                  {formatLinkedList(selected)}
                </div>
              </div>
            </div>
            <div className={styles.actions}>
              <Badge tone={paymentTone(selected.paymentStatus)}>{selected.paymentStatus}</Badge>
              <Badge tone={selected.status === "voided" ? "danger" : "success"}>
                {selected.status}
              </Badge>
            </div>
            <div className="pos-sect-label">Line items</div>
            {linesLoading ? (
              <div className={styles.status}>Loading lines…</div>
            ) : lines.length === 0 ? (
              <EmptyState title="No line detail" text="This purchase has no itemized lines." />
            ) : (
              <DataTable
                headers={["Item", "Qty", "Amount"]}
                rows={lines.map((line) => [
                  line.itemName,
                  `${line.quantity} ${line.unit}`,
                  formatCurrency(line.totalAmount),
                ])}
              />
            )}
          </div>
        )}
      </Drawer>

      <ConfirmModal
        open={Boolean(voidTarget)}
        title="Void purchase?"
        onClose={() => setVoidTarget(null)}
        onConfirm={confirmVoidPurchase}
        confirmLabel="Void purchase"
        loading={saving}
      >
        {voidTarget ? (
          <p style={{ margin: 0 }}>
            This will void a purchase of <strong>{formatCurrency(voidTarget.total)}</strong>
            {voidListLabel !== "—" ? (
              <>
                {" "}
                from <strong>{voidListLabel}</strong>
              </>
            ) : null}
            . The linked buying list will be updated.
          </p>
        ) : null}
      </ConfirmModal>

      <Modal open={pickListOpen} title="Record Purchase" onClose={() => setPickListOpen(false)}>
        <div className="ui-form-stack">
          {openLists.length === 0 ? (
            <div className={styles.hint}>
              No open buying lists in the active range. Create or reopen a list first.
            </div>
          ) : (
            <Select
              label="Buying list"
              value={pickedListId}
              onChange={(e) => setPickedListId(e.target.value)}
            >
              {openLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.title} · {formatListDate(list.listDate)} · {list.status}
                </option>
              ))}
            </Select>
          )}
          <div className="ui-form-actions">
            <Button variant="secondary" onClick={() => setPickListOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!pickedListId}
              onClick={() => {
                setPickListOpen(false);
                setPurchaseListId(pickedListId);
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      </Modal>

      {purchaseListId && (
        <RecordPurchaseFlow
          listId={purchaseListId}
          onClose={() => setPurchaseListId(null)}
          onChanged={async () => {
            await load();
            setStatus("Purchase recorded");
          }}
        />
      )}
    </div>
  );
}
