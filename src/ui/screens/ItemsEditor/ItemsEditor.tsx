import React from "react";
import {
  getItems,
  seedItems,
  createItem,
  updateItem,
  deleteItem,
  getConfigCategories,
  getConfigMenuVariantOptions,
} from "../../../app/db/posRepository";
import {
  normalizeCategoryName,
  normalizeSku,
  normalizeText,
  parsePositiveMoney,
  validationMessage,
} from "../../../shared/validation";
import { useToast } from "../../context/ToastContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Icon } from "../../components/ui/Icon";
import { Star, X } from "lucide-react";

const MENU_PAGE_SIZE = 50;

type VariantDraft = {
  id?: string;
  name: string;
  price: number;
  sortOrder?: number;
};

function normalizeVariantDrafts(input: VariantDraft[]) {
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

  if (!rows.length) {
    return [] as VariantDraft[];
  }

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
    return {
      id: variant.id,
      name: variant.name,
      price,
      sortOrder: variant.sortOrder,
    };
  });
}

function getVariantMinPrice(variants: VariantDraft[]) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return null;
  }
  const prices = variants
    .map((variant) => parsePositiveMoney(variant.price))
    .filter((price): price is number => price !== null);
  if (!prices.length) {
    return null;
  }
  return Math.min(...prices);
}

function getVariantPriceLabel(variants: VariantDraft[]) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return "";
  }
  const prices = variants
    .map((variant) => parsePositiveMoney(variant.price))
    .filter((price): price is number => price !== null);
  if (!prices.length) {
    return "";
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `₹${min}` : `₹${min} - ₹${max}`;
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
  const [items, setItems] = React.useState<any[]>([]);
  const [query, setQuery] = React.useState("");
  const [pageIndex, setPageIndex] = React.useState(0);
  // Modal states
  const [modalOpen, setModalOpen] = React.useState(false);
  const [modalName, setModalName] = React.useState("");
  const [modalSku, setModalSku] = React.useState("");
  const [modalPrice, setModalPrice] = React.useState<number>(100);
  const [modalCategory, setModalCategory] = React.useState("");
  const [modalAvailable, setModalAvailable] = React.useState(true);
  const [modalVariants, setModalVariants] = React.useState<VariantDraft[]>([]);
  const [modalSaving, setModalSaving] = React.useState(false);

  React.useEffect(() => {
    if (!addItemRef) {
      return;
    }
    addItemRef.current = () => setModalOpen(true);
    return () => {
      addItemRef.current = null;
    };
  }, [addItemRef]);

  // Inline edit map: itemId -> draft field overrides.
  const [editMap, setEditMap] = React.useState<
    Record<
      string,
      {
        price?: number;
        name?: string;
        sku?: string;
        category?: string;
        available?: boolean;
        favorite?: boolean;
        variants?: VariantDraft[];
      }
    >
  >({});
  const [saveAllLoading, setSaveAllLoading] = React.useState(false);
  const [deletingItemId, setDeletingItemId] = React.useState<string | null>(null);
  const [bulkDeleteLoading, setBulkDeleteLoading] = React.useState(false);
  const [favoriteUpdatingId, setFavoriteUpdatingId] = React.useState<string | null>(null);
  const [variantEditorItemId, setVariantEditorItemId] = React.useState<string | null>(null);
  const [variantEditorDraft, setVariantEditorDraft] = React.useState<VariantDraft[]>([]);
  const [variantEditorSaving, setVariantEditorSaving] = React.useState(false);
  const modalSavingRef = React.useRef(false);
  const saveAllLoadingRef = React.useRef(false);
  const deletingItemRef = React.useRef<string | null>(null);
  const bulkDeleteLoadingRef = React.useRef(false);
  const favoriteUpdatingRef = React.useRef(false);

  // Categories loaded from DB config
  const [categories, setCategories] = React.useState<string[]>([]);
  const [variantOptions, setVariantOptions] = React.useState<string[]>([]);

  React.useEffect(() => {
    (async () => {
      await seedItems();
      const all = await getItems();
      setItems(all);
      const [loadedCategories, loadedVariantOptions] = await Promise.all([
        getConfigCategories(),
        getConfigMenuVariantOptions(),
      ]);
      setCategories(loadedCategories);
      setVariantOptions(loadedVariantOptions);
    })();
  }, []);

  const variantNameOptions = React.useCallback(
    (currentValue?: string) => {
      const options = [...variantOptions];
      const current = normalizeText(currentValue);
      if (current && !options.some((entry) => entry.toLowerCase() === current.toLowerCase())) {
        options.push(current);
      }
      return options;
    },
    [variantOptions],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = React.useMemo(
    () =>
      items.filter(
        (it) =>
          (it.name || "").toLowerCase().includes(normalizedQuery) ||
          (it.sku || "").toLowerCase().includes(normalizedQuery),
      ),
    [items, normalizedQuery],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / MENU_PAGE_SIZE));

  React.useEffect(() => {
    setPageIndex(0);
  }, [normalizedQuery]);

  React.useEffect(() => {
    setPageIndex((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const pageStart = pageIndex * MENU_PAGE_SIZE;
  const visibleItems = filtered.slice(pageStart, pageStart + MENU_PAGE_SIZE);
  const displayStart = filtered.length === 0 ? 0 : pageStart + 1;
  const displayEnd = pageStart + visibleItems.length;

  const hasEdits = Object.keys(editMap).length > 0;

  const itemSkuInUse = React.useCallback(
    (skuValue: string, currentId?: string) => {
      const sku = normalizeSku(skuValue).toLowerCase();
      return Boolean(
        sku &&
        items.some((it) => it._id !== currentId && normalizeSku(it.sku).toLowerCase() === sku),
      );
    },
    [items],
  );

  const closeModal = React.useCallback(() => {
    if (modalSavingRef.current) {
      return;
    }
    setModalOpen(false);
    setModalName("");
    setModalSku("");
    setModalPrice(100);
    setModalCategory("");
    setModalAvailable(true);
    setModalVariants([]);
  }, []);

  const resetModalForm = React.useCallback(() => {
    setModalName("");
    setModalSku("");
    setModalPrice(100);
    setModalCategory("");
    setModalAvailable(true);
    setModalVariants([]);
  }, []);

  const onModalSave = async (addAnother = false) => {
    if (modalSavingRef.current) {
      return;
    }
    const name = normalizeText(modalName);
    const sku = normalizeSku(modalSku);
    const price = parsePositiveMoney(modalPrice);
    const category = normalizeCategoryName(modalCategory);
    let variants: VariantDraft[] = [];
    try {
      variants = normalizeVariantDrafts(modalVariants);
    } catch (e) {
      showToast(validationMessage(e), "err");
      return;
    }
    if (!name) {
      showToast(validationMessage("item-name-required"), "err");
      return;
    }
    const fallbackPrice = getVariantMinPrice(variants);
    const effectivePrice = price ?? fallbackPrice;
    if (effectivePrice === null) {
      showToast(validationMessage("item-price-invalid"), "err");
      return;
    }
    if (itemSkuInUse(sku)) {
      showToast(validationMessage("item-sku-duplicate"), "err");
      return;
    }
    modalSavingRef.current = true;
    setModalSaving(true);
    try {
      await createItem({
        name,
        price: effectivePrice,
        sku: sku || undefined,
        category: category || undefined,
        available: modalAvailable,
        variants,
      });
      const all = await getItems();
      setItems(all);
      showToast(`"${name}" added`);
      if (addAnother) {
        resetModalForm();
      } else {
        closeModal();
      }
    } catch (e) {
      showToast(validationMessage(e, "Failed to create item"), "err");
    } finally {
      modalSavingRef.current = false;
      setModalSaving(false);
    }
  };

  const toggleFavorite = async (it: any) => {
    if (favoriteUpdatingRef.current) {
      return;
    }
    if (it.available === false) {
      showToast("Unavailable items cannot be favorites", "err");
      return;
    }
    favoriteUpdatingRef.current = true;
    setFavoriteUpdatingId(it._id);
    const nextFavorite = !Boolean(it.favorite);
    try {
      await updateItem({ ...it, favorite: nextFavorite, available: true });
      const all = await getItems();
      setItems(all);
      setEditMap((prev) => {
        if (!prev[it._id]) {
          return prev;
        }
        return {
          ...prev,
          [it._id]: { ...prev[it._id], favorite: nextFavorite },
        };
      });
      showToast(nextFavorite ? "Added to favorites" : "Removed from favorites");
    } catch (e) {
      showToast("Failed to update favorite", "err");
    } finally {
      favoriteUpdatingRef.current = false;
      setFavoriteUpdatingId(null);
    }
  };

  // Track which item row is in "confirm delete" mode
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  // Multi-select
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false);

  const onDeleteItem = async (it: any) => {
    if (deletingItemRef.current) {
      return;
    }
    deletingItemRef.current = it._id;
    setDeletingItemId(it._id);
    try {
      await deleteItem(it._id);
      setEditMap((m) => {
        const c = { ...m };
        delete c[it._id];
        return c;
      });
      setConfirmDeleteId(null);
      setItems(await getItems());
      showToast(`"${it.name}" deleted`);
    } catch (e) {
      showToast("Failed to delete item", "err");
    } finally {
      deletingItemRef.current = null;
      setDeletingItemId(null);
    }
  };

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

  const onBulkDelete = async () => {
    if (bulkDeleteLoadingRef.current) {
      return;
    }
    const count = selectedIds.size;
    bulkDeleteLoadingRef.current = true;
    setBulkDeleteLoading(true);
    try {
      for (const id of Array.from(selectedIds)) {
        await deleteItem(id);
        setEditMap((m) => {
          const c = { ...m };
          delete c[id];
          return c;
        });
      }
      setItems(await getItems());
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
      showToast(`${count} item${count !== 1 ? "s" : ""} deleted`);
    } catch (e) {
      showToast("Failed to delete items", "err");
    } finally {
      bulkDeleteLoadingRef.current = false;
      setBulkDeleteLoading(false);
    }
  };

  const onSaveAll = async () => {
    if (!hasEdits || saveAllLoadingRef.current) {
      return;
    }
    const drafts = items.map((base) => {
      const edits = editMap[base._id] || {};
      return {
        ...base,
        name: normalizeText(edits.name ?? base.name),
        sku: normalizeSku(edits.sku ?? base.sku),
        price: parsePositiveMoney(edits.price ?? base.price),
        category: normalizeCategoryName(edits.category ?? base.category),
        available: edits.available ?? base.available !== false,
        favorite: edits.available === false ? false : (edits.favorite ?? Boolean(base.favorite)),
        variants: edits.variants ?? (Array.isArray(base.variants) ? base.variants : []),
      };
    });
    for (const draft of drafts) {
      if (!editMap[draft._id]) {
        continue;
      }
      if (!draft.name) {
        showToast(validationMessage("item-name-required"), "err");
        return;
      }
      let normalizedVariants: VariantDraft[] = [];
      try {
        normalizedVariants = normalizeVariantDrafts(draft.variants || []);
      } catch (e) {
        showToast(`${validationMessage(e)} Check "${draft.name || "this item"}".`, "err");
        return;
      }
      const fallbackPrice = getVariantMinPrice(normalizedVariants);
      if (draft.price === null && fallbackPrice === null) {
        showToast(
          `${validationMessage("item-price-invalid")} Check "${draft.name || "this item"}".`,
          "err",
        );
        return;
      }
    }
    const seenSkus = new Map<string, string>();
    for (const draft of drafts) {
      if (!draft.sku) {
        continue;
      }
      const key = draft.sku.toLowerCase();
      const existingId = seenSkus.get(key);
      if (existingId && (editMap[draft._id] || editMap[existingId])) {
        showToast(validationMessage("item-sku-duplicate"), "err");
        return;
      }
      seenSkus.set(key, draft._id);
    }
    const changedCount = Object.keys(editMap).length;
    saveAllLoadingRef.current = true;
    setSaveAllLoading(true);
    try {
      const promises = Object.entries(editMap).map(([id, edits]) => {
        const base = items.find((it) => it._id === id);
        if (!base) {
          return Promise.resolve();
        }
        const next = drafts.find((draft) => draft._id === id) || { ...base, ...edits };
        const variants = normalizeVariantDrafts(next.variants || []);
        const effectivePrice = parsePositiveMoney(next.price) ?? getVariantMinPrice(variants);
        if (effectivePrice === null) {
          throw new Error("item-price-invalid");
        }
        return updateItem({
          ...next,
          name: next.name,
          sku: next.sku || undefined,
          price: Number(effectivePrice),
          category: next.category || undefined,
          available: next.available !== false,
          favorite: next.available !== false && Boolean(next.favorite),
          variants,
        });
      });
      await Promise.all(promises);
      const all = await getItems();
      setItems(all);
      setEditMap({});
      showToast(`${changedCount} item(s) saved`);
    } catch (e) {
      showToast(validationMessage(e, "Failed to save some items"), "err");
    } finally {
      saveAllLoadingRef.current = false;
      setSaveAllLoading(false);
    }
  };

  const variantEditorItem = React.useMemo(
    () => items.find((item) => item._id === variantEditorItemId) || null,
    [items, variantEditorItemId],
  );

  const saveVariantEditor = async () => {
    if (!variantEditorItem || variantEditorSaving) {
      return;
    }
    let normalized: VariantDraft[] = [];
    try {
      normalized = normalizeVariantDrafts(variantEditorDraft);
    } catch (e) {
      showToast(validationMessage(e), "err");
      return;
    }
    const fallbackPrice = getVariantMinPrice(normalized);
    const basePrice = parsePositiveMoney(variantEditorItem.price);
    const effectivePrice = fallbackPrice ?? basePrice;
    if (effectivePrice === null) {
      showToast(validationMessage("item-price-invalid"), "err");
      return;
    }
    setVariantEditorSaving(true);
    try {
      await updateItem({
        ...variantEditorItem,
        price: effectivePrice,
        variants: normalized,
      });
      const all = await getItems();
      setItems(all);
      setEditMap((prev) => {
        const current = prev[variantEditorItem._id];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [variantEditorItem._id]: {
            ...current,
            variants: normalized,
            ...(fallbackPrice !== null ? { price: fallbackPrice } : {}),
          },
        };
      });
      setVariantEditorItemId(null);
      showToast("Variants saved");
    } catch (e) {
      showToast(validationMessage(e, "Failed to save variants"), "err");
    } finally {
      setVariantEditorSaving(false);
    }
  };

  return (
    <div className={embedded ? undefined : "pos-page"}>
      {!embedded && (
        <PageHeader
          title="Menu"
          subtitle={`${items.length} item${items.length !== 1 ? "s" : ""} · edit prices inline, then Save All`}
          actions={
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              + Add Item
            </Button>
          }
        />
      )}

      {/* Search bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          placeholder="Search by name or SKU…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pos-input"
          style={{ flex: 1 }}
        />
        {query && (
          <Button variant="secondary" onClick={() => setQuery("")}>
            Clear
          </Button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 10,
          color: "var(--pos-muted,var(--pos-tx-sub))",
          fontSize: 12,
          flexWrap: "wrap",
        }}
      >
        <span>
          Showing {displayStart}-{displayEnd} of {filtered.length} item
          {filtered.length !== 1 ? "s" : ""}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button
            type="button"
            variant="secondary"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
          >
            Previous
          </Button>
          <span style={{ minWidth: 86, textAlign: "center" }}>
            Page {pageIndex + 1} of {pageCount}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Scrollable table area */}
      <div
        style={{
          overflowX: "auto",
          marginLeft: -14,
          marginRight: -14,
          paddingLeft: 14,
          paddingRight: 14,
        }}
      >
        <div style={{ minWidth: 680 }}>
          {/* Column headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr 90px 130px 150px 130px 70px 44px 44px",
              columnGap: 8,
              padding: "8px 14px",
              borderRadius: 8,
              background: "var(--pos-border-light,var(--pos-surface-sunken))",
              fontSize: 10,
              fontWeight: 800,
              color: "var(--pos-muted,var(--pos-tx-muted))",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              title="Select / deselect visible items"
              style={{ cursor: "pointer", margin: "auto", width: 15, height: 15 }}
            />
            <span>Name</span>
            <span>SKU</span>
            <span>Category</span>
            <span>Variants</span>
            <span style={{ textAlign: "right" }}>Price (₹)</span>
            <span style={{ textAlign: "center" }}>On Menu</span>
            <span style={{ textAlign: "center" }} title="Favorites">
              Fav
            </span>
            <span style={{ textAlign: "center" }} />
          </div>

          {/* Bulk-delete toolbar — sticky bottom bar, doesn't shift layout */}
          {selectedIds.size > 0 && (
            <div
              style={{
                position: "fixed",
                bottom: 28,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 100,
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 20px",
                borderRadius: 12,
                background: confirmBulkDelete ? "var(--pos-danger-tint)" : "var(--pos-tx)",
                border: confirmBulkDelete ? "1.5px solid var(--pos-danger-line)" : "none",
                boxShadow: "var(--pos-shadow-overlay)",
                minWidth: 340,
              }}
            >
              {confirmBulkDelete ? (
                <>
                  <span
                    style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--pos-danger)" }}
                  >
                    Delete {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} permanently?
                  </span>
                  <button
                    onClick={onBulkDelete}
                    disabled={bulkDeleteLoading}
                    style={{
                      padding: "6px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: "var(--pos-danger)",
                      color: "var(--pos-surface)",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: bulkDeleteLoading ? "not-allowed" : "pointer",
                      opacity: bulkDeleteLoading ? 0.65 : 1,
                      fontFamily: "inherit",
                      boxShadow: "0 2px 6px rgba(239,68,68,0.3)",
                    }}
                  >
                    {bulkDeleteLoading ? "Deleting..." : "Delete"}
                  </button>
                  <button
                    onClick={() => setConfirmBulkDelete(false)}
                    disabled={bulkDeleteLoading}
                    style={{
                      padding: "6px 16px",
                      borderRadius: 8,
                      border: "1px solid var(--pos-line)",
                      background: "var(--pos-surface)",
                      color: "var(--pos-tx-sec)",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: bulkDeleteLoading ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--pos-surface-hover)",
                    }}
                  >
                    {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} selected
                  </span>
                  <button
                    onClick={() => setConfirmBulkDelete(true)}
                    disabled={bulkDeleteLoading}
                    style={{
                      padding: "6px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: "var(--pos-danger)",
                      color: "var(--pos-surface)",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Delete Selected
                  </button>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    disabled={bulkDeleteLoading}
                    style={{
                      padding: "6px 16px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.08)",
                      color: "var(--pos-line-strong)",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Deselect All
                  </button>
                </>
              )}
            </div>
          )}

          {/* Item rows */}
          <div style={{ display: "grid", gap: 4 }}>
            {filtered.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 0",
                  color: "var(--pos-tx-muted)",
                  fontSize: 14,
                }}
              >
                No items found
              </div>
            )}
            {visibleItems.map((it) => {
              const edited = editMap[it._id] !== undefined;
              const currentPrice = editMap[it._id]?.price ?? it.price;
              const currentName = editMap[it._id]?.name ?? it.name;
              const currentAvailable = editMap[it._id]?.available ?? it.available !== false;
              const currentFavorite =
                currentAvailable && (editMap[it._id]?.favorite ?? Boolean(it.favorite));
              const currentVariants =
                editMap[it._id]?.variants ??
                (Array.isArray(it.variants)
                  ? it.variants.map((variant: any, index: number) => ({
                      id: variant.id,
                      name: variant.name,
                      price: Number(variant.price),
                      sortOrder: Number(variant.sortOrder ?? index),
                    }))
                  : []);
              const variantPriceLabel = getVariantPriceLabel(currentVariants);
              const isConfirmingDelete = confirmDeleteId === it._id;
              const isDeleting = deletingItemId === it._id;
              const isFavoriteUpdating = favoriteUpdatingId === it._id;
              return (
                <div
                  key={it._id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1fr 90px 130px 150px 130px 70px 44px 44px",
                    columnGap: 8,
                    alignItems: "center",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: isConfirmingDelete
                      ? "var(--pos-danger-tint)"
                      : edited
                        ? "var(--pos-saffron-tint)"
                        : "var(--pos-surface)",
                    border: isConfirmingDelete
                      ? "1.5px solid var(--pos-danger-line)"
                      : edited
                        ? "1.5px solid var(--pos-saffron-line)"
                        : "1px solid var(--pos-surface-sunken)",
                    boxShadow: "var(--pos-shadow-1)",
                    transition: "border-color 120ms, background 120ms",
                  }}
                >
                  {isConfirmingDelete ? (
                    /* Full-row delete confirmation — spans all 6 columns */
                    <div
                      style={{
                        gridColumn: "1 / -1",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--pos-danger)",
                        }}
                      >
                        Delete "{it.name}" permanently?
                      </span>
                      <button
                        onClick={() => onDeleteItem(it)}
                        disabled={isDeleting}
                        style={{
                          padding: "6px 16px",
                          borderRadius: 8,
                          border: "none",
                          background: "var(--pos-danger)",
                          color: "var(--pos-surface)",
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: isDeleting ? "not-allowed" : "pointer",
                          opacity: isDeleting ? 0.65 : 1,
                          fontFamily: "inherit",
                          boxShadow: "0 2px 6px rgba(239,68,68,0.3)",
                        }}
                      >
                        {isDeleting ? "Deleting..." : "Delete"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={isDeleting}
                        style={{
                          padding: "6px 16px",
                          borderRadius: 8,
                          border: "1px solid var(--pos-line)",
                          background: "var(--pos-surface)",
                          color: "var(--pos-tx-sec)",
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: isDeleting ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Row checkbox */}
                      <div
                        style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(it._id)}
                          onChange={() => toggleSelect(it._id)}
                          style={{ cursor: "pointer", width: 15, height: 15 }}
                        />
                      </div>
                      {/* Name — inline editable */}
                      <div>
                        <input
                          value={currentName}
                          onChange={(e) =>
                            setEditMap((m) => ({
                              ...m,
                              [it._id]: { ...m[it._id], name: e.target.value },
                            }))
                          }
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 7,
                            border:
                              editMap[it._id]?.name !== undefined
                                ? "1.5px solid var(--pos-saffron)"
                                : "1px solid var(--pos-line)",
                            fontSize: 14,
                            fontWeight: 700,
                            color: "var(--pos-tx)",
                            background:
                              editMap[it._id]?.name !== undefined
                                ? "var(--pos-saffron-tint)"
                                : "var(--pos-surface)",
                            outline: "none",
                            fontFamily: "inherit",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>

                      {/* SKU — inline editable */}
                      <div>
                        <input
                          value={editMap[it._id]?.sku ?? it.sku ?? ""}
                          placeholder="—"
                          onChange={(e) =>
                            setEditMap((m) => ({
                              ...m,
                              [it._id]: { ...m[it._id], sku: e.target.value },
                            }))
                          }
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 7,
                            border:
                              editMap[it._id]?.sku !== undefined
                                ? "1.5px solid var(--pos-saffron)"
                                : "1px solid var(--pos-line)",
                            fontSize: 12,
                            fontFamily: "'Courier New', monospace",
                            color: "var(--pos-tx-sub)",
                            background:
                              editMap[it._id]?.sku !== undefined
                                ? "var(--pos-saffron-tint)"
                                : "var(--pos-surface)",
                            outline: "none",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>

                      {/* Category — inline dropdown */}
                      <div>
                        <select
                          value={editMap[it._id]?.category ?? it.category ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditMap((m) => ({
                              ...m,
                              [it._id]: { ...m[it._id], category: val },
                            }));
                          }}
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 7,
                            border:
                              editMap[it._id]?.category !== undefined
                                ? "1.5px solid var(--pos-saffron)"
                                : "1px solid var(--pos-line)",
                            fontSize: 13,
                            background:
                              editMap[it._id]?.category !== undefined
                                ? "var(--pos-saffron-tint)"
                                : "var(--pos-surface)",
                            color: "var(--pos-tx-sec)",
                            outline: "none",
                            fontFamily: "inherit",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">— None —</option>
                          {it.category && !categories.includes(it.category.trim()) && (
                            <option value={it.category}>{it.category}</option>
                          )}
                          {categories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Editable price */}
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          style={{ width: "100%", padding: "6px 8px", fontSize: 12 }}
                          onClick={() => {
                            setVariantEditorItemId(it._id);
                            setVariantEditorDraft(currentVariants);
                          }}
                        >
                          {currentVariants.length > 0
                            ? `${currentVariants.length} option${currentVariants.length !== 1 ? "s" : ""}`
                            : "No variants"}
                        </Button>
                      </div>

                      {/* Editable price */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 4,
                        }}
                      >
                        {currentVariants.length > 0 ? (
                          <div
                            title="Price is derived from variants"
                            style={{
                              width: "100%",
                              padding: "6px 8px",
                              borderRadius: 7,
                              border: edited
                                ? "1.5px solid var(--pos-saffron)"
                                : "1px solid var(--pos-line)",
                              fontSize: 12,
                              fontWeight: 700,
                              textAlign: "right",
                              color: "var(--pos-tx-sec)",
                              background: edited
                                ? "var(--pos-saffron-tint)"
                                : "var(--pos-surface-hover)",
                              boxSizing: "border-box",
                            }}
                          >
                            {variantPriceLabel || "From variants"}
                          </div>
                        ) : (
                          <>
                            <span
                              style={{ fontSize: 12, color: "var(--pos-tx-muted)", flexShrink: 0 }}
                            >
                              ₹
                            </span>
                            <input
                              type="number"
                              value={currentPrice}
                              onChange={(e) =>
                                setEditMap((m) => ({
                                  ...m,
                                  [it._id]: { ...m[it._id], price: Number(e.target.value) },
                                }))
                              }
                              style={{
                                width: 0,
                                flex: 1,
                                padding: "6px 8px",
                                borderRadius: 7,
                                border: edited
                                  ? "1.5px solid var(--pos-saffron)"
                                  : "1px solid var(--pos-line)",
                                fontSize: 13,
                                fontWeight: 600,
                                fontFamily: "inherit",
                                textAlign: "right",
                                background: edited
                                  ? "var(--pos-saffron-tint)"
                                  : "var(--pos-surface)",
                                outline: "none",
                                boxSizing: "border-box",
                              }}
                            />
                          </>
                        )}
                      </div>

                      {/* Available toggle */}
                      <div style={{ textAlign: "center" }}>
                        <button
                          onClick={() =>
                            setEditMap((m) => {
                              const nextAvailable = !currentAvailable;
                              return {
                                ...m,
                                [it._id]: {
                                  ...m[it._id],
                                  available: nextAvailable,
                                  ...(nextAvailable ? {} : { favorite: false }),
                                },
                              };
                            })
                          }
                          title={
                            currentAvailable
                              ? "Click to mark as unavailable"
                              : "Click to mark as available"
                          }
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "3px 12px",
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 700,
                            border: "none",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            background: currentAvailable
                              ? "var(--pos-success-tint)"
                              : "var(--pos-danger-tint)",
                            color: currentAvailable ? "var(--pos-success)" : "var(--pos-danger)",
                            transition: "background 120ms, color 120ms",
                            letterSpacing: "0.02em",
                          }}
                        >
                          {currentAvailable ? "On" : "Off"}
                        </button>
                      </div>

                      {/* Favorite star toggle */}
                      <div style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => currentAvailable && toggleFavorite(it)}
                          disabled={!currentAvailable || isFavoriteUpdating}
                          aria-label={
                            currentAvailable
                              ? currentFavorite
                                ? `Remove ${currentName} from favorites`
                                : `Add ${currentName} to favorites`
                              : "Unavailable items cannot be favorites"
                          }
                          aria-pressed={currentFavorite}
                          title={
                            currentAvailable
                              ? currentFavorite
                                ? "Remove from favorites"
                                : "Add to favorites"
                              : "Unavailable items cannot be favorites"
                          }
                          style={{
                            background: currentFavorite
                              ? "var(--pos-saffron-tint)"
                              : "var(--pos-surface-sunken)",
                            border: `1px solid ${currentFavorite ? "var(--pos-saffron-line)" : "var(--pos-line)"}`,
                            cursor:
                              currentAvailable && !isFavoriteUpdating ? "pointer" : "not-allowed",
                            lineHeight: 1,
                            color: currentFavorite
                              ? "var(--pos-saffron-deep)"
                              : "var(--pos-tx-muted)",
                            padding: 0,
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            opacity: currentAvailable && !isFavoriteUpdating ? 1 : 0.55,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "color 120ms, background 120ms, border-color 120ms",
                          }}
                        >
                          <Icon
                            icon={Star}
                            size="md"
                            fill={currentFavorite ? "currentColor" : "none"}
                          />
                        </button>
                      </div>

                      {/* Delete button — matches billing removeBtn style */}
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <button
                          onClick={() => setConfirmDeleteId(it._id)}
                          disabled={isDeleting}
                          title={`Delete "${it.name}"`}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            background: "var(--pos-danger-tint)",
                            border: "none",
                            color: "var(--pos-danger)",
                            cursor: "pointer",
                            fontSize: 18,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "background 120ms",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background =
                              "var(--pos-danger-tint)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background =
                              "var(--pos-danger-tint)";
                          }}
                        >
                          <Icon icon={X} size="sm" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Save All footer */}
      <div
        style={{
          marginTop: 20,
          paddingTop: 16,
          borderTop: "1px solid var(--pos-border,var(--pos-line))",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--pos-muted,var(--pos-tx-muted))" }}>
          {hasEdits
            ? `${Object.keys(editMap).length} unsaved change${
                Object.keys(editMap).length !== 1 ? "s" : ""
              }`
            : "No unsaved changes"}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {hasEdits && (
            <Button variant="secondary" onClick={() => setEditMap({})} disabled={saveAllLoading}>
              Discard
            </Button>
          )}
          <Button variant="primary" onClick={onSaveAll} disabled={!hasEdits || saveAllLoading}>
            {saveAllLoading ? "Saving…" : "Save All Changes"}
          </Button>
        </div>
      </div>

      <Modal open={modalOpen} title="New Menu Item" onClose={closeModal} large>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--pos-tx-sec)",
                display: "block",
                marginBottom: 4,
              }}
            >
              Item Name <span style={{ color: "var(--pos-danger)" }}>*</span>
            </label>
            <input
              placeholder="e.g. Paneer Tikka"
              value={modalName}
              onChange={(e) => setModalName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && !modalSaving && onModalSave()}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1.5px solid var(--pos-line-strong)",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <div>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--pos-tx-sec)",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                SKU / ID
              </label>
              <input
                placeholder="e.g. PT-01"
                value={modalSku}
                onChange={(e) => setModalSku(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1.5px solid var(--pos-line-strong)",
                  fontSize: 14,
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--pos-tx-sec)",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Price (₹) <span style={{ color: "var(--pos-danger)" }}>*</span>
              </label>
              <input
                type="number"
                placeholder="100"
                value={modalPrice}
                onChange={(e) => setModalPrice(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1.5px solid var(--pos-line-strong)",
                  fontSize: 14,
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--pos-tx-sec)",
                display: "block",
                marginBottom: 4,
              }}
            >
              Category
            </label>
            <select
              value={modalCategory}
              onChange={(e) => setModalCategory(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1.5px solid var(--pos-line-strong)",
                fontSize: 14,
                background: "var(--pos-surface)",
                color: modalCategory ? "var(--pos-tx)" : "var(--pos-tx-muted)",
                fontFamily: "inherit",
                outline: "none",
                cursor: "pointer",
                boxSizing: "border-box",
              }}
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--pos-tx-sec)",
                  display: "block",
                }}
              >
                Variants (optional)
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() =>
                  setModalVariants((prev) => [
                    ...prev,
                    {
                      name: variantOptions[0] || "",
                      price: modalPrice > 0 ? modalPrice : 100,
                      sortOrder: prev.length,
                    },
                  ])
                }
              >
                + Add Variant
              </Button>
            </div>
            {variantOptions.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--pos-saffron-text)", marginBottom: 8 }}>
                Configure variant options in Settings to use dropdown variants.
              </div>
            )}
            {modalVariants.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--pos-tx-muted)" }}>
                Example: Half / Full with different prices.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {modalVariants.map((variant, index) => (
                  <div
                    key={`${variant.id || "new"}-${index}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 120px 40px",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <select
                      value={variant.name}
                      onChange={(e) =>
                        setModalVariants((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, name: e.target.value } : row,
                          ),
                        )
                      }
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1.5px solid var(--pos-line-strong)",
                        fontSize: 13,
                        background: "var(--pos-surface)",
                        color: variant.name ? "var(--pos-tx)" : "var(--pos-tx-muted)",
                        fontFamily: "inherit",
                        cursor: "pointer",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="">Select variant…</option>
                      {variantNameOptions(variant.name).map((nameOption) => (
                        <option key={nameOption} value={nameOption}>
                          {nameOption}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      placeholder="Price"
                      value={variant.price}
                      onChange={(e) =>
                        setModalVariants((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, price: Number(e.target.value) } : row,
                          ),
                        )
                      }
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1.5px solid var(--pos-line-strong)",
                        fontSize: 13,
                        boxSizing: "border-box",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setModalVariants((prev) => prev.filter((_, rowIndex) => rowIndex !== index))
                      }
                      title="Remove variant"
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        border: "none",
                        background: "var(--pos-danger-tint)",
                        color: "var(--pos-danger)",
                        cursor: "pointer",
                        fontSize: 18,
                        lineHeight: 1,
                      }}
                    >
                      <Icon icon={X} size="sm" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <label
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              fontSize: 13,
              color: "var(--pos-tx-sec)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={modalAvailable}
              onChange={(e) => setModalAvailable(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--pos-saffron-deep)" }}
            />
            Available on menu
          </label>
        </div>

        <div className="ui-form-actions" style={{ marginTop: 18 }}>
          <Button type="button" variant="secondary" onClick={closeModal} disabled={modalSaving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onModalSave(true)}
            disabled={modalSaving}
          >
            {modalSaving ? "Saving…" : "Save & Add Another"}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => onModalSave(false)}
            disabled={modalSaving}
          >
            {modalSaving ? "Saving…" : "Save Item"}
          </Button>
        </div>
      </Modal>

      {variantEditorItem && (
        <Modal
          open
          title={`Variants · ${variantEditorItem.name}`}
          onClose={() => setVariantEditorItemId(null)}
          large
        >
          <div style={{ fontSize: 12, color: "var(--pos-tx-sub)", marginBottom: 12 }}>
            Add options like Half/Full with different prices.
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {variantOptions.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--pos-saffron-text)" }}>
                Configure variant options in Settings to use dropdown variants.
              </div>
            )}
            {variantEditorDraft.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--pos-tx-muted)" }}>
                No variants yet. Use Add Variant to create one.
              </div>
            )}
            {variantEditorDraft.map((variant, index) => (
              <div
                key={`${variant.id || "new"}-${index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 130px 40px",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <select
                  value={variant.name}
                  onChange={(e) =>
                    setVariantEditorDraft((prev) =>
                      prev.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, name: e.target.value } : row,
                      ),
                    )
                  }
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1.5px solid var(--pos-line-strong)",
                    fontSize: 13,
                    background: "var(--pos-surface)",
                    color: variant.name ? "var(--pos-tx)" : "var(--pos-tx-muted)",
                    fontFamily: "inherit",
                    cursor: "pointer",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">Select variant…</option>
                  {variantNameOptions(variant.name).map((nameOption) => (
                    <option key={nameOption} value={nameOption}>
                      {nameOption}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Price"
                  value={variant.price}
                  onChange={(e) =>
                    setVariantEditorDraft((prev) =>
                      prev.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, price: Number(e.target.value) } : row,
                      ),
                    )
                  }
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1.5px solid var(--pos-line-strong)",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    setVariantEditorDraft((prev) =>
                      prev.filter((_, rowIndex) => rowIndex !== index),
                    )
                  }
                  title="Remove variant"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: "none",
                    background: "var(--pos-danger-tint)",
                    color: "var(--pos-danger)",
                    cursor: "pointer",
                    fontSize: 18,
                    lineHeight: 1,
                  }}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setVariantEditorDraft((prev) => [
                  ...prev,
                  {
                    name: variantOptions[0] || "",
                    price: Number(
                      editMap[variantEditorItem._id]?.price ?? variantEditorItem.price ?? 0,
                    ),
                    sortOrder: prev.length,
                  },
                ])
              }
            >
              + Add Variant
            </Button>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setVariantEditorItemId(null)}
                disabled={variantEditorSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={saveVariantEditor}
                disabled={variantEditorSaving}
              >
                {variantEditorSaving ? "Saving..." : "Save Variants"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
