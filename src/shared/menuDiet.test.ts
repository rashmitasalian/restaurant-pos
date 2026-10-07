import { dietFilterEmptyText, dietName, matchesDiet } from "./menuDiet";

describe("menu diet filter", () => {
  test("All includes veg, non-veg, egg, and unmarked items", () => {
    expect(matchesDiet("veg", "all")).toBe(true);
    expect(matchesDiet("non-veg", "all")).toBe(true);
    expect(matchesDiet("egg", "all")).toBe(true);
    expect(matchesDiet(null, "all")).toBe(true);
    expect(matchesDiet(undefined, "all")).toBe(true);
  });

  test("Veg is veg only", () => {
    expect(matchesDiet("veg", "veg")).toBe(true);
    expect(matchesDiet("non-veg", "veg")).toBe(false);
    expect(matchesDiet("egg", "veg")).toBe(false);
    expect(matchesDiet(null, "veg")).toBe(false);
    expect(matchesDiet("", "veg")).toBe(false);
  });

  test("Non-veg does not include egg or unmarked items", () => {
    expect(matchesDiet("non-veg", "non-veg")).toBe(true);
    expect(matchesDiet("egg", "non-veg")).toBe(false);
    expect(matchesDiet("veg", "non-veg")).toBe(false);
    expect(matchesDiet(null, "non-veg")).toBe(false);
  });

  test("Egg is egg only", () => {
    expect(matchesDiet("egg", "egg")).toBe(true);
    expect(matchesDiet("non-veg", "egg")).toBe(false);
    expect(matchesDiet("veg", "egg")).toBe(false);
    expect(matchesDiet(undefined, "egg")).toBe(false);
  });

  test("names and empty copy follow the filter", () => {
    expect(dietName("veg")).toBe("Veg");
    expect(dietName("non-veg")).toBe("Non-veg");
    expect(dietName("egg")).toBe("Egg");
    expect(dietName(null)).toBe("");
    expect(dietFilterEmptyText("veg")).toBe("No veg items in this category");
    expect(dietFilterEmptyText("all")).toBe("Nothing in this category yet");
  });
});
