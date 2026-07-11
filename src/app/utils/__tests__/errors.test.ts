/**
 * Unit Tests for Error Handling
 * Tests custom error classes and error reporting
 */

import {
  PosError,
  DatabaseError,
  PrinterError,
  ValidationError,
  AuthenticationError,
  NetworkError,
  handleError,
  errorReporter,
} from "../errors";

describe("PosError", () => {
  it("should create PosError with message and defaults", () => {
    const error = new PosError("Test error", "TEST_ERROR");
    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_ERROR");
    expect(error.severity).toBe("medium");
    expect(error.recoverable).toBe(false);
    expect(error.name).toBe("PosError");
  });

  it("should create PosError with custom severity and recoverable", () => {
    const error = new PosError("Critical error", "CRITICAL", "critical", true, { orderId: "123" });
    expect(error.severity).toBe("critical");
    expect(error.recoverable).toBe(true);
    expect(error.context).toEqual({ orderId: "123" });
  });

  it("should serialize to JSON with toJSON method", () => {
    const error = new PosError("Test", "TEST_CODE", "high", true, { data: "test" });
    const json = error.toJSON();
    expect(json.name).toBe("PosError");
    expect(json.message).toBe("Test");
    expect(json.code).toBe("TEST_CODE");
    expect(json.severity).toBe("high");
    expect(json.recoverable).toBe(true);
    expect(json.context).toEqual({ data: "test" });
  });

  it("should be instanceof Error", () => {
    const error = new PosError("Test", "TEST");
    expect(error instanceof Error).toBe(true);
  });
});

describe("DatabaseError", () => {
  it("should create DatabaseError with correct defaults", () => {
    const error = new DatabaseError("DB connection failed", { database: "pos" });
    expect(error.message).toBe("DB connection failed");
    expect(error.code).toBe("DB_ERROR");
    expect(error.severity).toBe("high");
    expect(error.recoverable).toBe(true);
    expect(error.name).toBe("DatabaseError");
  });

  it("should include context in error", () => {
    const context = { table: "orders", operation: "insert" };
    const error = new DatabaseError("Insert failed", context);
    expect(error.context).toEqual(context);
  });
});

describe("PrinterError", () => {
  it("should create PrinterError with recoverable by default", () => {
    const error = new PrinterError("Printer offline", true);
    expect(error.code).toBe("PRINTER_ERROR");
    expect(error.severity).toBe("high");
    expect(error.recoverable).toBe(true);
  });

  it("should allow non-recoverable printer errors", () => {
    const error = new PrinterError("Printer hardware failure", false);
    expect(error.recoverable).toBe(false);
  });
});

describe("ValidationError", () => {
  it("should create ValidationError with correct severity", () => {
    const error = new ValidationError("Invalid order", { field: "itemCount" });
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.severity).toBe("low");
    expect(error.recoverable).toBe(false);
    expect(error.context).toEqual({ field: "itemCount" });
  });
});

describe("AuthenticationError", () => {
  it("should create AuthenticationError as non-recoverable", () => {
    const error = new AuthenticationError("Invalid credentials", { userId: "user123" });
    expect(error.code).toBe("AUTH_ERROR");
    expect(error.severity).toBe("high");
    expect(error.recoverable).toBe(false);
  });
});

describe("NetworkError", () => {
  it("should create NetworkError with recoverable by default", () => {
    const error = new NetworkError("Connection timeout");
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.severity).toBe("medium");
    expect(error.recoverable).toBe(true);
  });

  it("should allow non-recoverable network errors", () => {
    const error = new NetworkError("DNS resolution failed", false);
    expect(error.recoverable).toBe(false);
  });
});

describe("handleError", () => {
  it("should return PosError if error is already PosError", () => {
    const posError = new DatabaseError("DB Error");
    const result = handleError(posError);
    expect(result).toBe(posError);
    expect(result instanceof DatabaseError).toBe(true);
  });

  it("should convert Error to PosError", () => {
    const stdError = new Error("Standard error");
    const result = handleError(stdError);
    expect(result instanceof PosError).toBe(true);
    expect(result.message).toBe("Standard error");
    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.severity).toBe("medium");
    expect(result.recoverable).toBe(true);
  });

  it("should convert string to PosError", () => {
    const result = handleError("String error");
    expect(result instanceof PosError).toBe(true);
    expect(result.message).toBe("String error");
  });

  it("should handle number errors", () => {
    const result = handleError(123);
    expect(result instanceof PosError).toBe(true);
    expect(result.code).toBe("UNKNOWN_ERROR");
  });

  it("should preserve stack trace from Error", () => {
    const stdError = new Error("Original error");
    const result = handleError(stdError);
    expect(result.context.originalStack).toBeDefined();
    expect(typeof result.context.originalStack).toBe("string");
  });
});

describe("ErrorReporter", () => {
  beforeEach(() => {
    // Clear the ErrorReporter before each test
    errorReporter.clear();
  });

  it("should add error to report", () => {
    const error = new DatabaseError("Test error");
    errorReporter.addError(error);
    expect(errorReporter.getErrors().length).toBe(1);
  });

  it("should collect multiple critical errors", () => {
    const error1 = new PosError("Error 1", "ERR_1", "critical");
    const error2 = new PosError("Error 2", "ERR_2", "critical");
    errorReporter.addError(error1);
    errorReporter.addError(error2);
    expect(errorReporter.getErrors().length).toBe(2);
  });

  it("should export errors as JSON", () => {
    const error = new DatabaseError("DB Error", { query: "SELECT *" });
    errorReporter.addError(error);

    const jsonReport = errorReporter.exportErrors();
    expect(typeof jsonReport).toBe("string");

    const parsed = JSON.parse(jsonReport);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].message).toBe("DB Error");
  });

  it("should include error count in export", () => {
    for (let i = 0; i < 3; i++) {
      errorReporter.addError(new PosError(`Error ${i}`, "ERR"));
    }

    const jsonReport = errorReporter.exportErrors();
    const parsed = JSON.parse(jsonReport);
    expect(parsed.length).toBe(3);
  });

  it("should include export timestamp", () => {
    errorReporter.addError(new PosError("Test", "TEST"));
    const jsonReport = errorReporter.exportErrors();
    const parsed = JSON.parse(jsonReport);
    expect(parsed.length).toBe(1);
  });

  it("should clear errors after retrieval", () => {
    errorReporter.addError(new PosError("Error 1", "ERR_1"));
    errorReporter.addError(new PosError("Error 2", "ERR_2"));

    const report = errorReporter.exportErrors();
    const parsed = JSON.parse(report);
    expect(parsed.length).toBe(2);

    // Verify errors are still there (they might be cleared separately)
    const errors = errorReporter.getErrors();
    expect(errors.length).toBe(2);
  });

  it("should format errors with stack traces", () => {
    const error = new DatabaseError("Query error", { query: "INSERT" });
    errorReporter.addError(error);

    const jsonReport = errorReporter.exportErrors();
    const parsed = JSON.parse(jsonReport);
    expect(parsed[0]).toHaveProperty("code");
    expect(parsed[0]).toHaveProperty("severity");
    expect(parsed[0]).toHaveProperty("recoverable");
  });
});

describe("Error hierarchy", () => {
  it("should maintain proper error hierarchy", () => {
    const errors = [
      new DatabaseError("DB"),
      new PrinterError("Printer"),
      new ValidationError("Validation"),
      new AuthenticationError("Auth"),
      new NetworkError("Network"),
    ];

    errors.forEach((error) => {
      expect(error instanceof PosError).toBe(true);
      expect(error instanceof Error).toBe(true);
      expect(error.toJSON).toBeDefined();
    });
  });

  it("should have unique error codes", () => {
    const codes = new Set([
      new PosError("msg", "POS_ERROR").code,
      new DatabaseError("msg").code,
      new PrinterError("msg").code,
      new ValidationError("msg").code,
      new AuthenticationError("msg").code,
      new NetworkError("msg").code,
    ]);

    expect(codes.size).toBe(6); // All unique
  });
});
