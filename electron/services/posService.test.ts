jest.mock("../db/sqlite", () => ({
  backupDatabase: jest.fn(),
  getDb: jest.fn(),
  inTransaction: jest.fn((fn: any) => fn(mockDb)),
  restoreDatabaseFromBackup: jest.fn(),
}));

import { getDb } from "../db/sqlite";
import { hashClientOpRequest, posService } from "./posService";

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
    groceryPurchaseTotalPaise: 0,
    expenseBreakdownRows: [] as any[],
    productLineRows: [] as any[],
    auditRows: [] as any[],
    auditCount: 0,
    lineRows: new Map<string, any[]>(),
    clientOps: new Map<string, any>(),
    paymentRows: new Map<string, any[]>(),
    orderSummaryRows: new Map<string, any>(),
    prepare(sql: string) {
      return {
        all: (...params: unknown[]) => {
          calls.push({ sql, params });
          if (sql.includes("sales-facts-bills")) {
            return db.payments.map((payment: any) => {
              const summary = db.orderSummaryRows.get(String(payment.order_id)) || {};
              return {
                id: payment.order_id,
                created_at: payment.received_at || 1500,
                invoice_number: payment.order_id,
                subtotal_paise: summary.subtotal_paise ?? payment.amount_paise,
                tax_total_paise: summary.tax_total_paise ?? 0,
                discount_total_paise: summary.discount_total_paise ?? 0,
                total_paise: summary.total_paise ?? payment.amount_paise,
                order_type: "table",
                meta_json: "{}",
                customer_name: null,
                method: payment.method,
                amount_paise: payment.amount_paise,
                amount_paid_paise: payment.amount_paise,
                change_paise: 0,
                split_json: payment.split_json,
                received_at: payment.received_at || 1500,
              };
            });
          }
          if (sql.includes("FROM grocery_purchases") && sql.includes("status = 'recorded'")) {
            if (!db.groceryPurchaseTotalPaise) {
              return [];
            }
            return [
              {
                id: "grocery-purchase-hdr:mock",
                purchase_date: 1500,
                created_at: 1500,
                total_paise: db.groceryPurchaseTotalPaise,
                vendor_name: null,
              },
            ];
          }
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
          if (sql.includes("FROM expenses e") && sql.includes("JOIN expense_categories")) {
            return db.expenseBreakdownRows;
          }
          if (sql.includes("FROM audit_logs")) {
            if (sql.includes("action = 'order.discount.updated'")) {
              return db.auditRows.filter((row: any) => row.action === "order.discount.updated");
            }
            if (sql.includes("action = 'order.kot.void'")) {
              return db.auditRows.filter((row: any) => row.action === "order.kot.void");
            }
            if (sql.includes("action = 'order.kot.sent'")) {
              return db.auditRows.filter((row: any) => row.action === "order.kot.sent");
            }
            if (sql.includes("action = 'order.bill.printed'")) {
              return db.auditRows.filter((row: any) => row.action === "order.bill.printed");
            }
            return db.auditRows;
          }
          if (sql.includes("FROM orders o") && sql.includes("discount_percent > 0")) {
            return db.orderRows.filter((row: any) => Number(row.discount_percent || 0) > 0);
          }
          if (sql.includes("FROM orders o") && sql.includes("status = 'cancelled'")) {
            return db.orderRows.filter((row: any) => row.status === "cancelled");
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
          if (sql.includes("FROM grocery_purchases") && sql.includes("SUM(total_paise)")) {
            return { total_paise: db.groceryPurchaseTotalPaise };
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
          if (sql.includes("FROM client_ops")) {
            return db.clientOps.get(String(params[0]));
          }
          return undefined;
        },
        run: jest.fn((...params: unknown[]) => {
          calls.push({ sql, params });
          if (sql.includes("INSERT INTO client_ops")) {
            db.clientOps.set(String(params[0]), {
              id: params[0],
              username: params[1],
              action: params[2],
              entity_id: params[3],
              result_json: params[4],
              request_hash: params[5],
              created_at: params[6],
            });
          }
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
    expect(query!.sql).toContain("audit_logs_fts MATCH ?");
    expect(query!.sql).toContain("LIMIT ? OFFSET ?");
    expect(query!.params).toEqual([1000, 3000, '"paid"*', 100, 25]);
  });

  it("counts audits with the same server-side filters used by the audit viewer", () => {
    mockDb.auditCount = 42;

    const result = posService.countAudits({ from: 1000, to: 3000, search: "admin" });

    expect(result).toBe(42);
    const query = mockDb.calls.find((call: any) => /COUNT\(\*\).*FROM audit_logs/.test(call.sql));
    expect(query!.sql).toContain("timestamp >= ?");
    expect(query!.sql).toContain("timestamp <= ?");
    expect(query!.sql).toContain("audit_logs_fts MATCH ?");
    expect(query!.params).toEqual([1000, 3000, '"admin"*']);
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
    const lineQuery = mockDb.calls.find((call: any) => call.sql.includes("JOIN order_lines"));
    expect(lineQuery!.sql).toContain("SELECT DISTINCT p.order_id");
    expect(lineQuery!.sql).toContain("p.status = 'completed'");
    expect(lineQuery!.sql).toContain("p.received_at >= ?");
    expect(lineQuery!.sql).toContain("p.received_at < ?");
    expect(lineQuery!.params).toEqual([1000, 2000]);
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
      topItems: [
        { itemName: "Tomato", category: "Vegetables", amount: 200, quantity: 5, unit: "kg" },
      ],
      topVendors: [{ vendor: "Market A", amount: 200, purchaseCount: 1 }],
    });
    const groceryQuery = mockDb.calls.find((call: any) =>
      call.sql.includes("FROM grocery_purchase_lines"),
    );
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
    const groceryQuery = mockDb.calls.find((call: any) =>
      call.sql.includes("FROM grocery_purchase_lines"),
    );
    expect(groceryQuery!.sql).toContain("list_id = ?");
    expect(groceryQuery!.sql).not.toContain("LIMIT");
    expect(groceryQuery!.params).toEqual(["grocery-list:today"]);
  });

  it("allows mixing lump-sum and item grocery purchases on one list", () => {
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
    ).not.toThrow("grocery-list-purchase-mode-conflict");
  });

  it("does not block item grocery purchases after a lump-sum exists", () => {
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
    ).not.toThrow("grocery-list-purchase-mode-conflict");
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

  it("computes estimated operating profit from sales, purchases, and expenses without double-counting food cost", () => {
    mockDb.payments = [
      { order_id: "order:1", method: "cash", amount_paise: 118000, split_json: null },
    ];
    mockDb.orderSummaryRows.set("order:1", {
      subtotal_paise: 100000,
      tax_total_paise: 18000,
      discount_total_paise: 0,
      total_paise: 118000,
    });
    mockDb.groceryPurchaseTotalPaise = 25000;
    mockDb.expenseBreakdownRows = [
      { category_id: "expense-cat:rent", category_name: "Rent", amount_paise: 30000 },
      { category_id: "expense-cat:power", category_name: "Electricity", amount_paise: 10000 },
    ];

    const summary = posService.getProfitabilitySummary({ from: 1000, to: 2000 });

    expect(summary).toMatchObject({
      revenue: 1000,
      foodCost: {
        purchases: 250,
        amount: 250,
        basis: "purchases",
        openingInventory: null,
        closingInventory: null,
      },
      grossContribution: 750,
      operatingExpenses: 400,
      estimatedOperatingProfit: 350,
      operatingMarginPercent: 35,
      recordedPurchaseCostPercent: 25,
      staffCostRecorded: false,
      disclaimer:
        "Estimate based on recorded sales, purchases and expenses. Purchase cost is based on purchases recorded during the selected period and is not inventory-adjusted food consumption.",
    });
    expect(summary.expenseBreakdown).toEqual([
      {
        categoryId: "expense-cat:rent",
        categoryName: "Rent",
        amount: 300,
        percentOfRevenue: 30,
      },
      {
        categoryId: "expense-cat:power",
        categoryName: "Electricity",
        amount: 100,
        percentOfRevenue: 10,
      },
    ]);
    expect(summary.expenseBreakdown.some((row) => /grocery|food/i.test(row.categoryName))).toBe(
      false,
    );
    const purchaseQuery = mockDb.calls.find(
      (call: any) =>
        call.sql.includes("FROM grocery_purchases") && call.sql.includes("status = 'recorded'"),
    );
    expect(purchaseQuery!.sql).toContain("purchase_date >= ?");
    expect(purchaseQuery!.sql).toContain("purchase_date < ?");
    expect(purchaseQuery!.sql).not.toContain("purchase_date <= ?");
    expect(purchaseQuery!.params).toEqual([1000, 2000]);
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

    expect(() => posService.updateOrderLines("order:1", [])).toThrow("kot-sent-item-requires-void");
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

  it("hashes client-op requests independently of object key order", () => {
    expect(hashClientOpRequest({ orderId: "o1", qty: 1, name: "Tea" })).toBe(
      hashClientOpRequest({ name: "Tea", qty: 1, orderId: "o1" }),
    );
    expect(hashClientOpRequest({ orderId: "o1", qty: 1 })).not.toBe(
      hashClientOpRequest({ orderId: "o1", qty: 2 }),
    );
  });

  it("replays the same client op and rejects the same id with a different body", () => {
    const request = { orderId: "order:1", name: "Tea", qty: 1 };
    const first = posService.rememberClientOp({
      id: "op:add-1",
      username: "priya",
      action: "order.add-item",
      entityId: "order:1",
      request,
      result: { _id: "order:1", qty: 1 },
    });
    expect(first.replay).toBe(false);

    const replay = posService.rememberClientOp({
      id: "op:add-1",
      username: "priya",
      action: "order.add-item",
      entityId: "order:1",
      request,
      result: { _id: "order:1", qty: 99 },
    });
    expect(replay.replay).toBe(true);
    expect(replay.op.result).toEqual({ _id: "order:1", qty: 1 });

    expect(() =>
      posService.rememberClientOp({
        id: "op:add-1",
        username: "priya",
        action: "order.add-item",
        entityId: "order:1",
        request: { ...request, qty: 2 },
        result: { _id: "order:1", qty: 2 },
      }),
    ).toThrow("client-op-conflict");
  });

  it("replays a legacy client op that has no stored request hash", () => {
    mockDb.clientOps.set("op:legacy", {
      id: "op:legacy",
      username: "priya",
      action: "order.send-kot",
      entity_id: "order:1",
      result_json: JSON.stringify({ ok: true }),
      request_hash: null,
      created_at: 1,
    });
    expect(() =>
      posService.assertClientOpRequest({ requestHash: null }, { orderId: "order:other" }),
    ).not.toThrow();
    const replay = posService.rememberClientOp({
      id: "op:legacy",
      username: "priya",
      action: "order.send-kot",
      entityId: "order:1",
      request: { orderId: "order:1" },
      result: { ok: false },
    });
    expect(replay.replay).toBe(true);
    expect(replay.op.result).toEqual({ ok: true });
  });

  it("requires a reason and records cancellation actor, time, and KOT state", () => {
    mockDb.orderById = {
      id: "order:1",
      order_type: "table",
      table_id: 7,
      status: "open",
      kot_status: "sent",
      discount_percent: 0,
      subtotal_paise: 185000,
      tax_total_paise: 0,
      discount_total_paise: 0,
      total_paise: 185000,
      invoice_number: null,
      paid_at: null,
      meta_json: JSON.stringify({ orderSeq: 1042 }),
      created_at: 1000,
      updated_at: 1000,
      created_by: "rahul",
    };
    mockDb.lineRows.set("order:1", [
      {
        id: "line:1",
        item_name: "Paneer Tikka",
        quantity: 1,
        rate_paise: 185000,
        tax_rate_bps: 1800,
        kot_printed_qty: 1,
      },
    ]);

    expect(() => posService.cancelOrder("order:1", "rahul", "")).toThrow("cancel-reason-required");

    posService.cancelOrder("order:1", "rahul", "Customer changed mind");
    const update = mockDb.calls.find((call: any) => call.sql.includes("SET status = 'cancelled'"));
    expect(update?.params[1]).toBe("rahul");
    expect(update?.params[2]).toBe("Customer changed mind");
    const audit = mockDb.calls.find((call: any) => call.sql.includes("INSERT INTO audit_logs"));
    expect(audit?.params[1]).toBe("order.cancelled");
    expect(String(audit?.params[5])).toContain("Customer changed mind");
    expect(String(audit?.params[5])).toContain('"kotSent":true');
  });

  it("rejects cancelling a paid order", () => {
    mockDb.orderById = {
      id: "order:1",
      order_type: "table",
      table_id: 7,
      status: "paid",
      kot_status: "printed",
      discount_percent: 0,
      subtotal_paise: 10000,
      tax_total_paise: 0,
      discount_total_paise: 0,
      total_paise: 10000,
      invoice_number: "INV-1",
      paid_at: 2000,
      meta_json: "{}",
      created_at: 1000,
      updated_at: 2000,
      created_by: "rahul",
    };
    expect(() => posService.cancelOrder("order:1", "rahul", "Customer changed mind")).toThrow(
      "order-closed",
    );
  });

  it("refuses to hard-delete cancelled orders", () => {
    mockDb.orderById = {
      id: "order:1",
      order_type: "table",
      table_id: 7,
      status: "cancelled",
      kot_status: "sent",
      discount_percent: 0,
      subtotal_paise: 10000,
      tax_total_paise: 0,
      discount_total_paise: 0,
      total_paise: 10000,
      invoice_number: null,
      paid_at: null,
      meta_json: "{}",
      created_at: 1000,
      updated_at: 2000,
      created_by: "rahul",
    };
    expect(() => posService.deleteClosedOrders(["order:1"], "admin")).toThrow(
      "cannot-delete-cancelled-order",
    );
    expect(mockDb.calls.some((call: any) => call.sql.includes("DELETE FROM orders"))).toBe(false);
  });

  it("stores previous and new discount percents on discount audits", () => {
    mockDb.orderById = {
      id: "order:1",
      order_type: "table",
      table_id: 3,
      status: "open",
      kot_status: "pending",
      discount_percent: 10,
      subtotal_paise: 10000,
      tax_total_paise: 0,
      discount_total_paise: 1000,
      total_paise: 9000,
      invoice_number: null,
      paid_at: null,
      meta_json: "{}",
      created_at: 1000,
      updated_at: 1000,
      created_by: "rahul",
    };
    mockDb.lineRows.set("order:1", [
      {
        id: "line:1",
        item_name: "Tea",
        quantity: 1,
        rate_paise: 10000,
        tax_rate_bps: 0,
        kot_printed_qty: 0,
      },
    ]);
    mockDb.orderSummaryRows.set("order:1", {
      subtotal_paise: 10000,
      tax_total_paise: 0,
      discount_total_paise: 2500,
      total_paise: 7500,
    });

    posService.setOrderDiscount("order:1", 25, "rahul");
    const audit = mockDb.calls.find((call: any) => call.sql.includes("INSERT INTO audit_logs"));
    expect(audit?.params[1]).toBe("order.discount.updated");
    expect(String(audit?.params[5])).toContain('"previousDiscountPercent":10');
    expect(String(audit?.params[5])).toContain('"discountPercent":25');
  });

  it("keeps cancelled-after-KOT orders in Needs Review", () => {
    mockDb.orderRows = [
      {
        id: "order:1",
        order_type: "table",
        table_id: 7,
        status: "cancelled",
        kot_status: "sent",
        discount_percent: 0,
        subtotal_paise: 185000,
        tax_total_paise: 0,
        discount_total_paise: 0,
        total_paise: 185000,
        invoice_number: null,
        paid_at: null,
        cancelled_at: 3000,
        cancelled_by: "rahul",
        cancellation_reason: "Customer changed mind",
        meta_json: JSON.stringify({ orderSeq: 1042 }),
        created_at: 1000,
        updated_at: 3000,
        created_by: "rahul",
      },
    ];
    mockDb.lineRows.set("order:1", [
      {
        id: "line:1",
        item_name: "Paneer Tikka",
        quantity: 1,
        rate_paise: 185000,
        tax_rate_bps: 1800,
        kot_printed_qty: 1,
      },
    ]);

    const items = posService.listReviewItems({ from: 500, to: 4000 });
    expect(items.some((item) => item.rule === "cancellation_after_kot")).toBe(true);
    expect(items.find((item) => item.rule === "cancellation_after_kot")?.orderId).toBe("order:1");
  });

  it("does not put unsent single cancellations in Needs Review", () => {
    mockDb.orderRows = [
      {
        id: "order:2",
        order_type: "takeaway",
        table_id: null,
        status: "cancelled",
        kot_status: "pending",
        discount_percent: 0,
        subtotal_paise: 5000,
        tax_total_paise: 0,
        discount_total_paise: 0,
        total_paise: 5000,
        invoice_number: null,
        paid_at: null,
        cancelled_at: 3000,
        cancelled_by: "priya",
        cancellation_reason: "Wrong item",
        meta_json: "{}",
        created_at: 1000,
        updated_at: 3000,
        created_by: "priya",
      },
    ];
    mockDb.lineRows.set("order:2", [
      {
        id: "line:2",
        item_name: "Tea",
        quantity: 1,
        rate_paise: 5000,
        tax_rate_bps: 0,
        kot_printed_qty: 0,
      },
    ]);

    expect(posService.listReviewItems({ from: 500, to: 4000 })).toEqual([]);
  });

  it("surfaces discounted orders in Needs Review even without discount audits", () => {
    mockDb.orderRows = [
      {
        id: "order:disc",
        order_type: "table",
        table_id: 2,
        status: "paid",
        kot_status: "printed",
        discount_percent: 50,
        subtotal_paise: 19000,
        tax_total_paise: 0,
        discount_total_paise: 9500,
        total_paise: 9500,
        invoice_number: "INV-9",
        paid_at: 2000,
        cancelled_at: null,
        cancelled_by: null,
        cancellation_reason: null,
        meta_json: JSON.stringify({ orderSeq: 9 }),
        created_at: 1000,
        updated_at: 2000,
        created_by: "admin",
      },
    ];
    mockDb.orderById = mockDb.orderRows[0];
    mockDb.lineRows.set("order:disc", [
      {
        id: "line:1",
        item_name: "Tea",
        quantity: 1,
        rate_paise: 19000,
        tax_rate_bps: 0,
        kot_printed_qty: 1,
      },
    ]);
    mockDb.auditRows = [];

    const items = posService.listReviewItems({ from: 500, to: 4000 });
    expect(items.some((item) => item.rule === "discount_applied")).toBe(true);
    expect(items.find((item) => item.rule === "discount_applied")?.discountPercent).toBe(50);
    expect(posService.getStaffActivity({ from: 500, to: 4000 })[0]?.discounts).toBe(1);
  });

  it("does not prune order-lifecycle audit events", () => {
    posService.pruneAuditLogs();
    const prune = mockDb.calls.find((call: any) => call.sql.includes("DELETE FROM audit_logs"));
    expect(prune).toBeDefined();
    expect(prune!.sql).toContain("action NOT IN");
    expect(prune!.params).toContain("order.cancelled");
    expect(prune!.params).toContain("order.kot.void");
    expect(prune!.params).toContain("order.bill.printed");
  });
});
