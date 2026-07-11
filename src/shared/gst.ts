import type { OrderLineDto } from "./pos";

export type GstConfig = {
  enabled: boolean;
  gstin: string;
  legalName: string;
  registeredAddress: string;
  stateCode: string;
  stateName: string;
  gstRateBps: number;
  priceIncludesTax: boolean;
};

export type GstTotalsPaise = {
  itemSubtotalPaise: number;
  preDiscountTotalPaise: number;
  discountTotalPaise: number;
  taxableSubtotalPaise: number;
  taxTotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
  gstRateBps: number;
  gstHalfRateBps: number;
  gstEnabled: boolean;
  priceIncludesTax: boolean;
};

export type GstTotals = {
  itemSubtotal: number;
  preDiscountTotal: number;
  discountTotal: number;
  taxableSubtotal: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  total: number;
  gstRateBps: number;
  gstHalfRateBps: number;
  gstEnabled: boolean;
  priceIncludesTax: boolean;
};

export const DEFAULT_GST_CONFIG: GstConfig = {
  enabled: false,
  gstin: "",
  legalName: "",
  registeredAddress: "",
  stateCode: "",
  stateName: "",
  gstRateBps: 1800,
  priceIncludesTax: true,
};

export function normalizeGstConfig(input?: Partial<GstConfig> | null): GstConfig {
  const rawRate = Number(input?.gstRateBps ?? DEFAULT_GST_CONFIG.gstRateBps);
  const gstRateBps = Number.isFinite(rawRate)
    ? Math.max(0, Math.min(2800, Math.round(rawRate)))
    : DEFAULT_GST_CONFIG.gstRateBps;

  return {
    enabled: Boolean(input?.enabled),
    gstin: String(input?.gstin || "")
      .trim()
      .toUpperCase(),
    legalName: String(input?.legalName || "").trim(),
    registeredAddress: String(input?.registeredAddress || "").trim(),
    stateCode: String(input?.stateCode || "").trim(),
    stateName: String(input?.stateName || "").trim(),
    gstRateBps,
    priceIncludesTax: input?.priceIncludesTax !== false,
  };
}

export function isValidGstin(gstin: string) {
  const value = String(gstin || "")
    .trim()
    .toUpperCase();
  return !value || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value);
}

export function formatGstRate(gstRateBps: number) {
  return `${(Number(gstRateBps || 0) / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function getOrderGstConfig(
  order: { meta?: Record<string, unknown> } | null | undefined,
  currentConfig?: Partial<GstConfig> | null,
) {
  const snapshot =
    order?.meta && typeof order.meta === "object" ? (order.meta as any).gstSnapshot : null;
  return normalizeGstConfig(snapshot || currentConfig || DEFAULT_GST_CONFIG);
}

function rupeesToPaise(value: number | null | undefined) {
  return Math.round((Number(value) || 0) * 100);
}

function paiseToRupees(value: number | null | undefined) {
  return Math.round(Number(value) || 0) / 100;
}

export function calculateGstTotalsPaise(
  lines: Array<Pick<OrderLineDto, "qty" | "rate">>,
  discountPercent = 0,
  inputConfig?: Partial<GstConfig> | null,
): GstTotalsPaise {
  const config = normalizeGstConfig(inputConfig);
  const itemSubtotalPaise = (lines || []).reduce((sum, line) => {
    const qty = Number(line.qty) || 0;
    return sum + Math.round(qty * rupeesToPaise(Number(line.rate) || 0));
  }, 0);
  const safeDiscountPercent = Math.max(0, Math.min(100, Number(discountPercent) || 0));
  const discountTotalPaise = Math.round((itemSubtotalPaise * safeDiscountPercent) / 100);
  const discountedBasePaise = Math.max(0, itemSubtotalPaise - discountTotalPaise);
  const gstEnabled = config.enabled && config.gstRateBps > 0;

  let taxableSubtotalPaise = discountedBasePaise;
  let calculatedTaxTotalPaise = 0;
  let totalPaise = discountedBasePaise;
  let preDiscountTotalPaise = itemSubtotalPaise;

  if (gstEnabled && config.priceIncludesTax) {
    calculatedTaxTotalPaise = Math.round(
      (discountedBasePaise * config.gstRateBps) / (10000 + config.gstRateBps),
    );
    taxableSubtotalPaise = Math.max(0, discountedBasePaise - calculatedTaxTotalPaise);
    totalPaise = discountedBasePaise;
    preDiscountTotalPaise = itemSubtotalPaise;
  } else if (gstEnabled) {
    taxableSubtotalPaise = discountedBasePaise;
    calculatedTaxTotalPaise = Math.round((taxableSubtotalPaise * config.gstRateBps) / 10000);
    totalPaise = taxableSubtotalPaise + calculatedTaxTotalPaise;
    preDiscountTotalPaise =
      itemSubtotalPaise + Math.round((itemSubtotalPaise * config.gstRateBps) / 10000);
  }

  const gstHalfRateBps = gstEnabled ? Math.round(config.gstRateBps / 2) : 0;
  const cgstPaise = gstEnabled ? Math.round((taxableSubtotalPaise * gstHalfRateBps) / 10000) : 0;
  const sgstPaise = cgstPaise; // always equal — both halves use the same rate
  const taxTotalPaise = cgstPaise + sgstPaise;

  // For price-exclusive orders, recalculate total using the CGST-consistent tax total
  // so that taxable + cgst + sgst always equals the grand total on the receipt.
  if (gstEnabled && !config.priceIncludesTax) {
    totalPaise = taxableSubtotalPaise + taxTotalPaise;
  }

  return {
    itemSubtotalPaise,
    preDiscountTotalPaise,
    discountTotalPaise,
    taxableSubtotalPaise,
    taxTotalPaise,
    cgstPaise,
    sgstPaise,
    totalPaise,
    gstRateBps: gstEnabled ? config.gstRateBps : 0,
    gstHalfRateBps,
    gstEnabled,
    priceIncludesTax: config.priceIncludesTax,
  };
}

export function calculateGstTotals(
  lines: Array<Pick<OrderLineDto, "qty" | "rate">>,
  discountPercent = 0,
  inputConfig?: Partial<GstConfig> | null,
): GstTotals {
  const totals = calculateGstTotalsPaise(lines, discountPercent, inputConfig);
  return {
    itemSubtotal: paiseToRupees(totals.itemSubtotalPaise),
    preDiscountTotal: paiseToRupees(totals.preDiscountTotalPaise),
    discountTotal: paiseToRupees(totals.discountTotalPaise),
    taxableSubtotal: paiseToRupees(totals.taxableSubtotalPaise),
    taxTotal: paiseToRupees(totals.taxTotalPaise),
    cgst: paiseToRupees(totals.cgstPaise),
    sgst: paiseToRupees(totals.sgstPaise),
    total: paiseToRupees(totals.totalPaise),
    gstRateBps: totals.gstRateBps,
    gstHalfRateBps: totals.gstHalfRateBps,
    gstEnabled: totals.gstEnabled,
    priceIncludesTax: totals.priceIncludesTax,
  };
}
