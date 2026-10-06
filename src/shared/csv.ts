/** Excel and other spreadsheets treat these as formulas when a cell starts with them. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function neutralizeSpreadsheetFormula(value: string) {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** Undo the leading apostrophe added for spreadsheet export, so a re-import keeps the original text. */
export function restoreSpreadsheetText(value: unknown) {
  const text = String(value ?? "");
  return text.startsWith("'") && FORMULA_PREFIX.test(text.slice(1)) ? text.slice(1) : text;
}

export function csvCell(value: unknown) {
  const safe = neutralizeSpreadsheetFormula(String(value ?? ""));
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
