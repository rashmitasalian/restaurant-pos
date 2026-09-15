import {
  addDaysToDateOnly,
  buildCreditSaleDescription,
  normalizeCreditConfig,
  resolveCreditDueDate,
} from "./customerCredit";

describe("customerCredit helpers", () => {
  it("normalizes credit config with clamped days", () => {
    expect(normalizeCreditConfig({ enabled: true, defaultCreditDays: 15 })).toEqual({
      enabled: true,
      defaultCreditDays: 15,
    });
    expect(normalizeCreditConfig({ enabled: 1 as any, defaultCreditDays: 999 })).toEqual({
      enabled: true,
      defaultCreditDays: 365,
    });
  });

  it("resolves due date from customer term before restaurant default", () => {
    expect(
      resolveCreditDueDate({
        saleDateOnly: "2026-09-01",
        customerDefaultDays: 7,
        restaurantDefaultDays: 15,
      }),
    ).toBe("2026-09-08");

    expect(
      resolveCreditDueDate({
        saleDateOnly: "2026-09-01",
        customerDefaultDays: null,
        restaurantDefaultDays: 30,
      }),
    ).toBe("2026-10-01");

    expect(
      resolveCreditDueDate({
        explicitDueDate: "2026-09-20",
        customerDefaultDays: 7,
        restaurantDefaultDays: 15,
        saleDateOnly: "2026-09-01",
      }),
    ).toBe("2026-09-20");
  });

  it("adds calendar days without timezone drift", () => {
    expect(addDaysToDateOnly("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToDateOnly("2026-09-12", 0)).toBe("2026-09-12");
  });

  it("builds a short credit sale description", () => {
    expect(buildCreditSaleDescription([{ name: "Coffee", qty: 1 }])).toBe("Coffee");
    expect(
      buildCreditSaleDescription([
        { name: "Coffee", qty: 1 },
        { name: "Idli", qty: 2 },
        { name: "Tea", qty: 1 },
        { name: "Vada", qty: 1 },
      ]),
    ).toBe("Coffee, Idli ×2, Tea +1 more");
  });
});
