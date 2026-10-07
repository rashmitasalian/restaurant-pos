/** Device appearance preference. Not restaurant data and not stored in SQLite. */
export const APPEARANCE_STORAGE_KEY = "pos-appearance";

export const APPEARANCE_CHOICES = ["light", "dark", "system"] as const;

export type AppearanceChoice = (typeof APPEARANCE_CHOICES)[number];

export type ResolvedTheme = "light" | "dark";

/** Browser status-bar color. Matches `--pos-chrome` in tokens.css. */
export const THEME_CHROME: Record<ResolvedTheme, string> = {
  light: "#0f5e68",
  dark: "#12383d",
};

/** Must match --pos-bg in src/ui/theme/tokens.css for each theme. */
export const THEME_WINDOW_BACKGROUND: Record<ResolvedTheme, string> = {
  light: "#f9f8f6",
  dark: "#1c2124",
};

export function isAppearanceChoice(value: unknown): value is AppearanceChoice {
  return value === "light" || value === "dark" || value === "system";
}

export function parseAppearanceChoice(value: unknown): AppearanceChoice {
  return isAppearanceChoice(value) ? value : "light";
}

export function resolveAppearance(choice: AppearanceChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "dark") {
    return "dark";
  }
  if (choice === "system") {
    return prefersDark ? "dark" : "light";
  }
  return "light";
}
