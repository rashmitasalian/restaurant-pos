/**
 * Custom Error Classes for Production Error Handling
 */

export class PosError extends Error {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  recoverable: boolean;
  context: Record<string, any>;

  constructor(
    message: string,
    code: string,
    severity: "low" | "medium" | "high" | "critical" = "medium",
    recoverable: boolean = false,
    context: Record<string, any> = {},
  ) {
    super(message);
    this.name = "PosError";
    this.code = code;
    this.severity = severity;
    this.recoverable = recoverable;
    this.context = context;

    Object.setPrototypeOf(this, PosError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      recoverable: this.recoverable,
      context: this.context,
      stack: this.stack,
    };
  }
}

export class DatabaseError extends PosError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, "DB_ERROR", "high", true, context);
    this.name = "DatabaseError";
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

export class PrinterError extends PosError {
  constructor(message: string, recoverable: boolean = true, context: Record<string, any> = {}) {
    super(message, "PRINTER_ERROR", "high", recoverable, context);
    this.name = "PrinterError";
    Object.setPrototypeOf(this, PrinterError.prototype);
  }
}

export class ValidationError extends PosError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, "VALIDATION_ERROR", "low", false, context);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class AuthenticationError extends PosError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, "AUTH_ERROR", "high", false, context);
    this.name = "AuthenticationError";
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class NetworkError extends PosError {
  constructor(message: string, recoverable: boolean = true, context: Record<string, any> = {}) {
    super(message, "NETWORK_ERROR", "medium", recoverable, context);
    this.name = "NetworkError";
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Global error handler
 */
export function handleError(error: unknown): PosError {
  if (error instanceof PosError) {
    return error;
  }

  if (error instanceof Error) {
    return new PosError(error.message, "UNKNOWN_ERROR", "medium", true, {
      originalStack: error.stack,
    });
  }

  return new PosError(String(error), "UNKNOWN_ERROR", "medium", true);
}

/**
 * Error reporter for production
 */
export class ErrorReporter {
  private errors: PosError[] = [];
  private readonly maxCrashReports = 100;

  addError(error: PosError) {
    this.errors.push(error);

    if (this.errors.length > this.maxCrashReports) {
      this.errors = this.errors.slice(-this.maxCrashReports);
    }
  }

  getCriticalErrors(): PosError[] {
    return this.errors.filter((e) => e.severity === "critical" || e.severity === "high");
  }

  getErrors(): PosError[] {
    return [...this.errors];
  }

  exportErrors(): string {
    return JSON.stringify(this.errors, null, 2);
  }

  clear() {
    this.errors = [];
  }
}

export const errorReporter = new ErrorReporter();
