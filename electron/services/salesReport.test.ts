import { allocateLinePaise, buildSalesFacts, type SalesBillInput, type SalesFactsInput } from "./salesReport";

const SEP_10 = Date.parse("2026-09-10T12:00:00+05:30");
const SEP_20 = Date.parse("2026-09-20T12:00:00+05:30");
const SEP_FROM = Date.parse("2026-09-01T00:00:00+05:30");
const OCT_FROM = Date.parse("2026-10-01T00:00:00+05:30");
const ZONE = "Asia/Kolkata";

function bill(overrides: Partial<SalesBillInput> & Pick<SalesBillInput, "id" | "settledAt" | "netSalesPaise" | "billTotalPaise">): SalesBillInput {
  return {
    createdAt: overrides.settledAt,
    invoiceNumber: overrides.id,
    customerName: null,
    taxPaise: 0,
    discountPaise: 0,
    gstEnabled: false,
    priceIncludesTax: true,
    gstRateBps: 0,
    serviceModeId: "table",
    lines: [{ itemName: "Item", category: "Mains", units: 1, lineValuePaise: overrides.netSalesPaise }],
    tenders: [
      {
        method: "cash",
        amountPaise: overrides.billTotalPaise,
        receivedAt: overrides.settledAt,
      },
    ],
    ...overrides,
  };
}

function facts(overrides: Partial<SalesFactsInput> & Pick<SalesFactsInput, "from" | "to" | "bills">) {
  return buildSalesFacts({
    timeZone: ZONE,
    creditCollections: [],
    outstandingCreditPaise: 0,
    serviceModeLabels: { table: "Dine In", delivery: "Delivery" },
    ...overrides,
  });
}

function expectReconcile(result: ReturnType<typeof buildSalesFacts>) {
  const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + Math.round(value * 100), 0));
  const net = Math.round(result.netSales * 100);
  expect(sum(result.daily.map((row) => row.netSales))).toBe(net);
  expect(sum(result.categories.map((row) => row.netSales))).toBe(net);
  expect(sum(result.items.map((row) => row.netSales))).toBe(net);
  expect(sum(result.serviceModes.map((row) => row.netSales))).toBe(net);
  expect(sum(result.tenders.map((row) => row.amount))).toBe(Math.round(result.billTotal * 100));
}

describe("allocateLinePaise", () => {
  it("gives the last line the remainder instead of rounding each line", () => {
    expect(allocateLinePaise(1000, [100, 100, 100])).toEqual([333, 333, 334]);
  });

  it("keeps an even split unchanged", () => {
    expect(allocateLinePaise(100000, [60000, 30000, 10000])).toEqual([60000, 30000, 10000]);
  });
});

describe("buildSalesFacts", () => {
  it("counts a bill by payment received_at, including from and excluding to", () => {
    const openedEarlier = bill({
      id: "earlier",
      createdAt: SEP_FROM - 86_400_000,
      settledAt: SEP_10,
      netSalesPaise: 200000,
      billTotalPaise: 200000,
      invoiceNumber: "INV-1",
    });
    const paidLater = bill({
      id: "later",
      createdAt: SEP_10,
      settledAt: OCT_FROM,
      netSalesPaise: 50000,
      billTotalPaise: 50000,
      invoiceNumber: "INV-2",
    });
    const onFrom = bill({
      id: "on-from",
      settledAt: SEP_FROM,
      netSalesPaise: 10000,
      billTotalPaise: 10000,
    });
    const onTo = bill({
      id: "on-to",
      settledAt: OCT_FROM,
      netSalesPaise: 10000,
      billTotalPaise: 10000,
    });

    const september = facts({ from: SEP_FROM, to: OCT_FROM, bills: [openedEarlier, paidLater, onFrom, onTo] });
    expect(september.billCount).toBe(2);
    expect(september.netSales).toBe(2100);
    expect(september.gst.invoices.map((row) => row.invoiceNumber).sort()).toEqual(["INV-1", "on-from"]);

    const october = facts({ from: OCT_FROM, to: OCT_FROM + 86_400_000, bills: [paidLater] });
    expect(october.billCount).toBe(1);
    expect(october.netSales).toBe(500);
  });

  it("weights discount percent from each bill's own pre-discount base", () => {
    const inclusive = bill({
      id: "inclusive",
      settledAt: SEP_10,
      gstEnabled: true,
      priceIncludesTax: true,
      gstRateBps: 500,
      netSalesPaise: 9524,
      taxPaise: 476,
      discountPaise: 10000,
      billTotalPaise: 90000,
      lines: [{ itemName: "Thali", category: "Mains", units: 1, lineValuePaise: 100000 }],
      tenders: [{ method: "upi", amountPaise: 90000, receivedAt: SEP_10 }],
    });
    const exclusive = bill({
      id: "exclusive",
      settledAt: SEP_10,
      gstEnabled: true,
      priceIncludesTax: false,
      gstRateBps: 1800,
      netSalesPaise: 50000,
      taxPaise: 9000,
      discountPaise: 0,
      billTotalPaise: 59000,
      serviceModeId: "delivery",
      lines: [{ itemName: "Biryani", category: "Mains", units: 1, lineValuePaise: 50000 }],
      tenders: [{ method: "card", amountPaise: 59000, receivedAt: SEP_10 }],
    });
    const noGst = bill({
      id: "plain",
      settledAt: SEP_10,
      netSalesPaise: 20000,
      discountPaise: 5000,
      billTotalPaise: 20000,
      lines: [{ itemName: "Tea", category: "Beverages", units: 2, lineValuePaise: 25000 }],
    });
    const result = facts({ from: SEP_FROM, to: OCT_FROM, bills: [inclusive, exclusive, noGst] });
    const bases = (90000 + 10000) + (50000 + 0) + (20000 + 5000);
    expect(result.discountTotal).toBe(150);
    expect(result.discountPercent).toBe(Math.round((15000 / bases) * 1000) / 10);
    expect(result.discountPercent).not.toBe(Math.round(((10 + 0 + 20) / 3) * 10) / 10);
  });

  it("keeps a zero-discount bill in the weighted base", () => {
    const heavy = bill({
      id: "heavy",
      settledAt: SEP_10,
      netSalesPaise: 5000,
      discountPaise: 5000,
      billTotalPaise: 5000,
    });
    const none = bill({
      id: "none",
      settledAt: SEP_10,
      netSalesPaise: 90000,
      discountPaise: 0,
      billTotalPaise: 90000,
    });
    const result = facts({ from: SEP_FROM, to: OCT_FROM, bills: [heavy, none] });
    expect(result.discountPercent).toBe(5);
  });

  it("separates original tenders from later credit collections", () => {
    const cash = bill({
      id: "cash",
      settledAt: SEP_10,
      netSalesPaise: 100000,
      billTotalPaise: 100000,
      tenders: [{ method: "cash", amountPaise: 100000, receivedAt: SEP_10, amountPaidPaise: 150000 }],
    });
    const septemberCash = facts({ from: SEP_FROM, to: OCT_FROM, bills: [cash] });
    expect(septemberCash.billTotal).toBe(1000);
    expect(septemberCash.amountCollected).toBe(1000);
    expect(septemberCash.tenders).toEqual([{ method: "cash", label: "Cash", amount: 1000, percent: 100 }]);

    const credit = bill({
      id: "credit",
      settledAt: SEP_10,
      netSalesPaise: 100000,
      billTotalPaise: 100000,
      tenders: [{ method: "credit", amountPaise: 100000, receivedAt: SEP_10 }],
    });
    const stillOpen = facts({
      from: SEP_FROM,
      to: OCT_FROM,
      bills: [credit],
      outstandingCreditPaise: 100000,
    });
    expect(stillOpen.billTotal).toBe(1000);
    expect(stillOpen.amountCollected).toBe(0);
    expect(stillOpen.outstandingCredit).toBe(1000);
    expect(stillOpen.tenders.map((row) => row.method)).toEqual(["credit"]);

    const collectedInSeptember = facts({
      from: SEP_FROM,
      to: OCT_FROM,
      bills: [credit],
      creditCollections: [{ amountPaise: 100000, collectedAt: SEP_20 }],
    });
    expect(collectedInSeptember.billTotal).toBe(1000);
    expect(collectedInSeptember.amountCollected).toBe(1000);

    const onlyCollectionDay = facts({
      from: SEP_20,
      to: SEP_20 + 86_400_000,
      bills: [credit],
      creditCollections: [{ amountPaise: 100000, collectedAt: SEP_20 }],
    });
    expect(onlyCollectionDay.billTotal).toBe(0);
    expect(onlyCollectionDay.amountCollected).toBe(1000);
    expect(onlyCollectionDay.billCount).toBe(0);
  });

  it("expands a split settlement and ignores change above the applied amount", () => {
    const split = bill({
      id: "split",
      settledAt: SEP_10,
      netSalesPaise: 100000,
      billTotalPaise: 100000,
      tenders: [
        { method: "cash", amountPaise: 40000, receivedAt: SEP_10, amountPaidPaise: 50000 },
        { method: "upi", amountPaise: 60000, receivedAt: SEP_10 },
      ],
    });
    const result = facts({ from: SEP_FROM, to: OCT_FROM, bills: [split] });
    expect(result.tenders).toEqual([
      { method: "cash", label: "Cash", amount: 400, percent: 40 },
      { method: "upi", label: "UPI", amount: 600, percent: 60 },
    ]);
    expectReconcile(result);
  });

  it("reconciles tax-exclusive bills and keeps the inclusive residual", () => {
    const exclusive = bill({
      id: "ex",
      settledAt: SEP_10,
      gstEnabled: true,
      priceIncludesTax: false,
      gstRateBps: 500,
      netSalesPaise: 100000,
      taxPaise: 5000,
      billTotalPaise: 105000,
      invoiceNumber: "INV-EX",
      customerName: "Ravi",
    });
    const inclusive = bill({
      id: "in",
      settledAt: SEP_10,
      gstEnabled: true,
      priceIncludesTax: true,
      gstRateBps: 500,
      netSalesPaise: 11429,
      taxPaise: 572,
      billTotalPaise: 12000,
      invoiceNumber: "INV-IN",
      serviceModeId: "delivery",
      lines: [
        { itemName: "Soup", category: "Starters", units: 1, lineValuePaise: 4000 },
        { itemName: "Bread", category: "Starters", units: 1, lineValuePaise: 8000 },
      ],
    });
    const result = facts({ from: SEP_FROM, to: OCT_FROM, bills: [exclusive, inclusive] });
    expect(exclusive.netSalesPaise + exclusive.taxPaise).toBe(exclusive.billTotalPaise);
    expect(result.inclusiveResidual).toBe(paise(-1));
    expect(result.netSales + result.gst.totalTax + result.inclusiveResidual).toBeCloseTo(result.billTotal, 2);
    expect(result.gst.invoices.find((row) => row.invoiceNumber === "INV-IN")?.total).toBe(120);
    expect(result.gst.invoices.find((row) => row.invoiceNumber === "INV-EX")?.customerName).toBe("Ravi");
    expect(result.gst.rates.map((row) => row.rateLabel)).toEqual(["5%"]);
    expectReconcile(result);
  });

  it("reports several tax rates and leaves untaxed bills off the rate table", () => {
    const five = bill({
      id: "five",
      settledAt: SEP_10,
      gstEnabled: true,
      gstRateBps: 500,
      netSalesPaise: 100000,
      taxPaise: 5000,
      billTotalPaise: 105000,
      priceIncludesTax: false,
      invoiceNumber: "INV-5",
    });
    const eighteen = bill({
      id: "eighteen",
      settledAt: SEP_10,
      gstEnabled: true,
      gstRateBps: 1800,
      priceIncludesTax: false,
      netSalesPaise: 100000,
      taxPaise: 18000,
      billTotalPaise: 118000,
      invoiceNumber: "INV-18",
      customerName: null,
    });
    const plain = bill({
      id: "plain",
      settledAt: SEP_10,
      netSalesPaise: 40000,
      billTotalPaise: 40000,
      invoiceNumber: "INV-0",
    });
    const result = facts({ from: SEP_FROM, to: OCT_FROM, bills: [five, eighteen, plain] });
    expect(result.hasTax).toBe(true);
    expect(result.gst.rates.map((row) => row.rateBps)).toEqual([500, 1800]);
    expect(result.untaxedNetSales).toBe(400);
    expect(result.gst.invoices.find((row) => row.invoiceNumber === "INV-0")?.rateLabel).toBeNull();
    expect(result.gst.invoices.find((row) => row.invoiceNumber === "INV-0")?.customerName).toBeNull();
    expectReconcile(result);
  });

  it("keeps a stable shape when the period has no GST", () => {
    const plain = bill({
      id: "plain",
      settledAt: SEP_10,
      netSalesPaise: 25000,
      billTotalPaise: 25000,
      invoiceNumber: "INV-9",
      lines: [
        { itemName: "A", category: "Mains", units: 1, lineValuePaise: 100 },
        { itemName: "B", category: "Mains", units: 1, lineValuePaise: 100 },
        { itemName: "C", category: "Mains", units: 1, lineValuePaise: 100 },
      ],
    });
    const result = facts({ from: SEP_FROM, to: OCT_FROM, bills: [plain] });
    expect(result.hasTax).toBe(false);
    expect(result.gst).toMatchObject({ cgst: 0, sgst: 0, totalTax: 0, rates: [] });
    expect(result.billTotal).toBe(result.netSales);
    expect(result.gst.invoices[0].rateLabel).toBeNull();
    expect(result.gst.invoices[0].invoiceNumber).toBe("INV-9");
    expect(result.categories.reduce((sum, row) => sum + row.netSales, 0)).toBe(result.netSales);
    expectReconcile(result);
  });

  it("uses the stored mode id and only borrows the current label", () => {
    const result = facts({
      from: SEP_FROM,
      to: OCT_FROM,
      serviceModeLabels: { delivery: "Home Delivery" },
      bills: [
        bill({
          id: "drop",
          settledAt: SEP_10,
          serviceModeId: "delivery",
          netSalesPaise: 10000,
          billTotalPaise: 10000,
        }),
      ],
    });
    expect(result.serviceModes).toEqual([
      { modeId: "delivery", label: "Home Delivery", bills: 1, netSales: 100, averageBill: 100 },
    ]);
  });
});

function paise(rupees: number) {
  return rupees / 100;
}
