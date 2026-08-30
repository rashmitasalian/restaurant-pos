import {
  resolveCounterPrinterTarget,
  resolveKitchenPrinterTarget,
  samePrinterTarget,
} from "./printerConfig";

describe("printerConfig", () => {
  it("resolves kitchen printer with fallback", () => {
    expect(resolveKitchenPrinterTarget(null)).toBe("POS-80C");
    expect(resolveKitchenPrinterTarget({ kitchenPrinterIp: "192.168.1.10" })).toBe("192.168.1.10");
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
});
