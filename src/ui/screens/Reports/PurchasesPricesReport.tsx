import React from "react";
import type { GroceryPurchaseAnalysisDto } from "../../../shared/pos";
import { ENV } from "../../../config/env";
import { DataTable } from "../../components/ui/DataTable";
import { Drawer } from "../../components/ui/Drawer";
import { Stat } from "../../components/ui/Stat";
import { groceryUnitLabel } from "../Grocery/groceryUtils";

const PRICE_ALERT_PCT = 10;
const PAGE_SIZE = 10;
const UNALLOCATED_TOOLTIP =
  "Purchase value recorded on bills without item-level amounts. Included in total purchases but excluded from item price analysis.";
const UNALLOCATED_NOTE =
  "Item purchase values include only purchases with item-level amounts. Unallocated purchase value is included in Grocery Purchases.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type PurchaseRow = GroceryPurchaseAnalysisDto["purchaseRows"][number];
type PriceRow = GroceryPurchaseAnalysisDto["priceRows"][number];
type PurchaseSort = "value" | "quantity" | "change" | "name";
type PriceSort = "increase" | "decrease" | "name";

function formatCurrency(value: number) {
  try {
    return new Intl.NumberFormat(ENV.CURRENCY_LOCALE, {
      style: "currency",
      currency: ENV.CURRENCY_CODE,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `₹${Math.round(value * 100) / 100}`;
  }
}

function formatNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded.toLocaleString(ENV.CURRENCY_LOCALE, { maximumFractionDigits: 3 });
}

/** Quantities are normalised to kg / L; show sub-unit amounts in g / ml so 100 g doesn't read as 0.1 kg. */
function formatQty(quantity: number, unit: string) {
  if (quantity > 0 && quantity < 1 && unit === "kg") {
    return `${formatNumber(quantity * 1000)} g`;
  }
  if (quantity > 0 && quantity < 1 && unit === "L") {
    return `${formatNumber(quantity * 1000)} ml`;
  }
  return `${formatNumber(quantity)} ${groceryUnitLabel(unit)}`;
}

function formatWhen(ts: number) {
  const date = new Date(ts);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function formatPct(value: number) {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function QuantityChange({ row }: { row: PurchaseRow }) {
  if (row.quantityChangePct == null) {
    return <span className="rpt-muted">New</span>;
  }
  if (row.quantityChangePct === 0) {
    return <span className="rpt-muted">No change</span>;
  }
  return (
    <span>
      {row.quantityChangePct > 0 ? "↑ +" : "↓ −"}
      {formatPct(row.quantityChangePct)}%
    </span>
  );
}

function PriceChange({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span className="rpt-muted" title="First recorded price for this item">
        —
      </span>
    );
  }
  if (value === 0) {
    return <span className="rpt-muted">No change</span>;
  }
  const alert = Math.abs(value) >= PRICE_ALERT_PCT;
  const cls = alert ? (value > 0 ? "rpt-change-up" : "rpt-change-down") : undefined;
  return (
    <span className={cls}>
      {value > 0 ? "↑ +" : "↓ −"}
      {formatPct(value)}%
    </span>
  );
}

function PricePoint({ price, unit }: { price: PriceRow["latest"] | null; unit: string }) {
  if (!price) {
    return <span className="rpt-muted">—</span>;
  }
  return (
    <span className="rpt-price-point">
      <strong>
        {formatCurrency(price.unitPrice)}/{groceryUnitLabel(unit)}
      </strong>
      <small>{formatWhen(price.date)}</small>
    </span>
  );
}

function sortPurchases(rows: PurchaseRow[], sort: PurchaseSort) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sort === "quantity") {
      return b.purchasedQuantity - a.purchasedQuantity || a.itemName.localeCompare(b.itemName);
    }
    if (sort === "change") {
      const av = a.quantityChangePct ?? Number.POSITIVE_INFINITY;
      const bv = b.quantityChangePct ?? Number.POSITIVE_INFINITY;
      return bv - av || a.itemName.localeCompare(b.itemName);
    }
    if (sort === "name") {
      return a.itemName.localeCompare(b.itemName) || a.unit.localeCompare(b.unit);
    }
    return b.purchaseValue - a.purchaseValue || a.itemName.localeCompare(b.itemName);
  });
  return sorted;
}

function sortPrices(rows: PriceRow[], sort: PriceSort) {
  if (sort === "increase") {
    return rows;
  }
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sort === "decrease") {
      const av = a.changePct ?? Number.POSITIVE_INFINITY;
      const bv = b.changePct ?? Number.POSITIVE_INFINITY;
      return av - bv || a.itemName.localeCompare(b.itemName);
    }
    return a.itemName.localeCompare(b.itemName) || a.unit.localeCompare(b.unit);
  });
  return sorted;
}

function TableFoot({
  shown,
  total,
  noun,
  onMore,
}: {
  shown: number;
  total: number;
  noun: string;
  onMore: () => void;
}) {
  if (total <= PAGE_SIZE) {
    return null;
  }
  return (
    <div className="rpt-table-foot">
      <span>
        Showing {shown} of {total} {noun}
      </span>
      {shown < total ? (
        <button type="button" className="rpt-show-more" onClick={onMore}>
          Show {Math.min(PAGE_SIZE * 2, total - shown)} more
        </button>
      ) : null}
    </div>
  );
}

export function PurchasesPricesReport({
  report,
  loading,
}: {
  report: GroceryPurchaseAnalysisDto | null;
  loading: boolean;
}) {
  const [search, setSearch] = React.useState("");
  const [purchaseSort, setPurchaseSort] = React.useState<PurchaseSort>("value");
  const [priceSort, setPriceSort] = React.useState<PriceSort>("increase");
  const [purchaseVisible, setPurchaseVisible] = React.useState(PAGE_SIZE);
  const [priceVisible, setPriceVisible] = React.useState(PAGE_SIZE);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPurchaseVisible(PAGE_SIZE);
    setPriceVisible(PAGE_SIZE);
  }, [report, search, purchaseSort, priceSort]);

  React.useEffect(() => {
    if (selectedKey && !report?.itemDetails[selectedKey]) {
      setSelectedKey(null);
    }
  }, [report, selectedKey]);

  if (loading && !report) {
    return <div className="rpt-empty-state">Loading purchases…</div>;
  }
  if (!report) {
    return <div className="rpt-empty-state">Could not load purchases for this range</div>;
  }

  const query = search.trim().toLowerCase();
  const matches = (name: string) => !query || name.toLowerCase().includes(query);
  const purchaseRows = sortPurchases(report.purchaseRows.filter((row) => matches(row.itemName)), purchaseSort);
  const priceRows = sortPrices(report.priceRows.filter((row) => matches(row.itemName)), priceSort);
  const visiblePurchases = purchaseRows.slice(0, purchaseVisible);
  const visiblePrices = priceRows.slice(0, priceVisible);
  const hasPurchases = report.purchaseRows.length > 0;

  const selectedPurchase = report.purchaseRows.find((row) => row.key === selectedKey) || null;
  const selectedPrice = report.priceRows.find((row) => row.key === selectedKey) || null;
  const detail = selectedKey ? report.itemDetails[selectedKey] : null;

  return (
    <div className={`rpt-purchases${loading ? " rpt-purchases-refreshing" : ""}`}>
      <div className="rpt-kpi-grid">
        <Stat
          primary
          label="Grocery Purchases"
          value={formatCurrency(report.summary.purchaseTotal)}
          sub="Same as food cost in Profitability"
        />
        <Stat label="Purchase Bills" value={String(report.summary.billCount)} sub="Voided bills excluded" />
        <Stat
          label="Price Increases"
          value={String(report.summary.priceIncreaseCount)}
          sub="Items that cost more than last time"
        />
        <div title={UNALLOCATED_TOOLTIP} className="rpt-kpi-help">
          <Stat
            label="Unallocated"
            value={formatCurrency(report.summary.unallocatedTotal)}
            sub="Bill money not split to items"
          />
        </div>
      </div>

      {hasPurchases ? (
        <div className="rpt-purchases-toolbar">
          <input
            className="rpt-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items"
            aria-label="Search purchased items"
          />
          <span className="rpt-muted">Click an item to see its purchase and price history.</span>
        </div>
      ) : null}

      <div className="rpt-card rpt-purchases-card">
        <div className="rpt-section-head">
          <div>
            <div className="rpt-section-name">Purchase Analysis</div>
            <div className="rpt-section-sub">What was bought in this period, compared with the period before</div>
          </div>
          {hasPurchases ? (
            <select
              className="rpt-sort-select"
              value={purchaseSort}
              onChange={(e) => setPurchaseSort(e.target.value as PurchaseSort)}
              aria-label="Sort purchase analysis"
            >
              <option value="value">Sort by purchase value</option>
              <option value="quantity">Sort by quantity</option>
              <option value="change">Sort by change</option>
              <option value="name">Sort by item name</option>
            </select>
          ) : null}
        </div>
        <DataTable
          dense
          empty={query ? "No items match this search" : "No grocery purchases in this period"}
          onRowClick={(index) => setSelectedKey(visiblePurchases[index]?.key || null)}
          columns={[
            { key: "item", header: "Item" },
            { key: "purchased", header: "Purchased", align: "right", nowrap: true },
            { key: "previous", header: "Previous period", align: "right", nowrap: true },
            { key: "change", header: "Change", align: "right", nowrap: true },
            { key: "avg", header: "Avg. purchased / day", align: "right", nowrap: true },
            { key: "value", header: "Purchase value", align: "right", nowrap: true },
            { key: "bills", header: "Bills", align: "right", nowrap: true },
          ]}
          rows={visiblePurchases.map((row) => [
            <span key="name" className="rpt-item-name">
              {row.itemName}
            </span>,
            formatQty(row.purchasedQuantity, row.unit),
            row.previousQuantity > 0 ? formatQty(row.previousQuantity, row.unit) : <span className="rpt-muted">—</span>,
            <QuantityChange key="change" row={row} />,
            formatQty(row.avgPurchasedPerDay, row.unit),
            row.purchaseValue > 0 ? formatCurrency(row.purchaseValue) : <span className="rpt-muted">Not priced</span>,
            String(row.billCount),
          ])}
        />
        <TableFoot
          shown={visiblePurchases.length}
          total={purchaseRows.length}
          noun="items"
          onMore={() => setPurchaseVisible((count) => count + PAGE_SIZE * 2)}
        />
        {report.summary.unallocatedTotal > 0 ? <p className="rpt-footnote">{UNALLOCATED_NOTE}</p> : null}
      </div>

      <div className="rpt-card rpt-purchases-card">
        <div className="rpt-section-head">
          <div>
            <div className="rpt-section-name">Price Watch</div>
            <div className="rpt-section-sub">Price per unit from bills that list item amounts</div>
          </div>
          {report.priceRows.length ? (
            <select
              className="rpt-sort-select"
              value={priceSort}
              onChange={(e) => setPriceSort(e.target.value as PriceSort)}
              aria-label="Sort price watch"
            >
              <option value="increase">Biggest increase first</option>
              <option value="decrease">Biggest decrease first</option>
              <option value="name">Sort by item name</option>
            </select>
          ) : null}
        </div>
        <DataTable
          dense
          empty={
            query
              ? "No items match this search"
              : "No item prices in this period. Add item amounts when recording a bill to see prices here."
          }
          onRowClick={(index) => setSelectedKey(visiblePrices[index]?.key || null)}
          columns={[
            { key: "item", header: "Item" },
            { key: "latest", header: "Latest price", align: "right", nowrap: true },
            { key: "previous", header: "Previous price", align: "right", nowrap: true },
            { key: "change", header: "Change", align: "right", nowrap: true },
            { key: "range", header: "Period low – high", align: "right", nowrap: true },
          ]}
          rows={visiblePrices.map((row) => [
            <span key="name" className="rpt-item-name">
              {row.itemName}
            </span>,
            <PricePoint key="latest" price={row.latest} unit={row.unit} />,
            <PricePoint key="previous" price={row.previous} unit={row.unit} />,
            <PriceChange key="change" value={row.changePct} />,
            row.periodLow === row.periodHigh
              ? `${formatCurrency(row.periodLow)}/${groceryUnitLabel(row.unit)}`
              : `${formatCurrency(row.periodLow)} – ${formatCurrency(row.periodHigh)}/${groceryUnitLabel(row.unit)}`,
          ])}
        />
        <TableFoot
          shown={visiblePrices.length}
          total={priceRows.length}
          noun="items"
          onMore={() => setPriceVisible((count) => count + PAGE_SIZE * 2)}
        />
      </div>

      <Drawer
        open={Boolean(selectedKey && detail)}
        title={selectedPurchase?.itemName || selectedPrice?.itemName || "Item"}
        onClose={() => setSelectedKey(null)}
        wide
      >
        {detail ? (
          <div className="rpt-detail">
            <div className="rpt-detail-stats">
              <div>
                <span>Purchased this period</span>
                <strong>
                  {selectedPurchase ? formatQty(selectedPurchase.purchasedQuantity, selectedPurchase.unit) : "—"}
                </strong>
              </div>
              <div>
                <span>Purchase value</span>
                <strong>
                  {selectedPurchase && selectedPurchase.purchaseValue > 0
                    ? formatCurrency(selectedPurchase.purchaseValue)
                    : "Not priced"}
                </strong>
              </div>
              <div>
                <span>Average price</span>
                <strong>
                  {detail.avgRecordedPrice == null
                    ? "Not priced"
                    : `${formatCurrency(detail.avgRecordedPrice)}/${groceryUnitLabel(selectedPurchase?.unit || selectedPrice?.unit || "")}`}
                </strong>
              </div>
            </div>

            <section className="rpt-detail-block">
              <h3>Latest price by vendor</h3>
              {detail.vendorPrices.length === 0 ? (
                <p className="rpt-muted">No item price recorded yet.</p>
              ) : (
                <table className="rpt-detail-table">
                  <tbody>
                    {detail.vendorPrices.map((vendor) => (
                      <tr key={`${vendor.vendorName}-${vendor.date}`}>
                        <td>{vendor.vendorName}</td>
                        <td className="rpt-num">
                          {formatCurrency(vendor.unitPrice)}/{groceryUnitLabel(selectedPurchase?.unit || selectedPrice?.unit || "")}
                        </td>
                        <td className="rpt-num rpt-muted">{formatWhen(vendor.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="rpt-detail-block">
              <h3>Recent purchases</h3>
              <table className="rpt-detail-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="rpt-num">Qty</th>
                    <th className="rpt-num">Price</th>
                    <th>Vendor</th>
                    <th className="rpt-num">Bill total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentPurchases.map((purchase, index) => (
                    <tr key={`${purchase.date}-${index}`}>
                      <td>{formatWhen(purchase.date)}</td>
                      <td className="rpt-num">{formatQty(purchase.quantity, purchase.unit)}</td>
                      <td className="rpt-num">
                        {purchase.unitPrice == null ? (
                          <span className="rpt-muted">not priced</span>
                        ) : (
                          `${formatCurrency(purchase.unitPrice)}/${groceryUnitLabel(purchase.unit)}`
                        )}
                      </td>
                      <td>{purchase.vendorName}</td>
                      <td className="rpt-num">{formatCurrency(purchase.billTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
