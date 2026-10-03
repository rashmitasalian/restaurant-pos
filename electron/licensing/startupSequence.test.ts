import { isLicensedAtStartup, runStartupSequence, startLicensedServices } from "./startupSequence";

function steps() {
  const calls: string[] = [];
  return {
    calls,
    steps: {
      startCore: jest.fn(async () => {
        calls.push("core");
      }),
      startDeferred: jest.fn(() => {
        calls.push("deferred");
      }),
      startGateway: jest.fn(async () => {
        calls.push("gateway");
      }),
      createWindow: jest.fn(async () => {
        calls.push("window");
      }),
    },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("startup sequence", () => {
  it("decides licensed state from the gate, not the renderer", () => {
    expect(isLicensedAtStartup(false, null)).toBe(true);
    expect(isLicensedAtStartup(true, null)).toBe(false);
    expect(isLicensedAtStartup(true, { openDatabase: false })).toBe(false);
    expect(isLicensedAtStartup(true, { openDatabase: true })).toBe(true);
  });

  it("without a valid license opens only the window", async () => {
    const { steps: s, calls } = steps();
    await runStartupSequence(false, s);
    await flush();
    expect(calls).toEqual(["window"]);
    expect(s.startCore).not.toHaveBeenCalled();
    expect(s.startGateway).not.toHaveBeenCalled();
    expect(s.startDeferred).not.toHaveBeenCalled();
  });

  it("with a valid license opens the database and IPC before the window, then Captain", async () => {
    const { steps: s, calls } = steps();
    await runStartupSequence(true, s);
    await flush();
    expect(calls.indexOf("core")).toBe(0);
    expect(calls).toContain("window");
    expect(calls).toContain("gateway");
    expect(calls).toContain("deferred");
    expect(calls.indexOf("core")).toBeLessThan(calls.indexOf("window"));
  });

  it("after import starts the database, deferred services, and Captain in order", async () => {
    const { steps: s, calls } = steps();
    await startLicensedServices(s);
    expect(calls).toEqual(["core", "deferred", "gateway"]);
  });

  it("does not start Captain when the database fails after import", async () => {
    const { steps: s } = steps();
    s.startCore.mockRejectedValueOnce(new Error("sqlite"));
    await expect(startLicensedServices(s)).rejects.toThrow("sqlite");
    expect(s.startGateway).not.toHaveBeenCalled();
  });
});
