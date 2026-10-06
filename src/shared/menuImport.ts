import { parse } from "csv-parse/sync";
import { restoreSpreadsheetText, neutralizeSpreadsheetFormula } from "./csv";
import { TEXT_LIMITS } from "./textLimits";

export const MENU_IMPORT_HEADERS = [
  "category",
  "item",
  "variant",
  "price",
  "diet",
  "available",
  "favorite",
  "sku",
] as const;

const REQUIRED_HEADERS = ["category", "item", "price"] as const;
const LEGACY_ORDER_HEADERS = ["category_order", "item_order"] as const;
const LEGACY_VARIANT_PRICE = "variant_price";
const KNOWN_HEADERS = new Set<string>([
  ...MENU_IMPORT_HEADERS,
  ...LEGACY_ORDER_HEADERS,
  LEGACY_VARIANT_PRICE,
]);

const TEMPLATE_ROWS = [
  "Starters,Veg Manchow Soup,,120,veg,,,",
  "Pizza,Margherita,Half,180,veg,,yes,",
  "Pizza,Margherita,Full,300,veg,,yes,",
];

export type MenuDiet = "veg" | "non-veg" | "egg" | null;

/** "upsert" leaves items and categories missing from the file untouched; "replace" deactivates them. */
export type MenuImportMode = "upsert" | "replace";

export function normalizeMenuImportMode(value: unknown): MenuImportMode {
  return value === "replace" ? "replace" : "upsert";
}

export type MenuImportExistingItem = {
  id: string;
  name: string;
  category?: string | null;
  sku?: string | null;
  active?: boolean;
  /** Optional current values; when given, the preview lists what an update changes. */
  price?: number | null;
  variants?: Array<{ name: string; price: number }>;
  available?: boolean;
  favorite?: boolean;
  diet?: MenuDiet;
};

export type MenuImportChange = {
  name: string;
  category: string;
  details: string[];
};

export type MenuImportVariant = {
  name: string;
  price: number;
  sortOrder: number;
};

export type MenuImportItem = {
  category: string;
  categoryOrder: number;
  name: string;
  itemOrder: number;
  sku: string | null;
  price: number | null;
  available: boolean;
  favorite: boolean;
  diet: MenuDiet;
  variants: MenuImportVariant[];
  existingId: string | null;
};

export type MenuImportPreview = {
  mode: MenuImportMode;
  items: MenuImportItem[];
  errors: string[];
  /** Does not block the import. Shown so the owner can check spelling and leftovers. */
  warnings: string[];
  created: number;
  updated: number;
  deactivatedItems: number;
  deactivatedCategories: number;
  variantsReplaced: number;
  categories: Array<{ name: string; itemCount: number; isNew: boolean }>;
  variantItems: Array<{ category: string; name: string; variantCount: number }>;
  deactivatedItemNames: string[];
  deactivatedCategoryNames: string[];
  identityChanges: string[];
  /** Updated items whose price, variants, availability, favourite or diet change. */
  changes: MenuImportChange[];
  unchangedItems: number;
};

export function menuMatchKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function menuDisplayName(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function headerKey(value: unknown) {
  return menuMatchKey(value).replace(/ /g, "_");
}

function parseFlag(value: unknown): { value: boolean | null; error: boolean } {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) {
    return { value: null, error: false };
  }
  if (text === "yes" || text === "true") {
    return { value: true, error: false };
  }
  if (text === "no" || text === "false") {
    return { value: false, error: false };
  }
  return { value: null, error: true };
}

function parseMoney(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    return null;
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return Math.round(amount * 100) / 100;
}

function parseDiet(value: unknown): { diet: MenuDiet; error: boolean } {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) {
    return { diet: null, error: false };
  }
  if (text === "veg" || text === "non-veg" || text === "egg") {
    return { diet: text, error: false };
  }
  return { diet: null, error: true };
}

/** Excel in some locales saves with semicolons; copying cells into a text file gives tabs. */
function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  if (firstLine.includes(",")) {
    return ",";
  }
  if (firstLine.includes(";")) {
    return ";";
  }
  if (firstLine.includes("\t")) {
    return "\t";
  }
  return ",";
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function looksAlike(leftKey: string, rightKey: string) {
  if (!leftKey || !rightKey || leftKey === rightKey) {
    return false;
  }
  const shortest = Math.min(leftKey.length, rightKey.length);
  if (shortest < 4) {
    return false;
  }
  return editDistance(leftKey, rightKey) <= (shortest >= 5 ? 2 : 1);
}

export function menuImportTemplate() {
  return `\uFEFF${[MENU_IMPORT_HEADERS.join(","), ...TEMPLATE_ROWS].join("\r\n")}\r\n`;
}

type Group = {
  rows: number[];
  category: string;
  categoryKey: string;
  categoryOrder: number;
  name: string;
  itemOrder: number;
  sku: string | null;
  price: number | null;
  available: boolean | null;
  favorite: boolean | null;
  diet: MenuDiet;
  variants: MenuImportVariant[];
  singleRows: number;
  variantRows: number;
};

export function validateMenuCsv(
  text: string,
  existing: MenuImportExistingItem[] = [],
  existingCategories: string[] = [],
  mode: MenuImportMode = "upsert",
): MenuImportPreview {
  const emptyPreview = (errorList: string[], warningList: string[] = []) =>
    emptyPreviewFor(mode, errorList, warningList);
  const errors: string[] = [];
  const warnings: string[] = [];
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  let headers: string[] = [];
  let records: Array<{ record: Record<string, string>; info: { lines: number } }> = [];
  try {
    records = parse(source, {
      bom: true,
      delimiter: detectDelimiter(source),
      columns: (row: string[]) => {
        headers = row.map(headerKey);
        return headers;
      },
      info: true,
      trim: true,
      skip_empty_lines: true,
      skip_records_with_empty_values: true,
      relax_column_count_less: true,
    }) as unknown as Array<{ record: Record<string, string>; info: { lines: number } }>;
  } catch (error) {
    return emptyPreview([`Could not read the CSV: ${(error as Error).message || "invalid file"}`]);
  }

  if (!headers.length) {
    return emptyPreview(["The file is empty."]);
  }
  const seenHeaders = new Set<string>();
  for (const header of headers) {
    if (header && seenHeaders.has(header)) {
      errors.push(`Column "${header}" appears twice in the header row.`);
    }
    seenHeaders.add(header);
  }
  for (const header of REQUIRED_HEADERS) {
    if (!seenHeaders.has(header)) {
      errors.push(
        `Missing column "${header}". The first row must be: ${MENU_IMPORT_HEADERS.join(",")}`,
      );
    }
  }
  if (errors.length) {
    return emptyPreview(errors);
  }
  if (!records.length) {
    return emptyPreview(["The file has a header row but no menu rows."]);
  }
  for (const header of headers) {
    if (header && !KNOWN_HEADERS.has(header)) {
      warnings.push(`Column "${header}" is not used and will be ignored.`);
    }
  }
  if (LEGACY_ORDER_HEADERS.some((header) => seenHeaders.has(header))) {
    warnings.push(
      "category_order and item_order are from the old template and are ignored. The order of rows sets the menu order.",
    );
  }

  const groups = new Map<string, Group>();
  const categoryPositions = new Map<string, { name: string; order: number }>();
  const itemCountByCategory = new Map<string, number>();
  let usedLegacyVariantPrice = false;

  for (const { record, info } of records) {
    const row = info.lines;
    const category = restoreSpreadsheetText(menuDisplayName(record.category));
    const name = restoreSpreadsheetText(menuDisplayName(record.item));
    const variant = restoreSpreadsheetText(menuDisplayName(record.variant));
    const sku = restoreSpreadsheetText(menuDisplayName(record.sku)) || null;
    let priceText = String(record.price ?? "").trim();
    const legacyVariantPrice = String(record[LEGACY_VARIANT_PRICE] ?? "").trim();

    if (!category) {
      errors.push(`Row ${row}: category is empty.`);
      continue;
    }
    if (category.length > TEXT_LIMITS.menuCategory) {
      errors.push(`Row ${row}: category must be ${TEXT_LIMITS.menuCategory} characters or fewer.`);
      continue;
    }
    if (!name) {
      errors.push(`Row ${row}: item is empty.`);
      continue;
    }
    if (name.length > TEXT_LIMITS.menuItemName) {
      errors.push(`Row ${row}: item must be ${TEXT_LIMITS.menuItemName} characters or fewer.`);
      continue;
    }
    if (variant.length > TEXT_LIMITS.menuVariant) {
      errors.push(`Row ${row}: variant must be ${TEXT_LIMITS.menuVariant} characters or fewer.`);
      continue;
    }
    if (sku && sku.length > TEXT_LIMITS.sku) {
      errors.push(`Row ${row}: sku must be ${TEXT_LIMITS.sku} characters or fewer.`);
      continue;
    }
    if (legacyVariantPrice) {
      if (!variant) {
        errors.push(`Row ${row}: variant_price is filled but variant is empty.`);
        continue;
      }
      if (priceText && priceText !== legacyVariantPrice) {
        errors.push(`Row ${row}: price and variant_price disagree. Put the size price in price.`);
        continue;
      }
      priceText = legacyVariantPrice;
      usedLegacyVariantPrice = true;
    }
    if (!priceText) {
      errors.push(`Row ${row}: price is empty.`);
      continue;
    }
    const price = parseMoney(priceText);
    if (price === null) {
      errors.push(
        `Row ${row}: price "${priceText}" must be a number like 120 or 120.50, without ₹ or commas.`,
      );
      continue;
    }
    const available = parseFlag(record.available);
    const favorite = parseFlag(record.favorite);
    const diet = parseDiet(record.diet);
    if (available.error) {
      errors.push(`Row ${row}: available must be yes, no, or blank.`);
    }
    if (favorite.error) {
      errors.push(`Row ${row}: favorite must be yes, no, or blank.`);
    }
    if (diet.error) {
      errors.push(`Row ${row}: diet must be veg, non-veg, egg, or blank.`);
    }
    if (available.error || favorite.error || diet.error) {
      continue;
    }

    const categoryKey = menuMatchKey(category);
    if (!categoryPositions.has(categoryKey)) {
      categoryPositions.set(categoryKey, { name: category, order: categoryPositions.size + 1 });
    }
    const key = `${categoryKey}\u0000${menuMatchKey(name)}`;
    let group = groups.get(key);
    if (!group) {
      const itemOrder = (itemCountByCategory.get(categoryKey) || 0) + 1;
      itemCountByCategory.set(categoryKey, itemOrder);
      const position = categoryPositions.get(categoryKey)!;
      const created: Group = {
        rows: [],
        category: position.name,
        categoryKey,
        categoryOrder: position.order,
        name,
        itemOrder,
        sku: null,
        price: null,
        available: null,
        favorite: null,
        diet: null,
        variants: [],
        singleRows: 0,
        variantRows: 0,
      };
      groups.set(key, created);
      group = created;
    }
    group.rows.push(row);

    if (sku) {
      if (group.sku && menuMatchKey(group.sku) !== menuMatchKey(sku)) {
        errors.push(`Row ${row}: ${group.name} has two SKUs, ${group.sku} and ${sku}.`);
      } else if (!group.sku) {
        group.sku = sku;
      }
    }
    if (diet.diet) {
      if (group.diet && group.diet !== diet.diet) {
        errors.push(`Row ${row}: ${group.name} has two diets, ${group.diet} and ${diet.diet}.`);
      } else {
        group.diet = diet.diet;
      }
    }
    if (available.value !== null) {
      if (group.available !== null && group.available !== available.value) {
        errors.push(`Row ${row}: ${group.name} is marked both available and not available.`);
      } else {
        group.available = available.value;
      }
    }
    if (favorite.value !== null) {
      if (group.favorite !== null && group.favorite !== favorite.value) {
        errors.push(`Row ${row}: ${group.name} is marked both favorite and not favorite.`);
      } else {
        group.favorite = favorite.value;
      }
    }

    if (variant) {
      group.variantRows += 1;
      const duplicate = group.variants.some(
        (entry) => menuMatchKey(entry.name) === menuMatchKey(variant),
      );
      if (duplicate) {
        errors.push(`Row ${row}: ${group.name} already has a variant named "${variant}".`);
      } else {
        group.variants.push({ name: variant, price, sortOrder: group.variants.length });
      }
    } else {
      group.singleRows += 1;
      if (group.singleRows > 1) {
        errors.push(
          `Row ${row}: ${group.name} is listed again without a variant. Remove the extra row, or give each row a variant name.`,
        );
      } else {
        group.price = price;
      }
    }
  }

  for (const group of groups.values()) {
    if (group.singleRows && group.variantRows) {
      errors.push(
        `${group.name} in ${group.category} has rows with and without a variant (rows ${group.rows.join(", ")}). Give every row a variant, or use one row with no variant.`,
      );
    }
  }

  const skuOwners = new Map<string, string>();
  for (const [key, group] of groups) {
    if (!group.sku) {
      continue;
    }
    const skuKey = menuMatchKey(group.sku);
    const owner = skuOwners.get(skuKey);
    if (owner && owner !== key) {
      errors.push(`SKU "${group.sku}" is used by more than one item.`);
    }
    skuOwners.set(skuKey, key);
  }

  const categoriesByItem = new Map<string, string[]>();
  for (const group of groups.values()) {
    const itemKey = menuMatchKey(group.name);
    const list = categoriesByItem.get(itemKey) || [];
    list.push(group.category);
    categoriesByItem.set(itemKey, list);
  }
  for (const [itemKey, categories] of categoriesByItem) {
    if (categories.length > 1) {
      const name = [...groups.values()].find((group) => menuMatchKey(group.name) === itemKey)!.name;
      warnings.push(`"${name}" is in more than one category: ${categories.join(", ")}.`);
    }
  }

  const categorySource = uniqueByKey(
    existingCategories.length
      ? existingCategories
      : existing
          .filter((item) => item.active !== false)
          .map((item) => String(item.category || "")),
  );
  const fileCategoryNames = [...categoryPositions.values()].map((entry) => entry.name);
  const alikePairs = new Set<string>();
  const warnAlike = (left: string, right: string) => {
    const pair = [menuMatchKey(left), menuMatchKey(right)].sort().join("\u0000");
    if (!alikePairs.has(pair) && looksAlike(menuMatchKey(left), menuMatchKey(right))) {
      alikePairs.add(pair);
      warnings.push(`"${left}" and "${right}" look alike. Check the spelling.`);
    }
  };
  fileCategoryNames.forEach((left, index) => {
    fileCategoryNames.slice(index + 1).forEach((right) => warnAlike(left, right));
    categorySource
      .filter((name) => !categoryPositions.has(menuMatchKey(name)))
      .forEach((right) => warnAlike(left, right));
  });
  const groupsByCategory = new Map<string, Group[]>();
  for (const group of groups.values()) {
    const list = groupsByCategory.get(group.categoryKey) || [];
    list.push(group);
    groupsByCategory.set(group.categoryKey, list);
  }
  for (const list of groupsByCategory.values()) {
    list.forEach((left, index) => {
      list.slice(index + 1).forEach((right) => warnAlike(left.name, right.name));
    });
  }

  const leftovers: string[] = [];
  const soup = groups.get(`starters\u0000veg manchow soup`);
  if (soup && soup.price === 120 && !soup.variants.length) {
    leftovers.push("Veg Manchow Soup");
  }
  const pizza = groups.get(`pizza\u0000margherita`);
  if (
    pizza &&
    pizza.variants.length === 2 &&
    pizza.variants.some((variant) => menuMatchKey(variant.name) === "half" && variant.price === 180) &&
    pizza.variants.some((variant) => menuMatchKey(variant.name) === "full" && variant.price === 300)
  ) {
    leftovers.push("Margherita");
  }
  if (leftovers.length) {
    warnings.push(
      `The sample rows from the template (${leftovers.join(" and ")}) are still in the file. Delete them if they are not on your menu.`,
    );
  }
  if (usedLegacyVariantPrice) {
    warnings.push("variant_price is from the old template. Its value was used as the size price.");
  }

  const bySku = new Map<string, MenuImportExistingItem>();
  const byName = new Map<string, MenuImportExistingItem>();
  const byId = new Map<string, MenuImportExistingItem>();
  const orderedExisting = [...existing].sort(
    (left, right) => Number(right.active !== false) - Number(left.active !== false),
  );
  for (const item of orderedExisting) {
    byId.set(item.id, item);
    if (item.sku && !bySku.has(menuMatchKey(item.sku))) {
      bySku.set(menuMatchKey(item.sku), item);
    }
    const nameKey = `${menuMatchKey(item.category)}\u0000${menuMatchKey(item.name)}`;
    if (!byName.has(nameKey)) {
      byName.set(nameKey, item);
    }
  }

  const items: MenuImportItem[] = [];
  const identityChanges: string[] = [];
  const identityChangedIds = new Set<string>();
  const claimed = new Map<string, string>();
  for (const [key, group] of groups) {
    const byNameHit = byName.get(key) || null;
    const bySkuHit = group.sku ? bySku.get(menuMatchKey(group.sku)) || null : null;
    if (bySkuHit && byNameHit && bySkuHit.id !== byNameHit.id) {
      errors.push(
        `${group.name}: SKU "${group.sku}" belongs to a different item than this category and name.`,
      );
      continue;
    }
    const existingId = bySkuHit?.id || byNameHit?.id || null;
    const existingHit = existingId ? byId.get(existingId) || null : null;
    if (existingId) {
      const claimedBy = claimed.get(existingId);
      if (claimedBy && claimedBy !== key) {
        errors.push(`${group.name} matches the same existing item as another row.`);
        continue;
      }
      claimed.set(existingId, key);
    }
    if (existingHit) {
      const identityCount = identityChanges.length;
      const oldSku = existingHit.sku || null;
      if (group.sku && menuMatchKey(oldSku) !== menuMatchKey(group.sku)) {
        identityChanges.push(
          oldSku
            ? `${group.name}: SKU ${oldSku} becomes ${group.sku}.`
            : `${group.name}: SKU set to ${group.sku}.`,
        );
      }
      if (
        bySkuHit &&
        (menuMatchKey(existingHit.name) !== menuMatchKey(group.name) ||
          menuMatchKey(existingHit.category) !== group.categoryKey)
      ) {
        identityChanges.push(
          `SKU ${group.sku}: "${existingHit.name}" in ${existingHit.category || "no category"} becomes "${group.name}" in ${group.category}.`,
        );
      }
      if (existingHit.active === false) {
        identityChanges.push(`${group.name} was removed earlier and will be back on the menu.`);
      }
      if (identityChanges.length > identityCount) {
        identityChangedIds.add(existingHit.id);
      }
    }
    const available = group.available ?? true;
    items.push({
      category: group.category,
      categoryOrder: group.categoryOrder,
      name: group.name,
      itemOrder: group.itemOrder,
      sku: group.sku || existingHit?.sku || null,
      price: group.variants.length
        ? Math.min(...group.variants.map((variant) => variant.price))
        : group.price,
      available,
      favorite: (group.favorite ?? false) && available,
      diet: group.diet,
      variants: group.variants,
      existingId,
    });
  }

  if (errors.length) {
    return emptyPreview(errors, warnings);
  }

  const keptIds = new Set(items.map((item) => item.existingId).filter(Boolean) as string[]);
  const replacing = mode === "replace";
  const deactivatedItemNames = replacing
    ? existing
        .filter((item) => item.active !== false && !keptIds.has(item.id))
        .map((item) => (item.category ? `${item.name} (${item.category})` : item.name))
    : [];
  const existingCategoryKeys = new Set(categorySource.map(menuMatchKey));
  const deactivatedCategoryNames = replacing
    ? categorySource.filter((name) => !categoryPositions.has(menuMatchKey(name)))
    : [];
  const categories = [...categoryPositions.entries()].map(([categoryKey, entry]) => ({
    name: entry.name,
    itemCount: items.filter((item) => menuMatchKey(item.category) === categoryKey).length,
    isNew: !existingCategoryKeys.has(categoryKey),
  }));
  const variantItems = items
    .filter((item) => item.variants.length)
    .map((item) => ({
      category: item.category,
      name: item.name,
      variantCount: item.variants.length,
    }));
  const updated = items.filter((item) => item.existingId).length;
  const changes: MenuImportChange[] = [];
  let unchangedItems = 0;
  let variantsReplaced = 0;
  for (const item of items) {
    const current = item.existingId ? byId.get(item.existingId) : undefined;
    if (!current) {
      continue;
    }
    if (variantsDiffer(current, item)) {
      variantsReplaced += item.variants.length;
    }
    const details = describeItemChanges(current, item);
    if (details.length) {
      changes.push({ name: item.name, category: item.category, details });
    } else if (!identityChangedIds.has(current.id)) {
      unchangedItems += 1;
    }
  }

  return {
    mode,
    items,
    errors: [],
    warnings,
    created: items.length - updated,
    updated,
    deactivatedItems: deactivatedItemNames.length,
    deactivatedCategories: deactivatedCategoryNames.length,
    variantsReplaced,
    categories,
    variantItems,
    deactivatedItemNames,
    deactivatedCategoryNames,
    identityChanges,
    changes,
    unchangedItems,
  };
}

function uniqueByKey(names: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = menuDisplayName(raw);
    const key = menuMatchKey(name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(name);
  }
  return result;
}

function emptyPreviewFor(
  mode: MenuImportMode,
  errors: string[],
  warnings: string[] = [],
): MenuImportPreview {
  return {
    mode,
    items: [],
    errors,
    warnings,
    created: 0,
    updated: 0,
    deactivatedItems: 0,
    deactivatedCategories: 0,
    variantsReplaced: 0,
    categories: [],
    variantItems: [],
    deactivatedItemNames: [],
    deactivatedCategoryNames: [],
    identityChanges: [],
    changes: [],
    unchangedItems: 0,
  };
}

function formatRupees(value: number) {
  return `₹${Math.round(value * 100) / 100}`;
}

function formatVariantList(variants: Array<{ name: string; price: number }>) {
  return variants.map((variant) => `${variant.name} ${formatRupees(variant.price)}`).join(", ");
}

function dietLabel(diet: MenuDiet | undefined) {
  return diet || "not set";
}

function describeItemChanges(existing: MenuImportExistingItem, next: MenuImportItem) {
  const details: string[] = [];
  const oldVariants = existing.variants;
  if (oldVariants !== undefined || existing.price !== undefined) {
    const oldList = oldVariants || [];
    const oldLabel = oldList.length
      ? formatVariantList(oldList)
      : existing.price != null
        ? formatRupees(existing.price)
        : "";
    const newLabel = next.variants.length
      ? formatVariantList(next.variants)
      : next.price != null
        ? formatRupees(next.price)
        : "";
    if (oldLabel !== newLabel) {
      const label = oldList.length && next.variants.length ? "Variants" : "Price";
      details.push(`${label}: ${oldLabel || "none"} → ${newLabel || "none"}`);
    }
  }
  if (existing.available !== undefined && existing.available !== next.available) {
    details.push(next.available ? "Turned on" : "Turned off");
  }
  if (existing.favorite !== undefined && existing.favorite !== next.favorite) {
    details.push(next.favorite ? "Marked favourite" : "No longer favourite");
  }
  if (existing.diet !== undefined && (existing.diet || null) !== next.diet) {
    details.push(`Diet: ${dietLabel(existing.diet)} → ${dietLabel(next.diet)}`);
  }
  return details;
}

function variantsDiffer(existing: MenuImportExistingItem, next: MenuImportItem) {
  if (existing.variants === undefined) {
    return next.variants.length > 0;
  }
  return formatVariantList(existing.variants) !== formatVariantList(next.variants);
}

export type MenuExportItem = {
  category?: string | null;
  name: string;
  sku?: string | null;
  price: number;
  diet?: MenuDiet;
  available?: boolean;
  favorite?: boolean;
  variants?: Array<{ name: string; price: number }>;
};

function csvCell(value: unknown) {
  const safe = neutralizeSpreadsheetFormula(String(value ?? ""));
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function exportMoney(value: number) {
  return String(Math.round(Number(value) * 100) / 100);
}

/** Current menu in the import format, in menu order, one row per variant. */
export function menuExportCsv(items: MenuExportItem[]) {
  const lines: string[] = [MENU_IMPORT_HEADERS.join(",")];
  for (const item of items) {
    const available = item.available !== false;
    const shared = {
      category: menuDisplayName(item.category) || "Uncategorised",
      item: menuDisplayName(item.name),
      diet: item.diet || "",
      available: available ? "yes" : "no",
      favorite: available && item.favorite ? "yes" : "",
      sku: item.sku || "",
    };
    const rows = item.variants?.length
      ? item.variants.map((variant) => ({ variant: variant.name, price: variant.price }))
      : [{ variant: "", price: item.price }];
    for (const row of rows) {
      const values: Record<(typeof MENU_IMPORT_HEADERS)[number], string> = {
        ...shared,
        variant: row.variant,
        price: exportMoney(row.price),
      };
      lines.push(MENU_IMPORT_HEADERS.map((header) => csvCell(values[header])).join(","));
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
