import React from "react";
import type { SalesFactsDto } from "../../../shared/pos";
import { TEXT_LIMITS } from "../../../shared/textLimits";
import { CATEGORY_CHART_COLORS } from "../../theme/external-brands";
import { DataTable } from "../../components/ui/DataTable";
import { Stat } from "../../components/ui/Stat";

const ITEM_PAGE_SIZE = 25;
const DONUT_RADIUS = 42;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

const PAYMENT_COLORS: Record<string, string> = {
  upi: "#0f766e",
  cash: "#d97706",
  card: "#2563eb",
  online: "#7c3aed",
  voucher: "#db2777",
  credit: "#64748b",
  split: "#0891b2",
  other: "#64748b",
};

function compactRupees(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function DonutChart({
  title,
  centerValue,
  centerCaption,
  segments,
  formatValue,
}: {
  title: string;
  centerValue: string;
  centerCaption: string;
  segments: Array<{ key: string; label: string; value: number; color: string }>;
  formatValue: (value: number) => string;
}) {
  const drawn = segments.filter((segment) => segment.value > 0);
  const total = drawn.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  const arcs = drawn.map((segment) => {
    const length = total > 0 ? (segment.value / total) * DONUT_CIRCUMFERENCE : 0;
    const arc = { ...segment, dash: `${length} ${Math.max(0, DONUT_CIRCUMFERENCE - length)}`, offset: -offset };
    offset += length;
    return arc;
  });

  return (
    <div className="rpt-card" style={{ padding: 0 }}>
      <div className="rpt-section-title">{title}</div>
      {arcs.length === 0 ? (
        <div className="rpt-empty-state">Nothing in this range</div>
      ) : (
        <div className="rpt-chart-wrap">
          <svg className="rpt-chart-svg" viewBox="0 0 120 120" role="img" aria-label={title}>
            <circle className="rpt-chart-empty" cx="60" cy="60" r={DONUT_RADIUS} />
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                className="rpt-chart-segment"
                cx="60"
                cy="60"
                r={DONUT_RADIUS}
                stroke={arc.color}
                strokeDasharray={arc.dash}
                strokeDashoffset={arc.offset}
                transform="rotate(-90 60 60)"
              />
            ))}
            <text className="rpt-chart-center" x="60" y="58">
              {centerValue}
            </text>
            <text className="rpt-chart-total" x="60" y="74">
              {centerCaption}
            </text>
          </svg>
          <div>
            {arcs.map((arc) => {
              const percent = total > 0 ? Math.round((arc.value / total) * 100) : 0;
              return (
                <div key={arc.key} className="rpt-legend-row">
                  <span className="rpt-legend-swatch" style={{ background: arc.color }} />
                  <span className="rpt-legend-name">{arc.label}</span>
                  <span className="rpt-legend-value">
                    {formatValue(arc.value)} · {percent}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function SalesFactsView({
  facts,
  loading,
  formatCurrency,
}: {
  facts: SalesFactsDto | null;
  loading: boolean;
  formatCurrency: (value: number) => string;
}) {
  const [itemSearch, setItemSearch] = React.useState("");
  const [visibleItemCount, setVisibleItemCount] = React.useState(ITEM_PAGE_SIZE);
  React.useEffect(() => {
    setVisibleItemCount(ITEM_PAGE_SIZE);
  }, [facts, itemSearch]);

  if (loading && !facts) {
    return <div className="rpt-empty-state">Loading...</div>;
  }
  if (!facts) {
    return <div className="rpt-empty-state">Could not load sales for this range</div>;
  }

  const formatUnits = (value: number) =>
    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
  const maxDay = Math.max(0, ...facts.daily.map((row) => row.netSales));
  const query = itemSearch.trim().toLowerCase();
  const items = facts.items.filter(
    (item) =>
      !query ||
      item.itemName.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query),
  );
  const visibleItems = items.slice(0, visibleItemCount);
  const showBillTotal = facts.billTotal !== facts.netSales;
  const showCollected = facts.amountCollected !== facts.billTotal;
  const showCredit = facts.outstandingCredit > 0;

  return (
    <>
      <div className="rpt-kpi-grid">
        <Stat primary label="Net Sales" value={formatCurrency(facts.netSales)} sub="Taxable value after discounts" />
        <Stat label="Bills" value={facts.billCount} sub="Paid bills" />
        <Stat label="Average Bill" value={formatCurrency(facts.averageBill)} sub="Net Sales / Bills" />
        <Stat
          label="Discounts"
          value={formatCurrency(facts.discountTotal)}
          sub={facts.discountPercent != null ? `${facts.discountPercent}% of pre-discount sales` : "No pre-discount base"}
        />
        {showBillTotal && (
          <Stat label="Bill Total" value={formatCurrency(facts.billTotal)} sub="What the bills total" />
        )}
        {showCollected && (
          <Stat label="Amount Collected" value={formatCurrency(facts.amountCollected)} sub="Money received in this period" />
        )}
        {showCredit && (
          <Stat
            label="Outstanding Credit"
            value={formatCurrency(facts.outstandingCredit)}
            sub="Open balance across all dates"
          />
        )}
      </div>

      <div className="rpt-bottom">
        <DonutChart
          title="How bills were paid"
          centerValue={compactRupees(facts.billTotal)}
          centerCaption="Bill total"
          formatValue={formatCurrency}
          segments={[...facts.tenders]
            .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
            .map((row) => ({
              key: row.method,
              label: row.label,
              value: row.amount,
              color: PAYMENT_COLORS[row.method] || CATEGORY_CHART_COLORS[0],
            }))}
        />
        <DonutChart
          title="Sales by category"
          centerValue={compactRupees(facts.netSales)}
          centerCaption="Net sales"
          formatValue={formatCurrency}
          segments={[...facts.categories]
            .sort((a, b) => b.netSales - a.netSales || a.category.localeCompare(b.category))
            .map((row, index) => ({
              key: row.category,
              label: row.category,
              value: row.netSales,
              color: CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length],
            }))}
        />
      </div>

      {facts.daily.length > 1 ? (
        <div className="rpt-card" style={{ padding: 0, marginTop: 16 }}>
          <div className="rpt-section-title">Sales by Day</div>
          <div className="rpt-day-chart" role="img" aria-label="Net sales by day">
            {facts.daily.map((row) => (
              <div key={row.date} className="rpt-day-col" title={`${row.date}: ${formatCurrency(row.netSales)}`}>
                <div
                  className="rpt-day-bar"
                  style={{ height: maxDay > 0 ? `${Math.max(2, (row.netSales / maxDay) * 100)}%` : "2px" }}
                />
                <span className="rpt-day-label">{row.date.slice(8)}</span>
              </div>
            ))}
          </div>
          <DataTable
            headers={["Date", "Net Sales", "Bills", "Avg Bill"]}
            rows={facts.daily.map((row) => [
              row.date,
              formatCurrency(row.netSales),
              String(row.bills),
              formatCurrency(row.averageBill),
            ])}
          />
        </div>
      ) : null}

      <div className="rpt-bottom" style={{ marginTop: 16 }}>
        <div className="rpt-card" style={{ padding: 0 }}>
          <div className="rpt-section-title">Service mode</div>
          <DataTable
            headers={["Mode", "Bills", "Net Sales", "Avg Bill"]}
            rows={
              facts.serviceModes.length
                ? facts.serviceModes.map((row) => [
                    row.label,
                    String(row.bills),
                    formatCurrency(row.netSales),
                    formatCurrency(row.averageBill),
                  ])
                : []
            }
          />
          {facts.serviceModes.length === 0 && <div className="rpt-empty-state">No bills in this range</div>}
        </div>
        <div className="rpt-card" style={{ padding: 0 }}>
          <div className="rpt-section-title">Item sales</div>
          {facts.items.length > 0 && (
            <div className="rpt-table-toolbar">
              <input
                className="rpt-search-input"
                value={itemSearch}
                onChange={(event) => setItemSearch(event.target.value)}
                placeholder="Search item or category"
                maxLength={TEXT_LIMITS.search}
                aria-label="Search menu items sold"
              />
            </div>
          )}
          <DataTable
            headers={["Item", "Category", "Units Sold", "Net Sales"]}
            rows={visibleItems.map((row) => [
              row.itemName,
              row.category,
              formatUnits(row.units),
              formatCurrency(row.netSales),
            ])}
          />
          {facts.items.length === 0 && <div className="rpt-empty-state">No menu items sold for this range</div>}
          {facts.items.length > 0 && items.length === 0 && (
            <div className="rpt-empty-state">No menu items match this search</div>
          )}
          {visibleItems.length < items.length && (
            <div className="rpt-table-foot">
              <span>
                Showing {visibleItems.length} of {items.length} items
              </span>
              <button type="button" className="rpt-show-more" onClick={() => setVisibleItemCount((count) => count + ITEM_PAGE_SIZE)}>
                Show more
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
