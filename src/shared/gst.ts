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
  roundOffPaise: number;
  preRoundTotalPaise: number;
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
  roundOff: number;
  preRoundTotal: number;
  total: number;
  gstRateBps: number;
  gstHalfRateBps: number;
  gstEnabled: boolean;
  priceIncludesTax: boolean;
};

export type BillGstInput = {
  grossPaise: number;
  enabled: boolean;
  gstRateBps: number;
  priceIncludesTax: boolean;
};

export type BillGstPaise = {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  taxPaise: number;
  preRoundTotalPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
};

/** New restaurants and Settings → Reset Form. Not used when a stored field is missing. */
export const PRODUCT_GST_DEFAULTS = {
  enabled: false,
  gstRateBps: 500,
  priceIncludesTax: false,
} as const;

/** Used only when a stored GST field is absent. Do not apply this to new databases. */
export const LEGACY_GST_DEFAULTS = {
  enabled: false,
  gstRateBps: 1800,
  priceIncludesTax: true,
} as const;

export const DEFAULT_GST_CONFIG: GstConfig = {
  enabled: PRODUCT_GST_DEFAULTS.enabled,
  gstin: "",
  legalName: "",
  registeredAddress: "",
  stateCode: "",
  stateName: "",
  gstRateBps: PRODUCT_GST_DEFAULTS.gstRateBps,
  priceIncludesTax: PRODUCT_GST_DEFAULTS.priceIncludesTax,
};

const GST_RATE_CAP_BPS = 2800;

export function roundHalfUpDiv(numerator: number, denominator: number) {
  const top = Math.trunc(numerator);
  const bottom = Math.trunc(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) {
    return 0;
  }
  const sign = top < 0 ? -1 : 1;
  const abs = Math.abs(top);
  return sign * Math.floor((abs + Math.floor(bottom / 2)) / bottom);
}

export function roundToNearestRupee(paise: number) {
  const safe = Math.max(0, Math.trunc(paise));
  const remainder = safe % 100;
  if (remainder === 0) {
    return safe;
  }
  if (remainder < 50) {
    return safe - remainder;
  }
  return safe + (100 - remainder);
}

export function splitGstPaise(taxPaise: number) {
  const tax = Math.max(0, Math.trunc(taxPaise));
  const cgstPaise = Math.floor(tax / 2);
  return { cgstPaise, sgstPaise: tax - cgstPaise };
}

export function gstRateBpsForChoice(choice: 5 | 18 | null, legacyPercent: number | null) {
  if (choice === 5) {
    return 500;
  }
  if (choice === 18) {
    return 1800;
  }
  return Math.round((Number(legacyPercent) || 0) * 100);
}

export function gstRateSelection(gstRateBps: number): {
  choice: 5 | 18 | null;
  legacyPercent: number | null;
} {
  const percent = Number(gstRateBps) / 100;
  if (percent === 5) {
    return { choice: 5, legacyPercent: null };
  }
  if (percent === 18) {
    return { choice: 18, legacyPercent: null };
  }
  return {
    choice: null,
    legacyPercent: Number.isFinite(percent) ? percent : null,
  };
}

export function normalizeGstConfig(input?: Partial<GstConfig> | null): GstConfig {
  const rateMissing = input == null || input.gstRateBps === undefined || input.gstRateBps === null;
  const rawRate = rateMissing ? LEGACY_GST_DEFAULTS.gstRateBps : Number(input?.gstRateBps);
  const gstRateBps = Number.isFinite(rawRate)
    ? Math.max(0, Math.min(GST_RATE_CAP_BPS, Math.round(rawRate)))
    : LEGACY_GST_DEFAULTS.gstRateBps;

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
    priceIncludesTax:
      input?.priceIncludesTax === undefined || input?.priceIncludesTax === null
        ? LEGACY_GST_DEFAULTS.priceIncludesTax
        : Boolean(input.priceIncludesTax),
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
  if (snapshot && typeof snapshot === "object") {
    return normalizeGstConfig(snapshot);
  }
  if (currentConfig) {
    return normalizeGstConfig(currentConfig);
  }
  return normalizeGstConfig(null);
}

function rupeesToPaise(value: number | null | undefined) {
  return Math.round((Number(value) || 0) * 100);
}

function paiseToRupees(value: number | null | undefined) {
  return Math.round(Number(value) || 0) / 100;
}

export type DiscountMode = "percent" | "amount";

/** One discount at a time: a percent of the item subtotal, or a fixed rupee amount. */
export type OrderDiscount = {
  mode: DiscountMode;
  /** 0–100. Applied when mode is percent. */
  percent: number;
  /** Rupees. Applied when mode is amount, and never more than the item subtotal. */
  amount: number;
};

function clampDiscountPercent(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

function clampDiscountAmount(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.round(n * 100) / 100;
}

export function normalizeOrderDiscount(
  input?: number | Partial<OrderDiscount> | null,
): OrderDiscount {
  if (typeof input !== "object" || input == null) {
    return { mode: "percent", percent: clampDiscountPercent(input), amount: 0 };
  }
  if (input.mode === "amount") {
    return { mode: "amount", percent: 0, amount: clampDiscountAmount(input.amount) };
  }
  return { mode: "percent", percent: clampDiscountPercent(input.percent), amount: 0 };
}

export function orderDiscountsEqual(a: OrderDiscount, b: OrderDiscount) {
  return a.mode === b.mode && a.percent === b.percent && a.amount === b.amount;
}

export function calculateBillGstPaise(input: BillGstInput): BillGstPaise {
  const grossPaise = Math.max(0, Math.trunc(Number(input.grossPaise) || 0));
  const rateBps = Math.max(0, Math.trunc(Number(input.gstRateBps) || 0));
  const gstEnabled = Boolean(input.enabled) && rateBps > 0;
  if (!gstEnabled) {
    return {
      taxablePaise: grossPaise,
      cgstPaise: 0,
      sgstPaise: 0,
      taxPaise: 0,
      preRoundTotalPaise: grossPaise,
      roundOffPaise: 0,
      grandTotalPaise: grossPaise,
    };
  }

  let taxPaise = 0;
  let taxablePaise = grossPaise;
  let preRoundTotalPaise = grossPaise;
  let grandTotalPaise = grossPaise;
  let roundOffPaise = 0;

  if (input.priceIncludesTax) {
    taxPaise = roundHalfUpDiv(grossPaise * rateBps, 10000 + rateBps);
    taxablePaise = grossPaise - taxPaise;
    preRoundTotalPaise = grossPaise;
    grandTotalPaise = grossPaise;
    roundOffPaise = 0;
  } else {
    taxablePaise = grossPaise;
    taxPaise = roundHalfUpDiv(taxablePaise * rateBps, 10000);
    preRoundTotalPaise = taxablePaise + taxPaise;
    grandTotalPaise = roundToNearestRupee(preRoundTotalPaise);
    roundOffPaise = grandTotalPaise - preRoundTotalPaise;
  }

  const split = splitGstPaise(taxPaise);
  return {
    taxablePaise,
    cgstPaise: split.cgstPaise,
    sgstPaise: split.sgstPaise,
    taxPaise,
    preRoundTotalPaise,
    roundOffPaise,
    grandTotalPaise,
  };
}

export function calculateGstTotalsPaise(
  lines: Array<Pick<OrderLineDto, "qty" | "rate">>,
  discount: number | Partial<OrderDiscount> = 0,
  inputConfig?: Partial<GstConfig> | null,
): GstTotalsPaise {
  const config = normalizeGstConfig(inputConfig);
  const itemSubtotalPaise = (lines || []).reduce((sum, line) => {
    const qty = Number(line.qty) || 0;
    return sum + Math.round(qty * rupeesToPaise(Number(line.rate) || 0));
  }, 0);
  const normalizedDiscount = normalizeOrderDiscount(discount);
  const discountTotalPaise =
    normalizedDiscount.mode === "amount"
      ? Math.min(itemSubtotalPaise, rupeesToPaise(normalizedDiscount.amount))
      : roundHalfUpDiv(
          itemSubtotalPaise * Math.round(normalizedDiscount.percent * 100),
          10000,
        );
  const grossPaise = Math.max(0, itemSubtotalPaise - discountTotalPaise);
  const bill = calculateBillGstPaise({
    grossPaise,
    enabled: config.enabled,
    gstRateBps: config.gstRateBps,
    priceIncludesTax: config.priceIncludesTax,
  });
  const gstEnabled = config.enabled && config.gstRateBps > 0;

  return {
    itemSubtotalPaise,
    preDiscountTotalPaise: itemSubtotalPaise,
    discountTotalPaise,
    taxableSubtotalPaise: bill.taxablePaise,
    taxTotalPaise: bill.taxPaise,
    cgstPaise: bill.cgstPaise,
    sgstPaise: bill.sgstPaise,
    roundOffPaise: bill.roundOffPaise,
    preRoundTotalPaise: bill.preRoundTotalPaise,
    totalPaise: bill.grandTotalPaise,
    gstRateBps: gstEnabled ? config.gstRateBps : 0,
    gstHalfRateBps: gstEnabled ? Math.floor(config.gstRateBps / 2) : 0,
    gstEnabled,
    priceIncludesTax: config.priceIncludesTax,
  };
}

export function calculateGstTotals(
  lines: Array<Pick<OrderLineDto, "qty" | "rate">>,
  discount: number | Partial<OrderDiscount> = 0,
  inputConfig?: Partial<GstConfig> | null,
): GstTotals {
  const totals = calculateGstTotalsPaise(lines, discount, inputConfig);
  return {
    itemSubtotal: paiseToRupees(totals.itemSubtotalPaise),
    preDiscountTotal: paiseToRupees(totals.preDiscountTotalPaise),
    discountTotal: paiseToRupees(totals.discountTotalPaise),
    taxableSubtotal: paiseToRupees(totals.taxableSubtotalPaise),
    taxTotal: paiseToRupees(totals.taxTotalPaise),
    cgst: paiseToRupees(totals.cgstPaise),
    sgst: paiseToRupees(totals.sgstPaise),
    roundOff: paiseToRupees(totals.roundOffPaise),
    preRoundTotal: paiseToRupees(totals.preRoundTotalPaise),
    total: paiseToRupees(totals.totalPaise),
    gstRateBps: totals.gstRateBps,
    gstHalfRateBps: totals.gstHalfRateBps,
    gstEnabled: totals.gstEnabled,
    priceIncludesTax: totals.priceIncludesTax,
  };
}
