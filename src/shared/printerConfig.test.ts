import {
  extraPrinterOption,
  isIpv4PrinterTarget,
  isSelectablePosPrinter,
  PRINTER_SELECT_NETWORK,
  PRINTER_SELECT_SAME_AS_KITCHEN,
  printerDropdownValue,
  resolveCounterPrinterTarget,
  resolveKitchenPrinterTarget,
  samePrinterTarget,
} from "./printerConfig";

describe("printerConfig", () => {
  it("resolves kitchen printer with fallback", () => {
    expect(resolveKitchenPrinterTarget(null)).toBe("POS-80C");
    expect(resolveKitchenPrinterTarget({ kitchenPrinterIp: "192.168.1.10" })).toBe("192.168.1.10");
    expect(resolveKitchenPrinterTarget({ counterPrinterIp: "Receipt USB" })).toBe("Receipt USB");
  });

  it("falls counter back to kitchen when counter is blank", () => {
    expect(resolveCounterPrinterTarget({ kitchenPrinterIp: "192.168.1.10" })).toBe("192.168.1.10");
    expect(
      resolveCounterPrinterTarget({
        kitchenPrinterIp: "Kitchen USB",
        counterPrinterIp: "Receipt USB",
      }),
    ).toBe("Receipt USB");
  });

  it("detects matching printer targets case-insensitively", () => {
    expect(samePrinterTarget("192.168.1.10", "192.168.1.10")).toBe(true);
    expect(samePrinterTarget("POS-80C", "pos-80c")).toBe(true);
    expect(samePrinterTarget("192.168.1.10", "192.168.1.11")).toBe(false);
  });

  it("classifies IPv4 targets for the network print path", () => {
    expect(isIpv4PrinterTarget("192.168.1.50")).toBe(true);
    expect(isIpv4PrinterTarget("EPSON TM-T20II")).toBe(false);
    expect(isIpv4PrinterTarget("999.1.1.1")).toBe(false);
  });

  it("maps saved printer config onto dropdown values", () => {
    expect(printerDropdownValue("POS-80C")).toBe("POS-80C");
    expect(printerDropdownValue("192.168.1.45")).toBe(PRINTER_SELECT_NETWORK);
    expect(printerDropdownValue("", { blankValue: PRINTER_SELECT_SAME_AS_KITCHEN })).toBe(
      PRINTER_SELECT_SAME_AS_KITCHEN,
    );
    expect(printerDropdownValue("", { networkMode: true })).toBe(PRINTER_SELECT_NETWORK);
  });

  it("keeps a saved Windows printer visible when it is not currently listed", () => {
    expect(extraPrinterOption("Kitchen USB", ["POS-80C"])).toBe("Kitchen USB");
    expect(extraPrinterOption("POS-80C", ["POS-80C"])).toBeNull();
    expect(extraPrinterOption("192.168.1.10", ["POS-80C"])).toBeNull();
  });

  it("hides Windows virtual printers from the hardware dropdown", () => {
    expect(isSelectablePosPrinter("POS-80C")).toBe(true);
    expect(isSelectablePosPrinter("EPSON TM-T20II")).toBe(true);
    expect(isSelectablePosPrinter("Microsoft Print to PDF")).toBe(false);
    expect(isSelectablePosPrinter("OneNote (Desktop)")).toBe(false);
    expect(
      isSelectablePosPrinter({
        name: "Kitchen USB",
        driverName: "Generic / Text Only",
        portName: "USB001",
      }),
    ).toBe(true);
    expect(
      isSelectablePosPrinter({
        name: "Any Printer",
        driverName: "Microsoft Print To PDF",
        portName: "PORTPROMPT:",
      }),
    ).toBe(false);
  });
});
