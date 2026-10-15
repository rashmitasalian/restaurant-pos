import { describeGatewayListenFailure } from "./gatewayListen";

describe("gateway listen failure", () => {
  it("names a single busy port", () => {
    const error = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    expect(describeGatewayListenFailure(error, 4747, 1)).toBe(
      "Port 4747 already in use. Close the other program using it, then try again.",
    );
  });

  it("names the range when every fallback port is busy", () => {
    const error = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    expect(describeGatewayListenFailure(error, 4747, 10)).toBe(
      "Ports 4747–4756 already in use. Close the other program using them, then try again.",
    );
  });

  it("keeps other listen errors", () => {
    expect(describeGatewayListenFailure(new Error("listen EACCES"), 4747, 1)).toBe("listen EACCES");
  });
});
