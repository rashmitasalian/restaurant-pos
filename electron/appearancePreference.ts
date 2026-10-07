import fs from "fs";
import path from "path";
import { app, nativeTheme } from "electron";
import {
  isAppearanceChoice,
  parseAppearanceChoice,
  resolveAppearance,
  THEME_WINDOW_BACKGROUND,
  type AppearanceChoice,
  type ResolvedTheme,
} from "../src/shared/appearance";

export { THEME_WINDOW_BACKGROUND };
export type { AppearanceChoice, ResolvedTheme };

function preferencePath(): string {
  return path.join(app.getPath("userData"), "appearance.json");
}

export function readAppearanceChoice(): AppearanceChoice {
  try {
    const raw = JSON.parse(fs.readFileSync(preferencePath(), "utf8")) as { choice?: unknown };
    return parseAppearanceChoice(raw?.choice);
  } catch {
    return "light";
  }
}

export function writeAppearanceChoice(choice: AppearanceChoice): void {
  const file = preferencePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ choice })}\n`, "utf8");
}

export function resolvedTheme(): ResolvedTheme {
  return resolveAppearance(readAppearanceChoice(), nativeTheme.shouldUseDarkColors);
}

export function currentWindowBackground(): string {
  return THEME_WINDOW_BACKGROUND[resolvedTheme()];
}

export function acceptAppearanceChoice(value: unknown): AppearanceChoice | null {
  return isAppearanceChoice(value) ? value : null;
}
