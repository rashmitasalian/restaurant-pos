import { isIpv4Address } from "./networkRaw";
import {
  enqueuePrinterJob,
  normalizePrintType,
  resetPrinterQueuesForTests,
  resolvePrinterTarget,
  type PrinterConfig,
} from "./printService";

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

describe("printer FIFO queue", () => {
  beforeEach(() => {
    resetPrinterQueuesForTests();
  });

  it("runs jobs for the same printer strictly in order", async () => {
    const order: number[] = [];
    const slow = enqueuePrinterJob("Kitchen", async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      order.push(1);
      return "a";
    });
    const fast = enqueuePrinterJob("Kitchen", async () => {
      order.push(2);
      return "b";
    });
    await expect(Promise.all([slow, fast])).resolves.toEqual(["a", "b"]);
    expect(order).toEqual([1, 2]);
  });

  it("does not block a different printer behind a busy one", async () => {
    const order: string[] = [];
    const kitchen = enqueuePrinterJob("Kitchen", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push("kitchen");
    });
    const counter = enqueuePrinterJob("Counter", async () => {
      order.push("counter");
    });
    await Promise.all([kitchen, counter]);
    expect(order[0]).toBe("counter");
    expect(order[1]).toBe("kitchen");
  });
});
