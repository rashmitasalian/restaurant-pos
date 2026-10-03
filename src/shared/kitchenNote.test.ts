import { lineHasUnsentQty, normalizeKitchenNote } from "./kitchenNote";
import { isCurrentService, startOfLocalDay } from "./serviceWindow";

describe("normalizeKitchenNote", () => {
  it("trims, collapses space, and drops empty notes", () => {
    expect(normalizeKitchenNote("  No   onion  ")).toBe("No onion");
    expect(normalizeKitchenNote("   ")).toBeNull();
    expect(normalizeKitchenNote(null)).toBeNull();
  });

  it("caps the note so a KOT line stays printable", () => {
    expect(normalizeKitchenNote("x".repeat(120))?.length).toBe(80);
  });
});

describe("lineHasUnsentQty", () => {
  it("is true only while quantity is still waiting for the kitchen", () => {
    expect(lineHasUnsentQty({ qty: 3, kotPrintedQty: 1 })).toBe(true);
    expect(lineHasUnsentQty({ qty: 2, kotPrintedQty: 2 })).toBe(false);
  });
});

describe("isCurrentService", () => {
  const now = new Date(2026, 9, 3, 15, 0, 0).getTime();

  it("keeps unsent work even when the table is from a previous day", () => {
    const yesterday = startOfLocalDay(now) - 60_000;
    expect(isCurrentService(yesterday, 2, now)).toBe(true);
  });

  it("hides a quiet older ticket from the default view", () => {
    const yesterday = startOfLocalDay(now) - 60_000;
    expect(isCurrentService(yesterday, 0, now)).toBe(false);
    expect(isCurrentService(startOfLocalDay(now) + 1000, 0, now)).toBe(true);
  });
});
