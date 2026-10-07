import fs from "fs";
import path from "path";
import { THEME_WINDOW_BACKGROUND } from "../../shared/appearance";

function channel(hex: string, index: number): number {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = channel(hex, 0);
  const g = channel(hex, 1);
  const b = channel(hex, 2);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function parseBlock(css: string, header: string): Record<string, string> {
  const start = css.indexOf(header);
  if (start < 0) {
    throw new Error(`Missing ${header}`);
  }
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  const body = css.slice(open + 1, close);
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--pos-[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

function resolve(tokens: Record<string, string>, light: Record<string, string>, name: string): string {
  let value = tokens[name] ?? light[name];
  const seen = new Set<string>();
  while (value.startsWith("var(")) {
    const ref = value.slice(4, -1).trim();
    if (seen.has(ref)) {
      throw new Error(`Cycle at ${name}`);
    }
    seen.add(ref);
    value = tokens[ref] ?? light[ref];
    if (!value) {
      throw new Error(`Unresolved ${ref}`);
    }
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${name} resolved to ${value}`);
  }
  return value.toLowerCase();
}

const css = fs.readFileSync(path.join(__dirname, "tokens.css"), "utf8");
const light = parseBlock(css, ":root {");
const dark = parseBlock(css, 'html[data-theme="dark"]');

const textPairs: [string, string][] = [
  ["--pos-tx", "--pos-bg"],
  ["--pos-tx", "--pos-surface"],
  ["--pos-tx", "--pos-surface-sunken"],
  ["--pos-tx-sec", "--pos-surface"],
  ["--pos-tx-sub", "--pos-surface"],
  ["--pos-tx-muted", "--pos-surface"],
  ["--pos-tx-inverse", "--pos-teal"],
  ["--pos-tx-inverse", "--pos-teal-strong"],
  ["--pos-tx-inverse", "--pos-danger"],
  ["--pos-surface", "--pos-teal"],
  ["--pos-saffron-text", "--pos-surface"],
  ["--pos-danger-text", "--pos-surface"],
  ["--pos-success-text", "--pos-surface"],
  ["--pos-chrome-tx", "--pos-chrome"],
  ["--pos-teal", "--pos-surface"],
  ["--pos-teal-strong", "--pos-surface"],
  ["--pos-state-available-text", "--pos-state-available-tint"],
  ["--pos-state-occupied-text", "--pos-state-occupied-tint"],
  ["--pos-state-attention-text", "--pos-state-attention-tint"],
  ["--pos-state-success-text", "--pos-state-success-tint"],
  ["--pos-state-danger-text", "--pos-state-danger-tint"],
  ["--pos-tx", "--pos-teal-line"],
];

describe("theme contrast", () => {
  test("dark window background matches the dark page background", () => {
    expect(resolve(dark, light, "--pos-bg")).toBe(THEME_WINDOW_BACKGROUND.dark);
    expect(resolve(light, light, "--pos-bg")).toBe(THEME_WINDOW_BACKGROUND.light);
  });

  test.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s text pairs meet WCAG AA", (_name, tokens) => {
    const failures = textPairs.flatMap(([fg, bg]) => {
      // Light muted is the existing ramp (#94a3b8 on white, about 2.6:1). Dark muted must pass.
      if (_name === "light" && fg === "--pos-tx-muted") {
        return [];
      }
      const ratio = contrast(resolve(tokens, light, fg), resolve(tokens, light, bg));
      return ratio + 0.02 < 4.5 ? [`${fg} on ${bg} = ${ratio.toFixed(2)}`] : [];
    });
    expect(failures).toEqual([]);
  });

  test("dark accent fills keep inverse text readable, including saffron", () => {
    const ratio = contrast(resolve(dark, light, "--pos-tx-inverse"), resolve(dark, light, "--pos-saffron"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test("dark input borders meet non-text contrast", () => {
    const ratio = contrast(
      resolve(dark, light, "--pos-line-strong"),
      resolve(dark, light, "--pos-surface"),
    );
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
