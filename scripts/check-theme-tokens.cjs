const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "src", "ui");

const ALLOWED_EXCEPTIONS = new Set([
  path.normalize("theme/tokens.css"),
  path.normalize("theme/external-brands.ts"),
  path.normalize("theme/print-html.ts"),
  path.normalize("utils/logoProcessing.ts"),
]);

const MIGRATED = new Set();
const STRICT_ALL = true;

const HEX = /#(?:[0-9a-fA-F]{3,8})\b/;
const LINEAR = /linear-gradient\s*\(/i;
const RADIAL = /radial-gradient\s*\(/i;
const BLACK_RGBA = /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/i;
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(css|tsx|ts|jsx|js)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

const files = walk(ROOT);
const failures = [];
const warnings = [];

for (const file of files) {
  const key = path.normalize(rel(file));
  if (ALLOWED_EXCEPTIONS.has(key) || ALLOWED_EXCEPTIONS.has(path.normalize(key))) {
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, index) => {
    if (line.trim().startsWith("//") || line.trim().startsWith("*") || line.includes("check-theme-tokens")) {
      return;
    }
    if (
      HEX.test(line) ||
      LINEAR.test(line) ||
      RADIAL.test(line) ||
      BLACK_RGBA.test(line) ||
      EMOJI.test(line)
    ) {
      hits.push(`${index + 1}: ${line.trim().slice(0, 160)}`);
    }
  });
  if (!hits.length) {
    continue;
  }
  const record = { file: rel(file), hits };
  const migrated = MIGRATED.has(key) || MIGRATED.has(rel(file)) || STRICT_ALL;
  if (migrated) {
    failures.push(record);
  } else {
    warnings.push(record);
  }
}

if (warnings.length) {
  const count = warnings.reduce((sum, item) => sum + item.hits.length, 0);
  console.warn(`[check-theme-tokens] ${count} warning(s) in ${warnings.length} unmigrated file(s)`);
}

if (failures.length) {
  for (const item of failures) {
    console.error(`\n[check-theme-tokens] ${item.file}`);
    for (const hit of item.hits) {
      console.error(`  ${hit}`);
    }
  }
  process.exit(1);
}

console.log("[check-theme-tokens] ok");
