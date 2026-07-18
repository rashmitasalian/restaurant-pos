import React from "react";
import {
  getSalesSummary,
  getPaymentBreakdown,
  getProductSalesReport,
  getConfigGst,
  getConfigBranding,
} from "../../../app/db/posRepository";
import { ENV } from "../../../config/env";
import type { ProductSalesReportDto } from "../../../shared/pos";
import { DEFAULT_GST_CONFIG, formatGstRate, normalizeGstConfig } from "../../../shared/gst";

type RangePreset = "today" | "yesterday" | "thisWeek" | "thisMonth" | "custom";
type CategoryMetric = "sales" | "units";
type ItemSort = "units" | "sales" | "name";

const ITEM_PAGE_SIZE = 25;

const EMPTY_PRODUCT_SALES_REPORT: ProductSalesReportDto = {
  categorySales: [],
  itemSales: [],
  totals: { totalSales: 0, totalUnits: 0 },
};

const CATEGORY_COLORS = [
  "#d97706",
  "#0891b2",
  "#7c3aed",
  "#16a34a",
  "#2563eb",
  "#db2777",
  "#4f46e5",
  "#65a30d",
  "#6b7280",
];

function getPresetRange(preset: RangePreset): { from: number; to: number } {
  const now = new Date();
  const sod = (d: Date) => {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  const eod = (d: Date) => {
    const c = new Date(d);
    c.setHours(23, 59, 59, 999);
    return c;
  };

  switch (preset) {
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: sod(y).getTime(), to: eod(y).getTime() };
    }
    case "thisWeek": {
      const d = new Date(now);
      const day = d.getDay(); // 0=Sun
      d.setDate(d.getDate() - day); // back to Sunday (start of week)
      return { from: sod(d).getTime(), to: eod(now).getTime() };
    }
    case "thisMonth": {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: sod(d).getTime(), to: eod(now).getTime() };
    }
    case "today":
    default:
      return { from: sod(now).getTime(), to: eod(now).getTime() };
  }
}

function toInputDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeLabel(preset: RangePreset, from: number, to: number): string {
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  if (preset === "today") {
return "Today";
}
  if (preset === "yesterday") {
return "Yesterday";
}
  if (preset === "thisWeek") {
return "This Week";
}
  if (preset === "thisMonth") {
return "This Month";
}
  const f = fmt(from);
  const t = fmt(to);
  return f === t ? f : `${f} – ${t}`;
}

function topCategoryRows(
  rows: ProductSalesReportDto["categorySales"],
  metric: CategoryMetric,
) {
  const sorted = [...rows].sort((a, b) => b[metric] - a[metric] || a.category.localeCompare(b.category));
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
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export default function Reports() {
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

  const [preset, setPreset] = React.useState<RangePreset>("today");
  const initRange = getPresetRange("today");
  const [fromTs, setFromTs] = React.useState(initRange.from);
  const [toTs, setToTs] = React.useState(initRange.to);

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
    (async () => {
      try {
        setLoading(true);

        const summary = await getSalesSummary({ from: fromTs, to: toTs });
        const breakdown = await getPaymentBreakdown({ from: fromTs, to: toTs });
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
          summary.subtotal !== undefined
            ? summary.subtotal
            : +(totalSales - gstAmount).toFixed(2),
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
        setProductSales(productReport);
      } catch (e) {
        console.error("Failed to load reports:", e);
        setProductSales(EMPTY_PRODUCT_SALES_REPORT);
      } finally {
        setLoading(false);
      }
    })();
  }, [fromTs, toTs]);

  const cashPercent = sales > 0 ? Math.round((cashAmount / sales) * 100) : 0;
  const upiPercent = sales > 0 ? Math.round((upiAmount / sales) * 100) : 0;
  const cardPercent = sales > 0 ? Math.round((cardAmount / sales) * 100) : 0;
  const onlinePercent = sales > 0 ? Math.round((onlineAmount / sales) * 100) : 0;
  const otherPercent = sales > 0 ? Math.round((otherAmount / sales) * 100) : 0;

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
      color: "#d97706",
      glow: "rgba(217,119,6,0.2)",
    },
    {
      label: "UPI",
      amount: upiAmount,
      pct: upiPercent,
      color: "#0891b2",
      glow: "rgba(8,145,178,0.2)",
    },
    {
      label: "Card",
      amount: cardAmount,
      pct: cardPercent,
      color: "#7c3aed",
      glow: "rgba(124,58,237,0.2)",
    },
    {
      label: "Online",
      amount: onlineAmount,
      pct: onlinePercent,
      color: "#2563eb",
      glow: "rgba(37,99,235,0.2)",
    },
    {
      label: "Other",
      amount: otherAmount,
      pct: otherPercent,
      color: "#16a34a",
      glow: "rgba(22,163,74,0.2)",
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
    const dateStr = rangeLabel(preset, fromTs, toTs);
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
    body { font-family: Arial, sans-serif; padding: 32px; color: #111; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 16px; margin: 28px 0 8px; }
    p.sub { color: #666; font-size: 13px; margin: 0 0 24px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 28px; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
    .card-label { font-size: 11px; text-transform: uppercase; color: #888; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 6px; }
    .card-value { font-size: 22px; font-weight: 900; color: #111; }
    .card-sub { font-size: 12px; color: #888; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: #666; border-bottom: 2px solid #e5e7eb; }
    td { padding: 10px 12px; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
    .total-row td { font-weight: 800; border-top: 2px solid #e5e7eb; font-size: 15px; }
    footer { margin-top: 40px; font-size: 11px; color: #aaa; text-align: center; }
    .report-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 28px; padding-bottom: 16px; border-bottom: 1px solid #e5e7eb; }
    .brand { display: flex; gap: 12px; align-items: center; min-width: 0; }
    .brand-logo { width: 52px; height: 52px; border-radius: 10px; object-fit: contain; border: 1px solid #e5e7eb; background: #fff; padding: 4px; flex: 0 0 auto; }
    .brand-name { font-size: 18px; font-weight: 900; color: #111; }
    .brand-contact { margin-top: 3px; font-size: 11px; color: #666; }
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
        ? `<div class="card" style="border-color:#fca5a5"><div class="card-label">Discounts Given</div><div class="card-value" style="color:#dc2626">${formatCurrency(discountTotal)}</div><div class="card-sub">Total discount deducted</div></div>`
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
          `sales-report-${rangeLabel(preset, fromTs, toTs)
            .replace(/[^a-z0-9]/gi, "-")
            .toLowerCase()}`,
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

  const PRESETS: { key: RangePreset; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "thisWeek", label: "This Week" },
    { key: "thisMonth", label: "This Month" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div style={{ background: "var(--pos-bg, #ffffff)", minHeight: "100%", padding: 0 }}>
      <style>{`
        .rpt-wrap { padding: 22px 28px; }
        .rpt-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 28px; flex-wrap: wrap; gap: 14px; }
        .rpt-header .pos-ph-title { margin-bottom: 5px; }
        .rpt-controls { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .rpt-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 18px; }
        .rpt-bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .rpt-product-grid { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 16px; }
        .rpt-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 22px 20px;
          position: relative;
          overflow: hidden;
          transition: box-shadow 0.2s;
        }
        .rpt-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.07); }
        .rpt-card-accent {
          position: absolute; top: 0; left: 0; right: 0; height: 3px;
          background: var(--accent, #f59e0b);
          opacity: 0.9;
        }
        .rpt-card-glow {
          position: absolute; top: -40px; right: -30px;
          width: 120px; height: 120px;
          background: radial-gradient(circle, var(--glow, rgba(245,158,11,0.12)) 0%, transparent 70%);
          pointer-events: none;
        }
        .rpt-kpi-label {
          font-size: 10px; font-weight: 800; text-transform: uppercase;
          letter-spacing: 0.1em; color: #9ca3af; margin-bottom: 10px;
        }
        .rpt-kpi-value {
          font-size: 28px; font-weight: 900; line-height: 1;
          font-variant-numeric: tabular-nums; margin-bottom: 7px;
          transition: color 0.3s;
        }
        .rpt-kpi-sub { font-size: 12px; color: #9ca3af; }
        .rpt-shimmer { animation: rpt-pulse 1.4s ease-in-out infinite; }
        .rpt-preset-btn {
          padding: 5px 12px; border-radius: 8px; font-size: 12px; font-weight: 500;
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
          border: 1px solid #e5e7eb;
          background: #fff; color: #6b7280; font-family: inherit;
        }
        .rpt-preset-btn:hover { background: #fff7ed; color: #374151; border-color: #fcd34d; }
        .rpt-preset-btn.active {
          background: #fffbeb; border-color: #f59e0b;
          color: #92400e; font-weight: 700;
        }
        .rpt-date-input {
          padding: 5px 10px; border-radius: 8px; font-size: 12px;
          border: 1px solid #e5e7eb; background: #fff;
          color: #374151; outline: none; font-family: inherit;
        }
        .rpt-date-input:focus { border-color: #f59e0b; box-shadow: 0 0 0 2px rgba(245,158,11,0.15); }
        .rpt-export-btn {
          padding: 7px 16px; border-radius: 9px; font-size: 12px; font-weight: 700;
          cursor: pointer; border: none; color: #fff; white-space: nowrap;
          background: linear-gradient(135deg, #d97706 0%, #f59e0b 100%);
          box-shadow: 0 2px 10px rgba(217,119,6,0.35);
          transition: opacity 0.15s, box-shadow 0.15s; font-family: inherit;
        }
        .rpt-export-btn:hover { box-shadow: 0 4px 18px rgba(217,119,6,0.5); }
        .rpt-export-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }
        .rpt-pay-row { margin-bottom: 18px; }
        .rpt-pay-row:last-child { margin-bottom: 0; }
        .rpt-pay-meta { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 7px; }
        .rpt-pay-bar-bg { height: 6px; background: #f3f4f6; border-radius: 3px; overflow: hidden; }
        .rpt-pay-bar-fill { height: 100%; border-radius: 3px; transition: width 0.7s cubic-bezier(0.4,0,0.2,1); }
        .rpt-section-title {
          font-size: 10px; font-weight: 800; text-transform: uppercase;
          letter-spacing: 0.1em; color: #9ca3af; padding: 16px 20px 14px;
          border-bottom: 1px solid #f3f4f6;
        }
        .rpt-section-head {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 14px 18px; border-bottom: 1px solid #f3f4f6;
        }
        .rpt-metric-toggle {
          display: inline-flex; gap: 4px; padding: 3px; border: 1px solid #e5e7eb;
          border-radius: 8px; background: #f9fafb;
        }
        .rpt-metric-toggle button {
          border: none; background: transparent; border-radius: 6px; padding: 5px 9px;
          font-size: 11px; font-weight: 700; color: #6b7280; cursor: pointer; font-family: inherit;
          white-space: nowrap;
        }
        .rpt-metric-toggle button.active { background: #fff; color: #92400e; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .rpt-chart-wrap { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 20px; align-items: center; padding: 20px; }
        .rpt-chart-svg { width: 160px; height: 160px; justify-self: center; }
        .rpt-chart-empty { fill: none; stroke: #f3f4f6; stroke-width: 24; }
        .rpt-chart-segment { fill: none; stroke-width: 24; transition: stroke-dasharray 0.25s ease; }
        .rpt-chart-center { font-size: 11px; fill: #6b7280; font-weight: 800; text-anchor: middle; }
        .rpt-chart-total { font-size: 10px; fill: #9ca3af; font-weight: 700; text-anchor: middle; }
        .rpt-legend-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 8px; align-items: center; margin-bottom: 9px; }
        .rpt-legend-swatch { width: 10px; height: 10px; border-radius: 50%; }
        .rpt-legend-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; color: #374151; }
        .rpt-legend-value { font-size: 12px; color: #6b7280; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .rpt-empty-state { padding: 24px 20px; color: #9ca3af; font-size: 13px; text-align: center; }
        .rpt-table-toolbar {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding: 12px 16px; border-bottom: 1px solid #f3f4f6; flex-wrap: wrap;
        }
        .rpt-search-input {
          min-width: 220px; flex: 1; max-width: 360px; padding: 7px 10px;
          border: 1px solid #e5e7eb; border-radius: 8px; outline: none;
          font: inherit; font-size: 12px; color: #374151; background: #fff;
        }
        .rpt-search-input:focus { border-color: #f59e0b; box-shadow: 0 0 0 2px rgba(245,158,11,0.14); }
        .rpt-sort-select {
          padding: 7px 10px; border: 1px solid #e5e7eb; border-radius: 8px;
          background: #fff; font: inherit; font-size: 12px; color: #374151;
        }
        .rpt-table-scroll { width: 100%; overflow-x: auto; }
        .rpt-table { width: 100%; border-collapse: collapse; }
        .rpt-table-scroll .rpt-table { min-width: 620px; }
        .rpt-table th {
          text-align: left; padding: 10px 20px; font-size: 10px; font-weight: 800;
          text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af;
          border-bottom: 1px solid #f3f4f6;
        }
        .rpt-table td {
          padding: 13px 20px; font-size: 14px; color: #6b7280;
          border-bottom: 1px solid #f9fafb;
        }
        .rpt-table th:nth-child(3), .rpt-table th:nth-child(4),
        .rpt-table td:nth-child(3), .rpt-table td:nth-child(4) {
          text-align: right; white-space: nowrap;
        }
        .rpt-table td:first-child { font-weight: 700; color: #374151; }
        .rpt-table td:last-child { font-weight: 700; color: #111827; }
        .rpt-table-foot {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding: 12px 16px; border-top: 1px solid #f3f4f6; color: #9ca3af;
          font-size: 12px; flex-wrap: wrap;
        }
        .rpt-show-more {
          padding: 6px 12px; border: 1px solid #e5e7eb; border-radius: 8px;
          background: #fff; color: #374151; font: inherit; font-size: 12px;
          font-weight: 700; cursor: pointer;
        }
        .rpt-show-more:hover { background: #fff7ed; border-color: #fcd34d; color: #92400e; }
        .rpt-total-row td {
          border-top: 1px solid #e5e7eb; border-bottom: none;
          background: #fffbeb; color: #92400e;
          font-weight: 800; font-size: 15px;
        }
        .rpt-total-row td:last-child { color: #d97706; font-size: 16px; }
        @keyframes rpt-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 0.7; } }
        @media (max-width: 960px) {
          .rpt-kpi-grid { grid-template-columns: repeat(2, 1fr); }
          .rpt-bottom { grid-template-columns: 1fr; }
        }
        @media (max-width: 560px) {
          .rpt-kpi-grid { grid-template-columns: 1fr 1fr; }
          .rpt-wrap { padding: 14px 12px; }
          .rpt-kpi-value { font-size: 22px; }
          .rpt-header { flex-direction: column; }
          .rpt-chart-wrap { grid-template-columns: 1fr; justify-items: stretch; }
          .rpt-chart-svg { width: 145px; height: 145px; }
          .rpt-section-head { align-items: flex-start; flex-direction: column; }
          .rpt-search-input { min-width: 100%; max-width: none; }
          .rpt-sort-select { width: 100%; }
        }
      `}</style>

      <div className="rpt-wrap">
        {/* ── Header ── */}
        <div className="rpt-header">
          <div>
            <h2 className="pos-ph-title">Reports</h2>
            <p className="pos-ph-sub" style={{ paddingLeft: 13 }}>
              {rangeLabel(preset, fromTs, toTs)} ·{" "}
              {new Date().toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
          </div>

          <div className="rpt-controls">
            {PRESETS.map(({ key, label }) => (
              <button
                key={key}
                className={`rpt-preset-btn${preset === key ? " active" : ""}`}
                aria-pressed={preset === key}
                onClick={() => {
                  setPreset(key);
                  if (key !== "custom") {
                    const r = getPresetRange(key);
                    setFromTs(r.from);
                    setToTs(r.to);
                  }
                }}
              >
                {label}
              </button>
            ))}

            {preset === "custom" && (
              <>
                <input
                  type="date"
                  className="rpt-date-input"
                  value={toInputDate(fromTs)}
                  max={toInputDate(toTs)}
                  onChange={(e) => {
                    const d = new Date(e.target.value);
                    d.setHours(0, 0, 0, 0);
                    if (!isNaN(d.getTime())) {
setFromTs(d.getTime());
}
                  }}
                />
                <span style={{ fontSize: 11, color: "#374151" }}>–</span>
                <input
                  type="date"
                  className="rpt-date-input"
                  value={toInputDate(toTs)}
                  min={toInputDate(fromTs)}
                  max={toInputDate(Date.now())}
                  onChange={(e) => {
                    const d = new Date(e.target.value);
                    d.setHours(23, 59, 59, 999);
                    if (!isNaN(d.getTime())) {
setToTs(d.getTime());
}
                  }}
                />
              </>
            )}

            <button
              className="rpt-export-btn"
              onClick={handleExport}
              disabled={loading || exporting}
            >
              {exporting ? "Saving…" : "↗ Export PDF"}
            </button>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="rpt-kpi-grid">
          {/* Total Sales */}
          <div
            className="rpt-card"
            style={{
              ["--accent" as string]: "#f59e0b",
              ["--glow" as string]: "rgba(245,158,11,0.08)",
            }}
          >
            <div className="rpt-card-accent" />
            <div className="rpt-card-glow" />
            <div className="rpt-kpi-label">Total Sales</div>
            <div
              className={`rpt-kpi-value${loading ? " rpt-shimmer" : ""}`}
              style={{ color: loading ? "#e5e7eb" : "#d97706" }}
            >
              {loading ? "———" : formatCurrency(sales)}
            </div>
            <div className="rpt-kpi-sub">{loading ? "Loading…" : `${orders} orders`}</div>
          </div>

          {/* Orders */}
          <div
            className="rpt-card"
            style={{
              ["--accent" as string]: "#7c3aed",
              ["--glow" as string]: "rgba(124,58,237,0.07)",
            }}
          >
            <div className="rpt-card-accent" />
            <div className="rpt-card-glow" />
            <div className="rpt-kpi-label">Orders</div>
            <div
              className={`rpt-kpi-value${loading ? " rpt-shimmer" : ""}`}
              style={{ color: loading ? "#e5e7eb" : "#7c3aed" }}
            >
              {loading ? "——" : orders}
            </div>
            <div className="rpt-kpi-sub">
              {loading ? "Loading…" : `${rangeLabel(preset, fromTs, toTs)}`}
            </div>
          </div>

          {/* Avg Order */}
          <div
            className="rpt-card"
            style={{
              ["--accent" as string]: "#0891b2",
              ["--glow" as string]: "rgba(8,145,178,0.07)",
            }}
          >
            <div className="rpt-card-accent" />
            <div className="rpt-card-glow" />
            <div className="rpt-kpi-label">Avg. Order Value</div>
            <div
              className={`rpt-kpi-value${loading ? " rpt-shimmer" : ""}`}
              style={{ color: loading ? "#e5e7eb" : "#0891b2" }}
            >
              {loading ? "———" : formatCurrency(avgOrder)}
            </div>
            <div className="rpt-kpi-sub">
              {loading ? "Loading…" : orders > 0 ? "Per completed order" : "No orders yet"}
            </div>
          </div>

          {/* GST */}
          {(loading || hasGst) && (
          <div
            className="rpt-card"
            style={{
              ["--accent" as string]: "#16a34a",
              ["--glow" as string]: "rgba(22,163,74,0.07)",
            }}
          >
            <div className="rpt-card-accent" />
            <div className="rpt-card-glow" />
            <div className="rpt-kpi-label">GST Collected</div>
            <div
              className={`rpt-kpi-value${loading ? " rpt-shimmer" : ""}`}
              style={{ color: loading ? "#e5e7eb" : "#16a34a" }}
            >
              {loading ? "———" : formatCurrency(displayedGst)}
            </div>
            <div className="rpt-kpi-sub">
              {loading
                ? "Loading…"
                : `${gstRateLabel} GST · CGST ${formatCurrency(cgst)} + SGST ${formatCurrency(sgst)}`}
            </div>
          </div>
          )}

          {/* Discounts */}
          {(loading || discountTotal > 0) && (
          <div
            className="rpt-card"
            style={{
              ["--accent" as string]: "#dc2626",
              ["--glow" as string]: "rgba(220,38,38,0.07)",
            }}
          >
            <div className="rpt-card-accent" />
            <div className="rpt-card-glow" />
            <div className="rpt-kpi-label">Discounts Given</div>
            <div
              className={`rpt-kpi-value${loading ? " rpt-shimmer" : ""}`}
              style={{ color: loading ? "#e5e7eb" : "#dc2626" }}
            >
              {loading ? "———" : formatCurrency(discountTotal)}
            </div>
            <div className="rpt-kpi-sub">
              {loading ? "Loading…" : "Total discount deducted from orders"}
            </div>
          </div>
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
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
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
                      <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 7 }}>
                        {loading ? "" : `${m.pct}%`}
                      </span>
                    </div>
                  </div>
                  <div className="rpt-pay-bar-bg">
                    <div
                      className="rpt-pay-bar-fill"
                      style={{
                        width: loading ? "0%" : `${m.pct}%`,
                        background: `linear-gradient(90deg, ${m.color}99, ${m.color})`,
                        boxShadow: `0 0 6px ${m.glow}`,
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
            <table className="rpt-table">
              <thead>
                <tr>
                  {["Tax Type", "Rate", "Taxable Amount", "Tax Amount"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>CGST</td>
                  <td>{gstHalfRateLabel}</td>
                  <td>{formatCurrency(subtotalSales)}</td>
                  <td>{formatCurrency(cgst)}</td>
                </tr>
                <tr>
                  <td>SGST</td>
                  <td>{gstHalfRateLabel}</td>
                  <td>{formatCurrency(subtotalSales)}</td>
                  <td>{formatCurrency(sgst)}</td>
                </tr>
                <tr className="rpt-total-row">
                  <td colSpan={3}>Total GST</td>
                  <td>{formatCurrency(displayedGst)}</td>
                </tr>
              </tbody>
            </table>
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
                <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af" }}>
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
                <svg className="rpt-chart-svg" viewBox="0 0 120 120" role="img" aria-label="Category sales chart">
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
                        <span className="rpt-legend-swatch" style={{ background: segment.color }} />
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
                  <div className="rpt-table-scroll">
                    <table className="rpt-table">
                      <thead>
                        <tr>
                          {["Item", "Category", "Units Sold", "Sales Amount"].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleItemSales.map((item) => (
                          <tr key={`${item.category}:${item.itemName}`}>
                            <td>{item.itemName}</td>
                            <td>{item.category}</td>
                            <td>{formatUnits(item.units)}</td>
                            <td>{formatCurrency(item.sales)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
      </div>
    </div>
  );
}
