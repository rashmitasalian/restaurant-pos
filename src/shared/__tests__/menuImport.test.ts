import { menuExportCsv, menuImportTemplate, validateMenuCsv } from "../menuImport";

const header = "category,item,variant,price,diet,available,favorite,sku";
const legacyHeader =
  "category,category_order,item,item_order,sku,price,available,favorite,diet,variant,variant_price";

function csv(rows: string[]) {
  return `${header}\n${rows.join("\n")}\n`;
}

function legacyCsv(rows: string[]) {
  return `${legacyHeader}\n${rows.join("\n")}\n`;
}

describe("menu CSV import", () => {
  it("accepts the downloaded template and warns that sample rows are still there", () => {
    const preview = validateMenuCsv(menuImportTemplate());
    expect(preview.errors).toEqual([]);
    expect(preview.items.map((item) => item.name)).toEqual(["Veg Manchow Soup", "Margherita"]);
    expect(preview.warnings.join(" ")).toMatch(/sample rows/i);
  });

  it("uses row order and does not count extra variant rows as a position", () => {
    const preview = validateMenuCsv(
      csv([
        "Pizza,Margherita,Half,180,veg,,,",
        "Pizza,Margherita,Full,300,veg,,,",
        "Pizza,Farmhouse,,320,veg,,,",
        "Drinks,Tea,,20,,,,",
        "Pizza,Paneer,,340,veg,,,",
      ]),
    );
    expect(preview.errors).toEqual([]);
    const pizza = preview.items.filter((item) => item.category === "Pizza");
    expect(pizza.map((item) => [item.name, item.itemOrder])).toEqual([
      ["Margherita", 1],
      ["Farmhouse", 2],
      ["Paneer", 3],
    ]);
    expect(preview.categories.map((category) => category.name)).toEqual(["Pizza", "Drinks"]);
    expect(preview.items.find((item) => item.name === "Tea")?.categoryOrder).toBe(2);
    expect(preview.variantItems).toEqual([
      { category: "Pizza", name: "Margherita", variantCount: 2 },
    ]);
  });

  it("treats blank available as yes and blank favorite as no", () => {
    const preview = validateMenuCsv(csv(["Drinks,Tea,,20,,,,"]));
    expect(preview.items[0]).toMatchObject({ available: true, favorite: false, diet: null, sku: null });
  });

  it("rejects flag values other than yes, true, no, false", () => {
    const preview = validateMenuCsv(csv(["Drinks,Tea,,20,,y,,", "Drinks,Coffee,,30,,,1,"]));
    expect(preview.errors).toHaveLength(2);
    expect(preview.errors[0]).toMatch(/available must be yes, no, or blank/);
    expect(preview.errors[1]).toMatch(/favorite must be yes, no, or blank/);
  });

  it("rejects conflicting flags across variant rows", () => {
    const preview = validateMenuCsv(
      csv(["Pizza,Margherita,Half,180,veg,yes,,", "Pizza,Margherita,Full,300,veg,no,,"]),
    );
    expect(preview.errors.join(" ")).toMatch(/both available and not available/);
  });

  it("rejects an item that mixes rows with and without a variant", () => {
    const preview = validateMenuCsv(
      csv(["Pizza,Margherita,,250,veg,,,", "Pizza,Margherita,Full,300,veg,,,"]),
    );
    expect(preview.errors.join(" ")).toMatch(/with and without a variant/);
    expect(preview.items).toHaveLength(0);
  });

  it("rejects a repeated single-price item", () => {
    const preview = validateMenuCsv(csv(["Drinks,Tea,,20,,,,", "Drinks,tea,,25,,,,"]));
    expect(preview.errors.join(" ")).toMatch(/listed again without a variant/);
  });

  it("rejects money that is not a plain number", () => {
    const preview = validateMenuCsv(csv(["Drinks,Tea,,₹100,,,,", 'Drinks,Coffee,,"1,200",,,,']));
    expect(preview.errors).toHaveLength(2);
    expect(preview.errors[0]).toMatch(/without ₹ or commas/);
  });

  it("requires a price on every row", () => {
    const preview = validateMenuCsv(csv(["Drinks,Tea,,,,,,"]));
    expect(preview.errors[0]).toMatch(/price is empty/);
  });

  it("reports the file row number, skipping blank Excel rows", () => {
    const preview = validateMenuCsv(`${header}\n,,,,,,,\nDrinks,Tea,,abc,,,,\n`);
    expect(preview.errors).toEqual([
      'Row 3: price "abc" must be a number like 120 or 120.50, without ₹ or commas.',
    ]);
  });

  it("reads semicolon files and ignores a BOM", () => {
    const preview = validateMenuCsv(
      `\uFEFFcategory;item;variant;price;diet;available;favorite;sku\nDrinks;Tea;;20;;;;\n`,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.items[0]?.name).toBe("Tea");
  });

  it("accepts files with only the required columns", () => {
    const preview = validateMenuCsv("category,item,price\nDrinks,Tea,20\n");
    expect(preview.errors).toEqual([]);
    expect(preview.items[0]).toMatchObject({ name: "Tea", price: 20, available: true });
  });

  it("keeps a quoted comma inside the item name", () => {
    const preview = validateMenuCsv(csv(['Mains,"Chicken, Special",,180,non-veg,,,CHK1']));
    expect(preview.errors).toEqual([]);
    expect(preview.items[0]?.name).toBe("Chicken, Special");
    expect(preview.created).toBe(1);
  });

  it("warns about look-alike category names", () => {
    const preview = validateMenuCsv(
      csv(["Starters,Soup,,120,,,,", "Starter,Salad,,90,,,,", "started,Chaat,,60,,,,"]),
    );
    expect(preview.errors).toEqual([]);
    expect(preview.categories).toHaveLength(3);
    const text = preview.warnings.join(" ");
    expect(text).toMatch(/"Starters" and "Starter" look alike/);
    expect(text).toMatch(/"Starter" and "started" look alike/);
  });

  it("warns when a category looks like an existing one that is not in the file", () => {
    const preview = validateMenuCsv(csv(["Starter,Soup,,120,,,,"]), [], ["Starters"], "replace");
    expect(preview.warnings.join(" ")).toMatch(/"Starter" and "Starters" look alike/);
    expect(preview.categories[0]).toMatchObject({ name: "Starter", isNew: true });
    expect(preview.deactivatedCategoryNames).toEqual(["Starters"]);
  });

  it("updates the same item when its SKU changes and reports it", () => {
    const preview = validateMenuCsv(
      csv(["Mains,Biryani,,220,non-veg,,,BIR999"]),
      [{ id: "item:biryani", name: "Biryani", category: "Mains", sku: "BIR001", active: true }],
      ["Mains"],
    );
    expect(preview.errors).toEqual([]);
    expect(preview.items[0]?.existingId).toBe("item:biryani");
    expect(preview.items[0]?.sku).toBe("BIR999");
    expect(preview.updated).toBe(1);
    expect(preview.identityChanges).toEqual(["Biryani: SKU BIR001 becomes BIR999."]);
  });

  it("keeps the existing SKU when the SKU cell is blank", () => {
    const preview = validateMenuCsv(
      csv(["Mains,Biryani,,220,,,,"]),
      [{ id: "item:biryani", name: "Biryani", category: "Mains", sku: "BIR001", active: true }],
      ["Mains"],
    );
    expect(preview.items[0]?.sku).toBe("BIR001");
    expect(preview.identityChanges).toEqual([]);
  });

  it("reports a SKU match whose name changed", () => {
    const preview = validateMenuCsv(
      csv(["Mains,Chicken Biryani,,240,,,,BIR001"]),
      [{ id: "item:biryani", name: "Biryani", category: "Mains", sku: "BIR001", active: true }],
      ["Mains"],
    );
    expect(preview.items[0]?.existingId).toBe("item:biryani");
    expect(preview.identityChanges[0]).toMatch(/"Biryani" in Mains becomes "Chicken Biryani"/);
  });

  it("fails when two rows resolve to the same existing item", () => {
    const preview = validateMenuCsv(
      csv(["Mains,Biryani,,220,,,,", "Starters,Other,,90,,,,BIR001"]),
      [{ id: "item:biryani", name: "Biryani", category: "Mains", sku: "BIR001", active: true }],
      ["Mains"],
    );
    expect(preview.errors.join(" ")).toMatch(/same existing item/);
    expect(preview.items).toHaveLength(0);
  });

  const currentMenu = [
    { id: "item:biryani", name: "Biryani", category: "Mains", sku: "BIR001", active: true },
    { id: "item:soup", name: "Soup", category: "Mains", sku: null, active: true },
    { id: "item:tea", name: "Tea", category: "Drinks", sku: null, active: true },
    { id: "item:old", name: "Old", category: "Drinks", sku: null, active: false },
  ];

  it("lists items and categories that replace mode would deactivate", () => {
    const preview = validateMenuCsv(
      csv(["Mains,Biryani,,220,,,,BIR001"]),
      currentMenu,
      ["Mains", "Drinks"],
      "replace",
    );
    expect(preview.errors).toEqual([]);
    expect(preview.mode).toBe("replace");
    expect(preview.deactivatedItemNames).toEqual(["Soup (Mains)", "Tea (Drinks)"]);
    expect(preview.deactivatedCategoryNames).toEqual(["Drinks"]);
    expect(preview.categories).toEqual([{ name: "Mains", itemCount: 1, isNew: false }]);
  });

  it("deactivates nothing in the default add-or-update mode", () => {
    const preview = validateMenuCsv(
      csv(["Mains,Biryani,,220,,,,BIR001", "Mains,Kebab,,260,,,,"]),
      currentMenu,
      ["Mains", "Drinks"],
    );
    expect(preview.errors).toEqual([]);
    expect(preview.mode).toBe("upsert");
    expect(preview.created).toBe(1);
    expect(preview.updated).toBe(1);
    expect(preview.deactivatedItems).toBe(0);
    expect(preview.deactivatedCategories).toBe(0);
    expect(preview.deactivatedItemNames).toEqual([]);
    expect(preview.deactivatedCategoryNames).toEqual([]);
  });

  it("stores the cheapest variant and replaces variant rows on an existing item", () => {
    const preview = validateMenuCsv(
      csv(["Pizza,Margherita,Half,180,veg,,yes,", "Pizza,Margherita,Full,300,veg,,yes,"]),
      [{ id: "item:pizza", name: "Margherita", category: "Pizza", sku: null, active: true }],
      ["Pizza"],
    );
    expect(preview.errors).toEqual([]);
    expect(preview.items[0]?.price).toBe(180);
    expect(preview.items[0]?.favorite).toBe(true);
    expect(preview.items[0]?.variants.map((variant) => variant.name)).toEqual(["Half", "Full"]);
    expect(preview.variantsReplaced).toBe(2);
  });

  describe("export and change list", () => {
    const menu = [
      {
        id: "item:soup",
        name: "Soup",
        category: "Starters",
        sku: "S1",
        price: 120,
        variants: [],
        available: true,
        favorite: false,
        diet: "veg" as const,
      },
      {
        id: "item:pizza",
        name: 'Pizza, "Special"',
        category: "Pizza",
        sku: null,
        price: 180,
        variants: [
          { name: "Half", price: 180 },
          { name: "Full", price: 300 },
        ],
        available: false,
        favorite: false,
        diet: null,
      },
    ];

    it("exports a file that imports back with no changes", () => {
      const text = menuExportCsv(menu);
      expect(text.startsWith("\uFEFFcategory,item,variant,price")).toBe(true);
      expect(text).toContain('"Pizza, ""Special""",Half,180,,no,,');
      const preview = validateMenuCsv(text, menu, ["Starters", "Pizza"]);
      expect(preview.errors).toEqual([]);
      expect(preview.created).toBe(0);
      expect(preview.updated).toBe(2);
      expect(preview.changes).toEqual([]);
      expect(preview.unchangedItems).toBe(2);
      expect(preview.variantsReplaced).toBe(0);
    });

    it("lists price, variant, availability, favourite and diet changes", () => {
      const preview = validateMenuCsv(
        csv([
          "Starters,Soup,,140,non-veg,,yes,S1",
          "Pizza,\"Pizza, \"\"Special\"\"\",Half,200,,yes,,",
          "Pizza,\"Pizza, \"\"Special\"\"\",Full,300,,yes,,",
        ]),
        menu,
        ["Starters", "Pizza"],
      );
      expect(preview.errors).toEqual([]);
      expect(preview.changes).toEqual([
        {
          name: "Soup",
          category: "Starters",
          details: ["Price: ₹120 → ₹140", "Marked favourite", "Diet: veg → non-veg"],
        },
        {
          name: 'Pizza, "Special"',
          category: "Pizza",
          details: ["Variants: Half ₹180, Full ₹300 → Half ₹200, Full ₹300", "Turned on"],
        },
      ]);
      expect(preview.variantsReplaced).toBe(2);
    });
  });

  describe("old 11-column template", () => {
    it("imports variant_price and ignores the order columns", () => {
      const preview = validateMenuCsv(
        legacyCsv([
          "Pizza,5,Margherita,9,,,yes,no,veg,Half,180",
          "Pizza,5,Margherita,9,,,yes,no,veg,Full,300",
          "Drinks,1,Tea,4,,20,yes,no,,,",
        ]),
      );
      expect(preview.errors).toEqual([]);
      expect(preview.items.map((item) => [item.name, item.categoryOrder, item.itemOrder])).toEqual([
        ["Margherita", 1, 1],
        ["Tea", 2, 1],
      ]);
      const text = preview.warnings.join(" ");
      expect(text).toMatch(/order of rows sets the menu order/);
      expect(text).toMatch(/variant_price is from the old template/);
    });

    it("rejects price and variant_price that disagree", () => {
      const preview = validateMenuCsv(legacyCsv(["Pizza,1,Margherita,1,,250,yes,no,veg,Full,300"]));
      expect(preview.errors.join(" ")).toMatch(/price and variant_price disagree/);
    });

    it("rejects variant_price without a variant", () => {
      const preview = validateMenuCsv(legacyCsv(["Pizza,1,Margherita,1,,,yes,no,veg,,300"]));
      expect(preview.errors.join(" ")).toMatch(/variant_price is filled but variant is empty/);
    });
  });
});
