import React from "react";
import { getFoodCostSummary } from "../../../../app/db/posRepository";
import type { FoodCostSummaryDto } from "../../../../shared/pos";
import { validationMessage } from "../../../../shared/validation";
import { DataTable } from "../../../components/ui/DataTable";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import {
  formatCurrency,
  fromInputDate,
  getHistoryRange,
  toInputDate,
  type HistoryPreset,
} from "../groceryUtils";
import styles from "../Grocery.module.css";

const EMPTY_SUMMARY: FoodCostSummaryDto = {
  netSales: 0,
  grossSales: 0,
  grocerySpend: 0,
  estimatedGrossProfit: 0,
  foodCostPercent: null,
  purchaseCount: 0,
  topItems: [],
  topVendors: [],
};

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
  return { from, to };
}

type CategorySpend = { category: string; amount: number; percent: number };

function aggregateCategories(summary: FoodCostSummaryDto): CategorySpend[] {
  const map = new Map<string, number>();
  for (const item of summary.topItems) {
    const key = (item.category || "").trim() || "Uncategorized";
    map.set(key, (map.get(key) || 0) + Number(item.amount || 0));
  }
  const total =
    Array.from(map.values()).reduce((sum, n) => sum + n, 0) || summary.grocerySpend || 1;
  return Array.from(map.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      percent: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function InsightsView() {
  const initial = monthRange();
  const [summary, setSummary] = React.useState<FoodCostSummaryDto>(EMPTY_SUMMARY);
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<string | null>(null);
  const [preset, setPreset] = React.useState<"month" | HistoryPreset>("month");
  const [fromTs, setFromTs] = React.useState(initial.from);
  const [toTs, setToTs] = React.useState(initial.to);

  const applyPreset = (next: "month" | HistoryPreset) => {
    setPreset(next);
    if (next === "month") {
      const range = monthRange();
      setFromTs(range.from);
      setToTs(range.to);
      return;
    }
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
      const data = await getFoodCostSummary({ from: fromTs, to: toTs });
      setSummary(data);
    } catch (error) {
      setStatus(validationMessage(error, "Could not load grocery insights"));
      setSummary(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, [fromTs, toTs]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const categories = React.useMemo(() => aggregateCategories(summary), [summary]);
  const itemTotal = summary.topItems.reduce((sum, row) => sum + Number(row.amount || 0), 0) || 1;

  return (
    <div className={styles.listPage}>
      <PageHeader
        title="Insights"
        subtitle="Actionable grocery procurement KPIs — not restaurant profit."
      />

      {status && <div className={styles.status}>{status}</div>}

      <div className={styles.dateControls}>
        {(
          [
            ["month", "This month"],
            ["30d", "30 Days"],
            ["7d", "7 Days"],
            ["custom", "Custom"],
          ] as Array<["month" | HistoryPreset, string]>
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
            <input
              className="pos-input"
              style={{ width: 145 }}
              type="date"
              value={toInputDate(fromTs)}
              onChange={(e) => setFromTs(fromInputDate(e.target.value))}
            />
            <input
              className="pos-input"
              style={{ width: 145 }}
              type="date"
              value={toInputDate(toTs)}
              onChange={(e) => setToTs(fromInputDate(e.target.value, true))}
            />
          </>
        )}
      </div>

      {loading ? (
        <div className={styles.status}>Loading insights…</div>
      ) : (
        <>
          <div className={styles.kpiGrid}>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Grocery Purchases</div>
              <div className={styles.kpiValue}>{formatCurrency(summary.grocerySpend)}</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Purchase count</div>
              <div className={styles.kpiValue}>{summary.purchaseCount}</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Food cost %</div>
              <div className={styles.kpiValue}>
                {summary.foodCostPercent === null ? "N/A" : `${summary.foodCostPercent}%`}
              </div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Net sales (context)</div>
              <div className={styles.kpiValue}>{formatCurrency(summary.netSales)}</div>
            </div>
          </div>
          <p className={styles.hint}>
            Food cost % uses grocery purchases vs net sales for the range. It is a procurement
            signal, not operating profit. Full profitability lives under Reports.
          </p>

          <div className={styles.stack}>
            <div className={`pos-card pos-card-p ${styles.listCard}`}>
              <div className="pos-sect-label">Spend by category</div>
              {categories.length === 0 ? (
                <EmptyState
                  title="No category spend"
                  text="Record itemized purchases to see category breakdown."
                />
              ) : (
                <DataTable
                  headers={["Category", "Amount", "% of spend"]}
                  rows={categories.map((row) => [
                    row.category,
                    formatCurrency(row.amount),
                    `${row.percent}%`,
                  ])}
                />
              )}
            </div>

            <div className={`pos-card pos-card-p ${styles.listCard}`}>
              <div className="pos-sect-label">Top items</div>
              {summary.topItems.length === 0 ? (
                <EmptyState title="No item spend" text="No grocery purchase lines in this range." />
              ) : (
                <DataTable
                  headers={["Item", "Qty", "Spend", "%"]}
                  rows={summary.topItems.map((item) => {
                    const pct =
                      itemTotal > 0
                        ? Math.round((Number(item.amount || 0) / itemTotal) * 1000) / 10
                        : 0;
                    return [
                      <div key={`${item.itemName}-label`}>
                        <strong>{item.itemName}</strong>
                        {item.category ? <div className={styles.hint}>{item.category}</div> : null}
                      </div>,
                      item.quantity ? `${item.quantity} ${item.unit || ""}`.trim() : "—",
                      formatCurrency(item.amount),
                      `${pct}%`,
                    ];
                  })}
                />
              )}
            </div>

            <div className={`pos-card pos-card-p ${styles.listCard}`}>
              <div className="pos-sect-label">Vendor spend</div>
              {summary.topVendors.length === 0 ? (
                <EmptyState
                  title="No vendor spend"
                  text="Link purchases to vendors to see this breakdown."
                />
              ) : (
                <DataTable
                  headers={["Vendor", "Purchases", "Spend"]}
                  rows={summary.topVendors.map((vendor) => [
                    vendor.vendor || "—",
                    String(vendor.purchaseCount),
                    formatCurrency(vendor.amount),
                  ])}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
