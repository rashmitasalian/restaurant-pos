import {
  costVariance,
  formatCurrency,
  formatEstimatedAmount,
  formatVariance,
  groceryTabFromHash,
  statusLabel,
  suggestListName,
} from "./groceryUtils";

describe("groceryUtils", () => {
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
    expect(statusLabel("partial")).toBe("Partially Purchased");
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
});
