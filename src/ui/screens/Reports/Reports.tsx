import React from "react";
import {
  getSalesSummary,
  getPaymentBreakdown,
  getProductSalesReport,
  getProfitabilitySummary,
  getGroceryPurchaseAnalysis,
  getConfigGst,
  getConfigBranding,
} from "../../../app/db/posRepository";
import { ENV } from "../../../config/env";
import type {
  GroceryPurchaseAnalysisDto,
  ProductSalesReportDto,
  ProfitabilitySummaryDto,
} from "../../../shared/pos";
import { PurchasesPricesReport } from "./PurchasesPricesReport";
import { DEFAULT_GST_CONFIG, formatGstRate, normalizeGstConfig } from "../../../shared/gst";
import { CATEGORY_CHART_COLORS } from "../../theme/external-brands";
import { PRINT } from "../../theme/print-html";
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

type ReportTab = "sales" | "profitability" | "purchases";
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
  const [profitability, setProfitability] = React.useState<ProfitabilitySummaryDto | null>(null);
  const [profitLoading, setProfitLoading] = React.useState(false);
  const [purchaseAnalysis, setPurchaseAnalysis] = React.useState<GroceryPurchaseAnalysisDto | null>(null);
  const [purchaseLoading, setPurchaseLoading] = React.useState(false);

  React.useEffect(() => {
    setVisibleItemCount(ITEM_PAGE_SIZE);
  }, [fromTs, toTs, itemSearch, itemSort]);

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

  React.useEffect(() => {
    if (reportTab !== "sales") {
      return;
    }
    (async () => {
      try {
        setLoading(true);

        const summary = await getSalesSummary({ from: fromTs, to: toTs });
        const breakdown = await getPaymentBreakdown({ from: fromTs, to: toTs });
        let creditCollections: Record<string, number> = {};
        try {
          creditCollections =
            (await window.pos?.reports?.creditCollections?.({
              from: fromTs,
              to: toTs,
            })) || {};
        } catch {
          creditCollections = {};
        }
        let creditTotals = { outstanding: 0, overdue: 0 };
        try {
          creditTotals = (await window.pos?.reports?.creditTotals?.()) || creditTotals;
        } catch {
          creditTotals = { outstanding: 0, overdue: 0 };
        }
        let productReport = EMPTY_PRODUCT_SALES_REPORT;
        try {
          productReport = await getProductSalesReport({ from: fromTs, to: toTs });
        } catch (e) {
          console.error("Failed to load product sales report:", e);
        }

        const totalSales = summary.total || 0;
        const ordersCount = summary.orders || 0;
        const gstAmount = Number(summary.taxTotal || 0);
        const subtotal = Number(
          summary.subtotal !== undefined ? summary.subtotal : +(totalSales - gstAmount).toFixed(2),
        );
        try {
          const gstCfg = normalizeGstConfig(await getConfigGst());
          setGstRateLabel(formatGstRate(gstCfg.gstRateBps));
          setGstHalfRateLabel(formatGstRate(gstCfg.gstRateBps / 2));
        } catch {
          setGstRateLabel(formatGstRate(DEFAULT_GST_CONFIG.gstRateBps));
          setGstHalfRateLabel(formatGstRate(DEFAULT_GST_CONFIG.gstRateBps / 2));
        }
        const cash = breakdown.cash || 0;
        const upi = breakdown.upi || 0;
        const card = breakdown.card || 0;
        const online = breakdown.online || 0;
        const other = (breakdown.voucher || 0) + (breakdown.other || 0);
        const creditSales = breakdown.credit || 0;
        const creditCollected = Object.values(creditCollections).reduce(
          (sum, value) => sum + Number(value || 0),
          0,
        );

        setSales(totalSales);
        setSubtotalSales(subtotal);
        setDiscountTotal(Number(summary.discountTotal || 0));
        setOrders(ordersCount);
        setGst(gstAmount);
        setCashAmount(cash);
        setUpiAmount(upi);
        setCardAmount(card);
        setOnlineAmount(online);
        setOtherAmount(other);
        setCreditSalesAmount(creditSales);
        setCreditCollectedAmount(creditCollected);
        setCreditOutstandingTotal(Number(creditTotals.outstanding || 0));
        setCreditOverdueTotal(Number(creditTotals.overdue || 0));
        setProductSales(productReport);
      } catch (e) {
        console.error("Failed to load reports:", e);
        setProductSales(EMPTY_PRODUCT_SALES_REPORT);
        setCreditOutstandingTotal(0);
        setCreditOverdueTotal(0);
      } finally {
        setLoading(false);
      }
    })();
  }, [fromTs, toTs, reportTab]);

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
      glow: "rgba(217,119,6,0.2)",
    },
    {
      label: "UPI",
      amount: upiAmount,
      pct: upiPercent,
      color: "var(--pos-teal)",
      glow: "rgba(8,145,178,0.2)",
    },
    {
      label: "Card",
      amount: cardAmount,
      pct: cardPercent,
      color: "var(--pos-teal)",
      glow: "rgba(124,58,237,0.2)",
    },
    {
      label: "Online",
      amount: onlineAmount,
      pct: onlinePercent,
      color: "var(--pos-teal)",
      glow: "rgba(37,99,235,0.2)",
    },
    {
      label: "Other",
      amount: otherAmount,
      pct: otherPercent,
      color: "var(--pos-success)",
      glow: "rgba(22,163,74,0.2)",
    },
    {
      label: "Credit (not collected)",
      amount: creditSalesAmount,
      pct: creditSalesPercent,
      color: "var(--pos-tx-sec)",
      glow: "rgba(100,116,139,0.2)",
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
    const businessLogoHtml = branding?.logoDataUrl
      ? `<img class="brand-logo" src="${escapeHtml(branding.logoDataUrl)}" alt=""/>`
      : "";
    const businessContactHtml = [branding?.phone, branding?.email]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => escapeHtml(value))
      .join(" | ");
    const categoryRowsHtml = productSales.categorySales.length
      ? productSales.categorySales
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.category)}</td><td>${formatUnits(row.units)}</td><td>${formatCurrency(row.sales)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3">No category sales for this range</td></tr>`;
    const itemRowsHtml = productSales.itemSales.length
      ? productSales.itemSales
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.itemName)}</td><td>${escapeHtml(row.category)}</td><td>${formatUnits(row.units)}</td><td>${formatCurrency(row.sales)}</td></tr>`,
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
    .brand-logo { width: 52px; height: 52px; border-radius: 10px; object-fit: contain; border: 1px solid var(--pos-line); background: var(--pos-surface); padding: 4px; flex: 0 0 auto; }
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
    <div class="card"><div class="card-label">Total Sales · ${dateStr}</div><div class="card-value">${formatCurrency(sales)}</div><div class="card-sub">${orders} orders</div></div>
    <div class="card"><div class="card-label">Avg. Order Value</div><div class="card-value">${formatCurrency(avgOrder)}</div><div class="card-sub">Per completed order</div></div>
    ${
      hasGst
        ? `<div class="card"><div class="card-label">GST Collected</div><div class="card-value">${formatCurrency(displayedGst)}</div><div class="card-sub">CGST: ${formatCurrency(cgst)} + SGST: ${formatCurrency(sgst)}</div></div>`
        : ""
    }
    ${
      discountTotal > 0
        ? `<div class="card" style="border-color:var(--pos-danger-line)"><div class="card-label">Discounts Given</div><div class="card-value" style="color:var(--pos-danger)">${formatCurrency(discountTotal)}</div><div class="card-sub">Total discount deducted</div></div>`
        : ""
    }
    <div class="card"><div class="card-label">Cash</div><div class="card-value">${formatCurrency(cashAmount)}</div><div class="card-sub">${cashPercent}% of sales</div></div>
    <div class="card"><div class="card-label">UPI</div><div class="card-value">${formatCurrency(upiAmount)}</div><div class="card-sub">${upiPercent}% of sales</div></div>
    <div class="card"><div class="card-label">Card</div><div class="card-value">${formatCurrency(cardAmount)}</div><div class="card-sub">${cardPercent}% of sales</div></div>
    <div class="card"><div class="card-label">Online</div><div class="card-value">${formatCurrency(onlineAmount)}</div><div class="card-sub">${onlinePercent}% of sales</div></div>
    <div class="card"><div class="card-label">Other</div><div class="card-value">${formatCurrency(otherAmount)}</div><div class="card-sub">${otherPercent}% of sales</div></div>
  </div>
  ${
    hasGst
      ? `<table>
    <thead><tr><th>Tax Type</th><th>Rate</th><th>Taxable Amount</th><th>Tax Amount</th></tr></thead>
    <tbody>
      <tr><td>CGST</td><td>${gstHalfRateLabel}</td><td>${formatCurrency(subtotalSales)}</td><td>${formatCurrency(cgst)}</td></tr>
      <tr><td>SGST</td><td>${gstHalfRateLabel}</td><td>${formatCurrency(subtotalSales)}</td><td>${formatCurrency(sgst)}</td></tr>
      <tr class="total-row"><td colspan="3">Total GST</td><td>${formatCurrency(displayedGst)}</td></tr>
    </tbody>
  </table>`
      : ""
  }
  <h2>Category Summary</h2>
  <table>
    <thead><tr><th>Category</th><th>Units Sold</th><th>Sales Amount</th></tr></thead>
    <tbody>
      ${categoryRowsHtml}
      <tr class="total-row"><td>Total</td><td>${formatUnits(productSales.totals.totalUnits)}</td><td>${formatCurrency(productSales.totals.totalSales)}</td></tr>
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
        {!embedded && <PageHeader title="Reports" subtitle="Sales, profitability and grocery purchases" />}

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
            options={REPORT_TABS}
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
          <>
            <div className="rpt-kpi-grid">
              <Stat
                primary
                label="Total Sales"
                value={loading ? "———" : formatCurrency(sales)}
                sub={loading ? "Loading…" : `${orders} paid bills`}
              />
              <Stat
                label="Collected"
                value={loading ? "———" : formatCurrency(collectedAmount)}
                sub={
                  loading
                    ? "Loading…"
                    : creditCollectedAmount > 0
                      ? `Includes ${formatCurrency(creditCollectedAmount)} credit receipts`
                      : "Cash / UPI / card in range (excludes new credit sales)"
                }
              />
              <Stat
                label="Paid Bills"
                value={loading ? "——" : orders}
                sub={loading ? "Loading…" : BUSINESS_RANGE_SEMANTICS.reports.shortLabel}
              />
              <Stat
                label="Avg. Order Value"
                value={loading ? "———" : formatCurrency(avgOrder)}
                sub={loading ? "Loading…" : orders > 0 ? "Per completed order" : "No orders yet"}
              />
              {(loading || hasGst) && (
                <Stat
                  label="GST Collected"
                  value={loading ? "———" : formatCurrency(displayedGst)}
                  sub={
                    loading
                      ? "Loading…"
                      : `${gstRateLabel} GST · CGST ${formatCurrency(cgst)} + SGST ${formatCurrency(sgst)}`
                  }
                />
              )}
              {(loading || discountTotal > 0) && (
                <Stat
                  label="Discounts Given"
                  value={loading ? "———" : formatCurrency(discountTotal)}
                  sub={loading ? "Loading…" : "Total discount deducted from orders"}
                />
              )}
              {(loading ||
                creditOutstandingTotal > 0 ||
                creditOverdueTotal > 0 ||
                creditSalesAmount > 0) && (
                <Stat
                  label="Credit Outstanding"
                  value={loading ? "———" : formatCurrency(creditOutstandingTotal)}
                  sub={
                    loading
                      ? "Loading…"
                      : creditOverdueTotal > 0
                        ? `${formatCurrency(creditOverdueTotal)} overdue across open bills`
                        : "Open customer credit across all dates"
                  }
                />
              )}
            </div>

            {/* ── Bottom Row ── */}
            <div className="rpt-bottom">
              {/* Payment Methods */}
              <div className="rpt-card" style={{ padding: 0 }}>
                <div className="rpt-section-title">Payment Methods</div>
                <div style={{ padding: "18px 20px" }}>
                  {payMethods.map((m) => (
                    <div key={m.label} className="rpt-pay-row">
                      <div className="rpt-pay-meta">
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--pos-tx-sec)" }}>
                          {m.label}
                        </span>
                        <div>
                          <span
                            style={{
                              fontSize: 15,
                              fontWeight: 700,
                              color: m.color,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {loading ? "—" : formatCurrency(m.amount)}
                          </span>
                          <span
                            style={{ fontSize: 11, color: "var(--pos-tx-muted)", marginLeft: 7 }}
                          >
                            {loading ? "" : `${m.pct}%`}
                          </span>
                        </div>
                      </div>
                      <div className="rpt-pay-bar-bg">
                        <div
                          className="rpt-pay-bar-fill"
                          style={{
                            width: loading ? "0%" : `${m.pct}%`,
                            background: "var(--pos-teal)",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* GST Breakdown */}
              {hasGst && (
                <div className="rpt-card" style={{ padding: 0 }}>
                  <div className="rpt-section-title">GST Breakdown</div>
                  <DataTable
                    headers={["Tax Type", "Rate", "Taxable Amount", "Tax Amount"]}
                    rows={[
                      [
                        "CGST",
                        gstHalfRateLabel,
                        formatCurrency(subtotalSales),
                        formatCurrency(cgst),
                      ],
                      [
                        "SGST",
                        gstHalfRateLabel,
                        formatCurrency(subtotalSales),
                        formatCurrency(sgst),
                      ],
                      ["Total GST", "", "", formatCurrency(displayedGst)],
                    ]}
                  />
                </div>
              )}
            </div>

            <div className="rpt-product-grid">
              <div className="rpt-card" style={{ padding: 0 }}>
                <div className="rpt-section-head">
                  <div>
                    <div className="rpt-section-title" style={{ padding: 0, borderBottom: "none" }}>
                      Category Sales
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: "var(--pos-tx-muted)" }}>
                      {formatCurrency(productSales.totals.totalSales)} sales -{" "}
                      {formatUnits(productSales.totals.totalUnits)} units
                    </div>
                  </div>
                  <div className="rpt-metric-toggle" aria-label="Category metric">
                    <button
                      type="button"
                      className={categoryMetric === "sales" ? "active" : ""}
                      onClick={() => setCategoryMetric("sales")}
                    >
                      Sales Amount
                    </button>
                    <button
                      type="button"
                      className={categoryMetric === "units" ? "active" : ""}
                      onClick={() => setCategoryMetric("units")}
                    >
                      Units Sold
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="rpt-empty-state">Loading...</div>
                ) : hasCategorySales ? (
                  <div className="rpt-chart-wrap">
                    <svg
                      className="rpt-chart-svg"
                      viewBox="0 0 120 120"
                      role="img"
                      aria-label="Category sales chart"
                    >
                      <circle className="rpt-chart-empty" cx="60" cy="60" r="42" />
                      <g transform="rotate(-90 60 60)">
                        {categoryChartSegments.map((segment) => (
                          <circle
                            key={segment.category}
                            className="rpt-chart-segment"
                            cx="60"
                            cy="60"
                            r="42"
                            stroke={segment.color}
                            strokeDasharray={segment.dash}
                            strokeDashoffset={segment.offset}
                          />
                        ))}
                      </g>
                      <text x="60" y="58" className="rpt-chart-center">
                        {categoryMetric === "sales" ? "Sales" : "Units"}
                      </text>
                      <text x="60" y="73" className="rpt-chart-total">
                        {categoryRows.length} groups
                      </text>
                    </svg>
                    <div style={{ width: "100%" }}>
                      {categoryChartSegments.map((segment) => {
                        const percent = pct(segment.value, categoryMetricTotal);
                        return (
                          <div key={segment.category} className="rpt-legend-row">
                            <span
                              className="rpt-legend-swatch"
                              style={{ background: segment.color }}
                            />
                            <span className="rpt-legend-name">{segment.category}</span>
                            <span className="rpt-legend-value">
                              {categoryMetric === "sales"
                                ? formatCurrency(segment.sales)
                                : formatUnits(segment.units)}{" "}
                              ({percent}%)
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rpt-empty-state">No category sales for this range</div>
                )}
              </div>

              <div className="rpt-card" style={{ padding: 0 }}>
                <div className="rpt-section-title">Menu Items Sold</div>
                {hasItemSales && (
                  <div className="rpt-table-toolbar">
                    <input
                      className="rpt-search-input"
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Search item or category"
                      aria-label="Search menu items sold"
                    />
                    <select
                      className="rpt-sort-select"
                      value={itemSort}
                      onChange={(e) => setItemSort(e.target.value as ItemSort)}
                      aria-label="Sort menu items sold"
                    >
                      <option value="units">Sort by Units Sold</option>
                      <option value="sales">Sort by Sales Amount</option>
                      <option value="name">Sort by Item Name</option>
                    </select>
                  </div>
                )}
                {loading ? (
                  <div className="rpt-empty-state">Loading...</div>
                ) : hasItemSales ? (
                  hasVisibleItemSales ? (
                    <>
                      <DataTable
                        headers={["Item", "Category", "Units Sold", "Sales Amount"]}
                        rows={visibleItemSales.map((item) => [
                          item.itemName,
                          item.category,
                          formatUnits(item.units),
                          formatCurrency(item.sales),
                        ])}
                      />
                      <div className="rpt-table-foot">
                        <span>
                          Showing {visibleItemSales.length} of {filteredItemSales.length} items
                          {productSales.itemSales.length !== filteredItemSales.length
                            ? ` matching ${productSales.itemSales.length} total`
                            : ""}
                        </span>
                        {canShowMoreItems && (
                          <button
                            type="button"
                            className="rpt-show-more"
                            onClick={() => setVisibleItemCount((count) => count + ITEM_PAGE_SIZE)}
                          >
                            Show more
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="rpt-empty-state">No menu items match this search</div>
                  )
                ) : (
                  <div className="rpt-empty-state">No menu items sold for this range</div>
                )}
              </div>
            </div>
          </>
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
                    label="Revenue"
                    value={formatCurrency(profitability.revenue)}
                    sub={rangeLabel}
                  />
                  <Stat
                    label="Food Cost"
                    value={formatCurrency(profitability.foodCost.amount)}
                    sub={
                      profitability.foodCost.basis === "purchases"
                        ? "Based on recorded purchases. Inventory adjustment unavailable."
                        : "Inventory-adjusted food cost"
                    }
                  />
                  <Stat
                    label="Gross Contribution"
                    value={formatCurrency(profitability.grossContribution)}
                    sub="Revenue − Food Cost"
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
                              ? `${row.percentOfRevenue}% of revenue`
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
