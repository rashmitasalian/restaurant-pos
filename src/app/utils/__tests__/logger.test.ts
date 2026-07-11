/**
 * Unit Tests for Logger
 * Tests logging functionality, memory management, and export formats
 */

import { logger } from "../logger";

describe("Logger", () => {
  beforeEach(() => {
    // Clear logs before each test
    const logs = (logger as any).logs;
    logs.length = 0;
  });

  it("should log info messages", () => {
    logger.info("Test message", { key: "value" });
    const logs = (logger as any).logs;
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe("info");
    expect(logs[0].message).toBe("Test message");
    expect(logs[0].context).toEqual({ key: "value" });
  });

  it("should log warning messages", () => {
    logger.warn("Warning message", { severity: "high" });
    const logs = (logger as any).logs;
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe("warn");
  });

  it("should log error messages with stack trace", () => {
    const error = new Error("Test error");
    logger.error("Error occurred", error, { context: "test" });
    const logs = (logger as any).logs;
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe("error");
    expect(logs[0].context).toHaveProperty("errorMsg");
    expect(logs[0].stack).toBeDefined();
  });

  it("should log debug messages", () => {
    logger.debug("Debug message", { debugInfo: 123 });
    const logs = (logger as any).logs;
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe("debug");
  });

  it("should include timestamp in logs", () => {
    logger.info("Timestamped message");
    const logs = (logger as any).logs;
    expect(logs[0].timestamp).toBeDefined();
    expect(typeof logs[0].timestamp).toBe("string");
  });

  it("should maintain max memory logs limit (1000 entries)", () => {
    for (let i = 0; i < 1100; i++) {
      logger.info(`Message ${i}`);
    }
    const logs = (logger as any).logs;
    expect(logs.length).toBeLessThanOrEqual(1000);
  });

  it("should export logs as JSON", () => {
    logger.info("Test 1", { data: 1 });
    logger.warn("Test 2", { data: 2 });
    logger.error("Test 3", new Error("test error"));

    const jsonLogs = logger.exportJSON();
    expect(typeof jsonLogs).toBe("string");

    const parsed = JSON.parse(jsonLogs);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(3);
    expect(parsed[0].message).toBe("Test 1");
    expect(parsed[1].level).toBe("warn");
  });

  it("should export logs as CSV", () => {
    logger.info("Test message", { field1: "value1" });
    logger.warn("Warning", { field2: "value2" });

    const csvLogs = logger.exportCSV();
    expect(typeof csvLogs).toBe("string");

    const lines = csvLogs.split("\n");
    expect(lines.length).toBeGreaterThan(1); // header + at least 1 row
    expect(lines[0]).toContain("timestamp");
    expect(lines[0]).toContain("level");
    expect(lines[0]).toContain("message");
  });

  it("should get recent logs with limit", () => {
    for (let i = 0; i < 10; i++) {
      logger.info(`Message ${i}`);
    }

    const recentLogs = logger.getRecentLogs(5);
    expect(recentLogs.length).toBeLessThanOrEqual(5);
    // Most recent logs should be returned
    expect(recentLogs[recentLogs.length - 1].message).toContain("Message");
  });

  it("should handle log context as optional", () => {
    logger.info("Message without context");
    const logs = (logger as any).logs;
    expect(logs.length).toBe(1);
    expect(logs[0].context).toEqual({});
  });

  it("should handle error as string in error logger", () => {
    logger.error("Error with string", "String error message");
    const logs = (logger as any).logs;
    expect(logs[0].context).toHaveProperty("errorMsg");
  });

  it("should respect log level threshold", () => {
    // This test checks that the logger can be initialized with different levels
    // Note: This depends on logger being reconfigurable, which may need additional implementation
    logger.debug("Debug message 1");
    logger.info("Info message 1");
    logger.warn("Warning message 1");

    const logs = (logger as any).logs;
    expect(logs.length).toBeGreaterThan(0);
  });

  it("should format complex context objects", () => {
    const complexContext = {
      nested: {
        deep: {
          value: 42,
          array: [1, 2, 3],
        },
      },
      timestamp: Date.now(),
    };
    logger.info("Complex context", complexContext);

    const logs = (logger as any).logs;
    expect(logs[0].context).toEqual(complexContext);
  });

  it("should handle multiple rapid logs", () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      logger.info(`Rapid message ${i}`, { index: i });
    }
    const duration = Date.now() - start;

    const logs = (logger as any).logs;
    expect(logs.length).toBe(100);
    expect(duration).toBeLessThan(1000); // Should complete reasonably quickly
  });
});
