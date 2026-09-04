export type TableNamingMode = "number" | "prefix";

export type AreaTablePlan = {
  id: string;
  name: string;
  active?: boolean;
  order?: number;
  tableCount: number;
  namingMode: TableNamingMode;
  prefix: string;
  defaultSeats: number;
};

export type PlannedTable = {
  name: string;
  areaId: string;
  seats: number;
  sortOrder: number;
};

const MAX_TOTAL_TABLES = 200;
const MAX_AREA_TABLES = 100;
const MAX_SEATS = 50;

export function normalizeTablePrefix(raw: string) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

export function buildAreaTableName(
  indexWithinArea: number,
  namingMode: TableNamingMode,
  prefix: string,
) {
  const n = Math.max(1, Math.trunc(Number(indexWithinArea) || 1));
  if (namingMode === "prefix") {
    const clean = normalizeTablePrefix(prefix) || "T";
    return `${clean}${n}`;
  }
  return String(n);
}

export function planTablesFromAreas(areas: AreaTablePlan[]): {
  tables: PlannedTable[];
  total: number;
  error?: string;
} {
  const active = (areas || [])
    .filter((area) => area.active !== false)
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  if (!active.length) {
    return { tables: [], total: 0, error: "Keep at least one active area" };
  }

  const tables: PlannedTable[] = [];
  let sortOrder = 0;
  for (const area of active) {
    const count = Math.trunc(Number(area.tableCount) || 0);
    if (count < 0 || count > MAX_AREA_TABLES) {
      return {
        tables: [],
        total: 0,
        error: `Each area can have 0–${MAX_AREA_TABLES} tables`,
      };
    }
    const seats = Math.trunc(Number(area.defaultSeats) || 4);
    if (seats < 1 || seats > MAX_SEATS) {
      return {
        tables: [],
        total: 0,
        error: `Seats must be between 1 and ${MAX_SEATS}`,
      };
    }
    if (area.namingMode === "prefix" && count > 0 && !normalizeTablePrefix(area.prefix)) {
      return {
        tables: [],
        total: 0,
        error: `Add a prefix for ${area.name || "area"} (e.g. G, GF, B)`,
      };
    }
    for (let i = 1; i <= count; i += 1) {
      sortOrder += 1;
      tables.push({
        name: buildAreaTableName(i, area.namingMode || "number", area.prefix || ""),
        areaId: area.id,
        seats,
        sortOrder,
      });
    }
  }

  if (tables.length > MAX_TOTAL_TABLES) {
    return {
      tables: [],
      total: tables.length,
      error: `Total tables cannot exceed ${MAX_TOTAL_TABLES}`,
    };
  }

  return { tables, total: tables.length };
}

export function inferNamingFromTables(
  names: string[],
): { namingMode: TableNamingMode; prefix: string } {
  const cleaned = (names || []).map((name) => String(name || "").trim()).filter(Boolean);
  if (!cleaned.length) {
    return { namingMode: "number", prefix: "" };
  }
  const allNumeric = cleaned.every((name) => /^\d+$/.test(name));
  if (allNumeric) {
    return { namingMode: "number", prefix: "" };
  }
  const prefixMatch = cleaned
    .map((name) => {
      const match = /^([A-Za-z]{1,6})\d+$/.exec(name);
      return match ? match[1].toUpperCase() : null;
    })
    .filter(Boolean) as string[];
  if (prefixMatch.length === cleaned.length && new Set(prefixMatch).size === 1) {
    return { namingMode: "prefix", prefix: prefixMatch[0] };
  }
  return { namingMode: "number", prefix: "" };
}

export function suggestPrefixFromAreaName(name: string) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) {
    return "";
  }
  if (words.length === 1) {
    return normalizeTablePrefix(words[0][0] || "");
  }
  return normalizeTablePrefix(words.map((word) => word[0]).join(""));
}

/** Display label for a table — prefers configured name (G1, Patio), else Table N. */
export function formatTableLabel(
  tableId: number | null | undefined,
  name?: string | null,
): string {
  if (tableId === null || tableId === undefined || !Number.isFinite(Number(tableId))) {
    return "";
  }
  const id = Number(tableId);
  const trimmed = String(name || "").trim();
  return trimmed || `Table ${id}`;
}

export const FLOOR_LAYOUT_LIMITS = {
  MAX_TOTAL_TABLES,
  MAX_AREA_TABLES,
  MAX_SEATS,
};
