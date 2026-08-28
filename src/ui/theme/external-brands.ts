export const EXTERNAL_BRANDS = {
  swiggy: {
    name: "Swiggy",
    color: "#f97316",
    tint: "#fff7ed",
  },
  zomato: {
    name: "Zomato",
    color: "#ef4444",
    tint: "#fef2f2",
  },
} as const;

export function platformBrand(platform: string) {
  const value = String(platform || "").toLowerCase();
  if (value.includes("swiggy")) {
    return EXTERNAL_BRANDS.swiggy;
  }
  if (value.includes("zomato")) {
    return EXTERNAL_BRANDS.zomato;
  }
  return null;
}

/** Distinct hues for category pie charts — interleaved warm/cool for readability. */
export const CATEGORY_CHART_COLORS = [
  "#0f766e",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#2563eb",
  "#059669",
  "#db2777",
  "#64748b",
  "#0891b2",
  "#ca8a04",
];
