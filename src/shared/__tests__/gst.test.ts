import {
  calculateBillGstPaise,
  calculateGstTotals,
  calculateGstTotalsPaise,
  gstRateBpsForChoice,
  gstRateSelection,
  normalizeGstConfig,
  roundToNearestRupee,
} from "../gst";

const singleLine = [{ qty: 1, rate: 118 }];

function assertInclusiveInvariant(grossPaise: number, rateBps: number) {
  const bill = calculateBillGstPaise({
    grossPaise,
    enabled: true,
    gstRateBps: rateBps,
    priceIncludesTax: true,
  });
  expect(bill.taxablePaise + bill.cgstPaise + bill.sgstPaise).toBe(grossPaise);
  expect(bill.cgstPaise + bill.sgstPaise).toBe(bill.taxPaise);
  expect(bill.sgstPaise).toBeGreaterThanOrEqual(bill.cgstPaise);
  expect(bill.grandTotalPaise).toBe(grossPaise);
  expect(bill.roundOffPaise).toBe(0);
}

describe("GST totals", () => {
  it("does not apply tax when GST is disabled even if a rate is configured", () => {
    const totals = calculateGstTotalsPaise(singleLine, 0, {
      enabled: false,
      gstRateBps: 1800,
      priceIncludesTax: true,
    });

    expect(totals.gstEnabled).toBe(false);
    expect(totals.taxTotalPaise).toBe(0);
    expect(totals.roundOffPaise).toBe(0);
    expect(totals.totalPaise).toBe(11800);
  });

  it("applies included GST only when enabled", () => {
    const totals = calculateGstTotals(singleLine, 0, {
      enabled: true,
      gstRateBps: 1800,
      priceIncludesTax: true,
    });

    expect(totals.gstEnabled).toBe(true);
    expect(totals.taxTotal).toBe(18);
    expect(totals.total).toBe(118);
  });

  it("splits inclusive 5% GST with the odd paisa on SGST", () => {
    const totals = calculateGstTotalsPaise([{ qty: 1, rate: 120 }], 0, {
      enabled: true,
      gstRateBps: 500,
      priceIncludesTax: true,
    });

    expect(totals.taxableSubtotalPaise).toBe(11429);
    expect(totals.taxTotalPaise).toBe(571);
    expect(totals.cgstPaise).toBe(285);
    expect(totals.sgstPaise).toBe(286);
    expect(totals.totalPaise).toBe(12000);
  });

  it("adds 5% GST on the bill and rounds only the payable amount", () => {
    const totals = calculateGstTotalsPaise([{ qty: 1, rate: 333.33 }], 0, {
      enabled: true,
      gstRateBps: 500,
      priceIncludesTax: false,
    });

    expect(totals.taxableSubtotalPaise).toBe(33333);
    expect(totals.taxTotalPaise).toBe(1667);
    expect(totals.cgstPaise).toBe(833);
    expect(totals.sgstPaise).toBe(834);
    expect(totals.preRoundTotalPaise).toBe(35000);
    expect(totals.roundOffPaise).toBe(0);
    expect(totals.totalPaise).toBe(35000);
  });

  it("matches the Nandhini bill at 5% tax on top", () => {
    const bill = calculateBillGstPaise({
      grossPaise: 125900,
      enabled: true,
      gstRateBps: 500,
      priceIncludesTax: false,
    });
    expect(bill.taxPaise).toBe(6295);
    expect(bill.cgstPaise).toBe(3147);
    expect(bill.sgstPaise).toBe(3148);
    expect(bill.preRoundTotalPaise).toBe(132195);
    expect(bill.roundOffPaise).toBe(5);
    expect(bill.grandTotalPaise).toBe(132200);
  });

  it("extracts 5% from a ₹25 inclusive price", () => {
    const bill = calculateBillGstPaise({
      grossPaise: 2500,
      enabled: true,
      gstRateBps: 500,
      priceIncludesTax: true,
    });
    expect(bill.taxPaise).toBe(119);
    expect(bill.taxablePaise).toBe(2381);
    expect(bill.cgstPaise).toBe(59);
    expect(bill.sgstPaise).toBe(60);
    expect(bill.grandTotalPaise).toBe(2500);
  });

  it.each([2500, 10000, 10100, 99900])(
    "keeps inclusive ₹%s at 5% adding back to the gross",
    (grossPaise) => {
      assertInclusiveInvariant(grossPaise, 500);
    },
  );

  it.each([
    [0, 0],
    [1, 0],
    [49, 0],
    [50, 100],
    [99, 100],
  ])("rounds payable remainder %s paise to %s", (remainder, roundedRemainder) => {
    expect(roundToNearestRupee(1000 + remainder)).toBe(1000 + roundedRemainder);
  });

  it("applies GST to the discounted gross", () => {
    const totals = calculateGstTotalsPaise([{ qty: 1, rate: 1000 }], 10, {
      enabled: true,
      gstRateBps: 500,
      priceIncludesTax: false,
    });
    expect(totals.discountTotalPaise).toBe(10000);
    expect(totals.taxableSubtotalPaise).toBe(90000);
    expect(totals.taxTotalPaise).toBe(4500);
    expect(totals.totalPaise).toBe(94500);
  });

  it("keeps a missing rate at the legacy 18% inclusive default", () => {
    const cfg = normalizeGstConfig({ enabled: true });
    expect(cfg.gstRateBps).toBe(1800);
    expect(cfg.priceIncludesTax).toBe(true);
  });

  it("keeps an explicit 12% exclusive config", () => {
    const cfg = normalizeGstConfig({
      enabled: true,
      gstRateBps: 1200,
      priceIncludesTax: false,
    });
    expect(cfg.gstRateBps).toBe(1200);
    expect(cfg.priceIncludesTax).toBe(false);
  });

  it("keeps a stored inclusive 18% config", () => {
    const cfg = normalizeGstConfig({
      enabled: true,
      gstRateBps: 1800,
      priceIncludesTax: true,
    });
    expect(cfg.gstRateBps).toBe(1800);
    expect(cfg.priceIncludesTax).toBe(true);
  });

  it("offers only 5% and 18% as choices and leaves 12% as a legacy rate", () => {
    expect(gstRateSelection(500)).toEqual({ choice: 5, legacyPercent: null });
    expect(gstRateSelection(1800)).toEqual({ choice: 18, legacyPercent: null });
    expect(gstRateSelection(1200)).toEqual({ choice: null, legacyPercent: 12 });
    expect(gstRateBpsForChoice(null, 12)).toBe(1200);
    expect(gstRateBpsForChoice(5, 12)).toBe(500);
    expect(gstRateBpsForChoice(18, 12)).toBe(1800);
  });

  it("adds 18% GST on the bill", () => {
    const bill = calculateBillGstPaise({
      grossPaise: 100000,
      enabled: true,
      gstRateBps: 1800,
      priceIncludesTax: false,
    });
    expect(bill.taxPaise).toBe(18000);
    expect(bill.cgstPaise).toBe(9000);
    expect(bill.sgstPaise).toBe(9000);
    expect(bill.grandTotalPaise).toBe(118000);
  });

  it("charges no tax and no round-off at 0%", () => {
    const bill = calculateBillGstPaise({
      grossPaise: 10049,
      enabled: true,
      gstRateBps: 0,
      priceIncludesTax: false,
    });
    expect(bill.taxPaise).toBe(0);
    expect(bill.roundOffPaise).toBe(0);
    expect(bill.grandTotalPaise).toBe(10049);
  });

  it("can round the payable amount down", () => {
    const bill = calculateBillGstPaise({
      grossPaise: 980,
      enabled: true,
      gstRateBps: 500,
      priceIncludesTax: false,
    });
    expect(bill.preRoundTotalPaise % 100).toBeLessThan(50);
    expect(bill.roundOffPaise).toBeLessThan(0);
    expect(bill.grandTotalPaise % 100).toBe(0);
  });
});
