jest.mock("../db/sqlite", () => ({
  backupDatabase: jest.fn(),
  getDb: jest.fn(),
  inTransaction: jest.fn((fn: any) => fn(mockDb)),
  restoreDatabaseFromBackup: jest.fn(),
}));

import { getDb } from "../db/sqlite";
import { posService } from "./posService";

const mockGetDb = getDb as jest.Mock;

let mockDb: any;

function createMockDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    calls,
    orderRows: [] as any[],
    orderById: undefined as any,
    orderIds: [] as string[],
    count: 0,
    payments: [] as any[],
    groceryRows: [] as any[],
    groceryConflictRow: undefined as any,
    productLineRows: [] as any[],
    auditRows: [] as any[],
    auditCount: 0,
    lineRows: new Map<string, any[]>(),
    paymentRows: new Map<string, any[]>(),
    orderSummaryRows: new Map<string, any>(),
    prepare(sql: string) {
      return {
        all: (...params: unknown[]) => {
          calls.push({ sql, params });
          if (sql.includes("JOIN order_lines")) {
            return db.productLineRows;
          }
          if (sql.includes("FROM orders o") && /SELECT\s+o\.id/.test(sql)) {
            return db.orderIds.map((id) => ({ id }));
          }
          if (sql.includes("SELECT p.*")) {
            return db.payments;
          }
          if (sql.includes("FROM grocery_purchase_lines")) {
            return db.groceryRows;
          }
          if (sql.includes("FROM audit_logs")) {
            return db.auditRows;
          }
          if (sql.includes("FROM orders o") && !sql.includes("COUNT(*)")) {
            return db.orderRows;
          }
          if (sql.includes("FROM order_lines")) {
            return db.lineRows.get(String(params[0])) || [];
          }
          if (sql.includes("FROM payments WHERE order_id")) {
            return db.paymentRows.get(String(params[0])) || [];
          }
          return [];
        },
        get: (...params: unknown[]) => {
          calls.push({ sql, params });
          if (sql.includes("COUNT(*)") && sql.includes("FROM orders")) {
            return { count: db.count };
          }
          if (sql.includes("COUNT(*)") && sql.includes("FROM audit_logs")) {
            return { count: db.auditCount };
          }
          if (/SELECT\s+\*\s+FROM orders WHERE id = \?/.test(sql)) {
            return db.orderById;
          }
          if (sql.includes("SELECT subtotal_paise") && sql.includes("FROM orders WHERE id = ?")) {
            return db.orderSummaryRows.get(String(params[0]));
          }
          if (sql.includes("FROM grocery_purchase_lines")) {
            if (/WHERE id = \? AND active = 1/.test(sql)) {
              return db.groceryRows.find((row) => row.id === params[0] && row.active === 1);
            }
            if (/WHERE id = \?/.test(sql)) {
              return db.groceryRows.find((row) => row.id === params[0]);
            }
            return db.groceryConflictRow;
          }
          return undefined;
        },
        run: jest.fn((...params: unknown[]) => {
          calls.push({ sql, params });
          return { changes: 1 };
        }),
      };
    },
  };
  return db;
}

describe("posService strict SQLite APIs", () => {
  beforeEach(() => {
    mockDb = createMockDb();
    mockGetDb.mockReturnValue(mockDb);
  });

  it("lists paid orders with SQL filters, pagination, and stable ordering", () => {
    mockDb.orderRows = [
      {
        id: "order:2",
        order_type: "table",
        table_id: 4,
        status: "paid",
        kot_status: "printed",
        discount_percent: 0,
        subtotal_paise: 10000,
        tax_total_paise: 0,
        discount_total_paise: 0,
        total_paise: 10000,
        invoice_number: "INV-2",
        paid_at: 2000,
        meta_json: "{}",
        created_at: 1000,
        updated_at: 2000,
      },
    ];

    const result = posService.listPaidOrders({
      from: 1000,
      to: 3000,
      search: "upi",
      limit: 25,
      offset: 50,
    });

    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe("order:2");
    const orderQuery = mockDb.calls.find((call: any) => /SELECT\s+o\.\*/.test(call.sql));
    expect(orderQuery).toBeDefined();
    expect(orderQuery!.sql).toContain("o.status = 'paid'");
    expect(orderQuery!.sql).toContain("LIMIT ? OFFSET ?");
    expect(orderQuery!.params.slice(-2)).toEqual([25, 50]);
    expect(orderQuery!.params).toContain("%upi%");
  });

  it("counts and lists paid order ids without loading full order documents", () => {
    mockDb.count = 3;
    mockDb.orderIds = ["order:3", "order:2", "order:1"];

    expect(posService.countPaidOrders({ search: "table" })).toBe(3);
    expect(posService.listPaidOrderIds({ search: "table" })).toEqual([
      "order:3",
      "order:2",
      "order:1",
    ]);

    expect(mockDb.calls.some((call: any) => /SELECT\s+\*\s+FROM order_lines/.test(call.sql))).toBe(
      false,
    );
  });

  it("lists audit rows with server-side filters, pagination, and a capped page size", () => {
    mockDb.auditRows = [
      {
        id: "audit:1",
        action: "order.paid",
        entity_type: "order",
        entity_id: "order:1",
        user: "admin",
        detail_json: JSON.stringify({ total: 100 }),
        timestamp: 2000,
      },
    ];

    const result = posService.getAudits({
      from: 1000,
      to: 3000,
      search: "paid",
      limit: 500,
      offset: 25,
    });

    expect(result).toHaveLength(1);
    expect(result[0].orderId).toBe("order:1");
    const query = mockDb.calls.find((call: any) => /FROM audit_logs/.test(call.sql));
    expect(query!.sql).toContain("timestamp >= ?");
    expect(query!.sql).toContain("timestamp <= ?");
    expect(query!.sql).toContain("lower(action) LIKE ?");
    expect(query!.sql).toContain("LIMIT ? OFFSET ?");
    expect(query!.params).toEqual([
      1000,
      3000,
      "%paid%",
      "%paid%",
      "%paid%",
      "%paid%",
      "%paid%",
      100,
      25,
    ]);
  });

  it("counts audits with the same server-side filters used by the audit viewer", () => {
    mockDb.auditCount = 42;

    const result = posService.countAudits({ from: 1000, to: 3000, search: "admin" });

    expect(result).toBe(42);
    const query = mockDb.calls.find((call: any) => /COUNT\(\*\).*FROM audit_logs/.test(call.sql));
    expect(query!.sql).toContain("timestamp >= ?");
    expect(query!.sql).toContain("timestamp <= ?");
    expect(query!.sql).toContain("lower(COALESCE(user, '')) LIKE ?");
    expect(query!.params).toEqual([1000, 3000, "%admin%", "%admin%", "%admin%", "%admin%", "%admin%"]);
  });

  it("expands split payments into reporting method totals", () => {
    mockDb.payments = [
      {
        method: "split",
        amount_paise: 10000,
        split_json: JSON.stringify([
          { method: "upi", amount: 70 },
          { method: "card", amount: 30 },
        ]),
      },
      { method: "cash", amount_paise: 2500, split_json: null },
    ];

    expect(posService.getPaymentBreakdown({ from: 1, to: 2 })).toEqual({
      upi: 70,
      card: 30,
      cash: 25,
    });
  });

  it("aggregates product sales by stored category and item snapshots", () => {
    mockDb.payments = [
      { order_id: "order:1", method: "cash", amount_paise: 9000, split_json: null },
      { order_id: "order:2", method: "upi", amount_paise: 5000, split_json: null },
    ];
    mockDb.productLineRows = [
      {
        order_id: "order:1",
        total_paise: 9000,
        item_name: "Burger",
        category_name: "Mains",
        quantity: 2,
        rate_paise: 3000,
        line_total_paise: 6000,
      },
      {
        order_id: "order:1",
        total_paise: 9000,
        item_name: "Tea",
        category_name: "Beverages",
        quantity: 1,
        rate_paise: 4000,
        line_total_paise: 4000,
      },
      {
        order_id: "order:2",
        total_paise: 5000,
        item_name: "Burger",
        category_name: "Mains",
        quantity: 1,
        rate_paise: 5000,
        line_total_paise: 5000,
      },
    ];

    expect(posService.getProductSalesReport({ from: 1, to: 2 })).toEqual({
      categorySales: [
        { category: "Mains", sales: 104, units: 3 },
        { category: "Beverages", sales: 36, units: 1 },
      ],
      itemSales: [
        { itemName: "Burger", category: "Mains", sales: 104, units: 3 },
        { itemName: "Tea", category: "Beverages", sales: 36, units: 1 },
      ],
      totals: { totalSales: 140, totalUnits: 4 },
    });
  });

  it("uses Uncategorized for product sales lines without a category snapshot", () => {
    mockDb.payments = [
      { order_id: "order:1", method: "cash", amount_paise: 10000, split_json: null },
    ];
    mockDb.productLineRows = [
      {
        order_id: "order:1",
        total_paise: 10000,
        item_name: "Manual Item",
        category_name: "",
        quantity: 2,
        rate_paise: 5000,
        line_total_paise: 10000,
      },
    ];

    expect(posService.getProductSalesReport({ from: 1, to: 2 })).toEqual({
      categorySales: [{ category: "Uncategorized", sales: 100, units: 2 }],
      itemSales: [{ itemName: "Manual Item", category: "Uncategorized", sales: 100, units: 2 }],
      totals: { totalSales: 100, totalUnits: 2 },
    });
  });

  it("filters product sales through completed payments in the selected date range", () => {
    mockDb.payments = [
      { order_id: "order:1", method: "cash", amount_paise: 10000, split_json: null },
      { order_id: "order:1", method: "card", amount_paise: 10000, split_json: null },
    ];
    mockDb.productLineRows = [
      {
        order_id: "order:1",
        total_paise: 10000,
        item_name: "Pizza",
        category_name: "Mains",
        quantity: 1,
        rate_paise: 10000,
        line_total_paise: 10000,
      },
    ];

    const result = posService.getProductSalesReport({ from: 1000, to: 2000 });

    expect(result.totals).toEqual({ totalSales: 100, totalUnits: 1 });
    const paymentQuery = mockDb.calls.find((call: any) => /SELECT\s+p\.\*/.test(call.sql));
    expect(paymentQuery!.sql).toContain("p.status = 'completed'");
    expect(paymentQuery!.sql).toContain("p.received_at >= ?");
    expect(paymentQuery!.sql).toContain("p.received_at <= ?");
    expect(paymentQuery!.params).toEqual([1000, 2000]);
    const lineQuery = mockDb.calls.find((call: any) => call.sql.includes("JOIN order_lines"));
    expect(lineQuery!.params).toEqual(["order:1"]);
  });

  it("summarizes grocery spend against net sales for food cost reporting", () => {
    mockDb.payments = [
      { order_id: "order:1", method: "cash", amount_paise: 11800, split_json: null },
    ];
    mockDb.orderSummaryRows.set("order:1", {
      subtotal_paise: 10000,
      tax_total_paise: 1800,
      discount_total_paise: 0,
      total_paise: 11800,
    });
    mockDb.groceryRows = [
      {
        id: "grocery-purchase:1",
        list_id: null,
        grocery_item_id: "grocery-item:tomato",
        item_name: "Tomato",
        category: "Vegetables",
        quantity: 5,
        unit: "kg",
        unit_price_paise: 4000,
        total_paise: 20000,
        vendor: "Market A",
        payment_method: "cash",
        notes: null,
        purchased_at: 1500,
        created_by: "admin",
        active: 1,
        created_at: 1500,
        updated_at: 1500,
      },
    ];

    expect(posService.getFoodCostSummary({ from: 1000, to: 2000 })).toMatchObject({
      netSales: 100,
      grossSales: 118,
      grocerySpend: 200,
      estimatedGrossProfit: -100,
      foodCostPercent: 200,
      purchaseCount: 1,
      topItems: [{ itemName: "Tomato", category: "Vegetables", amount: 200, quantity: 5, unit: "kg" }],
      topVendors: [{ vendor: "Market A", amount: 200, purchaseCount: 1 }],
    });
    const groceryQuery = mockDb.calls.find((call: any) => call.sql.includes("FROM grocery_purchase_lines"));
    expect(groceryQuery!.sql).not.toContain("LIMIT");
    expect(groceryQuery!.params).toEqual([1000, 2000]);
  });

  it("filters grocery purchases by source buying list", () => {
    mockDb.groceryRows = [
      {
        id: "grocery-purchase:1",
        list_id: "grocery-list:today",
        grocery_item_id: "grocery-item:tomato",
        item_name: "Tomato",
        category: "Vegetables",
        quantity: 5,
        unit: "kg",
        unit_price_paise: 4000,
        total_paise: 20000,
        vendor: "Market A",
        payment_method: "cash",
        notes: null,
        purchased_at: 1500,
        created_by: "admin",
        active: 1,
        created_at: 1500,
        updated_at: 1500,
      },
    ];

    const result = posService.listGroceryPurchases({ listId: "grocery-list:today", limit: null });

    expect(result).toHaveLength(1);
    const groceryQuery = mockDb.calls.find((call: any) => call.sql.includes("FROM grocery_purchase_lines"));
    expect(groceryQuery!.sql).toContain("list_id = ?");
    expect(groceryQuery!.sql).not.toContain("LIMIT");
    expect(groceryQuery!.params).toEqual(["grocery-list:today"]);
  });

  it("blocks a whole-list grocery purchase when item-wise purchases already exist", () => {
    mockDb.groceryConflictRow = { id: "grocery-purchase:item" };

    expect(() =>
      posService.createGroceryPurchase({
        listId: "grocery-list:today",
        groceryItemId: null,
        itemName: "Buying List Total",
        category: "List Total",
        quantity: 1,
        unit: "unit",
        totalAmount: 500,
      }),
    ).toThrow("grocery-list-purchase-mode-conflict");

    expect(mockDb.calls.some((call: any) => call.sql.includes("INSERT INTO grocery_purchase_lines"))).toBe(false);
  });

  it("blocks an item-wise grocery purchase when a whole-list purchase already exists", () => {
    mockDb.groceryConflictRow = { id: "grocery-purchase:total" };

    expect(() =>
      posService.createGroceryPurchase({
        listId: "grocery-list:today",
        groceryItemId: "grocery-item:tomato",
        itemName: "Tomato",
        category: null,
        quantity: 2,
        unit: "kg",
        totalAmount: 120,
      }),
    ).toThrow("grocery-list-purchase-mode-conflict");

    expect(mockDb.calls.some((call: any) => call.sql.includes("INSERT INTO grocery_purchase_lines"))).toBe(false);
  });

  it("rejects zero quantity for grocery purchases instead of defaulting to one", () => {
    expect(() =>
      posService.createGroceryPurchase({
        listId: "grocery-list:today",
        groceryItemId: "grocery-item:tomato",
        itemName: "Tomato",
        quantity: 0,
        unit: "kg",
        totalAmount: 120,
      }),
    ).toThrow("grocery-quantity-invalid");
  });

  it("blocks normal line updates that reduce already-sent KOT quantity", () => {
    mockDb.orderById = {
      id: "order:1",
      order_type: "table",
      table_id: 3,
      status: "open",
      kot_status: "sent",
      discount_percent: 0,
      subtotal_paise: 16000,
      tax_total_paise: 0,
      discount_total_paise: 0,
      total_paise: 16000,
      invoice_number: null,
      paid_at: null,
      meta_json: "{}",
      created_at: 1000,
      updated_at: 1000,
    };
    mockDb.lineRows.set("order:1", [
      {
        id: "line:1",
        menu_item_id: null,
        item_name: "Dosa",
        quantity: 2,
        rate_paise: 8000,
        tax_rate_bps: 1800,
        kot_printed_qty: 2,
      },
    ]);

    expect(() => posService.updateOrderLines("order:1", [])).toThrow(
      "kot-sent-item-requires-void",
    );
    expect(mockDb.calls.some((call: any) => call.sql.includes("DELETE FROM order_lines"))).toBe(
      false,
    );
  });

  it("voids sent KOT quantity with a reason and adjusts the line", () => {
    mockDb.orderById = {
      id: "order:1",
      order_type: "table",
      table_id: 3,
      status: "open",
      kot_status: "sent",
      discount_percent: 0,
      subtotal_paise: 16000,
      tax_total_paise: 0,
      discount_total_paise: 0,
      total_paise: 16000,
      invoice_number: null,
      paid_at: null,
      meta_json: "{}",
      created_at: 1000,
      updated_at: 1000,
      created_by: "admin",
    };
    mockDb.lineRows.set("order:1", [
      {
        id: "line:1",
        menu_item_id: null,
        item_name: "Dosa",
        quantity: 2,
        rate_paise: 8000,
        tax_rate_bps: 1800,
        kot_printed_qty: 2,
      },
    ]);

    posService.voidKotLine(
      "order:1",
      { lineId: "line:1", finalQty: 1, reason: "Customer changed order" },
      "admin",
    );

    const insertLine = mockDb.calls.find((call: any) =>
      call.sql.includes("INSERT INTO order_lines"),
    );
    expect(insertLine?.params[5]).toBe(1);
    expect(insertLine?.params[9]).toBe(1);
    const audit = mockDb.calls.find((call: any) => call.sql.includes("INSERT INTO audit_logs"));
    expect(audit?.params[1]).toBe("order.kot.void");
    expect(String(audit?.params[5])).toContain("Customer changed order");
  });
});
