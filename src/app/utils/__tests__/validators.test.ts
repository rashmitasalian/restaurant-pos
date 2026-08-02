/**
 * Unit Tests for Validators
 * Tests all validation functions with valid, invalid, and edge case inputs
 */

import {
  OrderValidator,
  AuditValidator,
  PaymentValidator,
  MenuItemValidator,
  DocumentValidator,
} from "../validators";

describe("OrderValidator", () => {
  const validOrder = {
    _id: "order:abc-123",
    type: "order",
    orderType: "table" as const,
    tableId: 1,
    items: [
      { id: "item-1", name: "Burger", qty: 2, rate: 250 },
      { id: "item-2", name: "Fries", qty: 1, rate: 150 },
    ],
    status: "open" as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("should validate a correct order", () => {
    const errors = OrderValidator.validate(validOrder);
    expect(errors).toHaveLength(0);
  });

  it("should reject order without _id", () => {
    const invalidOrder = { ...validOrder, _id: "" };
    const errors = OrderValidator.validate(invalidOrder);
    expect(errors.some((e: any) => e.field === "_id")).toBe(true);
  });

  it("should reject order with invalid type", () => {
    const invalidOrder = { ...validOrder, type: "invalid" };
    const errors = OrderValidator.validate(invalidOrder);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("should reject order with empty orderType", () => {
    const invalidOrder = { ...validOrder, orderType: "" as any };
    const errors = OrderValidator.validate(invalidOrder);
    expect(errors.some((e: any) => e.field === "orderType")).toBe(true);
  });

  it("should reject order with no items array", () => {
    const invalidOrder = { ...validOrder, items: undefined };
    const errors = OrderValidator.validate(invalidOrder);
    expect(errors.some((e: any) => e.field === "items")).toBe(true);
  });

  it("should reject order with invalid status", () => {
    const invalidOrder = { ...validOrder, status: "invalid" };
    const errors = OrderValidator.validate(invalidOrder);
    expect(errors.some((e: any) => e.field === "status")).toBe(true);
  });

  it("should reject order with missing timestamps", () => {
    const invalidOrder = { ...validOrder, createdAt: undefined };
    const errors = OrderValidator.validate(invalidOrder);
    expect(errors.some((e: any) => e.field === "createdAt")).toBe(true);
  });

  it("should accept takeaway order with null tableId", () => {
    const takeawayOrder = {
      ...validOrder,
      orderType: "takeaway" as const,
      tableId: null,
    };
    const errors = OrderValidator.validate(takeawayOrder);
    expect(errors).toHaveLength(0);
  });

  it("should validate order with empty items array", () => {
    const emptyOrder = { ...validOrder, items: [] };
    const errors = OrderValidator.validate(emptyOrder);
    expect(errors).toHaveLength(0); // Empty is valid, items get added later
  });

  it("should reject order with invalid item structure", () => {
    const invalidOrder = {
      ...validOrder,
      items: [{ id: "item-1", name: "Burger" }], // Missing qty and rate
    };
    const errors = OrderValidator.validate(invalidOrder);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("AuditValidator", () => {
  const validAudit = {
    _id: "audit:001",
    type: "audit",
    action: "order.created",
    timestamp: Date.now(),
    userId: "user123",
    details: { orderId: "order:abc", orderType: "table" },
  };

  it("should validate correct audit entry", () => {
    const errors = AuditValidator.validate(validAudit);
    expect(errors).toHaveLength(0);
  });

  it("should reject audit without _id", () => {
    const invalid = { ...validAudit, _id: "" };
    const errors = AuditValidator.validate(invalid);
    expect(errors.some((e: any) => e.field === "_id")).toBe(true);
  });

  it("should reject audit without action", () => {
    const invalid = { ...validAudit, action: "" };
    const errors = AuditValidator.validate(invalid);
    expect(errors.some((e: any) => e.field === "action")).toBe(true);
  });

  it("should reject audit with invalid timestamp", () => {
    const invalid = { ...validAudit, timestamp: -1 };
    const errors = AuditValidator.validate(invalid);
    expect(errors.some((e: any) => e.field === "timestamp")).toBe(true);
  });

  it("should accept audit with null userId", () => {
    const audit = { ...validAudit, userId: null };
    const errors = AuditValidator.validate(audit);
    expect(errors).toHaveLength(0);
  });
});

describe("PaymentValidator", () => {
  const validPayment = {
    _id: "payment:001",
    type: "payment",
    amount: 500,
    method: "cash",
    receivedAt: Date.now(),
  };

  it("should validate correct payment", () => {
    const errors = PaymentValidator.validate(validPayment);
    expect(errors).toHaveLength(0);
  });

  it("should reject payment with zero amount", () => {
    const invalid = { ...validPayment, amount: 0 };
    const errors = PaymentValidator.validate(invalid);
    expect(errors.some((e: any) => e.field === "amount")).toBe(true);
  });

  it("should reject payment with negative amount", () => {
    const invalid = { ...validPayment, amount: -100 };
    const errors = PaymentValidator.validate(invalid);
    expect(errors.some((e: any) => e.field === "amount")).toBe(true);
  });

  it("should reject payment without method", () => {
    const invalid = { ...validPayment, method: "" };
    const errors = PaymentValidator.validate(invalid);
    expect(errors.some((e: any) => e.field === "method")).toBe(true);
  });

  it("should accept valid payment methods", () => {
    const methods = ["cash", "card", "upi", "other"];
    for (const method of methods) {
      const payment = { ...validPayment, method };
      const errors = PaymentValidator.validate(payment);
      expect(errors).toHaveLength(0);
    }
  });

  it("should reject invalid payment method", () => {
    const invalid = { ...validPayment, method: "bitcoin" };
    const errors = PaymentValidator.validate(invalid);
    expect(errors.some((e: any) => e.field === "method")).toBe(true);
  });
});

describe("MenuItemValidator", () => {
  const validItem = {
    _id: "item:burger-001",
    type: "menu-item",
    name: "Deluxe Burger",
    price: 350,
    category: "Mains",
    available: true,
  };

  it("should validate correct menu item", () => {
    const errors = MenuItemValidator.validate(validItem);
    expect(errors).toHaveLength(0);
  });

  it("should reject item without name", () => {
    const invalid = { ...validItem, name: "" };
    const errors = MenuItemValidator.validate(invalid);
    expect(errors.some((e: any) => e.field === "name")).toBe(true);
  });

  it("should reject item with zero price", () => {
    const invalid = { ...validItem, price: 0 };
    const errors = MenuItemValidator.validate(invalid);
    expect(errors.some((e: any) => e.field === "price")).toBe(true);
  });

  it("should reject item with negative price", () => {
    const invalid = { ...validItem, price: -50 };
    const errors = MenuItemValidator.validate(invalid);
    expect(errors.some((e: any) => e.field === "price")).toBe(true);
  });

  it("should accept item without category", () => {
    const item = { ...validItem, category: undefined };
    const errors = MenuItemValidator.validate(item);
    expect(errors).toHaveLength(0);
  });

  it("should accept item with available flag", () => {
    const availableItem = { ...validItem, available: true };
    const unavailableItem = { ...validItem, available: false };
    expect(MenuItemValidator.validate(availableItem)).toHaveLength(0);
    expect(MenuItemValidator.validate(unavailableItem)).toHaveLength(0);
  });
});

describe("DocumentValidator", () => {
  it("should dispatch to OrderValidator for order type", () => {
    const order = {
      _id: "order:abc",
      type: "order",
      orderType: "table",
      tableId: 1,
      items: [],
      status: "open",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const errors = DocumentValidator.validate(order);
    expect(errors).toHaveLength(0);
  });

  it("should dispatch to AuditValidator for audit type", () => {
    const audit = {
      _id: "audit:001",
      type: "audit",
      action: "order.created",
      timestamp: Date.now(),
      userId: "user123",
    };
    const errors = DocumentValidator.validate(audit);
    expect(errors).toHaveLength(0);
  });

  it("should dispatch to PaymentValidator for payment type", () => {
    const payment = {
      _id: "payment:001",
      type: "payment",
      amount: 500,
      method: "cash",
      receivedAt: Date.now(),
    };
    const errors = DocumentValidator.validate(payment);
    expect(errors).toHaveLength(0);
  });

  it("should dispatch to MenuItemValidator for item type", () => {
    const item = {
      _id: "item:burger",
      type: "menu-item",
      name: "Burger",
      price: 300,
    };
    const errors = DocumentValidator.validate(item);
    expect(errors).toHaveLength(0);
  });

  it("should return error for unknown document type", () => {
    const unknown = {
      _id: "unknown:001",
      type: "unknown",
    };
    const errors = DocumentValidator.validate(unknown);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("validator error formatting", () => {
  it("should format validation errors as human-readable messages", () => {
    const order = {
      _id: "",
      type: "invalid",
      orderType: "invalid",
      tableId: "not-a-number",
      items: null,
      status: "invalid",
      createdAt: -1,
      updatedAt: undefined,
    };
    const errors = OrderValidator.validate(order);
    expect(errors.length).toBeGreaterThan(0);
    // Verify error structure
    errors.forEach((error: any) => {
      expect(error).toHaveProperty("field");
      expect(error).toHaveProperty("error");
    });
  });
});
