import React from "react";
import {
  getSalesFacts,
  getProfitabilitySummary,
  getGroceryPurchaseAnalysis,
  getConfigBranding,
  getConfigGst,
} from "../../../app/db/posRepository";
import { ENV } from "../../../config/env";
import type {
  GroceryPurchaseAnalysisDto,
  ProductSalesReportDto,
  ProfitabilitySummaryDto,
  SalesFactsDto,
} from "../../../shared/pos";
import { PurchasesPricesReport } from "./PurchasesPricesReport";
import { SalesFactsView } from "./SalesFactsView";
import { GstTaxReport } from "./GstTaxReport";
import { DEFAULT_GST_CONFIG, formatGstRate, normalizeGstConfig } from "../../../shared/gst";
import { CATEGORY_CHART_COLORS } from "../../theme/external-brands";
import { PRINT } from "../../theme/print-html";
import { prepareRestaurantLogo } from "../../utils/logoProcessing";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { PageHeader } from "../../components/ui/PageHeader";
import { Stat } from "../../components/ui/Stat";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { Icon } from "../../components/ui/Icon";
import { FileDown } from "lucide-react";
import { BUSINESS_RANGE_SEMANTICS } from "../../../shared/businessDateRange";
import { BusinessRangeControls } from "../../components/BusinessRangeControls";
import { useBusinessDateRange } from "../../hooks/useBusinessDateRange";
import "./Reports.css";

type ReportTab = "sales" | "profitability" | "purchases" | "gst";
type CategoryMetric = "sales" | "units";
type ItemSort = "units" | "sales" | "name";

const REPORT_TABS = [
  { id: "sales", label: "Sales" },
  { id: "profitability", label: "Profitability" },
  { id: "purchases", label: "Purchases & Prices" },
];

const ITEM_PAGE_SIZE = 25;

const EMPTY_PRODUCT_SALES_REPORT: ProductSalesReportDto = {
  categorySales: [],
  itemSales: [],
  totals: { totalSales: 0, totalUnits: 0 },
};

const CATEGORY_COLORS = CATEGORY_CHART_COLORS;

function topCategoryRows(rows: ProductSalesReportDto["categorySales"], metric: CategoryMetric) {
  const sorted = [...rows].sort(
    (a, b) => b[metric] - a[metric] || a.category.localeCompare(b.category),
  );
  if (sorted.length <= 8) {
    return sorted;
  }
  const rest = sorted.slice(8).reduce(
    (acc, row) => ({
      category: "Others",
      sales: acc.sales + row.sales,
      units: acc.units + row.units,
    }),
    { category: "Others", sales: 0, units: 0 },
  );
  return [...sorted.slice(0, 8), rest];
}

function pct(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export default function Reports({ embedded = false }: { embedded?: boolean }) {
  const [sales, setSales] = React.useState(0);
  const [subtotalSales, setSubtotalSales] = React.useState(0);
  const [discountTotal, setDiscountTotal] = React.useState(0);
  const [orders, setOrders] = React.useState(0);
  const [gst, setGst] = React.useState(0);
  const [cashAmount, setCashAmount] = React.useState(0);
  const [upiAmount, setUpiAmount] = React.useState(0);
  const [cardAmount, setCardAmount] = React.useState(0);
  const [onlineAmount, setOnlineAmount] = React.useState(0);
  const [otherAmount, setOtherAmount] = React.useState(0);
  const [creditSalesAmount, setCreditSalesAmount] = React.useState(0);
  const [creditCollectedAmount, setCreditCollectedAmount] = React.useState(0);
  const [creditOutstandingTotal, setCreditOutstandingTotal] = React.useState(0);
  const [creditOverdueTotal, setCreditOverdueTotal] = React.useState(0);
  const [productSales, setProductSales] = React.useState<ProductSalesReportDto>(
    EMPTY_PRODUCT_SALES_REPORT,
  );
  const [categoryMetric, setCategoryMetric] = React.useState<CategoryMetric>("sales");
  const [itemSearch, setItemSearch] = React.useState("");
  const [itemSort, setItemSort] = React.useState<ItemSort>("units");
  const [visibleItemCount, setVisibleItemCount] = React.useState(ITEM_PAGE_SIZE);
  const [loading, setLoading] = React.useState(true);
  const [gstRateLabel, setGstRateLabel] = React.useState(
    formatGstRate(DEFAULT_GST_CONFIG.gstRateBps),
  );
  const [gstHalfRateLabel, setGstHalfRateLabel] = React.useState(
    formatGstRate(DEFAULT_GST_CONFIG.gstRateBps / 2),
  );
  const [branding, setBranding] = React.useState<{
    hotelName?: string;
    hotelInitials?: string;
    phone?: string;
    email?: string;
    logoDataUrl?: string | null;
  } | null>(null);

  const rangeState = useBusinessDateRange();
  const { fromTs, toTs, label: rangeLabel } = rangeState;
  const [reportTab, setReportTab] = React.useState<ReportTab>("sales");
  const [salesFacts, setSalesFacts] = React.useState<SalesFactsDto | null>(null);
  const [gstEnabled, setGstEnabled] = React.useState<boolean | null>(null);
  const [profitability, setProfitability] = React.useState<ProfitabilitySummaryDto | null>(null);
  const [profitLoading, setProfitLoading] = React.useState(false);
  const [purchaseAnalysis, setPurchaseAnalysis] = React.useState<GroceryPurchaseAnalysisDto | null>(null);
  const [purchaseLoading, setPurchaseLoading] = React.useState(false);

  React.useEffect(() => {
    setVisibleItemCount(ITEM_PAGE_SIZE);
  }, [fromTs, toTs, itemSearch, itemSort]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getConfigGst();
        if (!cancelled) {
          setGstEnabled(Boolean(cfg.enabled));
        }
      } catch {
        if (!cancelled) {
          setGstEnabled(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const loadBranding = async () => {
      try {
        setBranding(await getConfigBranding());
      } catch {
        setBranding(null);
      }
    };
    loadBranding();
    window.addEventListener("branding-changed", loadBranding);
    return () => window.removeEventListener("branding-changed", loadBranding);
  }, []);

  const formatCurrency = (v: number) => {
    try {
      return new Intl.NumberFormat(ENV.CURRENCY_LOCALE, {
        style: "currency",
        currency: ENV.CURRENCY_CODE,
        maximumFractionDigits: 2,
      }).format(v);
    } catch {
      return `₹${Math.round(v * 100) / 100}`;
    }
  };

  const showGstTab = gstEnabled === true || salesFacts?.hasTax === true;
  const reportTabs = showGstTab ? [...REPORT_TABS, { id: "gst", label: "GST & Tax" }] : REPORT_TABS;

  React.useEffect(() => {
    if (reportTab === "gst" && !showGstTab) {
      setReportTab("sales");
    }
  }, [reportTab, showGstTab]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const facts = await getSalesFacts({ from: fromTs, to: toTs });
        if (!cancelled) {
          setSalesFacts(facts);
        }
      } catch (e) {
        console.error("Failed to load reports:", e);
        if (!cancelled) {
          setSalesFacts(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromTs, toTs]);

  React.useEffect(() => {
    if (reportTab !== "profitability") {
      return;
    }
    (async () => {
      try {
        setProfitLoading(true);
        const summary = await getProfitabilitySummary({ from: fromTs, to: toTs });
        setProfitability(summary);
      } catch (e) {
        console.error("Failed to load profitability:", e);
        setProfitability(null);
      } finally {
        setProfitLoading(false);
      }
    })();
  }, [fromTs, toTs, reportTab]);

  React.useEffect(() => {
    if (reportTab !== "purchases") {
      return;
    }
    (async () => {
      try {
        setPurchaseLoading(true);
        const summary = await getGroceryPurchaseAnalysis({ from: fromTs, to: toTs });
        setPurchaseAnalysis(summary);
      } catch (e) {
        console.error("Failed to load purchases:", e);
        setPurchaseAnalysis(null);
      } finally {
        setPurchaseLoading(false);
      }
    })();
  }, [fromTs, toTs, reportTab]);

  const cashPercent = sales > 0 ? Math.round((cashAmount / sales) * 100) : 0;
  const upiPercent = sales > 0 ? Math.round((upiAmount / sales) * 100) : 0;
  const cardPercent = sales > 0 ? Math.round((cardAmount / sales) * 100) : 0;
  const onlinePercent = sales > 0 ? Math.round((onlineAmount / sales) * 100) : 0;
  const otherPercent = sales > 0 ? Math.round((otherAmount / sales) * 100) : 0;
  const creditSalesPercent = sales > 0 ? Math.round((creditSalesAmount / sales) * 100) : 0;
  const collectedAmount =
    cashAmount + upiAmount + cardAmount + onlineAmount + otherAmount + creditCollectedAmount;

  const gstPaise = Math.round(gst * 100);
  const gstHalfPaise = Math.round(gstPaise / 2);
  const cgst = +(gstHalfPaise / 100).toFixed(2);
  const sgst = +((gstPaise - gstHalfPaise) / 100).toFixed(2);
  const displayedGst = +(gstPaise / 100).toFixed(2);
  const hasGst = gst > 0;
  const avgOrder = orders > 0 ? +(sales / orders).toFixed(2) : 0;

  const payMethods = [
    {
      label: "Cash",
      amount: cashAmount,
      pct: cashPercent,
      color: "var(--pos-saffron-deep)",
      glow: "color-mix(in srgb, var(--pos-saffron) 25%, transparent)",
    },
    {
      label: "UPI",
      amount: upiAmount,
      pct: upiPercent,
      color: "var(--pos-teal)",
      glow: "color-mix(in srgb, var(--pos-teal) 25%, transparent)",
    },
    {
      label: "Card",
      amount: cardAmount,
      pct: cardPercent,
      color: "var(--pos-teal)",
      glow: "color-mix(in srgb, var(--pos-teal-strong) 25%, transparent)",
    },
    {
      label: "Online",
      amount: onlineAmount,
      pct: onlinePercent,
      color: "var(--pos-teal)",
      glow: "color-mix(in srgb, var(--pos-info) 25%, transparent)",
    },
    {
      label: "Other",
      amount: otherAmount,
      pct: otherPercent,
      color: "var(--pos-success)",
      glow: "color-mix(in srgb, var(--pos-success) 25%, transparent)",
    },
    {
      label: "Credit (not collected)",
      amount: creditSalesAmount,
      pct: creditSalesPercent,
      color: "var(--pos-tx-sec)",
      glow: "color-mix(in srgb, var(--pos-tx-sec) 25%, transparent)",
    },
  ];

  const formatUnits = (v: number) =>
    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);
  const categoryRows = topCategoryRows(productSales.categorySales, categoryMetric);
  const categoryMetricTotal =
    categoryMetric === "sales" ? productSales.totals.totalSales : productSales.totals.totalUnits;
  const categoryChartSegments = (() => {
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    return categoryRows.map((row, index) => {
      const value = row[categoryMetric];
      const length = categoryMetricTotal > 0 ? (value / categoryMetricTotal) * circumference : 0;
      const segment = {
        ...row,
        value,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
        dash: `${length} ${Math.max(0, circumference - length)}`,
        offset: -offset,
      };
      offset += length;
      return segment;
    });
  })();
  const hasCategorySales = productSales.categorySales.length > 0 && categoryMetricTotal > 0;
  const normalizedItemSearch = itemSearch.trim().toLowerCase();
  const filteredItemSales = productSales.itemSales
    .filter((item) => {
      if (!normalizedItemSearch) {
        return true;
      }
      return (
        item.itemName.toLowerCase().includes(normalizedItemSearch) ||
        item.category.toLowerCase().includes(normalizedItemSearch)
      );
    })
    .sort((a, b) => {
      if (itemSort === "sales") {
        return b.sales - a.sales || b.units - a.units || a.itemName.localeCompare(b.itemName);
      }
      if (itemSort === "name") {
        return a.itemName.localeCompare(b.itemName) || a.category.localeCompare(b.category);
      }
      return b.units - a.units || b.sales - a.sales || a.itemName.localeCompare(b.itemName);
    });
  const visibleItemSales = filteredItemSales.slice(0, visibleItemCount);
  const hasItemSales = productSales.itemSales.length > 0;
  const hasVisibleItemSales = filteredItemSales.length > 0;
  const canShowMoreItems = visibleItemSales.length < filteredItemSales.length;

  const [exporting, setExporting] = React.useState(false);
  const exportingRef = React.useRef(false);

  const handleExport = async () => {
    if (exportingRef.current) {
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    const dateStr = rangeLabel;
    const businessName = branding?.hotelName || ENV.HOTEL_NAME || "Restaurant";
    let reportLogoUrl = typeof branding?.logoDataUrl === "string" ? branding.logoDataUrl : "";
    if (reportLogoUrl) {
      try {
        reportLogoUrl = (await prepareRestaurantLogo(reportLogoUrl)).logoDataUrl;
      } catch {
        // Keep the stored image if it cannot be cropped.
      }
    }
    const businessLogoHtml = reportLogoUrl
      ? `<img class="brand-logo" src="${escapeHtml(reportLogoUrl)}" alt=""/>`
      : "";
    const businessContactHtml = [branding?.phone, branding?.email]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => escapeHtml(value))
      .join(" | ");
    const categoryRowsHtml = salesFacts?.categories.length
      ? salesFacts.categories
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.category)}</td><td>${formatUnits(row.units)}</td><td>${formatCurrency(row.netSales)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3">No category sales for this range</td></tr>`;
    const itemRowsHtml = salesFacts?.items.length
      ? salesFacts.items
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.itemName)}</td><td>${escapeHtml(row.category)}</td><td>${formatUnits(row.units)}</td><td>${formatCurrency(row.netSales)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4">No menu items sold for this range</td></tr>`;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Sales Report — ${dateStr}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 32px; color: ${PRINT.ink}; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 16px; margin: 28px 0 8px; }
    p.sub { color: ${PRINT.sub}; font-size: 13px; margin: 0 0 24px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 28px; }
    .card { border: 1px solid var(--pos-line); border-radius: 8px; padding: 16px; }
    .card-label { font-size: 11px; text-transform: uppercase; color: ${PRINT.muted}; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 6px; }
    .card-value { font-size: 22px; font-weight: 900; color: ${PRINT.ink}; }
    .card-sub { font-size: 12px; color: ${PRINT.muted}; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: ${PRINT.sub}; border-bottom: 2px solid var(--pos-line); }
    td { padding: 10px 12px; font-size: 14px; border-bottom: 1px solid var(--pos-surface-sunken); }
    .total-row td { font-weight: 800; border-top: 2px solid var(--pos-line); font-size: 15px; }
    footer { margin-top: 40px; font-size: 11px; color: ${PRINT.faint}; text-align: center; }
    .report-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 28px; padding-bottom: 16px; border-bottom: 1px solid var(--pos-line); }
    .brand { display: flex; gap: 12px; align-items: center; min-width: 0; }
    .brand-logo { width: 56px; height: 56px; border-radius: 10px; object-fit: contain; border: 1px solid var(--pos-line); background: #fff; padding: 4px; flex: 0 0 auto; }
    .brand-name { font-size: 18px; font-weight: 900; color: ${PRINT.ink}; }
    .brand-contact { margin-top: 3px; font-size: 11px; color: ${PRINT.sub}; }
    .report-title { text-align: right; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="brand">
      ${businessLogoHtml}
      <div>
        <div class="brand-name">${escapeHtml(businessName)}</div>
        ${businessContactHtml ? `<div class="brand-contact">${businessContactHtml}</div>` : ""}
      </div>
    </div>
    <div class="report-title">
      <h1>Sales Report</h1>
      <p class="sub">${dateStr}</p>
    </div>
  </div>
  <div class="grid">
    <div class="card"><div class="card-label">Net Sales · ${dateStr}</div><div class="card-value">${formatCurrency(salesFacts?.netSales || 0)}</div><div class="card-sub">${salesFacts?.billCount || 0} bills</div></div>
    <div class="card"><div class="card-label">Avg. Bill</div><div class="card-value">${formatCurrency(salesFacts?.averageBill || 0)}</div><div class="card-sub">Net Sales / Bills</div></div>
    <div class="card"><div class="card-label">Discounts</div><div class="card-value">${formatCurrency(salesFacts?.discountTotal || 0)}</div><div class="card-sub">${salesFacts?.discountPercent != null ? `${salesFacts.discountPercent}% of pre-discount sales` : ""}</div></div>
    ${(salesFacts?.tenders || [])
      .map(
        (row) =>
          `<div class="card"><div class="card-label">${escapeHtml(row.label)}</div><div class="card-value">${formatCurrency(row.amount)}</div><div class="card-sub">${row.percent}% of bill total</div></div>`,
      )
      .join("")}
  </div>
  ${
    salesFacts?.hasTax
      ? `<table>
    <thead><tr><th>Tax Type</th><th>Tax Amount</th></tr></thead>
    <tbody>
      <tr><td>CGST</td><td>${formatCurrency(salesFacts.gst.cgst)}</td></tr>
      <tr><td>SGST</td><td>${formatCurrency(salesFacts.gst.sgst)}</td></tr>
      <tr class="total-row"><td>Total GST</td><td>${formatCurrency(salesFacts.gst.totalTax)}</td></tr>
    </tbody>
  </table>`
      : ""
  }
  <h2>Category Summary</h2>
  <table>
    <thead><tr><th>Category</th><th>Units Sold</th><th>Sales Amount</th></tr></thead>
    <tbody>
      ${categoryRowsHtml}
      <tr class="total-row"><td>Total</td><td>${formatUnits((salesFacts?.categories || []).reduce((sum, row) => sum + row.units, 0))}</td><td>${formatCurrency(salesFacts?.netSales || 0)}</td></tr>
    </tbody>
  </table>
  <h2>Menu Item Summary</h2>
  <table>
    <thead><tr><th>Item</th><th>Category</th><th>Units Sold</th><th>Sales Amount</th></tr></thead>
    <tbody>
      ${itemRowsHtml}
    </tbody>
  </table>
  <footer>Generated ${new Date().toLocaleString("en-IN")}</footer>
</body>
</html>`;
    try {
      if (window.pos?.exportReportPdf) {
        // Electron: native save dialog → PDF via printToPDF
        await window.pos.exportReportPdf(
          html,
          `sales-report-${rangeLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
        );
      } else {
        throw new Error("PDF export is available only in Electron.");
      }
    } catch (e) {
      console.error("Failed to export report:", e);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  const rangeControls = <BusinessRangeControls rangeState={rangeState} />;

  return (
    <div
      style={{
        background: embedded ? "transparent" : "var(--pos-bg, var(--pos-surface))",
        minHeight: embedded ? undefined : "100%",
        padding: 0,
      }}
    >
      <div className="rpt-wrap" style={embedded ? { padding: 0 } : undefined}>
        {!embedded && (
          <PageHeader
            title="Reports"
            subtitle={
              showGstTab
                ? "Sales, profitability, purchases, and GST"
                : "Sales, profitability, and purchases"
            }
          />
        )}

        {rangeControls}

        <div
          className="rpt-tabs"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <SegmentedControl
            ariaLabel="Report sections"
            options={reportTabs}
            value={reportTab}
            onChange={(id) => setReportTab(id as ReportTab)}
          />
          {reportTab === "sales" && (
            <Button variant="primary" onClick={handleExport} disabled={loading || exporting}>
              {exporting ? (
                "Saving…"
              ) : (
                <>
                  <Icon icon={FileDown} size="sm" /> Export PDF
                </>
              )}
            </Button>
          )}
        </div>

        {reportTab === "sales" && (
          <SalesFactsView facts={salesFacts} loading={loading} formatCurrency={formatCurrency} />
        )}
        {showGstTab && reportTab === "gst" && (
          <GstTaxReport facts={salesFacts} loading={loading} periodLabel={rangeLabel} formatCurrency={formatCurrency} />
        )}
        {reportTab === "profitability" && (
          <div className="rpt-profit">
            {profitLoading ? (
              <div className="rpt-empty-state">Loading profitability…</div>
            ) : !profitability ? (
              <div className="rpt-empty-state">Could not load profitability for this range</div>
            ) : (
              <>
                <div className="rpt-kpi-grid rpt-profit-kpi">
                  <Stat
                    primary
                    label="Net Sales"
                    value={formatCurrency(profitability.revenue)}
                    sub={rangeLabel}
                  />
                  <Stat
                    label="Recorded Grocery Purchases"
                    value={formatCurrency(profitability.foodCost.amount)}
                    sub={
                      profitability.recordedPurchaseCostPercent != null
                        ? `${profitability.recordedPurchaseCostPercent}% of Net Sales`
                        : "Recorded purchase cost"
                    }
                  />
                  <Stat
                    label="Gross Contribution"
                    value={formatCurrency(profitability.grossContribution)}
                    sub="Net Sales − Recorded Grocery Purchases"
                  />
                  <Stat
                    label="Operating Expenses"
                    value={formatCurrency(profitability.operatingExpenses)}
                    sub="Recorded operating costs"
                  />
                  <Stat
                    primary
                    label="Estimated Operating Profit"
                    value={formatCurrency(profitability.estimatedOperatingProfit)}
                    sub={
                      profitability.operatingMarginPercent != null
                        ? `${profitability.operatingMarginPercent}% operating margin`
                        : "Gross contribution − operating expenses"
                    }
                  />
                </div>

                {!profitability.staffCostRecorded && (
                  <p className="rpt-note">No Staff expense was recorded for this period.</p>
                )}
                <p className="rpt-profit-disclaimer">{profitability.disclaimer}</p>

                <div className="rpt-card" style={{ padding: 0 }}>
                  <div className="rpt-section-title">Expense Breakdown</div>
                  {profitability.expenseBreakdown.length === 0 ? (
                    <div className="rpt-empty-state">No costs recorded for this range</div>
                  ) : (
                    <div className="rpt-profit-breakdown">
                      {profitability.expenseBreakdown.map((row) => (
                        <div key={row.categoryId} className="rpt-profit-row">
                          <span className="rpt-profit-cat">{row.categoryName}</span>
                          <span className="rpt-profit-amt">{formatCurrency(row.amount)}</span>
                          <span className="rpt-profit-pct">
                            {row.percentOfRevenue != null
                              ? `${row.percentOfRevenue}% of Net Sales`
                              : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        {reportTab === "purchases" && (
          <PurchasesPricesReport report={purchaseAnalysis} loading={purchaseLoading} />
        )}
      </div>
    </div>
  );
}
