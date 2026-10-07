import {
  parseAppearanceChoice,
  resolveAppearance,
  THEME_CHROME,
  THEME_WINDOW_BACKGROUND,
} from "./appearance";

describe("appearance preference", () => {
  test("unknown values fall back to light", () => {
    expect(parseAppearanceChoice(null)).toBe("light");
    expect(parseAppearanceChoice("")).toBe("light");
    expect(parseAppearanceChoice("dim")).toBe("light");
  });

  test("light and dark are explicit", () => {
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });

  test("system follows the OS preference only", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
  });

  test("window background colors match the theme surfaces", () => {
    expect(THEME_WINDOW_BACKGROUND.light).toBe("#f9f8f6");
    expect(THEME_WINDOW_BACKGROUND.dark).toBe("#1c2124");
  });

  test("status bar colors match the theme chrome", () => {
    expect(THEME_CHROME.light).toBe("#0f5e68");
    expect(THEME_CHROME.dark).toBe("#12383d");
  });
});
