export type LayoutMode = "grid" | "floor";

export function getFloorTileSpan(index: number) {
  const pattern = [2, 1, 1, 2, 1, 1, 2, 1];
  return pattern[index % pattern.length];
}

export function getFloorTileStyle(index: number) {
  const span = getFloorTileSpan(index);
  return {
    gridColumn: `span ${span}`,
  } as const;
}

export function normalizeLayoutMode(value: unknown): LayoutMode {
  return value === "floor" ? "floor" : "grid";
}
