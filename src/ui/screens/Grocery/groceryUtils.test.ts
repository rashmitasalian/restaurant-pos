import {
  formatCurrency,
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

  it("suggests a session name by time of day", () => {
    const morning = suggestListName(new Date(2026, 7, 26, 9, 0, 0));
    const afternoon = suggestListName(new Date(2026, 7, 26, 14, 0, 0));
    const evening = suggestListName(new Date(2026, 7, 26, 19, 0, 0));
    expect(morning).toBe("Morning Procurement");
    expect(afternoon).toBe("Afternoon Refill");
    expect(evening).toBe("Evening Refill");
  });
});
