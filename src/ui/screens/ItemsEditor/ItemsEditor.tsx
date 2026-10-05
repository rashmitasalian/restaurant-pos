import React from "react";
import {
  getItems,
  seedItems,
  createItem,
  updateItem,
  deleteItem,
  reorderItems,
  getConfigCategories,
  setConfigCategories,
  getConfigMenuVariantOptions,
  importMenu,
  type ItemDoc,
} from "../../../app/db/posRepository";
import {
  menuExportCsv,
  menuImportTemplate,
  menuMatchKey,
  validateMenuCsv,
  type MenuDiet,
  type MenuImportMode,
} from "../../../shared/menuImport";
import {
  normalizeCategoryName,
  normalizeSku,
  normalizeText,
  parsePositiveMoney,
  validationMessage,
} from "../../../shared/validation";
import { TEXT_LIMITS } from "../../../shared/textLimits";
import { useToast } from "../../context/ToastContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Drawer } from "../../components/ui/Drawer";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { PortalMenu, PortalMenuItem } from "../../components/ui/PortalMenu";
import { Icon } from "../../components/ui/Icon";
import { ChevronDown, ChevronUp, Pencil, Star, X } from "lucide-react";

type VariantDraft = {
  id?: string;
  name: string;
  price: number | string;
  sortOrder?: number;
};

type NormalizedVariant = {
  id?: string;
  name: string;
  price: number;
  sortOrder?: number;
};

type ItemDraft = {
  name: string;
  sku: string;
  category: string;
  diet: string;
  price: string;
  available: boolean;
  favorite: boolean;
  variants: VariantDraft[];
};

type EditorState = { mode: "create" } | { mode: "edit"; itemId: string };

type StatusFilter = "all" | "on" | "off";
type DietFilter = "all" | "veg" | "non-veg" | "egg" | "none";

const NO_CATEGORY = "\u0000none";
const FILTER_HEIGHT = "calc(var(--pos-hit-dense) + 8px)";
const EMPTY_DRAFT: ItemDraft = {
  name: "",
  sku: "",
  category: "",
  diet: "",
  price: "",
  available: true,
  favorite: false,
  variants: [],
};

function normalizeVariantDrafts(input: VariantDraft[]): NormalizedVariant[] {
  const rows = (input || [])
    .map((variant, index) => ({
      id: variant.id,
      name: normalizeText(variant.name),
      price: variant.price,
      sortOrder: Number.isFinite(Number(variant.sortOrder))
        ? Math.trunc(Number(variant.sortOrder))
        : index,
    }))
    .filter((variant) => variant.name || String(variant.price ?? "").trim() !== "");

  const seen = new Set<string>();
  return rows.map((variant) => {
    if (!variant.name) {
      throw new Error("item-variant-name-required");
    }
    const key = variant.name.toLowerCase();
    if (seen.has(key)) {
      throw new Error("item-variant-duplicate");
    }
    seen.add(key);
    const price = parsePositiveMoney(variant.price);
    if (price === null) {
      throw new Error("item-variant-price-invalid");
    }
    return { id: variant.id, name: variant.name, price, sortOrder: variant.sortOrder };
  });
}

function itemVariants(item: ItemDoc) {
  return Array.isArray(item.variants)
    ? item.variants.map((variant, index) => ({
        id: variant.id,
        name: variant.name,
        price: Number(variant.price),
        sortOrder: Number(variant.sortOrder ?? index),
      }))
    : [];
}

function draftFromItem(item: ItemDoc): ItemDraft {
  return {
    name: item.name || "",
    sku: item.sku || "",
    category: item.category || "",
    diet: item.diet || "",
    price: String(item.price ?? ""),
    available: item.available !== false,
    favorite: item.available !== false && Boolean(item.favorite),
    variants: itemVariants(item),
  };
}

function draftKey(draft: ItemDraft) {
  return JSON.stringify({
    ...draft,
    variants: draft.variants.map((variant) => [variant.name, String(variant.price)]),
  });
}

function priceLabel(item: ItemDoc) {
  const variants = itemVariants(item);
  if (!variants.length) {
    return `₹${item.price}`;
  }
  const prices = variants.map((variant) => variant.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `₹${min}` : `₹${min} – ₹${max}`;
}

function categoryKey(value: unknown) {
  return menuMatchKey(value) || NO_CATEGORY;
}

function downloadCsv(content: string, fileName: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ItemsEditor({
  embedded = false,
  addItemRef,
}: {
  embedded?: boolean;
  /** When set (Manage Menu), Add Item lives in ManageShell primaryAction */
  addItemRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { showToast: _showToast } = useToast();
  const showToast = (msg: string, kind: "ok" | "err" = "ok") =>
    _showToast(msg, kind === "err" ? "error" : "success");

  const [items, setItems] = React.useState<ItemDoc[]>([]);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [variantOptions, setVariantOptions] = React.useState<string[]>([]);

  const [query, setQuery] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [dietFilter, setDietFilter] = React.useState<DietFilter>("all");

  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [draft, setDraft] = React.useState<ItemDraft>(EMPTY_DRAFT);
  const [draftBaseline, setDraftBaseline] = React.useState(draftKey(EMPTY_DRAFT));
  const [editorSaving, setEditorSaving] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const [rowBusyId, setRowBusyId] = React.useState<string | null>(null);
  const [reorderBusy, setReorderBusy] = React.useState(false);

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false);

  const [ioMenuOpen, setIoMenuOpen] = React.useState(false);
  const ioMenuAnchor = React.useRef<HTMLButtonElement>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importFileName, setImportFileName] = React.useState("");
  const [importText, setImportText] = React.useState("");
  const [importBusy, setImportBusy] = React.useState(false);
  const [showAllDeactivated, setShowAllDeactivated] = React.useState(false);
  const [importMode, setImportMode] = React.useState<MenuImportMode>("upsert");
  const [replaceConfirmed, setReplaceConfirmed] = React.useState(false);

  const reload = React.useCallback(async () => {
    const [all, loadedCategories, loadedVariantOptions] = await Promise.all([
      getItems(),
      getConfigCategories(),
      getConfigMenuVariantOptions(),
    ]);
    setItems(all);
    setCategories(loadedCategories);
    setVariantOptions(loadedVariantOptions);
  }, []);

  React.useEffect(() => {
    (async () => {
      await seedItems();
      await reload();
    })();
  }, [reload]);

  const openCreate = React.useCallback(() => {
    setEditor({ mode: "create" });
    setDraft(EMPTY_DRAFT);
    setDraftBaseline(draftKey(EMPTY_DRAFT));
  }, []);

  React.useEffect(() => {
    if (!addItemRef) {
      return;
    }
    addItemRef.current = openCreate;
    return () => {
      addItemRef.current = null;
    };
  }, [addItemRef, openCreate]);

  const openEdit = (item: ItemDoc) => {
    const next = draftFromItem(item);
    setEditor({ mode: "edit", itemId: item._id });
    setDraft(next);
    setDraftBaseline(draftKey(next));
  };

  const editingItem =
    editor?.mode === "edit" ? items.find((item) => item._id === editor.itemId) || null : null;
  const draftDirty = editor !== null && draftKey(draft) !== draftBaseline;

  const closeEditor = (force = false) => {
    if (editorSaving || deleting) {
      return;
    }
    if (!force && draftDirty) {
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    setEditor(null);
  };

  const variantNameOptions = (currentValue?: string) => {
    const options = [...variantOptions];
    const current = normalizeText(currentValue);
    if (current && !options.some((entry) => entry.toLowerCase() === current.toLowerCase())) {
      options.push(current);
    }
    return options;
  };

  const itemSkuInUse = (skuValue: string, currentId?: string) => {
    const sku = normalizeSku(skuValue).toLowerCase();
    return Boolean(
      sku &&
        items.some((it) => it._id !== currentId && normalizeSku(it.sku).toLowerCase() === sku),
    );
  };

  const saveEditor = async (addAnother = false) => {
    if (!editor || editorSaving) {
      return;
    }
    const name = normalizeText(draft.name);
    const sku = normalizeSku(draft.sku);
    const category = normalizeCategoryName(draft.category);
    let variants: NormalizedVariant[] = [];
    try {
      variants = normalizeVariantDrafts(draft.variants);
    } catch (e) {
      showToast(validationMessage(e), "err");
      return;
    }
    if (!name) {
      showToast(validationMessage("item-name-required"), "err");
      return;
    }
    const price = variants.length
      ? Math.min(...variants.map((variant) => variant.price))
      : parsePositiveMoney(draft.price);
    if (price === null) {
      showToast(validationMessage("item-price-invalid"), "err");
      return;
    }
    const currentId = editor.mode === "edit" ? editor.itemId : undefined;
    if (itemSkuInUse(sku, currentId)) {
      showToast(validationMessage("item-sku-duplicate"), "err");
      return;
    }
    const diet = (draft.diet || null) as MenuDiet;
    const favorite = draft.available && draft.favorite;
    setEditorSaving(true);
    try {
      if (editor.mode === "create") {
        await createItem({
          name,
          price,
          sku: sku || undefined,
          category: category || undefined,
          available: draft.available,
          favorite,
          diet,
          variants,
        });
      } else {
        const base = items.find((item) => item._id === editor.itemId);
        if (!base) {
          throw new Error("item-not-found");
        }
        await updateItem({
          ...base,
          name,
          sku: sku || undefined,
          price,
          category: category || undefined,
          available: draft.available,
          favorite,
          diet,
          variants: variants.map((variant, index) => ({
            id: variant.id || "",
            name: variant.name,
            price: variant.price,
            sortOrder: variant.sortOrder ?? index,
          })),
        });
      }
      await reload();
      showToast(editor.mode === "create" ? `"${name}" added` : `"${name}" saved`);
      if (addAnother && editor.mode === "create") {
        const next = { ...EMPTY_DRAFT, category: draft.category, diet: draft.diet };
        setDraft(next);
        setDraftBaseline(draftKey(next));
      } else {
        setEditor(null);
      }
    } catch (e) {
      showToast(validationMessage(e, "Failed to save item"), "err");
    } finally {
      setEditorSaving(false);
    }
  };

  const onDeleteEditing = async () => {
    if (!editingItem || deleting) {
      return;
    }
    setDeleting(true);
    try {
      await deleteItem(editingItem._id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(editingItem._id);
        return next;
      });
      await reload();
      showToast(`"${editingItem.name}" deleted`);
      setConfirmDelete(false);
      setEditor(null);
    } catch {
      showToast("Failed to delete item", "err");
    } finally {
      setDeleting(false);
    }
  };

  const updateRow = async (item: ItemDoc, patch: Partial<ItemDoc>, message: string) => {
    if (rowBusyId) {
      return;
    }
    setRowBusyId(item._id);
    try {
      await updateItem({ ...item, ...patch });
      await reload();
      showToast(message);
    } catch (e) {
      showToast(validationMessage(e, "Failed to update item"), "err");
    } finally {
      setRowBusyId(null);
    }
  };

  const toggleAvailable = (item: ItemDoc) => {
    const next = item.available === false;
    void updateRow(
      item,
      { available: next, favorite: next ? item.favorite : false },
      next ? `"${item.name}" is on the menu` : `"${item.name}" is off the menu`,
    );
  };

  const toggleFavorite = (item: ItemDoc) => {
    if (item.available === false) {
      showToast("Items that are off the menu cannot be favourites", "err");
      return;
    }
    const next = !item.favorite;
    void updateRow(item, { favorite: next }, next ? "Added to favourites" : "Removed from favourites");
  };

  // Grouping ---------------------------------------------------------------

  const sectionOrder = React.useMemo(() => {
    const order: Array<{ key: string; name: string; configured: boolean }> = [];
    const seen = new Set<string>();
    for (const name of categories) {
      const key = categoryKey(name);
      if (!seen.has(key)) {
        seen.add(key);
        order.push({ key, name, configured: true });
      }
    }
    for (const item of items) {
      const key = categoryKey(item.category);
      if (!seen.has(key) && key !== NO_CATEGORY) {
        seen.add(key);
        order.push({ key, name: item.category || "", configured: false });
      }
    }
    order.push({ key: NO_CATEGORY, name: "No category", configured: false });
    return order;
  }, [categories, items]);

  const itemsByCategory = React.useMemo(() => {
    const map = new Map<string, ItemDoc[]>();
    for (const item of items) {
      const key = categoryKey(item.category);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [items]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtersActive =
    Boolean(normalizedQuery) || statusFilter !== "all" || favoritesOnly || dietFilter !== "all";

  const matchesFilters = React.useCallback(
    (item: ItemDoc) => {
      if (
        normalizedQuery &&
        !(item.name || "").toLowerCase().includes(normalizedQuery) &&
        !(item.sku || "").toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      const available = item.available !== false;
      if (statusFilter === "on" && !available) {
        return false;
      }
      if (statusFilter === "off" && available) {
        return false;
      }
      if (favoritesOnly && !(available && item.favorite)) {
        return false;
      }
      if (dietFilter === "none" && item.diet) {
        return false;
      }
      if (dietFilter !== "all" && dietFilter !== "none" && item.diet !== dietFilter) {
        return false;
      }
      return true;
    },
    [dietFilter, favoritesOnly, normalizedQuery, statusFilter],
  );

  const sections = sectionOrder
    .filter((section) => categoryFilter === "all" || categoryFilter === section.key)
    .map((section) => ({
      ...section,
      allItems: itemsByCategory.get(section.key) || [],
      items: (itemsByCategory.get(section.key) || []).filter(matchesFilters),
    }))
    .filter((section) => section.items.length > 0);
  const visibleItems = sections.flatMap((section) => section.items);
  const offCount = items.filter((item) => item.available === false).length;
  const canReorder = !filtersActive && !reorderBusy;

  const moveItem = async (sectionItems: ItemDoc[], index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (!canReorder || target < 0 || target >= sectionItems.length) {
      return;
    }
    const ids = sectionItems.map((item) => item._id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setReorderBusy(true);
    try {
      await reorderItems(ids);
      await reload();
    } catch (e) {
      showToast(validationMessage(e, "Could not change the order"), "err");
    } finally {
      setReorderBusy(false);
    }
  };

  const moveCategory = async (name: string, delta: -1 | 1) => {
    const index = categories.findIndex((entry) => categoryKey(entry) === categoryKey(name));
    const target = index + delta;
    if (!canReorder || index < 0 || target < 0 || target >= categories.length) {
      return;
    }
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    setReorderBusy(true);
    try {
      await setConfigCategories(next);
      await reload();
    } catch (e) {
      showToast(validationMessage(e, "Could not change the order"), "err");
    } finally {
      setReorderBusy(false);
    }
  };

  // Selection and bulk actions -----------------------------------------------

  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((it) => selectedIds.has(it._id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleItems.forEach((it) => next.delete(it._id));
      } else {
        visibleItems.forEach((it) => next.add(it._id));
      }
      return next;
    });
  };

  const selectedItems = items.filter((item) => selectedIds.has(item._id));

  const runBulk = async (
    patch: (item: ItemDoc) => Partial<ItemDoc>,
    message: (count: number) => string,
  ) => {
    if (bulkBusy || !selectedItems.length) {
      return;
    }
    setBulkBusy(true);
    let done = 0;
    try {
      for (const item of selectedItems) {
        await updateItem({ ...item, ...patch(item) });
        done += 1;
      }
      showToast(message(done));
      setSelectedIds(new Set());
    } catch (e) {
      showToast(
        `${validationMessage(e, "Some items could not be updated")} (${done} of ${selectedItems.length} done)`,
        "err",
      );
    } finally {
      await reload();
      setBulkBusy(false);
    }
  };

  const onBulkDelete = async () => {
    if (bulkBusy) {
      return;
    }
    const count = selectedIds.size;
    setBulkBusy(true);
    try {
      for (const id of Array.from(selectedIds)) {
        await deleteItem(id);
      }
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
      showToast(`${count} item${count !== 1 ? "s" : ""} deleted`);
    } catch {
      showToast("Failed to delete items", "err");
    } finally {
      await reload();
      setBulkBusy(false);
    }
  };

  // Import and export --------------------------------------------------------

  const importPreview = React.useMemo(
    () =>
      importText
        ? validateMenuCsv(
            importText,
            items.map((item) => ({
              id: item._id,
              name: item.name,
              category: item.category || null,
              sku: item.sku || null,
              active: true,
              price: item.price,
              variants: itemVariants(item),
              available: item.available !== false,
              favorite: item.available !== false && Boolean(item.favorite),
              diet: item.diet || null,
            })),
            categories,
            importMode,
          )
        : null,
    [categories, importMode, importText, items],
  );
  const replaceNeedsConfirm =
    importPreview?.mode === "replace" &&
    importPreview.deactivatedItems + importPreview.deactivatedCategories > 0;

  const exportMenu = () => {
    setIoMenuOpen(false);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(
      menuExportCsv(
        items.map((item) => ({
          category: item.category,
          name: item.name,
          sku: item.sku,
          price: item.price,
          diet: item.diet || null,
          available: item.available !== false,
          favorite: Boolean(item.favorite),
          variants: itemVariants(item),
        })),
      ),
      `restoniti-menu-${date}.csv`,
    );
  };

  const downloadTemplate = () => {
    setIoMenuOpen(false);
    downloadCsv(menuImportTemplate(), "restoniti-menu-template.csv");
  };

  const onImportFile = async (file: File | null) => {
    if (!file) {
      return;
    }
    setImportFileName(file.name);
    setImportText(await file.text());
    setShowAllDeactivated(false);
    setImportMode("upsert");
    setReplaceConfirmed(false);
    setImportOpen(true);
  };

  const closeImport = () => {
    if (importBusy) {
      return;
    }
    setImportOpen(false);
    setImportText("");
    setImportFileName("");
  };

  const confirmImport = async () => {
    if (
      !importPreview ||
      importPreview.errors.length ||
      importBusy ||
      (replaceNeedsConfirm && !replaceConfirmed)
    ) {
      return;
    }
    setImportBusy(true);
    try {
      await importMenu({ csv: importText, fileName: importFileName, mode: importPreview.mode });
      setImportOpen(false);
      setImportText("");
      setImportFileName("");
      await reload();
      showToast(importPreview.mode === "replace" ? "Menu replaced" : "Menu items imported");
    } catch (error) {
      const details = (error as { details?: string[] }).details;
      showToast(details?.[0] || validationMessage(error, "Menu import failed"), "err");
    } finally {
      setImportBusy(false);
    }
  };

  // Render -------------------------------------------------------------------

  const categoryOptions = [
    ...categories,
    ...(draft.category && !categories.some((c) => categoryKey(c) === categoryKey(draft.category))
      ? [draft.category]
      : []),
  ];

  return (
    <div className={embedded ? undefined : "pos-page"}>
      {!embedded && (
        <PageHeader
          title="Menu"
          subtitle={`${items.length} item${items.length !== 1 ? "s" : ""} · tap an item to edit it`}
          actions={
            <Button variant="primary" onClick={openCreate}>
              + Add Item
            </Button>
          }
        />
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <input
          placeholder="Search by name or SKU..."
          value={query}
          maxLength={TEXT_LIMITS.search}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search menu items"
          style={{
            flex: 1,
            padding: "9px 12px",
            borderRadius: 8,
            border: "1.5px solid var(--pos-line)",
            fontSize: 14,
            outline: "none",
            background: "var(--pos-surface)",
            fontFamily: "inherit",
          }}
        />
        {query && (
          <Button variant="secondary" onClick={() => setQuery("")}>
            Clear
          </Button>
        )}
        <button
          ref={ioMenuAnchor}
          type="button"
          className="ui-btn ui-btn-secondary"
          aria-haspopup="menu"
          aria-expanded={ioMenuOpen}
          onClick={() => setIoMenuOpen((open) => !open)}
        >
          Import / Export ▾
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            event.target.value = "";
            void onImportFile(file);
          }}
        />
        <PortalMenu
          open={ioMenuOpen}
          anchorRef={ioMenuAnchor}
          onClose={() => setIoMenuOpen(false)}
          align="right"
          minWidth={280}
        >
          <PortalMenuItem onClick={exportMenu} disabled={!items.length}>
            Export menu as CSV
          </PortalMenuItem>
          <PortalMenuItem
            onClick={() => {
              setIoMenuOpen(false);
              importInputRef.current?.click();
            }}
          >
            Import CSV…
          </PortalMenuItem>
          <PortalMenuItem onClick={downloadTemplate}>Download blank template</PortalMenuItem>
          <div
            style={{
              padding: "8px 12px 6px",
              fontSize: 11,
              lineHeight: 1.4,
              color: "var(--pos-tx-muted)",
              borderTop: "1px solid var(--pos-line)",
              marginTop: 4,
            }}
          >
            Tip: Use Excel&apos;s CSV UTF-8 format if your menu contains Hindi, Marathi, ₹, or
            other special characters.
          </div>
        </PortalMenu>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ width: 300, flexShrink: 0 }}>
          <SegmentedControl
            ariaLabel="Filter by availability"
            value={statusFilter}
            onChange={(id) => setStatusFilter(id as StatusFilter)}
            options={[
              { id: "all", label: "All items" },
              { id: "on", label: "On menu" },
              { id: "off", label: `Off menu${offCount ? ` (${offCount})` : ""}` },
            ]}
          />
        </div>
        <Button
          variant={favoritesOnly ? "primary" : "secondary"}
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((value) => !value)}
          style={{ minHeight: FILTER_HEIGHT }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon icon={Star} size="sm" fill={favoritesOnly ? "currentColor" : "none"} />
            Favourites
          </span>
        </Button>
        <select
          className="ui-select"
          aria-label="Filter by diet"
          value={dietFilter}
          onChange={(e) => setDietFilter(e.target.value as DietFilter)}
          style={{ width: "auto", minWidth: 150, minHeight: FILTER_HEIGHT }}
        >
          <option value="all">Any diet</option>
          <option value="veg">Veg</option>
          <option value="non-veg">Non-veg</option>
          <option value="egg">Egg</option>
          <option value="none">Diet not set</option>
        </select>
        {filtersActive ? (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
              setStatusFilter("all");
              setFavoritesOnly(false);
              setDietFilter("all");
            }}
          >
            Reset filters
          </Button>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <CategoryChip
          label="All"
          count={items.length}
          active={categoryFilter === "all"}
          onClick={() => setCategoryFilter("all")}
        />
        {sectionOrder.map((section) => {
          const count = (itemsByCategory.get(section.key) || []).length;
          if (!count) {
            return null;
          }
          return (
            <CategoryChip
              key={section.key}
              label={section.name}
              count={count}
              active={categoryFilter === section.key}
              onClick={() => setCategoryFilter(section.key)}
            />
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 8,
          color: "var(--pos-tx-muted)",
          fontSize: 12,
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleSelectAll}
            disabled={!visibleItems.length}
            style={{ width: 15, height: 15, cursor: "pointer" }}
          />
          Select all shown ({visibleItems.length})
        </label>
        <span>
          {filtersActive
            ? "Clear the search and filters to change the order."
            : "Use the arrows to change the order on Billing and Captain."}
        </span>
      </div>

      {sections.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 0",
            color: "var(--pos-tx-muted)",
            fontSize: 14,
          }}
        >
          {items.length ? "No items match these filters" : "No menu items yet. Add one or import a CSV."}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 18, paddingBottom: selectedIds.size ? 90 : 0 }}>
        {sections.map((section) => {
          const configuredIndex = section.configured
            ? categories.findIndex((entry) => categoryKey(entry) === section.key)
            : -1;
          return (
            <section key={section.key} aria-label={section.name}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "0 4px 6px",
                  borderBottom: "1px solid var(--pos-line)",
                  marginBottom: 6,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--pos-tx)" }}>
                  {section.name}
                </h3>
                <span style={{ fontSize: 12, color: "var(--pos-tx-muted)" }}>
                  {section.items.length === section.allItems.length
                    ? `${section.allItems.length} item${section.allItems.length !== 1 ? "s" : ""}`
                    : `${section.items.length} of ${section.allItems.length}`}
                </span>
                <span style={{ flex: 1 }} />
                {configuredIndex >= 0 ? (
                  <ReorderButtons
                    label={`category ${section.name}`}
                    disabled={!canReorder}
                    canUp={configuredIndex > 0}
                    canDown={configuredIndex < categories.length - 1}
                    onUp={() => void moveCategory(section.name, -1)}
                    onDown={() => void moveCategory(section.name, 1)}
                  />
                ) : null}
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {section.items.map((item) => {
                  const index = section.allItems.indexOf(item);
                  return (
                    <MenuRow
                      key={item._id}
                      item={item}
                      selected={selectedIds.has(item._id)}
                      busy={rowBusyId === item._id}
                      reorder={{
                        disabled: !canReorder,
                        canUp: index > 0,
                        canDown: index < section.allItems.length - 1,
                        onUp: () => void moveItem(section.allItems, index, -1),
                        onDown: () => void moveItem(section.allItems, index, 1),
                      }}
                      onSelect={() => toggleSelect(item._id)}
                      onOpen={() => openEdit(item)}
                      onToggleAvailable={() => toggleAvailable(item)}
                      onToggleFavorite={() => toggleFavorite(item)}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {selectedIds.size > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--pos-surface)",
            border: "1px solid var(--pos-line-strong)",
            boxShadow: "var(--pos-shadow-overlay)",
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          <strong style={{ fontSize: 13, marginRight: 4 }}>
            {selectedIds.size} selected
          </strong>
          <Button
            size="sm"
            disabled={bulkBusy}
            onClick={() =>
              void runBulk(
                () => ({ available: true }),
                (count) => `${count} item${count !== 1 ? "s" : ""} turned on`,
              )
            }
          >
            Turn on
          </Button>
          <Button
            size="sm"
            disabled={bulkBusy}
            onClick={() =>
              void runBulk(
                () => ({ available: false, favorite: false }),
                (count) => `${count} item${count !== 1 ? "s" : ""} turned off`,
              )
            }
          >
            Turn off
          </Button>
          <select
            className="ui-select"
            aria-label="Move selected items to category"
            value=""
            disabled={bulkBusy || !categories.length}
            onChange={(e) => {
              const category = e.target.value;
              if (category) {
                void runBulk(
                  () => ({ category }),
                  (count) => `${count} item${count !== 1 ? "s" : ""} moved to ${category}`,
                );
              }
            }}
            style={{ width: "auto", minWidth: 150 }}
          >
            <option value="">Move to category…</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <select
            className="ui-select"
            aria-label="Set diet for selected items"
            value=""
            disabled={bulkBusy}
            onChange={(e) => {
              const value = e.target.value;
              if (value) {
                const diet = (value === "none" ? null : value) as MenuDiet;
                void runBulk(
                  () => ({ diet }),
                  (count) => `Diet updated for ${count} item${count !== 1 ? "s" : ""}`,
                );
              }
            }}
            style={{ width: "auto", minWidth: 120 }}
          >
            <option value="">Set diet…</option>
            <option value="veg">Veg</option>
            <option value="non-veg">Non-veg</option>
            <option value="egg">Egg</option>
            <option value="none">Not set</option>
          </select>
          <Button
            size="sm"
            variant="danger-ghost"
            disabled={bulkBusy}
            onClick={() => setConfirmBulkDelete(true)}
          >
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={bulkBusy}
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      <ConfirmModal
        open={confirmBulkDelete}
        title={`Delete ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""}?`}
        confirmLabel="Delete"
        loading={bulkBusy}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={onBulkDelete}
        warning="This cannot be undone. To hide items for now, use Turn off instead."
      />

      <Drawer
        open={editor !== null}
        title={editor?.mode === "create" ? "New menu item" : `Edit ${editingItem?.name || "item"}`}
        onClose={() => closeEditor()}
        footer={
          <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center" }}>
            {editor?.mode === "edit" ? (
              <Button
                variant="danger-ghost"
                disabled={editorSaving || deleting}
                onClick={() => setConfirmDelete(true)}
              >
                Delete item
              </Button>
            ) : null}
            <span style={{ flex: 1 }} />
            <Button variant="secondary" onClick={() => closeEditor()} disabled={editorSaving}>
              Cancel
            </Button>
            {editor?.mode === "create" ? (
              <Button
                variant="secondary"
                onClick={() => void saveEditor(true)}
                disabled={editorSaving}
              >
                Save & add another
              </Button>
            ) : null}
            <Button
              variant="primary"
              onClick={() => void saveEditor(false)}
              disabled={editorSaving || (editor?.mode === "edit" && !draftDirty)}
            >
              {editorSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        <ItemForm
          draft={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          categoryOptions={categoryOptions}
          variantOptions={variantOptions}
          variantNameOptions={variantNameOptions}
          onSubmit={() => void saveEditor(false)}
        />
      </Drawer>

      <ConfirmModal
        open={confirmDiscard}
        title="Discard your changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => closeEditor(true)}
        warning="Your changes to this item have not been saved."
      />

      <ConfirmModal
        open={confirmDelete}
        title={`Delete "${editingItem?.name || "item"}"?`}
        confirmLabel="Delete"
        loading={deleting}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDeleteEditing}
        warning="This cannot be undone. Past bills keep their lines. To hide the item for now, turn it off instead."
      />

      <Modal
        open={importOpen && importPreview !== null}
        title={`Import menu from ${importFileName || "CSV"}`}
        onClose={closeImport}
        large
      >
        {importPreview ? (
          <ImportPreviewBody
            preview={importPreview}
            mode={importMode}
            busy={importBusy}
            showAllDeactivated={showAllDeactivated}
            replaceNeedsConfirm={replaceNeedsConfirm}
            replaceConfirmed={replaceConfirmed}
            onModeChange={(mode) => {
              setImportMode(mode);
              setReplaceConfirmed(false);
            }}
            onToggleShowAll={() => setShowAllDeactivated((value) => !value)}
            onReplaceConfirmed={setReplaceConfirmed}
            onCancel={closeImport}
            onConfirm={() => void confirmImport()}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--pos-teal)" : "var(--pos-line)"}`,
        background: active ? "var(--pos-teal)" : "var(--pos-surface)",
        color: active ? "var(--pos-surface)" : "var(--pos-tx-sec)",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label} <span style={{ opacity: 0.75, fontWeight: 500 }}>{count}</span>
    </button>
  );
}

function ReorderButtons({
  label,
  disabled,
  canUp,
  canDown,
  onUp,
  onDown,
}: {
  label: string;
  disabled: boolean;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  const style: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 6,
    border: "1px solid var(--pos-line)",
    background: "var(--pos-surface)",
    color: "var(--pos-tx-sec)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };
  return (
    <span style={{ display: "inline-flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={`Move ${label} up`}
        title="Move up"
        disabled={disabled || !canUp}
        onClick={onUp}
        style={{
          ...style,
          opacity: disabled || !canUp ? 0.35 : 1,
          cursor: disabled || !canUp ? "default" : "pointer",
        }}
      >
        <Icon icon={ChevronUp} size="sm" />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        title="Move down"
        disabled={disabled || !canDown}
        onClick={onDown}
        style={{
          ...style,
          opacity: disabled || !canDown ? 0.35 : 1,
          cursor: disabled || !canDown ? "default" : "pointer",
        }}
      >
        <Icon icon={ChevronDown} size="sm" />
      </button>
    </span>
  );
}

function DietMark({ diet }: { diet?: string | null }) {
  if (!diet) {
    return null;
  }
  const color =
    diet === "non-veg"
      ? "var(--pos-danger)"
      : diet === "egg"
        ? "var(--pos-saffron-deep)"
        : "var(--pos-success)";
  const label = diet === "non-veg" ? "Non-veg" : diet === "egg" ? "Egg" : "Veg";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        border: `1.5px solid ${color}`,
        borderRadius: 3,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
    </span>
  );
}

function AvailabilitySwitch({
  on,
  disabled,
  onToggle,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "none",
        border: "none",
        padding: 4,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        fontSize: 12,
        fontWeight: 700,
        color: on ? "var(--pos-success)" : "var(--pos-tx-muted)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 34,
          height: 20,
          borderRadius: 999,
          background: on ? "var(--pos-success)" : "var(--pos-line-strong)",
          position: "relative",
          transition: "background 120ms",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: on ? 16 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "var(--pos-surface)",
            boxShadow: "var(--pos-shadow-1)",
            transition: "left 120ms",
          }}
        />
      </span>
      <span style={{ minWidth: 22, textAlign: "left" }}>{on ? "On" : "Off"}</span>
    </button>
  );
}

function MenuRow({
  item,
  selected,
  busy,
  reorder,
  onSelect,
  onOpen,
  onToggleAvailable,
  onToggleFavorite,
}: {
  item: ItemDoc;
  selected: boolean;
  busy: boolean;
  reorder: {
    disabled: boolean;
    canUp: boolean;
    canDown: boolean;
    onUp: () => void;
    onDown: () => void;
  };
  onSelect: () => void;
  onOpen: () => void;
  onToggleAvailable: () => void;
  onToggleFavorite: () => void;
}) {
  const available = item.available !== false;
  const favorite = available && Boolean(item.favorite);
  const variants = itemVariants(item);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Edit ${item.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "28px 62px minmax(0,1fr) 130px 84px 40px 32px",
        columnGap: 8,
        alignItems: "center",
        padding: "8px 12px",
        borderRadius: 10,
        background: selected ? "var(--pos-teal-tint)" : "var(--pos-surface)",
        border: `1px solid ${selected ? "var(--pos-teal-line)" : "var(--pos-surface-sunken)"}`,
        boxShadow: "var(--pos-shadow-1)",
        cursor: "pointer",
      }}
    >
      <span
        onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", justifyContent: "center" }}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select ${item.name}`}
          style={{ cursor: "pointer", width: 15, height: 15 }}
        />
      </span>
      <ReorderButtons label={item.name} {...reorder} />
      <div style={{ minWidth: 0, opacity: available ? 1 : 0.55 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <DietMark diet={item.diet} />
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--pos-tx)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.name}
          </span>
          {!available ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--pos-tx-muted)",
                border: "1px solid var(--pos-line)",
                borderRadius: 4,
                padding: "0 5px",
                flexShrink: 0,
              }}
            >
              Off menu
            </span>
          ) : null}
        </div>
        {variants.length || item.sku ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--pos-tx-muted)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {variants.map((variant) => `${variant.name} ₹${variant.price}`).join(" · ")}
            {variants.length && item.sku ? " · " : ""}
            {item.sku ? `SKU ${item.sku}` : ""}
          </div>
        ) : null}
      </div>
      <span
        style={{
          textAlign: "right",
          fontSize: 14,
          fontWeight: 700,
          color: "var(--pos-tx)",
          opacity: available ? 1 : 0.55,
          whiteSpace: "nowrap",
        }}
      >
        {priceLabel(item)}
      </span>
      <AvailabilitySwitch
        on={available}
        disabled={busy}
        onToggle={onToggleAvailable}
        label={available ? `Take ${item.name} off the menu` : `Put ${item.name} on the menu`}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        disabled={!available || busy}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${item.name} from favourites` : `Add ${item.name} to favourites`}
        title={available ? (favorite ? "Remove from favourites" : "Add to favourites") : "Off-menu items cannot be favourites"}
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: favorite ? "var(--pos-saffron-tint)" : "transparent",
          border: `1px solid ${favorite ? "var(--pos-saffron-line)" : "transparent"}`,
          color: favorite ? "var(--pos-saffron-deep)" : "var(--pos-tx-muted)",
          cursor: available && !busy ? "pointer" : "default",
          opacity: available ? 1 : 0.4,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      >
        <Icon icon={Star} size="md" fill={favorite ? "currentColor" : "none"} />
      </button>
      <span
        aria-hidden
        style={{ color: "var(--pos-tx-muted)", display: "flex", justifyContent: "center" }}
      >
        <Icon icon={Pencil} size="sm" />
      </span>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--pos-tx-sec)",
  display: "block",
  marginBottom: 4,
};

const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1.5px solid var(--pos-line-strong)",
  fontSize: 14,
  boxSizing: "border-box",
  background: "var(--pos-surface)",
  color: "var(--pos-tx)",
  fontFamily: "inherit",
};

function ItemForm({
  draft,
  onChange,
  categoryOptions,
  variantOptions,
  variantNameOptions,
  onSubmit,
}: {
  draft: ItemDraft;
  onChange: (patch: Partial<ItemDraft>) => void;
  categoryOptions: string[];
  variantOptions: string[];
  variantNameOptions: (current?: string) => string[];
  onSubmit: () => void;
}) {
  const hasVariants = draft.variants.length > 0;
  const setVariant = (index: number, patch: Partial<VariantDraft>) =>
    onChange({
      variants: draft.variants.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    });
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <label style={fieldLabelStyle} htmlFor="menu-item-name">
          Item name <span style={{ color: "var(--pos-danger)" }}>*</span>
        </label>
        <input
          id="menu-item-name"
          placeholder="e.g. Paneer Tikka"
          value={draft.name}
          maxLength={TEXT_LIMITS.menuItemName}
          onChange={(e) => onChange({ name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          autoFocus
          style={fieldInputStyle}
        />
      </div>

      <div>
        <label style={fieldLabelStyle} htmlFor="menu-item-category">
          Category
        </label>
        <select
          id="menu-item-category"
          value={draft.category}
          onChange={(e) => onChange({ category: e.target.value })}
          style={{ ...fieldInputStyle, cursor: "pointer" }}
        >
          <option value="">No category</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span style={fieldLabelStyle}>Diet</span>
        <SegmentedControl
          ariaLabel="Diet"
          value={draft.diet || "none"}
          onChange={(id) => onChange({ diet: id === "none" ? "" : id })}
          options={[
            { id: "none", label: "Not set" },
            { id: "veg", label: "Veg" },
            { id: "non-veg", label: "Non-veg" },
            { id: "egg", label: "Egg" },
          ]}
        />
      </div>

      {!hasVariants ? (
        <div>
          <label style={fieldLabelStyle} htmlFor="menu-item-price">
            Price (₹) <span style={{ color: "var(--pos-danger)" }}>*</span>
          </label>
          <input
            id="menu-item-price"
            type="number"
            inputMode="decimal"
            placeholder="e.g. 120"
            value={draft.price}
            onChange={(e) => onChange({ price: e.target.value })}
            style={fieldInputStyle}
          />
        </div>
      ) : null}

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span style={{ ...fieldLabelStyle, marginBottom: 0 }}>
            Sizes / variants {hasVariants ? "" : "(optional)"}
          </span>
          <Button
            size="sm"
            onClick={() =>
              onChange({
                variants: [
                  ...draft.variants,
                  {
                    name: variantOptions[draft.variants.length] || variantOptions[0] || "",
                    price: draft.variants.length ? "" : draft.price,
                    sortOrder: draft.variants.length,
                  },
                ],
              })
            }
          >
            + Add variant
          </Button>
        </div>
        {!hasVariants ? (
          <div style={{ fontSize: 12, color: "var(--pos-tx-muted)" }}>
            For items like Half / Full with different prices. The item then uses the variant
            prices.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {variantOptions.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--pos-saffron-text)" }}>
                Add variant names like Half and Full in Settings to pick them here.
              </div>
            ) : null}
            {draft.variants.map((variant, index) => (
              <div
                key={`${variant.id || "new"}-${index}`}
                style={{ display: "grid", gridTemplateColumns: "1fr 120px 36px", gap: 8 }}
              >
                <select
                  aria-label={`Variant ${index + 1} name`}
                  value={variant.name}
                  onChange={(e) => setVariant(index, { name: e.target.value })}
                  style={{ ...fieldInputStyle, padding: "8px 10px", cursor: "pointer" }}
                >
                  <option value="">Select variant…</option>
                  {variantNameOptions(variant.name).map((nameOption) => (
                    <option key={nameOption} value={nameOption}>
                      {nameOption}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`Variant ${index + 1} price`}
                  aria-invalid={parsePositiveMoney(variant.price) === null}
                  type="number"
                  inputMode="decimal"
                  placeholder="Price"
                  value={variant.price}
                  onChange={(e) => setVariant(index, { price: e.target.value })}
                  style={{
                    ...fieldInputStyle,
                    padding: "8px 10px",
                    ...(parsePositiveMoney(variant.price) === null
                      ? { borderColor: "var(--pos-danger-line)" }
                      : {}),
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      variants: draft.variants.filter((_, rowIndex) => rowIndex !== index),
                      ...(draft.variants.length === 1 && !draft.price
                        ? { price: String(variant.price ?? "") }
                        : {}),
                    })
                  }
                  aria-label={`Remove variant ${variant.name || index + 1}`}
                  title="Remove variant"
                  style={{
                    width: 36,
                    height: 38,
                    borderRadius: 8,
                    border: "none",
                    background: "var(--pos-danger-tint)",
                    color: "var(--pos-danger)",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </div>
            ))}
            {draft.variants.some((variant) => parsePositiveMoney(variant.price) === null) ? (
              <div style={{ fontSize: 12, color: "var(--pos-danger-text)" }}>
                Enter a price for each variant, or remove the ones you don&apos;t need.
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={draft.available}
            onChange={(e) =>
              onChange({
                available: e.target.checked,
                ...(e.target.checked ? {} : { favorite: false }),
              })
            }
            style={{ width: 16, height: 16 }}
          />
          On the menu (shown on Billing and Captain)
        </label>
        <label
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            fontSize: 14,
            opacity: draft.available ? 1 : 0.5,
          }}
        >
          <input
            type="checkbox"
            checked={draft.available && draft.favorite}
            disabled={!draft.available}
            onChange={(e) => onChange({ favorite: e.target.checked })}
            style={{ width: 16, height: 16 }}
          />
          Favourite (shown first on Billing)
        </label>
      </div>

      <div>
        <label style={fieldLabelStyle} htmlFor="menu-item-sku">
          SKU / code (optional)
        </label>
        <input
          id="menu-item-sku"
          placeholder="e.g. PT-01"
          value={draft.sku}
          maxLength={TEXT_LIMITS.sku}
          onChange={(e) => onChange({ sku: e.target.value })}
          style={fieldInputStyle}
        />
        <div style={{ fontSize: 12, color: "var(--pos-tx-muted)", marginTop: 4 }}>
          Only needed if you match items by code, for example in CSV imports.
        </div>
      </div>
    </div>
  );
}

function SummaryChip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "danger" }) {
  return (
    <span
      style={{
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: tone === "danger" ? "var(--pos-danger-tint)" : "var(--pos-surface-sunken)",
        color: tone === "danger" ? "var(--pos-danger-text)" : "var(--pos-tx-sec)",
      }}
    >
      {label}
    </span>
  );
}

function ImportPreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ maxHeight: 180, overflowY: "auto", display: "grid", gap: 2 }}>{children}</div>
    </div>
  );
}

function ImportPreviewBody({
  preview,
  mode,
  busy,
  showAllDeactivated,
  replaceNeedsConfirm,
  replaceConfirmed,
  onModeChange,
  onToggleShowAll,
  onReplaceConfirmed,
  onCancel,
  onConfirm,
}: {
  preview: ReturnType<typeof validateMenuCsv>;
  mode: MenuImportMode;
  busy: boolean;
  showAllDeactivated: boolean;
  replaceNeedsConfirm: boolean;
  replaceConfirmed: boolean;
  onModeChange: (mode: MenuImportMode) => void;
  onToggleShowAll: () => void;
  onReplaceConfirmed: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const replacing = preview.mode === "replace";
  const hasErrors = preview.errors.length > 0;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
          <input
            type="radio"
            name="menu-import-mode"
            checked={mode === "upsert"}
            disabled={busy}
            onChange={() => onModeChange("upsert")}
          />
          <span>
            <strong>Add or update items</strong>. Items and categories not in the file stay as they
            are.
          </span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
          <input
            type="radio"
            name="menu-import-mode"
            checked={mode === "replace"}
            disabled={busy}
            onChange={() => onModeChange("replace")}
          />
          <span>
            <strong>Replace whole menu</strong>. The file becomes the full menu; anything not in it
            is taken off the menu.
          </span>
        </label>
      </div>

      {hasErrors ? (
        <div
          style={{
            color: "var(--pos-danger-text)",
            background: "var(--pos-danger-tint)",
            border: "1px solid var(--pos-danger-line)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13,
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            Fix{" "}
            {preview.errors.length === 1
              ? "this problem"
              : `these ${preview.errors.length} problems`}{" "}
            in the file, then import it again:
          </div>
          {preview.errors.map((error, index) => (
            <div key={`${index}-${error}`}>{error}</div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <SummaryChip label={`${preview.created} new`} />
          <SummaryChip label={`${preview.updated} updated`} />
          {preview.updated ? (
            <SummaryChip label={`${preview.changes.length} with changes`} />
          ) : null}
          {preview.unchangedItems ? (
            <SummaryChip label={`${preview.unchangedItems} unchanged`} />
          ) : null}
          <SummaryChip
            label={`${preview.deactivatedItems} taken off`}
            tone={preview.deactivatedItems ? "danger" : "neutral"}
          />
          {replacing ? (
            <SummaryChip
              label={`${preview.deactivatedCategories} categories taken off`}
              tone={preview.deactivatedCategories ? "danger" : "neutral"}
            />
          ) : null}
        </div>
      )}

      {preview.warnings.length ? (
        <div
          style={{
            background: "var(--pos-saffron-tint)",
            border: "1px solid var(--pos-saffron-line)",
            color: "var(--pos-saffron-text)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13,
            display: "grid",
            gap: 4,
          }}
        >
          <strong>Please check</strong>
          {preview.warnings.map((warning, index) => (
            <div key={`${index}-${warning}`}>{warning}</div>
          ))}
        </div>
      ) : null}

      {!hasErrors ? (
        <>
          {preview.changes.length ? (
            <ImportPreviewSection title="What changes on existing items">
              {preview.changes.map((change) => (
                <div key={`${change.category}-${change.name}`}>
                  <strong>{change.name}</strong>{" "}
                  <span style={{ color: "var(--pos-tx-muted)" }}>({change.category})</span>:{" "}
                  {change.details.join("; ")}
                </div>
              ))}
            </ImportPreviewSection>
          ) : null}
          {preview.identityChanges.length ? (
            <ImportPreviewSection title="Name, code and category changes">
              {preview.identityChanges.map((change, index) => (
                <div key={`${index}-${change}`}>{change}</div>
              ))}
            </ImportPreviewSection>
          ) : null}
          <ImportPreviewSection
            title={
              replacing
                ? "Categories, in menu order"
                : "Categories in the file (new ones go after your existing categories)"
            }
          >
            {preview.categories.map((category) => (
              <div key={category.name}>
                {category.name}: {category.itemCount} {category.itemCount === 1 ? "item" : "items"}
                {category.isNew ? " (new)" : ""}
              </div>
            ))}
          </ImportPreviewSection>
          {preview.variantItems.length ? (
            <ImportPreviewSection title="Items with sizes or variants">
              {preview.variantItems.map((item) => (
                <div key={`${item.category}-${item.name}`}>
                  {item.name} ({item.category}): {item.variantCount} variants
                </div>
              ))}
            </ImportPreviewSection>
          ) : null}
          {preview.deactivatedItemNames.length ? (
            <ImportPreviewSection title="Items that will be taken off the menu">
              {(showAllDeactivated
                ? preview.deactivatedItemNames
                : preview.deactivatedItemNames.slice(0, 10)
              ).map((name, index) => (
                <div key={`${index}-${name}`}>{name}</div>
              ))}
              {preview.deactivatedItemNames.length > 10 ? (
                <div>
                  <Button size="sm" onClick={onToggleShowAll}>
                    {showAllDeactivated
                      ? "Show fewer"
                      : `Show all ${preview.deactivatedItemNames.length}`}
                  </Button>
                </div>
              ) : null}
            </ImportPreviewSection>
          ) : null}
          {preview.deactivatedCategoryNames.length ? (
            <ImportPreviewSection title="Categories that will be taken off the menu">
              <div>{preview.deactivatedCategoryNames.join(", ")}</div>
            </ImportPreviewSection>
          ) : null}
          <div style={{ fontSize: 12, color: "var(--pos-tx-muted)" }}>
            Past bills are never changed by an import.
          </div>
        </>
      ) : null}

      {!hasErrors && replaceNeedsConfirm ? (
        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            fontSize: 13,
            color: "var(--pos-danger-text)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={replaceConfirmed}
            disabled={busy}
            onChange={(event) => onReplaceConfirmed(event.target.checked)}
          />
          <span>
            I understand that {preview.deactivatedItems} items and {preview.deactivatedCategories}{" "}
            categories not in this file will be taken off the menu.
          </span>
        </label>
      ) : null}

      <div className="ui-form-actions">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={replacing ? "danger" : "primary"}
          disabled={busy || hasErrors || (replaceNeedsConfirm && !replaceConfirmed)}
          onClick={onConfirm}
        >
          {busy
            ? replacing
              ? "Replacing…"
              : "Importing…"
            : replacing
              ? "Replace menu"
              : "Add or update items"}
        </Button>
      </div>
    </div>
  );
}
