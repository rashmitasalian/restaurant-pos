jest.mock("../../../../config/env", () => ({
  ENV: {
    HOTEL_NAME: "Restaurant",
    HOTEL_PHONE: "",
    HOTEL_EMAIL: "",
  },
}));

import { buildReceiptLines } from "./receiptBuilder";

const gstIdentity = {
  enabled: true,
  gstin: "29ABCDE1234F1Z5",
  legalName: "RestoNiti",
  registeredAddress: "MG Road",
  stateCode: "29",
  stateName: "Karnataka",
};

function billLines(gstRateBps: number, priceIncludesTax = false) {
  return buildReceiptLines(
    {
      items: [{ name: "Tea", qty: 1, rate: 25 }],
      orderType: "takeaway",
      meta: { orderSeq: 1 },
    },
    null,
    0,
    {
      itemSubtotal: 25,
      taxableSubtotal: priceIncludesTax ? 23.81 : 25,
      cgst: 974.58,
      sgst: 1322,
      taxTotal: 2296.58,
      roundOff: priceIncludesTax ? 0 : 5,
      total: 12345,
      gstEnabled: true,
      priceIncludesTax,
    },
    {
      ...gstIdentity,
      gstRateBps,
      priceIncludesTax,
    },
    { hotelName: "RestoNiti" },
  );
}

function amountLines(lines: string[]) {
  return lines.filter((line) => line.includes("Rs "));
}

describe("receipt GST layout", () => {
  it("prints half-rate labels from the bill rate and does not clip money", () => {
    const five = billLines(500).join("\n");
    const eighteen = billLines(1800).join("\n");
    const twelve = billLines(1200).join("\n");

    expect(five).toContain("CGST 2.5%");
    expect(five).toContain("SGST 2.5%");
    expect(eighteen).toContain("CGST 9%");
    expect(eighteen).toContain("SGST 9%");
    expect(twelve).toContain("CGST 6%");
    expect(twelve).toContain("SGST 6%");
    expect(five).not.toContain("CGST 2.50%");

    for (const money of ["Rs 25.00", "Rs 974.58", "Rs 1,322.00", "Rs 12,345.00"]) {
      const line = amountLines(billLines(500)).find((entry) => entry.includes(money));
      expect(line).toBeTruthy();
      expect(line).toContain(money);
      expect(line?.includes(money.slice(0, -1)) && !line?.includes(money)).toBe(false);
    }
  });

  it("prints SAC with the GSTIN and labels included tax", () => {
    const lines = billLines(500, true);
    expect(lines).toContain("CENTER:GSTIN: 29ABCDE1234F1Z5");
    expect(lines).toContain("CENTER:SAC 996331");
    expect(lines.join("\n")).toContain("Taxable Value");
    expect(lines.join("\n")).toContain("CGST 2.5% incl.");
  });
});
