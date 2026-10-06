import { publicGatewayError } from "./gatewayError";

describe("captain gateway errors", () => {
  it("keeps application error codes and hides database messages", () => {
    expect(publicGatewayError("order-not-found")).toBe("order-not-found");
    expect(publicGatewayError("auth-required")).toBe("auth-required");
    expect(publicGatewayError("SqliteError: no such column: name")).toBe("internal-error");
    expect(publicGatewayError("near \"orders\": syntax error")).toBe("internal-error");
  });
});
