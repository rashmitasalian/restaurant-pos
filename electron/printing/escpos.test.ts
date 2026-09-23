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
