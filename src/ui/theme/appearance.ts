import {
  APPEARANCE_STORAGE_KEY,
  parseAppearanceChoice,
  resolveAppearance,
  type AppearanceChoice,
  type ResolvedTheme,
} from "../../shared/appearance";

export { APPEARANCE_STORAGE_KEY, parseAppearanceChoice, resolveAppearance };
export type { AppearanceChoice, ResolvedTheme };

const APPEARANCE_LABELS: Record<AppearanceChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export const APPEARANCE_OPTIONS: { id: AppearanceChoice; label: string }[] = (
  ["light", "dark", "system"] as const
).map((id) => ({ id, label: APPEARANCE_LABELS[id] }));

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
}

export function readAppearanceChoice(): AppearanceChoice {
  try {
    return parseAppearanceChoice(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function applyAppearance(choice: AppearanceChoice): ResolvedTheme {
  const theme = resolveAppearance(choice, prefersDark());
  document.documentElement.setAttribute("data-theme", theme);
  const setBackground = window.pos?.appearance?.set;
  if (setBackground) {
    void setBackground(choice).catch(() => undefined);
  }
  return theme;
}

export function setAppearanceChoice(choice: AppearanceChoice): ResolvedTheme {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, choice);
  } catch {
    // Apply for this session even if the device preference cannot be stored.
  }
  return applyAppearance(choice);
}

let systemListenerStarted = false;

/** Follow the OS only while the saved choice is system. Safe to call more than once. */
export function bootAppearance(): void {
  applyAppearance(readAppearanceChoice());
  if (systemListenerStarted || typeof window.matchMedia !== "function") {
    return;
  }
  systemListenerStarted = true;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (readAppearanceChoice() === "system") {
      applyAppearance("system");
    }
  };
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
  } else {
    media.addListener(onChange);
  }
}
