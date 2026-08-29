import { isIpv4Address } from "./networkRaw";
import { normalizePrintType, resolvePrinterTarget, type PrinterConfig } from "./printService";

const cfg: PrinterConfig = {
  kitchenPrinterName: "Kitchen Printer",
  counterPrinterName: "Counter Printer",
  printerPort: 9100,
};

describe("print service routing", () => {
  it("normalizes unknown print types to receipt", () => {
    expect(normalizePrintType("kot")).toBe("kot");
    expect(normalizePrintType("receipt")).toBe("receipt");
    expect(normalizePrintType("anything")).toBe("receipt");
  });

  it("resolves aliases and defaults without changing caller payload shape", () => {
    expect(resolvePrinterTarget("kitchen", "receipt", cfg)).toBe("Kitchen Printer");
    expect(resolvePrinterTarget("counter", "kot", cfg)).toBe("Counter Printer");
    expect(resolvePrinterTarget(undefined, "kot", cfg)).toBe("Kitchen Printer");
    expect(resolvePrinterTarget("default", "receipt", cfg)).toBe("Counter Printer");
    expect(resolvePrinterTarget("POS-80C", "receipt", cfg)).toBe("Counter Printer");
    expect(resolvePrinterTarget("192.168.1.50", "kot", cfg)).toBe("Kitchen Printer");
  });

  it("only treats valid IPv4 addresses as network printer targets", () => {
    expect(isIpv4Address("192.168.1.50")).toBe(true);
    expect(isIpv4Address("999.168.1.50")).toBe(false);
    expect(isIpv4Address("Kitchen Printer")).toBe(false);
  });
});
