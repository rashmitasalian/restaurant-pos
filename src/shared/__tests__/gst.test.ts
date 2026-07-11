import { calculateGstTotals, calculateGstTotalsPaise } from "../gst";

const singleLine = [{ qty: 1, rate: 118 }];

describe("GST totals", () => {
  it("does not apply tax when GST is disabled even if a rate is configured", () => {
    const totals = calculateGstTotalsPaise(singleLine, 0, {
      enabled: false,
      gstRateBps: 1800,
      priceIncludesTax: true,
    });

    expect(totals.gstEnabled).toBe(false);
    expect(totals.taxTotalPaise).toBe(0);
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

  it("always produces equal CGST and SGST for price-inclusive GST", () => {
    const totals = calculateGstTotalsPaise([{ qty: 1, rate: 120 }], 0, {
      enabled: true,
      gstRateBps: 500,
      priceIncludesTax: true,
    });

    expect(totals.taxableSubtotalPaise).toBe(11429);
    // Both halves must be equal (each rounded from half-rate independently)
    expect(totals.cgstPaise).toBe(286);
    expect(totals.sgstPaise).toBe(286);
    expect(totals.taxTotalPaise).toBe(572);
    // For price-inclusive the selling price is the anchor, not taxable+tax
    expect(totals.totalPaise).toBe(12000);
  });

  it("always produces equal CGST and SGST for price-exclusive GST and grand total reconciles", () => {
    const totals = calculateGstTotalsPaise([{ qty: 1, rate: 333.33 }], 0, {
      enabled: true,
      gstRateBps: 500,
      priceIncludesTax: false,
    });

    expect(totals.taxableSubtotalPaise).toBe(33333);
    // Both halves must be equal
    expect(totals.cgstPaise).toBe(833);
    expect(totals.sgstPaise).toBe(833);
    expect(totals.taxTotalPaise).toBe(1666);
    // For price-exclusive, grand total must equal taxable + cgst + sgst
    expect(totals.taxableSubtotalPaise + totals.taxTotalPaise).toBe(totals.totalPaise);
  });
});
