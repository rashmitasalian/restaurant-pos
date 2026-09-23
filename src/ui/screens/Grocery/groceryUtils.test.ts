import {
  buyingListShareText,
  costVariance,
  formatCurrency,
  formatEstimatedAmount,
  formatVariance,
  groceryTabFromHash,
  listRegisterCopy,
  groceryUnitLabel,
  parseItemEntry,
  statusLabel,
  suggestListName,
} from "./groceryUtils";

describe("groceryUtils", () => {
  it("parses quantity and unit typed with an item name", () => {
    expect(parseItemEntry("10 L oil")).toEqual({ name: "oil", quantity: 10, unit: "L" });
    expect(parseItemEntry("250g jeera powder")).toEqual({
      name: "jeera powder",
      quantity: 250,
      unit: "g",
    });
    expect(parseItemEntry("Sunflower oil 5 ltr")).toEqual({
      name: "Sunflower oil",
      quantity: 5,
      unit: "L",
    });
    expect(parseItemEntry("eggs 2 dozen")).toEqual({ name: "eggs", quantity: 2, unit: "dozen" });
    expect(parseItemEntry("Tomato")).toEqual({ name: "Tomato" });
    expect(groceryUnitLabel("unit")).toBe("pcs");
    expect(groceryUnitLabel("kg")).toBe("kg");
    expect(parseItemEntry("7 up")).toEqual({ name: "7 up" });
  });

  it("maps legacy and new grocery hashes to tabs", () => {
    expect(groceryTabFromHash("#manager-grocery-lists")).toBe("lists");
    expect(groceryTabFromHash("#manager-grocery-purchases")).toBe("purchases");
    expect(groceryTabFromHash("#manager-grocery-vendors")).toBe("vendors");
    expect(groceryTabFromHash("#manager-grocery-items")).toBe("items");
    expect(groceryTabFromHash("#manager-grocery-templates")).toBe("items");
    expect(groceryTabFromHash("#manager-grocery-insights")).toBe("lists");
    expect(groceryTabFromHash("#manager-grocery-summary")).toBe("lists");
    expect(groceryTabFromHash("#manage-grocery-lists")).toBe("lists");
    expect(groceryTabFromHash("#manager-grocery")).toBe("lists");
  });

  it("labels buying list statuses for display", () => {
    expect(statusLabel("draft")).toBe("Draft");
    expect(statusLabel("open")).toBe("Open");
    expect(statusLabel("partial")).toBe("In progress");
    expect(statusLabel("completed")).toBe("Completed");
    expect(statusLabel("cancelled")).toBe("Cancelled");
  });

  it("formats currency in INR style", () => {
    expect(formatCurrency(1250.5)).toContain("1,250.5");
  });

  it("shows em dash for missing estimates instead of ₹0", () => {
    expect(formatEstimatedAmount(0, [])).toBe("₹—");
    expect(formatEstimatedAmount(0, [{ estimatedTotal: null }])).toBe("₹—");
    expect(formatEstimatedAmount(850, [{ estimatedTotal: 850 }])).toContain("850");
  });

  it("formats cost variance only when estimates exist", () => {
    expect(costVariance(850, 820, [{ estimatedTotal: 850 }])).toBe(-30);
    expect(formatVariance(-30)).toBe("−₹30");
    expect(costVariance(0, 60, [{ estimatedTotal: null }])).toBeNull();
    expect(formatVariance(null)).toBe("—");
  });

  it("writes owner-facing landing copy from service counts", () => {
    expect(
      listRegisterCopy({ status: "open", itemCount: 2, purchasedCount: 0, spentTotal: 0 }),
    ).toBe("2 items to buy");
    expect(
      listRegisterCopy({
        status: "partial",
        itemCount: 4,
        purchasedCount: 2,
        spentTotal: 1240,
      }),
    ).toBe("2 of 4 bought · 2 to buy");
    expect(
      listRegisterCopy({ status: "completed", itemCount: 3, purchasedCount: 3, spentTotal: 1320 }),
    ).toBe("All 3 items bought");
    expect(listRegisterCopy({ status: "draft", itemCount: 0 })).toBe("Empty — open to add items");
  });

  it("formats a shareable buying list", () => {
    expect(
      buyingListShareText(
        {
          title: "Evening Refill",
          listDate: Date.parse("2026-09-22T00:00:00"),
          lines: [
            { itemName: "Tomato", quantity: 2, unit: "kg" },
            { itemName: "Cabbage", quantity: 1, unit: "kg" },
          ],
        },
        "Green Leaf Kitchen",
      ),
    ).toContain("Green Leaf Kitchen");
  });
});
