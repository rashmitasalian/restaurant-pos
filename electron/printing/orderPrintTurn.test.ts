import { resetOrderPrintTurnsForTests, withOrderPrintTurn } from "./orderPrintTurn";

describe("order print turn", () => {
  afterEach(() => {
    resetOrderPrintTurnsForTests();
  });

  it("runs the same order one at a time and still runs the next job after a failure", async () => {
    let releaseFirst: (value: void) => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const seen: string[] = [];
    const first = withOrderPrintTurn("order:1", async () => {
      seen.push("first-start");
      await firstGate;
      seen.push("first-end");
      throw new Error("printer-offline");
    });
    let secondStarted = false;
    const second = withOrderPrintTurn("order:1", async () => {
      secondStarted = true;
      seen.push("second");
      return "ok";
    });

    await Promise.resolve();
    expect(secondStarted).toBe(false);
    expect(seen).toEqual(["first-start"]);

    releaseFirst();
    await expect(first).rejects.toThrow("printer-offline");
    await expect(second).resolves.toBe("ok");
    expect(seen).toEqual(["first-start", "first-end", "second"]);
  });

  it("lets two different orders print without waiting for each other", async () => {
    let releaseA: (value: void) => void = () => undefined;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const orderA = withOrderPrintTurn("order:a", async () => {
      await gateA;
      return "a";
    });
    const orderB = withOrderPrintTurn("order:b", async () => "b");
    await expect(orderB).resolves.toBe("b");
    releaseA();
    await expect(orderA).resolves.toBe("a");
  });
});
