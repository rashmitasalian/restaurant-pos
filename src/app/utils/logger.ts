/**
 * Production Logging System for Restaurant POS
 * Structured logging with file persistence for audit trail
 */

import { csvCell } from "../../shared/csv";

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  context?: Record<string, any>;
  stack?: string;
}

class Logger {
  private logs: LogEntry[] = [];
  private readonly MAX_MEMORY_LOGS = 1000;
  private readonly LOG_LEVEL_WEIGHT: Record<LogEntry["level"], number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private currentLevel: LogEntry["level"] = "info";

  constructor(level: LogEntry["level"] = "info") {
    this.currentLevel = level;
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, any>) {
    this.log("info", message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, any>) {
    this.log("warn", message, context);
  }

  /**
   * Log error with stack trace
   */
  error(message: string, error?: Error | string, context?: Record<string, any>) {
    const stack = error instanceof Error ? error.stack : undefined;
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.log("error", message, { ...context, errorMsg }, stack);
    console.error(`[ERROR] ${message}`, error);
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, any>) {
    this.log("debug", message, context);
  }

  /**
   * Internal log method
   */
  private log(
    level: LogEntry["level"],
    message: string,
    context?: Record<string, any>,
    stack?: string,
  ) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: context || {},
      ...(stack && { stack }),
    };

    this.logs.push(entry);

    // Keep only recent logs in memory
    if (this.logs.length > this.MAX_MEMORY_LOGS) {
      this.logs = this.logs.slice(-this.MAX_MEMORY_LOGS);
    }

    // Persist to file via Electron IPC (best-effort, non-blocking)
    if (this.LOG_LEVEL_WEIGHT[level] >= this.LOG_LEVEL_WEIGHT[this.currentLevel]) {
      try {
        const pos = (globalThis as any).pos;
        if (pos?.writeLog) {
          pos.writeLog(level, message, context || {});
        }
      } catch (_) {}
    }

    // Also log to console in development if level meets threshold
    if (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV !== "production" &&
      this.LOG_LEVEL_WEIGHT[level] >= this.LOG_LEVEL_WEIGHT[this.currentLevel]
    ) {
      const prefix = `[${level.toUpperCase()}]`;
      console.log(`${prefix} ${message}`, context || "");
    }
  }

  /**
   * Get recent logs with optional filtering
   */
  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level: LogEntry["level"]): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Export logs as JSON
   */
  exportJSON(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Export logs as CSV
   */
  exportCSV(): string {
    if (this.logs.length === 0) {
      return "timestamp,level,message\n";
    }

    const headers = ["timestamp", "level", "message", "context"];
    const rows = this.logs.map((log) => [
      csvCell(log.timestamp),
      csvCell(log.level),
      csvCell(log.message),
      log.context ? csvCell(JSON.stringify(log.context)) : "",
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  /**
   * Clear all logs
   */
  clear() {
    this.logs = [];
  }

  /**
   * Get log count
   */
  getCount(): number {
    return this.logs.length;
  }
}

// Export singleton instance
export const logger = new Logger((globalThis as any).pos?.env?.LOG_LEVEL || "info");

export default logger;
export type { LogEntry };
