import jsQR from "jsqr";
import { create as createQrSymbol } from "qrcode/lib/core/qrcode";
import {
  buildReceiptQrBitmap,
  buildReceiptQrFooterLines,
  buildReceiptQrPayload,
  receiptQrConfigForSave,
  receiptQrRasterBytes,
  receiptQrRgba,
  RECEIPT_QR_SIZE,
} from "./receiptQr";

const payConfig = {
  mode: "pay" as const,
  upiId: "restaurant@upi",
  payeeName: "Hotel & Restaurant",
  includeAmount: true,
};

function bitAt(bytes: Uint8Array, width: number, x: number, y: number) {
  const widthBytes = Math.ceil(width / 8);
  return (bytes[y * widthBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

describe("receipt QR payload", () => {
  it("encodes the grand total, payee, and invoice reference", () => {
    expect(
      buildReceiptQrPayload({
        receiptQr: payConfig,
        grandTotal: 842,
        reference: "INV 12/3",
        hotelName: "Other Name",
      }),
    ).toBe(
      "upi://pay?pa=restaurant%40upi&pn=Hotel%20%26%20Restaurant&am=842&cu=INR&tn=INV%2012%2F3",
    );
  });

  it("omits the amount when include-amount is off", () => {
    const payload = buildReceiptQrPayload({
      receiptQr: { ...payConfig, includeAmount: false },
      grandTotal: 842,
      reference: "7",
      hotelName: "Hotel & Restaurant",
    });
    expect(payload).toBe("upi://pay?pa=restaurant%40upi&pn=Hotel%20%26%20Restaurant&cu=INR&tn=7");
    expect(payload).not.toMatch(/(?:^|[?&])am=/);
  });

  it("does not build a bill URL from stored configuration fields alone", () => {
    const saved = receiptQrConfigForSave({
      mode: "pay",
      feedbackUrl: "",
      upiId: "restaurant@upi",
      payeeName: "Hotel & Restaurant",
      includeAmount: true,
      note: "Scan to pay",
    });
    expect(JSON.stringify(saved)).not.toContain("upi://");
    expect(saved).toEqual({
      mode: "pay",
      upiId: "restaurant@upi",
      payeeName: "Hotel & Restaurant",
      includeAmount: true,
      note: "Scan to pay",
    });
  });

  it("ignores stale feedback and pay fields when the mode is off or missing", () => {
    const stale = {
      mode: "off" as const,
      feedbackUrl: "https://example.com/feedback",
      upiId: "restaurant@upi",
      note: "Scan to pay",
    };
    expect(buildReceiptQrPayload({ receiptQr: stale, grandTotal: 842 })).toBeNull();
    expect(buildReceiptQrFooterLines({ receiptQr: stale, grandTotal: 842 })).toEqual([]);
    expect(buildReceiptQrFooterLines({ receiptQr: undefined, grandTotal: 842 })).toEqual([]);
  });

  it("drops an invalid feedback URL or UPI ID and still keeps a valid note", () => {
    expect(
      buildReceiptQrPayload({
        receiptQr: { mode: "feedback", feedbackUrl: "http://example.com/feedback" },
        grandTotal: 10,
      }),
    ).toBeNull();
    expect(
      buildReceiptQrFooterLines({
        receiptQr: {
          mode: "feedback",
          feedbackUrl: "http://example.com/feedback",
          note: "Tell us how we did",
        },
        grandTotal: 10,
      }),
    ).toEqual(["BLANK", "CENTER:Tell us how we did"]);
    expect(
      buildReceiptQrPayload({
        receiptQr: { mode: "pay", upiId: "not an id", payeeName: "Hotel" },
        grandTotal: 10,
      }),
    ).toBeNull();
  });

  it("normalizes empty, whitespace, newline, and long notes before wrapping", () => {
    expect(
      buildReceiptQrFooterLines({
        receiptQr: { mode: "feedback", feedbackUrl: "https://example.com/f", note: "  \n  " },
        grandTotal: 1,
      }).filter((line) => line.startsWith("CENTER:")),
    ).toEqual([]);

    const wrapped = buildReceiptQrFooterLines({
      receiptQr: {
        mode: "feedback",
        feedbackUrl: "https://example.com/f",
        note: "Please\nshare   your feedback धन्यवाद today",
      },
      grandTotal: 1,
    });
    expect(wrapped).toContain("CENTER:Please share your feedback धन्यवाद today");

    const longNote = Array.from({ length: 30 }, () => "word").join(" ");
    const lines = buildReceiptQrFooterLines({
      receiptQr: {
        mode: "pay",
        upiId: "restaurant@upi",
        payeeName: "Hotel",
        note: longNote,
      },
      grandTotal: 1,
      hotelName: "Hotel",
    });
    const noteLines = lines.filter((line) => line.startsWith("CENTER:"));
    expect(noteLines.length).toBeGreaterThan(1);
    expect(noteLines.join(" ").replace(/CENTER:/g, "")).toContain("word");
    expect(lines[lines.length - 1].startsWith("QR_MONO:")).toBe(true);
    expect(lines[0]).toBe("BLANK");
  });
});

describe("receipt QR bitmap", () => {
  const payload =
    "upi://pay?pa=restaurant%40upi&pn=Hotel%20%26%20Restaurant&am=842&cu=INR&tn=INV%2012%2F3";

  it("decodes back to the payment payload at a fixed 240 dot size", () => {
    const raster = buildReceiptQrBitmap(payload);
    expect(raster).toEqual(
      expect.objectContaining({ width: RECEIPT_QR_SIZE, height: RECEIPT_QR_SIZE }),
    );
    const bytes = receiptQrRasterBytes(raster!.dataBase64);
    expect(bytes.length).toBe((RECEIPT_QR_SIZE / 8) * RECEIPT_QR_SIZE);

    const decoded = jsQR(receiptQrRgba(raster!), raster!.width, raster!.height, {
      inversionAttempts: "dontInvert",
    });
    expect(decoded?.data).toBe(payload);
  });

  it("keeps error correction M as solid modules instead of interpolated pixels", () => {
    const raster = buildReceiptQrBitmap(payload)!;
    const bytes = receiptQrRasterBytes(raster.dataBase64);
    const medium = createQrSymbol(payload, { errorCorrectionLevel: "M" });
    const low = createQrSymbol(payload, { errorCorrectionLevel: "L" });
    const modules = medium.modules.size;
    const total = modules + 8;
    const modulePx = Math.floor(RECEIPT_QR_SIZE / total);
    const offset = Math.floor((RECEIPT_QR_SIZE - total * modulePx) / 2);
    expect(modulePx).toBeGreaterThan(0);

    let compared = false;
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        const dark = Boolean(medium.modules.get(row, col));
        const lowDark =
          low.modules.size === modules ? Boolean(low.modules.get(row, col)) : !dark;
        if (dark === lowDark) {
          continue;
        }
        const originX = offset + (col + 4) * modulePx;
        const originY = offset + (row + 4) * modulePx;
        for (let dy = 0; dy < modulePx; dy += 1) {
          for (let dx = 0; dx < modulePx; dx += 1) {
            expect(bitAt(bytes, RECEIPT_QR_SIZE, originX + dx, originY + dy)).toBe(dark);
          }
        }
        compared = true;
        break;
      }
      if (compared) {
        break;
      }
    }
    expect(compared).toBe(true);
  });
});
