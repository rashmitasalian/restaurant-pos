export type DietFilter = "all" | "veg" | "non-veg" | "egg";

export const DIET_FILTERS: { id: DietFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "veg", label: "Veg" },
  { id: "non-veg", label: "Non-veg" },
  { id: "egg", label: "Egg" },
];

export function dietName(diet: string | null | undefined): string {
  if (diet === "veg") {
    return "Veg";
  }
  if (diet === "non-veg") {
    return "Non-veg";
  }
  if (diet === "egg") {
    return "Egg";
  }
  return "";
}

/** Unmarked items match only All. Egg is not included in Non-veg. */
export function matchesDiet(diet: string | null | undefined, selected: DietFilter): boolean {
  if (selected === "all") {
    return true;
  }
  return diet === selected;
}

export function dietFilterEmptyText(selected: DietFilter): string {
  if (selected === "veg") {
    return "No veg items in this category";
  }
  if (selected === "non-veg") {
    return "No non-veg items in this category";
  }
  if (selected === "egg") {
    return "No egg items in this category";
  }
  return "Nothing in this category yet";
}
