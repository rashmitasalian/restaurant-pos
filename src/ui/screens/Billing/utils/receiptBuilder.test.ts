jest.mock("../../../../config/env", () => ({
  ENV: {
    HOTEL_NAME: "Restaurant",
    HOTEL_PHONE: "",
    HOTEL_EMAIL: "",
  },
}));

import { buildReceiptLines } from "./receiptBuilder";
import { buildReceiptQrBitmap, buildReceiptQrPayload } from "./receiptQr";

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

describe("receipt item names", () => {
  it("wraps a long name in the item column and keeps qty, rate, and amount on the first line", () => {
    const name = "Paneer Butter Masala Special";
    const lines = buildReceiptLines(
      {
        items: [{ name, qty: 2, rate: 180 }],
        orderType: "takeaway",
        meta: { orderSeq: 1 },
      },
      null,
      0,
      { subtotal: 360, total: 360 },
      null,
      { hotelName: "RestoNiti" },
    );
    const itemLines = lines.filter(
      (line) => line.startsWith("LEFTB:") && (line.includes("Paneer") || line.includes("Special")),
    );
    expect(itemLines).toHaveLength(2);
    const first = itemLines[0].slice("LEFTB:".length);
    const second = itemLines[1].slice("LEFTB:".length);
    expect(first).toHaveLength(42);
    expect(second).toHaveLength(42);
    expect(first.slice(2, 22)).toBe("Paneer Butter Masala");
    expect(first.slice(22, 26)).toBe("2".padStart(4));
    expect(first.slice(26, 34)).toBe("180".padStart(8));
    expect(first.slice(34)).toBe("360".padStart(8));
    expect(second.slice(2, 22).trimEnd()).toBe("Special");
    expect(second.slice(22)).toBe(" ".repeat(20));
    expect(`${first.slice(2, 22).trimEnd()} ${second.slice(2, 22).trimEnd()}`).toBe(name);
  });
});

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

function sampleBill(
  receiptQr?: {
    mode?: "off" | "feedback" | "pay";
    feedbackUrl?: string;
    upiId?: string;
    payeeName?: string;
    includeAmount?: boolean;
    note?: string;
  },
  total = 842,
) {
  return buildReceiptLines(
    {
      items: [{ name: "Tea", qty: 1, rate: total }],
      orderType: "takeaway",
      invoiceNumber: "INV 12/3",
      meta: { orderSeq: 7 },
    },
    null,
    0,
    { total, subtotal: total },
    null,
    { hotelName: "The Coastal Kitchen", receiptQr },
  );
}

function footer(lines: string[]) {
  return lines.slice(lines.lastIndexOf("CENTERB:Thank you! Visit again."));
}

describe("receipt QR footer", () => {
  it("prints thank you then cut when the QR is off, missing, or stale", () => {
    for (const lines of [
      sampleBill(undefined),
      sampleBill({ mode: "off", feedbackUrl: "https://example.com/f", note: "Scan", upiId: "a@b" }),
    ]) {
      expect(footer(lines)).toEqual(["CENTERB:Thank you! Visit again.", "CUT"]);
    }
  });

  it("prints a feedback QR after the thank-you line and before the cut", () => {
    const receiptQr = { mode: "feedback" as const, feedbackUrl: "https://example.com/feedback" };
    const lines = sampleBill(receiptQr);
    const payload = buildReceiptQrPayload({
      receiptQr,
      grandTotal: 842,
      reference: "INV 12/3",
      hotelName: "The Coastal Kitchen",
    });
    const raster = buildReceiptQrBitmap(payload!);
    expect(footer(lines)).toEqual([
      "CENTERB:Thank you! Visit again.",
      "BLANK",
      `QR_MONO:${raster!.width}:${raster!.height}:${raster!.dataBase64}`,
      "CUT",
    ]);
  });

  it("prints the note and then the QR, with nothing after the QR except the cut", () => {
    const lines = sampleBill({
      mode: "pay",
      upiId: "restaurant@upi",
      payeeName: "Hotel & Restaurant",
      includeAmount: true,
      note: "Scan to pay",
    });
    const tail = footer(lines);
    expect(tail[0]).toBe("CENTERB:Thank you! Visit again.");
    expect(tail[1]).toBe("BLANK");
    expect(tail[2]).toBe("CENTER:Scan to pay");
    expect(tail[3].startsWith("QR_MONO:240:240:")).toBe(true);
    expect(tail[4]).toBe("CUT");
    expect(lines[lines.length - 1]).toBe("CUT");
  });

  it("embeds the bill grand total in a pay QR and omits it when amount is off", () => {
    const withAmount = {
      mode: "pay" as const,
      upiId: "restaurant@upi",
      payeeName: "Hotel & Restaurant",
      includeAmount: true,
    };
    const withoutAmount = { ...withAmount, includeAmount: false };
    const amountPayload = buildReceiptQrPayload({
      receiptQr: withAmount,
      grandTotal: 842,
      reference: "INV 12/3",
      hotelName: "The Coastal Kitchen",
    });
    const plainPayload = buildReceiptQrPayload({
      receiptQr: withoutAmount,
      grandTotal: 842,
      reference: "INV 12/3",
      hotelName: "The Coastal Kitchen",
    });
    expect(amountPayload).toContain("am=842");
    expect(plainPayload).not.toMatch(/(?:^|[?&])am=/);
    const amountRaster = buildReceiptQrBitmap(amountPayload!);
    const plainRaster = buildReceiptQrBitmap(plainPayload!);
    expect(sampleBill(withAmount).join("\n")).toContain(amountRaster!.dataBase64);
    expect(sampleBill(withoutAmount).join("\n")).toContain(plainRaster!.dataBase64);
    expect(sampleBill(withoutAmount).join("\n")).not.toContain(amountRaster!.dataBase64);
  });

  it("still prints the note when the QR config cannot be used", () => {
    const lines = sampleBill({
      mode: "pay",
      upiId: "bad id",
      note: "Visit again soon",
    });
    expect(footer(lines)).toEqual([
      "CENTERB:Thank you! Visit again.",
      "BLANK",
      "CENTER:Visit again soon",
      "CUT",
    ]);
  });

  it("marks a practice bill on a reprint", () => {
    const lines = buildReceiptLines(
      {
        items: [{ name: "Tea", qty: 1, rate: 25 }],
        orderType: "takeaway",
        meta: { orderSeq: 4, practice: true },
      },
      null,
      0,
      { itemSubtotal: 25, total: 25, gstEnabled: false },
      { enabled: false, gstRateBps: 0, priceIncludesTax: false },
      { hotelName: "Green Leaf Kitchen" },
    );
    expect(lines).toContain("CENTER:PRACTICE — NOT A TAX INVOICE");
    expect(lines.some((line) => line.includes("Invoice No:"))).toBe(false);
  });
});
