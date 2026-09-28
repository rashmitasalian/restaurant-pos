jest.mock("./windowsRaw", () => ({
  printViaWindowsRaw: jest.fn(),
}));

import { isIpv4Address } from "./networkRaw";
import {
  enqueuePrinterJob,
  normalizePrintType,
  printPayload,
  resetPrinterQueuesForTests,
  resolvePrinterTarget,
  type PrinterConfig,
} from "./printService";
import { printViaWindowsRaw } from "./windowsRaw";

const printRaw = printViaWindowsRaw as jest.Mock;

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

describe("receipt print fallback", () => {
  const logo = `IMAGE_MONO:16:1:${Buffer.from([0x11, 0x22]).toString("base64")}`;
  const qr = `QR_MONO:16:1:${Buffer.from([0x33, 0x44]).toString("base64")}`;
  const lines = ["CENTERB:Thank you! Visit again.", "CENTER:Scan to pay", logo, qr, "CUT"];

  beforeEach(() => {
    resetPrinterQueuesForTests();
    printRaw.mockReset();
  });

  function sentBuffers() {
    return printRaw.mock.calls.map((call) => call[1] as Buffer);
  }

  it("retries without the logo, then as text only, and reports text success", async () => {
    printRaw
      .mockRejectedValueOnce(new Error("full failed"))
      .mockRejectedValueOnce(new Error("no logo failed"))
      .mockResolvedValueOnce(undefined);

    await expect(
      printPayload({ type: "receipt", data: { lines } }, cfg),
    ).resolves.toMatchObject({ type: "receipt", transport: "windows-raw" });

    const buffers = sentBuffers();
    expect(buffers).toHaveLength(3);
    expect(buffers[0].includes(Buffer.from([0x11, 0x22]))).toBe(true);
    expect(buffers[0].includes(Buffer.from([0x33, 0x44]))).toBe(true);
    expect(buffers[1].includes(Buffer.from([0x11, 0x22]))).toBe(false);
    expect(buffers[1].includes(Buffer.from([0x33, 0x44]))).toBe(true);
    expect(buffers[2].includes(Buffer.from([0x11, 0x22]))).toBe(false);
    expect(buffers[2].includes(Buffer.from([0x33, 0x44]))).toBe(false);
    for (const buffer of buffers) {
      const text = buffer.toString("latin1");
      expect(text).toContain("Thank you! Visit again.");
      expect(text).toContain("Scan to pay");
    }
  });

  it("keeps the QR when dropping only the logo succeeds", async () => {
    printRaw.mockRejectedValueOnce(new Error("full failed")).mockResolvedValueOnce(undefined);

    await expect(printPayload({ type: "receipt", data: { lines } }, cfg)).resolves.toMatchObject({
      transport: "windows-raw",
    });

    const buffers = sentBuffers();
    expect(buffers).toHaveLength(2);
    expect(buffers[1].includes(Buffer.from([0x33, 0x44]))).toBe(true);
    expect(buffers[1].toString("latin1")).toContain("Thank you! Visit again.");
  });

  it("does not retry a text receipt that has no logo or QR", async () => {
    printRaw.mockRejectedValueOnce(new Error("offline"));
    await expect(
      printPayload(
        { type: "receipt", data: { lines: ["CENTERB:Thank you! Visit again.", "CUT"] } },
        cfg,
      ),
    ).rejects.toThrow("offline");
    expect(printRaw).toHaveBeenCalledTimes(1);
  });
});
