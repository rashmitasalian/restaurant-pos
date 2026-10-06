import { createPairingThrottle } from "./pairingThrottle";

describe("captain pairing throttle", () => {
  it("locks a client after repeated wrong codes and then allows them again", () => {
    let clock = 1_000;
    const throttle = createPairingThrottle(() => clock);
    for (let attempt = 0; attempt < 7; attempt += 1) {
      expect(throttle.recordFailure("10.0.0.8")).toBe(false);
      expect(throttle.status("10.0.0.8").ok).toBe(true);
    }
    expect(throttle.recordFailure("10.0.0.8")).toBe(true);
    const locked = throttle.status("10.0.0.8");
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.retryAfterSeconds).toBe(15 * 60);
    }
    expect(throttle.status("10.0.0.9").ok).toBe(true);

    clock += 15 * 60 * 1000;
    expect(throttle.status("10.0.0.8").ok).toBe(true);
  });

  it("clears the failure count after a correct code", () => {
    const throttle = createPairingThrottle(() => 5_000);
    throttle.recordFailure("10.0.0.8");
    throttle.recordSuccess("10.0.0.8");
    for (let attempt = 0; attempt < 7; attempt += 1) {
      expect(throttle.recordFailure("10.0.0.8")).toBe(false);
    }
  });
});
