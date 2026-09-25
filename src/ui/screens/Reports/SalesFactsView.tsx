import React from "react";
import type { SalesFactsDto } from "../../../shared/pos";
import { DataTable } from "../../components/ui/DataTable";
import { Stat } from "../../components/ui/Stat";

const ITEM_PAGE_SIZE = 25;

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

      <div className="rpt-card" style={{ padding: 0 }}>
        <div className="rpt-section-title">Sales by Day</div>
        {facts.daily.length ? (
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
        ) : (
          <div className="rpt-empty-state">No days in this range</div>
        )}
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

      <div className="rpt-bottom">
        <div className="rpt-card" style={{ padding: 0 }}>
          <div className="rpt-section-title">Payment method — Bill Total</div>
          <div style={{ padding: "8px 20px 18px", fontSize: 12, color: "var(--pos-tx-muted)" }}>
            How bills in this period were settled. This is not cash collected.
          </div>
          <div style={{ padding: "0 20px 18px" }}>
            {facts.tenders.length === 0 ? (
              <div className="rpt-empty-state">No bills in this range</div>
            ) : (
              facts.tenders.map((row) => (
                <div key={row.method} className="rpt-pay-row">
                  <div className="rpt-pay-meta">
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{row.label}</span>
                    <div>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{formatCurrency(row.amount)}</span>
                      <span style={{ fontSize: 11, marginLeft: 7, color: "var(--pos-tx-muted)" }}>{row.percent}%</span>
                    </div>
                  </div>
                  <div className="rpt-pay-bar-bg">
                    <div className="rpt-pay-bar-fill" style={{ width: `${Math.min(100, row.percent)}%`, background: "var(--pos-teal)" }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rpt-card" style={{ padding: 0 }}>
          <div className="rpt-section-title">Service Mode</div>
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
      </div>

      <div className="rpt-product-grid">
        <div className="rpt-card" style={{ padding: 0 }}>
          <div className="rpt-section-title">Category Sales</div>
          <DataTable
            headers={["Category", "Units Sold", "Net Sales"]}
            rows={facts.categories.map((row) => [row.category, formatUnits(row.units), formatCurrency(row.netSales)])}
          />
          {facts.categories.length === 0 && <div className="rpt-empty-state">No category sales for this range</div>}
        </div>
        <div className="rpt-card" style={{ padding: 0 }}>
          <div className="rpt-section-title">Item Sales</div>
          {facts.items.length > 0 && (
            <div className="rpt-table-toolbar">
              <input
                className="rpt-search-input"
                value={itemSearch}
                onChange={(event) => setItemSearch(event.target.value)}
                placeholder="Search item or category"
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
