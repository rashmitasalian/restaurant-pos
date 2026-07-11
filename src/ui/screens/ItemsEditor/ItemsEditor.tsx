import React from "react";
import {
  getItems,
  seedItems,
  createItem,
  updateItem,
  deleteItem,
  getConfigCategories,
} from "../../../app/db/posRepository";
import {
  normalizeCategoryName,
  normalizeSku,
  normalizeText,
  parsePositiveMoney,
  validationMessage,
} from "../../../shared/validation";
import { useToast } from "../../context/ToastContext";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const MENU_PAGE_SIZE = 50;

export default function ItemsEditor() {
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
  const [modalSaving, setModalSaving] = React.useState(false);
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
      }
    >
  >({});
  const [saveAllLoading, setSaveAllLoading] = React.useState(false);
  const [deletingItemId, setDeletingItemId] = React.useState<string | null>(null);
  const [bulkDeleteLoading, setBulkDeleteLoading] = React.useState(false);
  const [favoriteUpdatingId, setFavoriteUpdatingId] = React.useState<string | null>(null);
  const modalSavingRef = React.useRef(false);
  const saveAllLoadingRef = React.useRef(false);
  const deletingItemRef = React.useRef<string | null>(null);
  const bulkDeleteLoadingRef = React.useRef(false);
  const favoriteUpdatingRef = React.useRef(false);

  // Categories loaded from DB config
  const [categories, setCategories] = React.useState<string[]>([]);

  React.useEffect(() => {
    (async () => {
      await seedItems();
      const all = await getItems();
      setItems(all);
      setCategories(await getConfigCategories());
    })();
  }, []);

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
  }, []);
  const addItemDialogRef = useFocusTrap<HTMLDivElement>(modalOpen, closeModal);

  const resetModalForm = React.useCallback(() => {
    setModalName("");
    setModalSku("");
    setModalPrice(100);
    setModalCategory("");
    setModalAvailable(true);
  }, []);

  const onModalSave = async (addAnother = false) => {
    if (modalSavingRef.current) {
      return;
    }
    const name = normalizeText(modalName);
    const sku = normalizeSku(modalSku);
    const price = parsePositiveMoney(modalPrice);
    const category = normalizeCategoryName(modalCategory);
    if (!name) {
      showToast(validationMessage("item-name-required"), "err");
      return;
    }
    if (price === null) {
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
        price,
        sku: sku || undefined,
        category: category || undefined,
        available: modalAvailable,
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
    favoriteUpdatingRef.current = true;
    setFavoriteUpdatingId(it._id);
    try {
      await updateItem({ ...it, favorite: !it.favorite });
      const all = await getItems();
      setItems(all);
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
      if (draft.price === null) {
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
        return updateItem({
          ...next,
          name: next.name,
          sku: next.sku || undefined,
          price: Number(next.price),
          category: next.category || undefined,
          available: next.available !== false,
          favorite: next.available !== false && Boolean(next.favorite),
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

  return (
    <div className="pos-page">
      {/* Page header */}
      <div className="pos-ph">
        <div>
          <h2 className="pos-ph-title">Menu</h2>
          <p className="pos-ph-sub">
            {items.length} item{items.length !== 1 ? "s" : ""} · edit prices inline, then Save All
          </p>
        </div>
        <div className="pos-ph-actions">
          <button onClick={() => setModalOpen(true)} className="pos-btn pos-btn-primary">
            + Add Item
          </button>
        </div>
      </div>

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
          <button onClick={() => setQuery("")} className="pos-btn pos-btn-secondary">
            Clear
          </button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 10,
          color: "var(--pos-muted,#6b7280)",
          fontSize: 12,
          flexWrap: "wrap",
        }}
      >
        <span>
          Showing {displayStart}-{displayEnd} of {filtered.length} item
          {filtered.length !== 1 ? "s" : ""}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="pos-btn pos-btn-secondary"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
          >
            Previous
          </button>
          <span style={{ minWidth: 86, textAlign: "center" }}>
            Page {pageIndex + 1} of {pageCount}
          </span>
          <button
            type="button"
            className="pos-btn pos-btn-secondary"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
          >
            Next
          </button>
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
              gridTemplateColumns: "28px 1fr 90px 130px 130px 70px 44px 44px",
              columnGap: 8,
              padding: "8px 14px",
              borderRadius: 8,
              background: "var(--pos-border-light,#f3f4f6)",
              fontSize: 10,
              fontWeight: 800,
              color: "var(--pos-muted,#9ca3af)",
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
            <span style={{ textAlign: "right" }}>Price (₹)</span>
            <span style={{ textAlign: "center" }}>On Menu</span>
            <span style={{ textAlign: "center" }}>★</span>
            <span style={{ textAlign: "center" }}></span>
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
                background: confirmBulkDelete ? "#fff5f5" : "#1f2937",
                border: confirmBulkDelete ? "1.5px solid #fca5a5" : "none",
                boxShadow: "0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)",
                minWidth: 340,
              }}
            >
              {confirmBulkDelete ? (
                <>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#dc2626" }}>
                    Delete {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} permanently?
                  </span>
                  <button
                    onClick={onBulkDelete}
                    disabled={bulkDeleteLoading}
                    style={{
                      padding: "6px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: "#ef4444",
                      color: "#fff",
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
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      color: "#374151",
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
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#f9fafb" }}>
                    {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} selected
                  </span>
                  <button
                    onClick={() => setConfirmBulkDelete(true)}
                    disabled={bulkDeleteLoading}
                    style={{
                      padding: "6px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: "#ef4444",
                      color: "#fff",
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
                      color: "#d1d5db",
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
                  color: "#9ca3af",
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
              const isConfirmingDelete = confirmDeleteId === it._id;
              const isDeleting = deletingItemId === it._id;
              const isFavoriteUpdating = favoriteUpdatingId === it._id;
              return (
                <div
                  key={it._id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1fr 90px 130px 130px 70px 44px 44px",
                    columnGap: 8,
                    alignItems: "center",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: isConfirmingDelete ? "#fff5f5" : edited ? "#fffbeb" : "#fff",
                    border: isConfirmingDelete
                      ? "1.5px solid #fca5a5"
                      : edited
                        ? "1.5px solid #fde68a"
                        : "1px solid #f3f4f6",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
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
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#dc2626" }}>
                        Delete "{it.name}" permanently?
                      </span>
                      <button
                        onClick={() => onDeleteItem(it)}
                        disabled={isDeleting}
                        style={{
                          padding: "6px 16px",
                          borderRadius: 8,
                          border: "none",
                          background: "#ef4444",
                          color: "#fff",
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
                          border: "1px solid #e5e7eb",
                          background: "#fff",
                          color: "#374151",
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
                                ? "1.5px solid #f59e0b"
                                : "1px solid #e5e7eb",
                            fontSize: 14,
                            fontWeight: 700,
                            color: "#111827",
                            background: editMap[it._id]?.name !== undefined ? "#fffbeb" : "#fff",
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
                                ? "1.5px solid #f59e0b"
                                : "1px solid #e5e7eb",
                            fontSize: 12,
                            fontFamily: "'Courier New', monospace",
                            color: "#6b7280",
                            background: editMap[it._id]?.sku !== undefined ? "#fffbeb" : "#fff",
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
                                ? "1.5px solid #f59e0b"
                                : "1px solid #e5e7eb",
                            fontSize: 13,
                            background:
                              editMap[it._id]?.category !== undefined ? "#fffbeb" : "#fff",
                            color: "#374151",
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 4,
                        }}
                      >
                        <span style={{ fontSize: 12, color: "#9ca3af", flexShrink: 0 }}>₹</span>
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
                            border: edited ? "1.5px solid #f59e0b" : "1px solid #e5e7eb",
                            fontSize: 13,
                            fontWeight: 600,
                            fontFamily: "inherit",
                            textAlign: "right",
                            background: edited ? "#fffbeb" : "#fff",
                            outline: "none",
                            boxSizing: "border-box",
                          }}
                        />
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
                            background: currentAvailable ? "#dcfce7" : "#fee2e2",
                            color: currentAvailable ? "#16a34a" : "#dc2626",
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
                          onClick={() => currentAvailable && toggleFavorite(it)}
                          disabled={!currentAvailable || isFavoriteUpdating}
                          title={
                            currentAvailable
                              ? currentFavorite
                                ? "Remove from favorites"
                                : "Add to favorites"
                              : "Unavailable items cannot be favorites"
                          }
                          style={{
                            background: "none",
                            border: "none",
                            cursor:
                              currentAvailable && !isFavoriteUpdating ? "pointer" : "not-allowed",
                            fontSize: 18,
                            lineHeight: 1,
                            color: currentFavorite ? "#f59e0b" : "#d1d5db",
                            padding: "2px 4px",
                            borderRadius: 4,
                            opacity: currentAvailable && !isFavoriteUpdating ? 1 : 0.55,
                            transition: "color 120ms, transform 120ms",
                          }}
                          onMouseEnter={(e) => {
                            if (currentAvailable && !isFavoriteUpdating) {
                              (e.currentTarget as HTMLButtonElement).style.transform =
                                "scale(1.25)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
                          }}
                        >
                          {currentFavorite ? "★" : "☆"}
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
                            background: "#fff1f2",
                            border: "none",
                            color: "#dc2626",
                            cursor: "pointer",
                            fontSize: 18,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "background 120ms",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = "#fee2e2";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = "#fff1f2";
                          }}
                        >
                          ×
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
          borderTop: "1px solid var(--pos-border,#e5e7eb)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--pos-muted,#9ca3af)" }}>
          {hasEdits
            ? `${Object.keys(editMap).length} unsaved change${
                Object.keys(editMap).length !== 1 ? "s" : ""
              }`
            : "No unsaved changes"}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {hasEdits && (
            <button
              onClick={() => setEditMap({})}
              disabled={saveAllLoading}
              className="pos-btn pos-btn-secondary"
            >
              Discard
            </button>
          )}
          <button
            onClick={onSaveAll}
            disabled={!hasEdits || saveAllLoading}
            className="pos-btn pos-btn-primary"
          >
            {saveAllLoading ? "Saving…" : "Save All Changes"}
          </button>
        </div>
      </div>

      {/* New Item modal */}
      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
          }}
          onClick={closeModal}
        >
          <div
            ref={addItemDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Add new menu item"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 480,
              maxWidth: "95vw",
              background: "#fff",
              borderRadius: 14,
              padding: "24px 28px",
              boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#111827",
                }}
              >
                New Menu Item
              </h3>
              <button
                onClick={closeModal}
                disabled={modalSaving}
                style={{
                  background: "none",
                  border: "none",
                  cursor: modalSaving ? "not-allowed" : "pointer",
                  color: "#9ca3af",
                  fontSize: 20,
                  lineHeight: 1,
                  opacity: modalSaving ? 0.55 : 1,
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#374151",
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Item Name <span style={{ color: "#ef4444" }}>*</span>
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
                    border: "1.5px solid #d1d5db",
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
                      color: "#374151",
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
                      border: "1.5px solid #d1d5db",
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
                      color: "#374151",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Price (₹) <span style={{ color: "#ef4444" }}>*</span>
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
                      border: "1.5px solid #d1d5db",
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
                    color: "#374151",
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
                    border: "1.5px solid #d1d5db",
                    fontSize: 14,
                    background: "#fff",
                    color: modalCategory ? "#111827" : "#9ca3af",
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
              <label
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  fontSize: 13,
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={modalAvailable}
                  onChange={(e) => setModalAvailable(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "#d97706" }}
                />
                Available on menu
              </label>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 22,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={closeModal}
                disabled={modalSaving}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  color: "#374151",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: modalSaving ? "not-allowed" : "pointer",
                  opacity: modalSaving ? 0.65 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => onModalSave(true)}
                disabled={modalSaving}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "1.5px solid #d97706",
                  background: "#fff",
                  color: "#d97706",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: modalSaving ? "not-allowed" : "pointer",
                  opacity: modalSaving ? 0.65 : 1,
                }}
              >
                {modalSaving ? "Saving…" : "Save & Add Another"}
              </button>
              <button
                onClick={() => onModalSave(false)}
                disabled={modalSaving}
                style={{
                  padding: "10px 24px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg,#d97706,#f59e0b)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: modalSaving ? "not-allowed" : "pointer",
                  opacity: modalSaving ? 0.7 : 1,
                  boxShadow: "0 2px 8px rgba(217,119,6,0.25)",
                }}
              >
                {modalSaving ? "Saving…" : "Save Item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
