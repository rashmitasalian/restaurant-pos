import { buildEscPosBuffer } from "./escpos";

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
});
