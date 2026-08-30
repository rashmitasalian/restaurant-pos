import { reportClientError } from "../clientError";
import { logger } from "../logger";

describe("reportClientError", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("logs technical errors and returns a safe default message", () => {
    const ipcError =
      "Error invoking remote method 'pos:grocery:purchase-headers:list': SqliteError: ambiguous column name: status";
    const message = reportClientError("grocery.purchases.load", ipcError, "Could not load purchases");

    expect(message).toBe("Could not load purchases");
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns mapped business error messages", () => {
    const message = reportClientError("billing.add-item", "customer-phone-duplicate", "Failed to add item");
    expect(message).toContain("phone number");
    expect(logger.error).toHaveBeenCalled();
  });
});
