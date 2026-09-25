import type { SalesFactsDto } from "../../src/shared/pos";

/**
 * Sales, Profitability, and GST & Tax are payment-period reports.
 * A bill belongs to the period of its completed payment `received_at` in `[from, to)`.
 * `from` is included. `to` is excluded. Purchases stay on `purchase_date`.
 *
 * Net Sales = orders.subtotal_paise
 *           = taxable value after the bill discount
 *
 * The source of truth is the stored subtotal_paise.
 * Do not reconstruct it as total_paise - tax_total_paise.
 * Tax-inclusive rounding can make that reconstruction miss the stored value.
 */

export type SalesTenderInput = {
  method: string;
  /** Amount applied to the bill. Not cash handed over before change. */
  amountPaise: number;
  receivedAt: number;
  /** Ignored. Present so tests can prove change / tendered cash is excluded. */
  amountPaidPaise?: number;
};

export type SalesLineInput = {
  itemName: string;
  category: string;
  units: number;
  lineValuePaise: number;
};

export type SalesBillInput = {
  id: string;
  createdAt: number;
  /** Original settlement time. The bill is counted once, in this period. */
  settledAt: number;
  invoiceNumber: string | null;
  customerName: string | null;
  /** Stored orders.subtotal_paise. */
  netSalesPaise: number;
  taxPaise: number;
  discountPaise: number;
  billTotalPaise: number;
  gstEnabled: boolean;
  priceIncludesTax: boolean;
  gstRateBps: number;
  /** Stored mode id. Labels are presentation only. */
  serviceModeId: string;
  lines: SalesLineInput[];
  tenders: SalesTenderInput[];
};

export type CreditCollectionInput = {
  amountPaise: number;
  collectedAt: number;
};

export type SalesFactsInput = {
  from: number;
  to: number;
  timeZone: string;
  bills: SalesBillInput[];
  /** Later credit settlements. Never original bill tenders. */
  creditCollections: CreditCollectionInput[];
  /** Open credit balance across all dates, in paise. */
  outstandingCreditPaise: number;
  serviceModeLabels: Record<string, string>;
};

const TENDER_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  online: "Online",
  other: "Other",
  credit: "Credit",
};

const TENDER_ORDER = ["cash", "upi", "card", "online", "other", "credit"];

function paiseToRupees(paise: number) {
  return Math.round(paise) / 100;
}

function inRange(ts: number, from: number, to: number) {
  return ts >= from && ts < to;
}

function normalizeTenderMethod(method: string) {
  const value = String(method || "other").trim().toLowerCase();
  if (value === "voucher" || value === "split") {
    return "other";
  }
  return TENDER_LABELS[value] ? value : "other";
}

function ymdInZone(ts: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts));
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function nextYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

function eachDay(from: number, to: number, timeZone: string) {
  if (!(to > from)) {
    return [];
  }
  const start = ymdInZone(from, timeZone);
  const end = ymdInZone(to - 1, timeZone);
  const days: string[] = [];
  let cursor = start;
  for (let guard = 0; guard < 4000 && cursor <= end; guard += 1) {
    days.push(cursor);
    if (cursor === end) {
      break;
    }
    cursor = nextYmd(cursor);
  }
  return days;
}

/** Integer paise. Every line except the last is floored. The last line takes the remainder. */
export function allocateLinePaise(netSalesPaise: number, lineValues: number[]) {
  if (!lineValues.length) {
    return [];
  }
  const weights = lineValues.map((value) => Math.max(0, Math.round(value)));
  const sum = weights.reduce((total, value) => total + value, 0);
  if (sum <= 0) {
    return weights.map((_, index) => (index === weights.length - 1 ? netSalesPaise : 0));
  }
  let used = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) {
      return netSalesPaise - used;
    }
    const share = Math.floor((netSalesPaise * weight) / sum);
    used += share;
    return share;
  });
}

function rateLabel(rateBps: number) {
  const percent = rateBps / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : String(percent)}%`;
}

function splitTax(taxPaise: number) {
  const cgstPaise = Math.round(taxPaise / 2);
  return { cgstPaise, sgstPaise: taxPaise - cgstPaise };
}

function preDiscountBasePaise(bill: SalesBillInput) {
  if (bill.gstEnabled && bill.priceIncludesTax) {
    return bill.billTotalPaise + bill.discountPaise;
  }
  return bill.netSalesPaise + bill.discountPaise;
}

export function buildSalesFacts(input: SalesFactsInput): SalesFactsDto {
  const qualifying = input.bills.filter((bill) => inRange(bill.settledAt, input.from, input.to));
  const dayKeys = eachDay(input.from, input.to, input.timeZone);
  const dayMap = new Map(dayKeys.map((date) => [date, { netSalesPaise: 0, bills: 0 }]));
  const categoryMap = new Map<string, { netSalesPaise: number; units: number }>();
  const itemMap = new Map<string, { itemName: string; category: string; netSalesPaise: number; units: number }>();
  const modeMap = new Map<string, { netSalesPaise: number; bills: number }>();
  const tenderMap = new Map<string, number>();
  const rateMap = new Map<number, { taxablePaise: number; cgstPaise: number; sgstPaise: number }>();

  let netSalesPaise = 0;
  let billTotalPaise = 0;
  let discountPaise = 0;
  let preDiscountPaise = 0;
  let taxPaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let residualPaise = 0;
  let untaxedPaise = 0;
  let collectedPaise = 0;

  const invoices: SalesFactsDto["gst"]["invoices"] = [];

  for (const bill of qualifying) {
    netSalesPaise += bill.netSalesPaise;
    billTotalPaise += bill.billTotalPaise;
    discountPaise += bill.discountPaise;
    preDiscountPaise += preDiscountBasePaise(bill);
    const taxSplit = splitTax(bill.taxPaise);
    taxPaise += bill.taxPaise;
    cgstPaise += taxSplit.cgstPaise;
    sgstPaise += taxSplit.sgstPaise;
    residualPaise += bill.billTotalPaise - (bill.netSalesPaise + bill.taxPaise);
    if (bill.taxPaise <= 0) {
      untaxedPaise += bill.netSalesPaise;
    }

    const day = ymdInZone(bill.settledAt, input.timeZone);
    const dayRow = dayMap.get(day) || { netSalesPaise: 0, bills: 0 };
    dayRow.netSalesPaise += bill.netSalesPaise;
    dayRow.bills += 1;
    dayMap.set(day, dayRow);

    const modeId = bill.serviceModeId || "unknown";
    const modeRow = modeMap.get(modeId) || { netSalesPaise: 0, bills: 0 };
    modeRow.netSalesPaise += bill.netSalesPaise;
    modeRow.bills += 1;
    modeMap.set(modeId, modeRow);

    const lineWeights = bill.lines.map((line) => line.lineValuePaise);
    const shares = lineWeights.length
      ? allocateLinePaise(bill.netSalesPaise, lineWeights)
      : [];
    if (!shares.length && bill.netSalesPaise !== 0) {
      const category = "Uncategorized";
      const categoryRow = categoryMap.get(category) || { netSalesPaise: 0, units: 0 };
      categoryRow.netSalesPaise += bill.netSalesPaise;
      categoryMap.set(category, categoryRow);
    }
    bill.lines.forEach((line, index) => {
      const share = shares[index] || 0;
      const category = line.category.trim() || "Uncategorized";
      const itemName = line.itemName.trim() || "Unknown Item";
      const categoryRow = categoryMap.get(category) || { netSalesPaise: 0, units: 0 };
      categoryRow.netSalesPaise += share;
      categoryRow.units += line.units;
      categoryMap.set(category, categoryRow);
      const itemKey = `${category}\u0000${itemName}`;
      const itemRow = itemMap.get(itemKey) || { itemName, category, netSalesPaise: 0, units: 0 };
      itemRow.netSalesPaise += share;
      itemRow.units += line.units;
      itemMap.set(itemKey, itemRow);
    });

    for (const tender of bill.tenders) {
      const method = normalizeTenderMethod(tender.method);
      tenderMap.set(method, (tenderMap.get(method) || 0) + tender.amountPaise);
      if (method !== "credit" && inRange(tender.receivedAt, input.from, input.to)) {
        collectedPaise += tender.amountPaise;
      }
    }

    if (bill.gstEnabled && bill.taxPaise > 0) {
      const rate = rateMap.get(bill.gstRateBps) || { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0 };
      rate.taxablePaise += bill.netSalesPaise;
      rate.cgstPaise += taxSplit.cgstPaise;
      rate.sgstPaise += taxSplit.sgstPaise;
      rateMap.set(bill.gstRateBps, rate);
    }

    invoices.push({
      invoiceNumber: bill.invoiceNumber,
      date: day,
      customerName: bill.customerName,
      taxable: paiseToRupees(bill.netSalesPaise),
      cgst: paiseToRupees(taxSplit.cgstPaise),
      sgst: paiseToRupees(taxSplit.sgstPaise),
      total: paiseToRupees(bill.billTotalPaise),
      rateLabel: bill.gstEnabled && bill.taxPaise > 0 ? rateLabel(bill.gstRateBps) : null,
    });
  }

  for (const collection of input.creditCollections) {
    if (inRange(collection.collectedAt, input.from, input.to)) {
      collectedPaise += collection.amountPaise;
    }
  }

  const hasTax = qualifying.some((bill) => bill.taxPaise > 0);
  const billCount = qualifying.length;
  const netSales = paiseToRupees(netSalesPaise);
  const billTotal = paiseToRupees(billTotalPaise);

  const tenders = TENDER_ORDER.filter((method) => (tenderMap.get(method) || 0) !== 0).map((method) => {
    const amountPaise = tenderMap.get(method) || 0;
    return {
      method,
      label: TENDER_LABELS[method],
      amount: paiseToRupees(amountPaise),
      percent: billTotalPaise > 0 ? Math.round((amountPaise / billTotalPaise) * 1000) / 10 : 0,
    };
  });

  invoices.sort((a, b) => a.date.localeCompare(b.date) || String(a.invoiceNumber || "").localeCompare(String(b.invoiceNumber || "")));

  return {
    from: input.from,
    to: input.to,
    hasTax,
    netSales,
    billCount,
    averageBill: billCount > 0 ? paiseToRupees(Math.round(netSalesPaise / billCount)) : 0,
    discountTotal: paiseToRupees(discountPaise),
    discountPercent: preDiscountPaise > 0 ? Math.round((discountPaise / preDiscountPaise) * 1000) / 10 : null,
    billTotal,
    amountCollected: paiseToRupees(collectedPaise),
    outstandingCredit: paiseToRupees(input.outstandingCreditPaise),
    inclusiveResidual: paiseToRupees(residualPaise),
    untaxedNetSales: paiseToRupees(untaxedPaise),
    daily: Array.from(dayMap.entries()).map(([date, row]) => ({
      date,
      netSales: paiseToRupees(row.netSalesPaise),
      bills: row.bills,
      averageBill: row.bills > 0 ? paiseToRupees(Math.round(row.netSalesPaise / row.bills)) : 0,
    })),
    categories: Array.from(categoryMap.entries())
      .map(([category, row]) => ({
        category,
        netSales: paiseToRupees(row.netSalesPaise),
        units: row.units,
      }))
      .sort((a, b) => b.netSales - a.netSales || a.category.localeCompare(b.category)),
    items: Array.from(itemMap.values())
      .map((row) => ({
        itemName: row.itemName,
        category: row.category,
        netSales: paiseToRupees(row.netSalesPaise),
        units: row.units,
      }))
      .sort((a, b) => b.netSales - a.netSales || a.itemName.localeCompare(b.itemName)),
    serviceModes: Array.from(modeMap.entries())
      .map(([modeId, row]) => ({
        modeId,
        label: input.serviceModeLabels[modeId] || modeId,
        bills: row.bills,
        netSales: paiseToRupees(row.netSalesPaise),
        averageBill: row.bills > 0 ? paiseToRupees(Math.round(row.netSalesPaise / row.bills)) : 0,
      }))
      .sort((a, b) => b.netSales - a.netSales || a.label.localeCompare(b.label)),
    tenders,
    gst: {
      cgst: paiseToRupees(cgstPaise),
      sgst: paiseToRupees(sgstPaise),
      totalTax: paiseToRupees(taxPaise),
      rates: Array.from(rateMap.entries())
        .map(([rateBps, row]) => ({
          rateBps,
          rateLabel: rateLabel(rateBps),
          taxable: paiseToRupees(row.taxablePaise),
          cgst: paiseToRupees(row.cgstPaise),
          sgst: paiseToRupees(row.sgstPaise),
          totalTax: paiseToRupees(row.cgstPaise + row.sgstPaise),
        }))
        .sort((a, b) => a.rateBps - b.rateBps),
      invoices,
    },
  };
}
