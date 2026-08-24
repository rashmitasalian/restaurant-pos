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

export const CHART_RAMP = [
  "#0b4a52",
  "#0f5e68",
  "#2d7380",
  "#4a8f99",
  "#6ba8b0",
  "#d97706",
  "#f59e0b",
  "#f3d89a",
  "#8b9089",
];
