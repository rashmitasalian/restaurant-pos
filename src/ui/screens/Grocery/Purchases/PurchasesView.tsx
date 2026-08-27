import React from "react";
import {
  listGroceryPurchaseHeaders,
  listGroceryPurchases,
  voidGroceryPurchaseHeader,
  type GroceryPurchaseLineDoc,
} from "../../../../app/db/posRepository";
import type { GroceryPurchaseDto } from "../../../../shared/pos";
import { validationMessage } from "../../../../shared/validation";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { DataTable } from "../../../components/ui/DataTable";
import { Drawer } from "../../../components/ui/Drawer";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input } from "../../../components/ui/Input";
import {
  formatCurrency,
  formatListDate,
  fromInputDate,
  getHistoryRange,
  toInputDate,
  type HistoryPreset,
} from "../groceryUtils";
import styles from "../Grocery.module.css";

function shortId(id?: string | null) {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function paymentTone(status: string): "neutral" | "attention" | "success" | "danger" {
  if (status === "paid") return "success";
  if (status === "partial") return "attention";
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

  const applyPreset = (next: HistoryPreset) => {
    setPreset(next);
    if (next === "custom") return;
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

  const voidPurchase = async (header: GroceryPurchaseDto) => {
    if (header.status === "voided") return;
    if (!window.confirm(`Void purchase of ${formatCurrency(header.total)}? This cannot be undone.`)) {
      return;
    }
    setSaving(true);
    try {
      await voidGroceryPurchaseHeader(header.id);
      setStatus("Purchase voided");
      if (selected?.id === header.id) {
        setSelected(null);
        setLines([]);
      }
      await load();
    } catch (error) {
      setStatus(validationMessage(error, "Could not void purchase"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.listPage}>
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
        <label className={styles.hint} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
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
          text="Record purchases from a buying list, or widen the date filter."
        />
      ) : (
        <DataTable
          headers={["Date", "Vendor", "Total", "Payment", "Status", "List", ""]}
          rows={headers.map((header) => [
            <div key={`${header.id}-date`}>
              {formatListDate(header.purchaseDate)}
                  {header.migrationSource === "legacy_grocery_purchase" ? (
                <div style={{ marginTop: 4 }}>
                  <Badge tone="attention">Legacy purchase</Badge>
                </div>
              ) : null}
            </div>,
            header.vendorName || "—",
            formatCurrency(header.total),
            <Badge key={`${header.id}-pay`} tone={paymentTone(header.paymentStatus)}>
              {header.paymentStatus}
            </Badge>,
            <Badge key={`${header.id}-st`} tone={header.status === "voided" ? "danger" : "success"}>
              {header.status}
            </Badge>,
            shortId(header.buyingListId),
            <div key={`${header.id}-actions`} className={styles.actions}>
              <Button variant="ghost" size="sm" onClick={() => void openDetail(header)}>
                Lines
              </Button>
              {header.status !== "voided" ? (
                <Button
                  variant="danger-ghost"
                  size="sm"
                  onClick={() => void voidPurchase(header)}
                  disabled={saving}
                >
                  Void Purchase
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
            <Button variant="danger-ghost" onClick={() => void voidPurchase(selected)} disabled={saving}>
              Void Purchase
            </Button>
          ) : undefined
        }
      >
        {!selected ? null : (
          <div className={styles.stack}>
            <div className={styles.kpiGrid} style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Total</div>
                <div className={styles.kpiValue}>{formatCurrency(selected.total)}</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Vendor</div>
                <div className={styles.kpiValue} style={{ fontSize: 16 }}>
                  {selected.vendorName || "—"}
                </div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Linked list</div>
                <div className={styles.kpiValue} style={{ fontSize: 16 }}>
                  {shortId(selected.buyingListId)}
                </div>
              </div>
            </div>
            <div className={styles.actions}>
              <Badge tone={paymentTone(selected.paymentStatus)}>{selected.paymentStatus}</Badge>
              <Badge tone={selected.status === "voided" ? "danger" : "success"}>{selected.status}</Badge>
              {selected.migrationSource === "legacy_grocery_purchase" ? (
                <Badge tone="attention">Legacy</Badge>
              ) : null}
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
    </div>
  );
}
