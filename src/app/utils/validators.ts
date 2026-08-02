/**
 * Schema Validation Layer for Database Documents
 * Runtime validation of document types
 */

import { logger } from "../utils/logger";

export interface ValidationError {
  field: string;
  error: string;
}

/**
 * Order Document Schema Validator
 */
export class OrderValidator {
  static validate(doc: any): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required fields
    if (!doc._id || typeof doc._id !== "string") {
      errors.push({ field: "_id", error: "Missing or invalid _id" });
    }

    if (doc.type !== "order") {
      errors.push({ field: "type", error: "Must be 'order'" });
    }

    // Validate orderType/serviceMode identifier
    if (!doc.orderType || typeof doc.orderType !== "string" || !doc.orderType.trim()) {
      errors.push({
        field: "orderType",
        error: "Order type must be a non-empty string",
      });
    }

    if (!Array.isArray(doc.items)) {
      errors.push({ field: "items", error: "Must be an array" });
    } else {
      // Validate each item
      for (let i = 0; i < doc.items.length; i++) {
        const item = doc.items[i];
        if (!item.name || typeof item.name !== "string") {
          errors.push({
            field: `items[${i}].name`,
            error: "Item name is required",
          });
        }
        if (!Number.isFinite(item.qty) || item.qty < 1) {
          errors.push({
            field: `items[${i}].qty`,
            error: "Item qty must be >= 1",
          });
        }
        if (!Number.isFinite(item.rate) || item.rate < 0) {
          errors.push({
            field: `items[${i}].rate`,
            error: "Item rate must be >= 0",
          });
        }
      }
    }

    // Validate status
    const validStatuses = ["open", "ready", "paid", "held", "cancelled", "assigned"];
    if (!doc.status || !validStatuses.includes(doc.status)) {
      errors.push({
        field: "status",
        error: `Status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Validate numeric fields
    if (!Number.isFinite(doc.createdAt)) {
      errors.push({ field: "createdAt", error: "Must be a valid timestamp" });
    }

    if (!Number.isFinite(doc.updatedAt)) {
      errors.push({ field: "updatedAt", error: "Must be a valid timestamp" });
    }

    // Validate boolean flags
    if ("kotSent" in doc && typeof doc.kotSent !== "boolean") {
      errors.push({ field: "kotSent", error: "Must be boolean" });
    }

    if ("kotPrinted" in doc && typeof doc.kotPrinted !== "boolean") {
      errors.push({ field: "kotPrinted", error: "Must be boolean" });
    }

    return errors;
  }

  static isValid(doc: any): boolean {
    return this.validate(doc).length === 0;
  }
}

/**
 * Audit Event Schema Validator
 */
export class AuditValidator {
  static validate(doc: any): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!doc._id || typeof doc._id !== "string") {
      errors.push({ field: "_id", error: "Missing or invalid _id" });
    }

    if (doc.type !== "audit") {
      errors.push({ field: "type", error: "Must be 'audit'" });
    }

    if (!doc.action || typeof doc.action !== "string") {
      errors.push({ field: "action", error: "Missing or invalid action" });
    }

    if (!Number.isFinite(doc.timestamp) || doc.timestamp <= 0) {
      errors.push({ field: "timestamp", error: "Must be a valid positive timestamp" });
    }

    if (doc.userId && typeof doc.userId !== "string") {
      errors.push({ field: "userId", error: "Must be a string" });
    }

    return errors;
  }

  static isValid(doc: any): boolean {
    return this.validate(doc).length === 0;
  }
}

/**
 * Payment Document Schema Validator
 */
export class PaymentValidator {
  static validate(payment: any): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
      errors.push({
        field: "amount",
        error: "Amount must be a positive number",
      });
    }

    const validMethods = ["cash", "upi", "card", "other"];
    if (!payment.method || !validMethods.includes(payment.method)) {
      errors.push({
        field: "method",
        error: `Method must be one of: ${validMethods.join(", ")}`,
      });
    }

    if (!Number.isFinite(payment.receivedAt)) {
      errors.push({
        field: "receivedAt",
        error: "Must be a valid timestamp",
      });
    }

    return errors;
  }

  static isValid(payment: any): boolean {
    return this.validate(payment).length === 0;
  }
}

/**
 * Menu Item Schema Validator
 */
export class MenuItemValidator {
  static validate(item: any): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!item._id || typeof item._id !== "string") {
      errors.push({ field: "_id", error: "Missing or invalid _id" });
    }

    if (item.type !== "menu-item") {
      errors.push({ field: "type", error: "Must be 'menu-item'" });
    }

    if (!item.name || typeof item.name !== "string") {
      errors.push({ field: "name", error: "Name is required" });
    }

    if (!Number.isFinite(item.price) || item.price <= 0) {
      errors.push({
        field: "price",
        error: "Price must be a positive number",
      });
    }

    if (item.category && typeof item.category !== "string") {
      errors.push({ field: "category", error: "Category must be a string" });
    }

    if (item.available && typeof item.available !== "boolean") {
      errors.push({ field: "available", error: "Must be boolean" });
    }

    return errors;
  }

  static isValid(item: any): boolean {
    return this.validate(item).length === 0;
  }
}

/**
 * Password Policy Validator
 * 
 * Security Policy for POS/Billing Systems (based on PCI DSS & NIST 800-63B):
 * - Minimum 8 characters (long, memorable passwords reduce weak patterns)
 * - At least 1 uppercase letter (ABC...XYZ)
 * - At least 1 lowercase letter (abc...xyz)
 * - At least 1 digit (0-9)
 * 
 * Why this policy:
 * - PCI DSS requires 7+ chars with complexity; 8+ is industry best practice
 * - NIST 800-63B: length > complexity for memorability and entropy
 * - No special character requirement: reduces friction, length provides security
 * - Examples: "MyPassword123", "Admin@POS2024", "BillingApp99"
 */
export class PasswordValidator {
  static readonly MIN_LENGTH = 8;
  static readonly MIN_UPPERCASE = 1;
  static readonly MIN_LOWERCASE = 1;
  static readonly MIN_DIGITS = 1;

  static getRequirements(): string[] {
    return [
      `Minimum ${this.MIN_LENGTH} characters`,
      `At least ${this.MIN_UPPERCASE} uppercase letter (A-Z)`,
      `At least ${this.MIN_LOWERCASE} lowercase letter (a-z)`,
      `At least ${this.MIN_DIGITS} digit (0-9)`,
    ];
  }

  static validate(password: string): { ok: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!password) {
      errors.push("Password is required");
      return { ok: false, errors };
    }

    if (password.length < this.MIN_LENGTH) {
      errors.push(`Password must be at least ${this.MIN_LENGTH} characters (you entered ${password.length})`);
    }

    if (!/[A-Z]/.test(password)) {
      errors.push(`Password must contain at least ${this.MIN_UPPERCASE} uppercase letter (A-Z)`);
    }

    if (!/[a-z]/.test(password)) {
      errors.push(`Password must contain at least ${this.MIN_LOWERCASE} lowercase letter (a-z)`);
    }

    if (!/[0-9]/.test(password)) {
      errors.push(`Password must contain at least ${this.MIN_DIGITS} digit (0-9)`);
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  }

  static isValid(password: string): boolean {
    return this.validate(password).ok;
  }
}

/**
 * Universal document validator
 */
export class DocumentValidator {
  static validate(doc: any): ValidationError[] {
    if (!doc || !doc.type) {
      return [{ field: "type", error: "Document type is required" }];
    }

    switch (doc.type) {
      case "order":
        return OrderValidator.validate(doc);
      case "audit":
        return AuditValidator.validate(doc);
      case "payment":
        return PaymentValidator.validate(doc);
      case "menu-item":
        return MenuItemValidator.validate(doc);
      default:
        return [
          {
            field: "type",
            error: `Unknown document type: ${doc.type}`,
          },
        ];
    }
  }

  static isValid(doc: any): boolean {
    return this.validate(doc).length === 0;
  }

  static formatErrors(errors: ValidationError[]): string {
    return errors.map((e) => `${e.field}: ${e.error}`).join("; ");
  }
}

export default DocumentValidator;
