import {
  buildKotLines,
  buildKotVoidLines,
  buildVoidKotItemPrintLines,
  resolveKotTableLabel,
} from "./kotTicket";

describe("resolveKotTableLabel", () => {
  it("prefers display label over internal table id", () => {
    expect(resolveKotTableLabel({ tableLabel: "F14", tableNum: 14 })).toBe("F14");
    expect(resolveKotTableLabel({ tableNum: 14 })).toBe("14");
    expect(resolveKotTableLabel({})).toBe("-");
  });
});

describe("buildKotLines", () => {
  it("prints the on-screen table label, not the raw id", () => {
    const lines = buildKotLines(
      {
        kotId: 12,
        orderType: "table",
        tableNum: 14,
        tableLabel: "F14",
        sentBy: "Administrator",
        items: [{ name: "Fries", qty: 1 }],
      },
      null,
      14,
      { hotelName: "Green Leaf Kitchen" },
    );
    expect(lines).toContain("LEFT:  Table No: F14");
    expect(lines.some((line) => line.includes("Table No: 14"))).toBe(false);
  });

  it("prints a line note under the unsent item", () => {
    const lines = buildKotLines(
      {
        kotId: 3,
        orderType: "table",
        tableLabel: "F4",
        items: [{ name: "Paneer Tikka", qty: 2, note: "No onion" }],
      },
      null,
      4,
      { hotelName: "Green Leaf Kitchen" },
    );
    const itemIndex = lines.findIndex((line) => line.includes("Paneer Tikka"));
    expect(itemIndex).toBeGreaterThan(-1);
    expect(lines[itemIndex + 1]).toContain("No onion");
  });
});

describe("buildKotVoidLines", () => {
  it("emits LEFTDHVOID so ESC/POS can raster-strikethrough the item", () => {
    const lines = buildKotVoidLines(
      {
        orderType: "table",
        tableNum: 8,
        tableLabel: "G8",
        reason: "Customer changed order",
        items: [{ name: "Pizza", qty: 1 }],
      },
      { hotelName: "Green Leaf Kitchen" },
    );

    expect(lines).toContain("LEFT:  Table No: G8");
    const voidLine = lines.find((line) => line.startsWith("LEFTDHVOID:"));
    expect(voidLine).toBeTruthy();
    expect(voidLine).toContain("Pizza");
    expect(lines.filter((line) => line.startsWith("LEFT:") && /-----/.test(line))).toHaveLength(0);
  });
});

describe("buildVoidKotItemPrintLines", () => {
  it("builds a single LEFTDHVOID directive", () => {
    const pad = "  ";
    const name = "Pizza".padEnd(32);
    const qty = "1".padStart(8);
    expect(buildVoidKotItemPrintLines(pad, name, qty)).toEqual([`LEFTDHVOID:${pad}${name}${qty}`]);
  });
});
