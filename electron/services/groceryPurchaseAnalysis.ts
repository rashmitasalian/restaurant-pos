import type Database from "better-sqlite3";
import type { GroceryPurchaseAnalysisDto } from "../../src/shared/pos";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNSPECIFIED_VENDOR = "Vendor not specified";

export type AnalyticalGroceryLine = {
  id: string;
  groceryItemId: string | null;
  itemName: string;
  catalogName: string | null;
  quantity: number;
  unit: string;
  totalPaise: number;
  vendorName: string | null;
};

export type AnalyticalGroceryBill = {
  id: string;
  purchaseDate: number;
  sortDate: number;
  sortCreatedAt: number;
  totalPaise: number;
  vendorName: string | null;
  lines: AnalyticalGroceryLine[];
};

type FlatLine = AnalyticalGroceryLine & {
  billId: string;
  sortDate: number;
  sortCreatedAt: number;
  billTotalPaise: number;
};

function rupeesFromPaise(paise: number) {
  return Math.round(paise) / 100;
}

function roundQty(quantity: number) {
  return Math.round(quantity * 1000) / 1000;
}

function roundUnitPrice(paisePerUnit: number) {
  return Math.round(paisePerUnit) / 100;
}

function roundPct(value: number) {
  return Math.round(value * 10000) / 10000;
}

function normaliseUnit(unit: string) {
  if (unit === "g") {
    return { unit: "kg", factor: 1 / 1000 };
  }
  if (unit === "ml") {
    return { unit: "L", factor: 1 / 1000 };
  }
  return { unit, factor: 1 };
}

function identityKey(line: AnalyticalGroceryLine) {
  if (line.groceryItemId) {
    return `item:${line.groceryItemId}`;
  }
  return `name:${line.itemName.trim().toLowerCase()}`;
}

function comparisonKey(line: AnalyticalGroceryLine) {
  return `${identityKey(line)}|${normaliseUnit(line.unit).unit}`;
}

function normalisedQuantity(line: AnalyticalGroceryLine) {
  return Number(line.quantity) * normaliseUnit(line.unit).factor;
}

function vendorLabel(name: string | null | undefined) {
  const text = String(name || "").trim();
  return text || UNSPECIFIED_VENDOR;
}

function newestFirst(a: FlatLine, b: FlatLine) {
  if (a.sortDate !== b.sortDate) {
    return b.sortDate - a.sortDate;
  }
  if (a.sortCreatedAt !== b.sortCreatedAt) {
    return b.sortCreatedAt - a.sortCreatedAt;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? 1 : -1;
}

function isPriced(line: AnalyticalGroceryLine) {
  return Number(line.totalPaise) > 0 && Number(line.quantity) > 0 && normalisedQuantity(line) > 0;
}

function rawUnitPricePaise(line: AnalyticalGroceryLine) {
  return Number(line.totalPaise) / normalisedQuantity(line);
}

function flatten(bills: AnalyticalGroceryBill[]): FlatLine[] {
  const lines: FlatLine[] = [];
  for (const bill of bills) {
    for (const line of bill.lines) {
      lines.push({
        ...line,
        vendorName: bill.vendorName || line.vendorName,
        billId: bill.id,
        sortDate: bill.sortDate,
        sortCreatedAt: bill.sortCreatedAt,
        billTotalPaise: bill.totalPaise,
      });
    }
  }
  return lines;
}

function groupByKey(lines: FlatLine[]) {
  const groups = new Map<string, FlatLine[]>();
  for (const line of lines) {
    const key = comparisonKey(line);
    const current = groups.get(key);
    if (current) {
      current.push(line);
    } else {
      groups.set(key, [line]);
    }
  }
  return groups;
}

function displayName(lines: FlatLine[]) {
  const newest = [...lines].sort(newestFirst)[0];
  if (lines.some((line) => line.groceryItemId)) {
    const catalog = lines.find((line) => line.catalogName)?.catalogName;
    return catalog || newest.itemName;
  }
  return newest.itemName;
}

function displayUnit(lines: FlatLine[]) {
  return normaliseUnit(lines[0].unit).unit;
}

function loadLinesForPurchases(database: Database.Database, purchaseIds: string[]) {
  const byPurchase = new Map<string, AnalyticalGroceryLine[]>();
  const chunkSize = 400;
  for (let index = 0; index < purchaseIds.length; index += chunkSize) {
    const chunk = purchaseIds.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = database
      .prepare(
        `SELECT l.id, l.purchase_id, l.grocery_item_id, l.item_name, l.quantity, l.unit, l.total_paise,
                COALESCE(v.name, l.vendor) AS vendor_name, gi.name AS catalog_name
         FROM grocery_purchase_lines l
         LEFT JOIN grocery_items gi ON gi.id = l.grocery_item_id
         LEFT JOIN vendors v ON v.id = l.vendor_id
         WHERE l.purchase_id IN (${placeholders})`,
      )
      .all(...chunk) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const purchaseId = String(row.purchase_id);
      const line: AnalyticalGroceryLine = {
        id: String(row.id),
        groceryItemId: row.grocery_item_id ? String(row.grocery_item_id) : null,
        itemName: String(row.item_name || ""),
        catalogName: row.catalog_name ? String(row.catalog_name) : null,
        quantity: Number(row.quantity) || 0,
        unit: String(row.unit || ""),
        totalPaise: Number(row.total_paise) || 0,
        vendorName: row.vendor_name ? String(row.vendor_name) : null,
      };
      const list = byPurchase.get(purchaseId);
      if (list) {
        list.push(line);
      } else {
        byPurchase.set(purchaseId, [line]);
      }
    }
  }
  return byPurchase;
}

/**
 * Recorded purchase headers in [from, to), plus active orphan lines (purchase_id IS NULL)
 * as in-memory bills. Orphan bills are never written to grocery_purchases.
 */
export function loadRecordedGroceryBills(
  database: Database.Database,
  from: number,
  to: number,
): AnalyticalGroceryBill[] {
  const headers = database
    .prepare(
      `SELECT p.id, p.purchase_date, p.created_at, p.total_paise, v.name AS vendor_name
       FROM grocery_purchases p
       LEFT JOIN vendors v ON v.id = p.vendor_id
       WHERE p.status = 'recorded'
         AND p.purchase_date >= ?
         AND p.purchase_date < ?`,
    )
    .all(from, to) as Array<Record<string, unknown>>;
  const linesByPurchase = loadLinesForPurchases(
    database,
    headers.map((row) => String(row.id)),
  );
  const bills: AnalyticalGroceryBill[] = headers.map((row) => ({
    id: String(row.id),
    purchaseDate: Number(row.purchase_date),
    sortDate: Number(row.purchase_date),
    sortCreatedAt: Number(row.created_at) || 0,
    totalPaise: Number(row.total_paise) || 0,
    vendorName: row.vendor_name ? String(row.vendor_name) : null,
    lines: linesByPurchase.get(String(row.id)) || [],
  }));

  const orphans = database
    .prepare(
      `SELECT l.id, l.grocery_item_id, l.item_name, l.quantity, l.unit, l.total_paise,
              l.purchased_at, l.created_at, COALESCE(v.name, l.vendor) AS vendor_name,
              gi.name AS catalog_name
       FROM grocery_purchase_lines l
       LEFT JOIN grocery_items gi ON gi.id = l.grocery_item_id
       LEFT JOIN vendors v ON v.id = l.vendor_id
       WHERE l.purchase_id IS NULL
         AND l.active = 1
         AND l.purchased_at >= ?
         AND l.purchased_at < ?`,
    )
    .all(from, to) as Array<Record<string, unknown>>;
  for (const row of orphans) {
    const line: AnalyticalGroceryLine = {
      id: String(row.id),
      groceryItemId: row.grocery_item_id ? String(row.grocery_item_id) : null,
      itemName: String(row.item_name || ""),
      catalogName: row.catalog_name ? String(row.catalog_name) : null,
      quantity: Number(row.quantity) || 0,
      unit: String(row.unit || ""),
      totalPaise: Number(row.total_paise) || 0,
      vendorName: row.vendor_name ? String(row.vendor_name) : null,
    };
    bills.push({
      id: `legacy-line:${line.id}`,
      purchaseDate: Number(row.purchased_at),
      sortDate: Number(row.purchased_at),
      sortCreatedAt: Number(row.created_at) || 0,
      totalPaise: line.totalPaise,
      vendorName: line.vendorName,
      lines: [line],
    });
  }
  return bills;
}

export function buildGroceryPurchaseAnalysis(input: {
  from: number;
  to: number;
  periodBills: AnalyticalGroceryBill[];
  previousBills: AnalyticalGroceryBill[];
  historyBills: AnalyticalGroceryBill[];
}): GroceryPurchaseAnalysisDto {
  const periodLines = flatten(input.periodBills);
  const previousLines = flatten(input.previousBills);
  const historyLines = flatten(input.historyBills);
  const periodGroups = groupByKey(periodLines);
  const previousGroups = groupByKey(previousLines);
  const historyGroups = groupByKey(historyLines);
  const dayCount = Math.max(1, (input.to - input.from) / DAY_MS);

  let purchaseTotalPaise = 0;
  let unallocatedPaise = 0;
  for (const bill of input.periodBills) {
    purchaseTotalPaise += bill.totalPaise;
    const pricedLineTotal = bill.lines.reduce(
      (sum, line) => sum + (Number(line.totalPaise) > 0 ? Number(line.totalPaise) : 0),
      0,
    );
    unallocatedPaise += Math.max(0, bill.totalPaise - pricedLineTotal);
  }

  const purchaseRows = Array.from(periodGroups.entries()).map(([key, lines]) => {
    const purchasedQuantity = lines.reduce((sum, line) => sum + normalisedQuantity(line), 0);
    const previousQuantity = (previousGroups.get(key) || []).reduce(
      (sum, line) => sum + normalisedQuantity(line),
      0,
    );
    const purchaseValuePaise = lines.reduce(
      (sum, line) => sum + (Number(line.totalPaise) > 0 ? Number(line.totalPaise) : 0),
      0,
    );
    const billIds = new Set(lines.map((line) => line.billId));
    return {
      key,
      itemName: displayName(lines),
      unit: displayUnit(lines),
      purchasedQuantity: roundQty(purchasedQuantity),
      previousQuantity: roundQty(previousQuantity),
      quantityChangePct:
        previousQuantity > 0
          ? roundPct(((purchasedQuantity - previousQuantity) / previousQuantity) * 100)
          : null,
      avgPurchasedPerDay: roundQty(purchasedQuantity / dayCount),
      purchaseValue: rupeesFromPaise(purchaseValuePaise),
      billCount: billIds.size,
    };
  });
  purchaseRows.sort(
    (a, b) => b.purchaseValue - a.purchaseValue || a.itemName.localeCompare(b.itemName) || a.unit.localeCompare(b.unit),
  );

  const priceRows: GroceryPurchaseAnalysisDto["priceRows"] = [];
  let priceIncreaseCount = 0;
  const itemDetails: GroceryPurchaseAnalysisDto["itemDetails"] = {};

  for (const [key, lines] of periodGroups) {
    const history = [...(historyGroups.get(key) || [])].sort(newestFirst);
    const pricedHistory = history.filter(isPriced);
    const pricedInPeriod = lines.filter(
      (line) => isPriced(line) && line.sortDate >= input.from && line.sortDate < input.to,
    );
    const pricedPaise = pricedInPeriod.reduce((sum, line) => sum + Number(line.totalPaise), 0);
    const pricedQty = pricedInPeriod.reduce((sum, line) => sum + normalisedQuantity(line), 0);
    const latest = pricedHistory[0];
    const previous = pricedHistory[1] || null;
    const latestInPeriod = Boolean(latest && latest.sortDate >= input.from && latest.sortDate < input.to);
    let changePct: number | null = null;
    if (latestInPeriod && previous) {
      const latestRaw = rawUnitPricePaise(latest);
      const previousRaw = rawUnitPricePaise(previous);
      if (previousRaw > 0) {
        changePct = roundPct(((latestRaw - previousRaw) / previousRaw) * 100);
        if (latestRaw > previousRaw) {
          priceIncreaseCount += 1;
        }
      }
    }
    if (latestInPeriod && latest) {
      const periodPrices = pricedInPeriod.map(rawUnitPricePaise);
      priceRows.push({
        key,
        itemName: displayName(lines),
        unit: displayUnit(lines),
        latest: {
          unitPrice: roundUnitPrice(rawUnitPricePaise(latest)),
          date: latest.sortDate,
          vendorName: vendorLabel(latest.vendorName),
        },
        previous: previous
          ? {
              unitPrice: roundUnitPrice(rawUnitPricePaise(previous)),
              date: previous.sortDate,
              vendorName: vendorLabel(previous.vendorName),
            }
          : null,
        changePct,
        periodLow: roundUnitPrice(Math.min(...periodPrices)),
        periodHigh: roundUnitPrice(Math.max(...periodPrices)),
      });
    }

    const vendorLatest = new Map<string, FlatLine>();
    for (const line of pricedHistory) {
      const label = vendorLabel(line.vendorName);
      if (!vendorLatest.has(label)) {
        vendorLatest.set(label, line);
      }
    }
    itemDetails[key] = {
      avgRecordedPrice: pricedQty > 0 ? roundUnitPrice(pricedPaise / pricedQty) : null,
      vendorPrices: Array.from(vendorLatest.entries())
        .map(([vendorName, line]) => ({
          vendorName,
          unitPrice: roundUnitPrice(rawUnitPricePaise(line)),
          date: line.sortDate,
        }))
        .sort((a, b) => b.date - a.date || a.vendorName.localeCompare(b.vendorName)),
      recentPurchases: history.slice(0, 10).map((line) => ({
        date: line.sortDate,
        quantity: roundQty(normalisedQuantity(line)),
        unit: normaliseUnit(line.unit).unit,
        unitPrice: isPriced(line) ? roundUnitPrice(rawUnitPricePaise(line)) : null,
        vendorName: vendorLabel(line.vendorName),
        billTotal: rupeesFromPaise(line.billTotalPaise),
      })),
    };
  }

  priceRows.sort((a, b) => {
    if (a.changePct == null && b.changePct == null) {
      return a.itemName.localeCompare(b.itemName);
    }
    if (a.changePct == null) {
      return 1;
    }
    if (b.changePct == null) {
      return -1;
    }
    return b.changePct - a.changePct || a.itemName.localeCompare(b.itemName);
  });

  return {
    from: input.from,
    to: input.to,
    summary: {
      purchaseTotal: rupeesFromPaise(purchaseTotalPaise),
      billCount: input.periodBills.length,
      priceIncreaseCount,
      unallocatedTotal: rupeesFromPaise(unallocatedPaise),
    },
    purchaseRows,
    priceRows,
    itemDetails,
  };
}
