import { buildReceiptQrBitmap } from "../../src/ui/screens/Billing/utils/receiptQr";
import { buildEscPosBuffer, buildStruckTextRaster } from "./escpos";

describe("ESC/POS buffer builder", () => {
  it("builds structured receipt bytes with initialize and cut commands", () => {
    const buffer = buildEscPosBuffer("receipt", "", ["CENTER:Hotel", "LEFT:Tea x1", "CUT"]);

    expect([...buffer.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect(buffer.toString("latin1")).toContain("Hotel");
    expect(buffer.toString("latin1")).toContain("Tea x1");
    expect([...buffer.slice(-4)]).toEqual([0x1d, 0x56, 0x41, 0x00]);
  });

  it("requires structured print directives", () => {
    expect(() => buildEscPosBuffer("kot", "Burger x2", [], "Kitchen")).toThrow(
      "print-lines-required",
    );
  });

  it("adds centered raster image bytes for receipt logo directives", () => {
    const logoBytes = Buffer.from([0xff, 0x00]).toString("base64");
    const buffer = buildEscPosBuffer("receipt", "", [`IMAGE_MONO:8:2:${logoBytes}`, "CUT"]);
    const bytes = [...buffer];

    expect(bytes).toEqual(expect.arrayContaining([0x1d, 0x76, 0x30, 0x00]));
    expect(bytes).toEqual(expect.arrayContaining([0xff, 0x00]));
  });

  it("prints a centered 240 dot QR raster after the thank-you line and before the cut", () => {
    const raster = buildReceiptQrBitmap("https://example.com/feedback");
    expect(raster).toEqual(expect.objectContaining({ width: 240, height: 240 }));
    const directive = `QR_MONO:${raster!.width}:${raster!.height}:${raster!.dataBase64}`;
    const buffer = buildEscPosBuffer("receipt", "", [
      "CENTERB:Thank you! Visit again.",
      directive,
      "CUT",
    ]);
    const bytes = [...buffer];
    const header = [0x1b, 0x61, 0x01, 0x1d, 0x76, 0x30, 0x00, 0x1e, 0x00, 0xf0, 0x00];
    const headerAt = bytes.findIndex((_, index) =>
      header.every((value, offset) => bytes[index + offset] === value),
    );
    const thankYouAt = buffer.toString("latin1").indexOf("Thank you! Visit again.");

    expect(raster && Buffer.from(raster.dataBase64, "base64").length).toBe(7200);
    expect(headerAt).toBeGreaterThan(-1);
    expect(thankYouAt).toBeGreaterThan(-1);
    expect(thankYouAt).toBeLessThan(headerAt);
    expect(bytes.slice(headerAt + header.length, headerAt + header.length + 7200)).toHaveLength(7200);
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x41, 0x00]);
    expect(buffer.toString("latin1")).not.toContain("QR_MONO:");
  });

  it("prints void KOT items as a left-aligned raster with a mid-line strike", () => {
    // Match kotTicket layout: PAD(2) + item(32) + qty(8).
    const item = `  ${"Pizza".padEnd(32)}${"1".padStart(8)}`;
    const buffer = buildEscPosBuffer("kot", "", [`LEFTDHVOID:${item}`, "CUT"]);
    const bytes = [...buffer];
    const latin = buffer.toString("latin1");

    expect(item.length).toBe(42);
    expect(latin).not.toContain("LEFTDHVOID:");
    expect(latin).not.toContain("Pizza");
    expect(bytes).toEqual(expect.arrayContaining([0x1d, 0x76, 0x30, 0x00]));
    expect(bytes).not.toContain(0x0d);

    const raster = buildStruckTextRaster(item);
    expect(raster.width).toBe(576);
    expect(raster.height).toBe(38);
    const widthBytes = 72;
    const nameByte = Math.floor((2 * 12) / 8);
    const qtyByte = Math.floor((41 * 12) / 8);
    let nameBits = 0;
    let qtyBits = 0;
    for (let y = 4; y < 12; y += 1) {
      nameBits += raster.data[y * widthBytes + nameByte];
      qtyBits += raster.data[y * widthBytes + qtyByte];
    }
    expect(nameBits).toBeGreaterThan(0);
    expect(qtyBits).toBeGreaterThan(0);
    expect(qtyByte).toBeGreaterThan(nameByte + 8);
  });
});
