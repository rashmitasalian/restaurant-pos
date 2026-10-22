import {
  buildKitchenUpdateLines,
  buildKotLines,
  buildKotVoidLines,
  buildTableTransferLines,
  buildVoidKotItemPrintLines,
  PRACTICE_DOCUMENT_BANNER,
  resolveKotTableLabel,
  rewriteKotTableHeader,
} from "./kotTicket";

describe("resolveKotTableLabel", () => {
  it("prefers display label over internal table id", () => {
    expect(resolveKotTableLabel({ tableLabel: "F14", tableNum: 14 })).toBe("F14");
    expect(resolveKotTableLabel({ tableNum: 14 })).toBe("14");
    expect(resolveKotTableLabel({})).toBe("-");
  });
});

describe("buildKotLines", () => {
  it("marks a practice KOT on the original ticket and a void reprint", () => {
    const lines = buildKotLines(
      {
        kotId: 1,
        orderType: "table",
        tableLabel: "F1",
        practice: true,
        items: [{ name: "Tea", qty: 1 }],
      },
      null,
      1,
      { hotelName: "Green Leaf Kitchen" },
    );
    const voids = buildKotVoidLines(
      {
        orderType: "table",
        tableLabel: "F1",
        practice: true,
        items: [{ name: "Tea", qty: 1 }],
      },
      { hotelName: "Green Leaf Kitchen" },
    );
    expect(lines).toContain(`CENTER:${PRACTICE_DOCUMENT_BANNER}`);
    expect(voids).toContain(`CENTER:${PRACTICE_DOCUMENT_BANNER}`);
  });

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

  it("wraps a long item name in the item column and keeps qty on the first line", () => {
    const name = "Tandoori Chicken Dum Biryani with Raita";
    const lines = buildKotLines(
      {
        kotId: 4,
        orderType: "table",
        tableLabel: "F1",
        items: [{ name, qty: 2, note: "Less spicy" }],
      },
      null,
      1,
      { hotelName: "Green Leaf Kitchen" },
    );

    const itemLines = lines.filter((line) => line.startsWith("LEFTDH:"));
    expect(itemLines).toHaveLength(2);
    const first = itemLines[0].slice("LEFTDH:".length);
    const second = itemLines[1].slice("LEFTDH:".length);
    expect(first).toHaveLength(42);
    expect(second).toHaveLength(42);
    expect(first.startsWith("  Tandoori Chicken Dum Biryani")).toBe(true);
    expect(first.endsWith("2")).toBe(true);
    expect(first.slice(34)).toBe("       2");
    expect(second.slice(34)).toBe("        ");
    expect(`${first.slice(2, 34).trimEnd()} ${second.slice(2, 34).trimEnd()}`).toBe(name);
    expect(lines[lines.indexOf(itemLines[1]) + 1]).toContain("Less spicy");
    expect(lines).toContain(`LEFT:  ${"Item".padEnd(32, " ")}${"Qty".padStart(8, " ")}`);
  });

  it("prints cancellations and new items on one modified ticket", () => {
    const lines = buildKitchenUpdateLines(
      {
        kotId: 9,
        orderType: "table",
        tableLabel: "F2",
        items: [{ name: "Masala Dosa (Full)", qty: 1 }],
        voidItems: [
          { name: "Masala Dosa (Half)", qty: 1, note: "Variant changed" },
          { name: "Filter Coffee", qty: 1 },
        ],
        reason: "Guest changed order",
      },
      null,
      2,
      { hotelName: "Green Leaf Kitchen" },
    );
    expect(lines).toContain("LEFTDH:  STOP");
    expect(lines).toContain("LEFTDH:  MAKE");
    expect(lines.some((line) => line.includes("MODIFIED") || line.includes("CANCEL"))).toBe(false);
    expect(lines.some((line) => line.includes("Variant changed"))).toBe(false);
    expect(lines.filter((line) => line === "CUT")).toHaveLength(1);
    const half = lines.find((line) => line.includes("Masala Dosa (Half)"));
    const coffee = lines.find((line) => line.includes("Filter Coffee"));
    const full = lines.find((line) => line.includes("Masala Dosa (Full)"));
    expect(half?.startsWith("LEFTDH:  Masala Dosa (Half)")).toBe(true);
    expect(half?.endsWith("1")).toBe(true);
    expect(coffee?.startsWith("LEFTDH:  Filter Coffee")).toBe(true);
    expect(coffee?.endsWith("1")).toBe(true);
    expect(full?.startsWith("LEFTDH:  Masala Dosa (Full)")).toBe(true);
    expect(full?.endsWith("1")).toBe(true);
    expect(lines.filter((line) => line.startsWith("LEFT:  Item"))).toHaveLength(1);
    expect(lines[lines.indexOf(half!) - 1]).toBe("SEP");
    expect(lines[lines.indexOf(half!) - 2]).toBe("LEFTDH:  STOP");
    expect(lines.indexOf(half!)).toBeLessThan(lines.indexOf(coffee!));
    expect(lines[lines.indexOf(full!) - 1]).toBe("SEP");
    expect(lines[lines.indexOf(full!) - 2]).toBe("LEFTDH:  MAKE");
  });

  it("wraps a long kitchen note onto the next line", () => {
    const lines = buildKotLines(
      {
        kotId: 5,
        orderType: "table",
        tableLabel: "F1",
        items: [
          {
            name: "Dosa",
            qty: 1,
            note: "No onion and no garlic, extra ghee, serve the chutney on the side",
          },
        ],
      },
      null,
      1,
      { hotelName: "Green Leaf Kitchen" },
    );
    const notes = lines.filter((line) => line.startsWith("LEFT:    "));
    expect(notes.length).toBeGreaterThan(1);
    expect(notes.every((line) => line.slice("LEFT:".length).length <= 42)).toBe(true);
    expect(notes.map((line) => line.slice("LEFT:    ".length).trimEnd()).join(" ")).toBe(
      "No onion and no garlic, extra ghee, serve the chutney on the side",
    );
  });
});

describe("buildKotVoidLines", () => {
  it("prints a stop list with the number before the dish", () => {
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

    expect(lines).toContain("LEFTDH:  STOP");
    expect(lines).toContain("LEFT:  Table No: G8");
    expect(lines.some((line) => line.includes("Customer changed order"))).toBe(false);
    const voidLine = lines.find((line) => line.includes("Pizza"));
    expect(voidLine?.slice("LEFTDH:".length)).toBe(`${"  Pizza".padEnd(34, " ")}${"1".padStart(8, " ")}`);
    expect(lines.indexOf("LEFT:  Table No: G8")).toBeLessThan(lines.indexOf("LEFTDH:  STOP"));
    expect(lines[lines.indexOf(voidLine!) - 1]).toBe("SEP");
    expect(lines[lines.indexOf(voidLine!) - 2]).toBe("LEFTDH:  STOP");
  });

  it("wraps a long stopped name under the number", () => {
    const name = "Tandoori Chicken Dum Biryani with Raita";
    const lines = buildKotVoidLines(
      {
        orderType: "table",
        tableLabel: "G8",
        items: [{ name, qty: 3 }],
      },
      { hotelName: "Green Leaf Kitchen" },
    );
    const itemLines = lines.filter(
      (line) => line.startsWith("LEFTDH:") && !line.endsWith("STOP") && !line.endsWith("MAKE"),
    );
    expect(itemLines).toHaveLength(2);
    const first = itemLines[0].slice("LEFTDH:".length);
    const second = itemLines[1].slice("LEFTDH:".length);
    expect(first).toHaveLength(42);
    expect(second).toHaveLength(42);
    expect(first.startsWith("  Tandoori Chicken Dum Biryani")).toBe(true);
    expect(first.slice(34)).toBe("       3");
    expect(second.slice(34)).toBe("        ");
    expect(`${first.slice(2, 34).trimEnd()} ${second.slice(2, 34).trimEnd()}`).toBe(name);
  });
});

describe("table transfer ticket", () => {
  it("names the move and does not include dish rows", () => {
    const lines = buildTableTransferLines({
      hotelName: "Green Leaf Kitchen",
      orderNumber: 18,
      fromLabel: "4",
      toLabel: "9",
      at: new Date("2026-10-15T12:30:00"),
      auditId: "audit:1",
    });
    expect(lines.join("\n")).toContain("Order #18");
    expect(lines.join("\n")).toContain("From: 4");
    expect(lines.join("\n")).toContain("To: 9");
    expect(lines.join("\n")).toContain("Ref: audit:1");
    expect(lines.join("\n")).toContain("No new food — redirect existing order");
    expect(lines.join("\n")).not.toContain("Tea");
    expect(rewriteKotTableHeader(["LEFT:  Table No: 4", "LEFT:  1 x Tea"], "9")).toEqual([
      "LEFT:  Table No: 9",
      "LEFT:  1 x Tea",
    ]);
  });
});

describe("buildVoidKotItemPrintLines", () => {
  it("builds a stop line with the number first", () => {
    const [line] = buildVoidKotItemPrintLines("  ", "Pizza", "1");
    const body = line.slice("LEFTDH:".length);
    expect(body).toHaveLength(42);
    expect(body.startsWith("  Pizza")).toBe(true);
    expect(body.slice(34)).toBe("       1");
  });
});
