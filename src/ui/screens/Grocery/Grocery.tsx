import React from "react";
import {
  createGroceryItem,
  createGroceryList,
  createGroceryPurchase,
  deleteGroceryItem,
  deleteGroceryPurchase,
  getFoodCostSummary,
  listGroceryItems,
  listGroceryLists,
  listGroceryPurchases,
  updateGroceryItem,
  updateGroceryList,
  updateGroceryPurchase,
  type GroceryItemDoc,
  type GroceryListDoc,
  type GroceryPurchaseLineDoc,
} from "../../../app/db/posRepository";
import { ENV } from "../../../config/env";
import type { FoodCostSummaryDto, GroceryUnit } from "../../../shared/pos";
import { normalizeCategoryName, normalizeText, validationMessage } from "../../../shared/validation";
import styles from "./Grocery.module.css";

type GroceryView = "list" | "purchases" | "summary";
type RangePreset = "today" | "yesterday" | "thisWeek" | "thisMonth" | "custom";
type ListRecordMode = "item" | "total";

const UNITS: GroceryUnit[] = ["kg", "g", "L", "ml", "unit", "packet", "box", "dozen", "bunch"];
const PAYMENT_METHODS = ["cash", "upi", "card", "online", "other"];
const LIST_TOTAL_ITEM_NAME = "Buying List Total";
const LIST_TOTAL_CATEGORY = "List Total";
const GROCERY_VIEW_HASH: Record<GroceryView, string> = {
  list: "#manager-grocery-list",
  purchases: "#manager-grocery-purchases",
  summary: "#manager-grocery-summary",
};
const GROCERY_TABS: Array<{ key: GroceryView; label: string }> = [
  { key: "list", label: "Buying List" },
  { key: "purchases", label: "Purchases" },
  { key: "summary", label: "Spend Summary" },
];
const ADD_ITEM_MIN_SEARCH_CHARS = 2;
const ADD_ITEM_RESULT_LIMIT = 15;

const EMPTY_SUMMARY: FoodCostSummaryDto = {
  netSales: 0,
  grossSales: 0,
  grocerySpend: 0,
  estimatedGrossProfit: 0,
  foodCostPercent: null,
  purchaseCount: 0,
  topItems: [],
  topVendors: [],
};

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function getPresetRange(preset: RangePreset): { from: number; to: number } {
  const now = new Date();
  if (preset === "yesterday") {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return { from: startOfDay(date).getTime(), to: endOfDay(date).getTime() };
  }
  if (preset === "thisWeek") {
    const date = new Date(now);
    date.setDate(date.getDate() - date.getDay());
    return { from: startOfDay(date).getTime(), to: endOfDay(now).getTime() };
  }
  if (preset === "thisMonth") {
    return {
      from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)).getTime(),
      to: endOfDay(now).getTime(),
    };
  }
  return { from: startOfDay(now).getTime(), to: endOfDay(now).getTime() };
}

function toInputDate(ts: number) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function fromInputDate(value: string, end = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return Date.now();
  }
  return (end ? endOfDay(date) : startOfDay(date)).getTime();
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function defaultPurchaseForm() {
  return {
    groceryItemId: "",
    itemName: "",
    category: "",
    quantity: 1,
    unit: "kg" as GroceryUnit,
    unitPrice: "",
    totalAmount: "",
    paymentMethod: "cash",
    notes: "",
    purchasedDate: toInputDate(Date.now()),
    listId: "",
  };
}

function defaultBuyingPurchaseForm() {
  return {
    lineIndex: null as number | null,
    quantity: 1,
    unit: "kg" as GroceryUnit,
    unitPrice: "",
    totalAmount: "",
    paymentMethod: "cash",
    notes: "",
    purchasedDate: toInputDate(Date.now()),
  };
}

function defaultListTotalPurchaseForm() {
  return {
    totalAmount: "",
    paymentMethod: "cash",
    notes: "",
    purchasedDate: toInputDate(Date.now()),
  };
}

function draftNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : Number.NaN;
}

function draftPurchaseTotal(input: { quantity: unknown; unitPrice?: unknown; totalAmount?: unknown }) {
  const explicitTotal = draftNumber(input.totalAmount);
  if (explicitTotal !== null) {
    return explicitTotal;
  }
  const unitPrice = draftNumber(input.unitPrice);
  if (unitPrice === null) {
    return null;
  }
  return Number(input.quantity || 0) * unitPrice;
}

function hasValidDraftPurchaseAmount(input: { quantity: unknown; unitPrice?: unknown; totalAmount?: unknown }) {
  const quantity = Number(input.quantity);
  const unitPrice = draftNumber(input.unitPrice);
  const totalAmount = draftPurchaseTotal(input);
  return (
    Number.isFinite(quantity) &&
    quantity > 0 &&
    (unitPrice === null || (Number.isFinite(unitPrice) && unitPrice >= 0)) &&
    totalAmount !== null &&
    Number.isFinite(totalAmount) &&
    totalAmount > 0
  );
}

function groceryRecordKey(input: {
  groceryItemId?: string | null;
  itemName?: string | null;
  category?: string | null;
}) {
  if (input.groceryItemId) {
    return `item:${input.groceryItemId}`;
  }
  return `custom:${normalizeText(input.itemName).toLowerCase()}:${normalizeText(input.category).toLowerCase()}`;
}

function isWholeListGroceryRecord(input: { groceryItemId?: string | null; itemName?: string | null; category?: string | null }) {
  return (
    !input.groceryItemId &&
    normalizeText(input.itemName).toLowerCase() === LIST_TOTAL_ITEM_NAME.toLowerCase() &&
    normalizeText(input.category).toLowerCase() === LIST_TOTAL_CATEGORY.toLowerCase()
  );
}

function isListTotalPurchase(purchase: GroceryPurchaseLineDoc) {
  return isWholeListGroceryRecord(purchase);
}

function groceryPurchaseDisplayName(input: { groceryItemId?: string | null; itemName?: string | null; category?: string | null }) {
  if (isWholeListGroceryRecord(input)) {
    return "Whole buying list";
  }
  return normalizeText(input.itemName);
}

function buyingListLinesSnapshot(lines: GroceryListDoc["lines"]) {
  return JSON.stringify(
    lines.map((line) => ({
      groceryItemId: line.groceryItemId || null,
      itemName: normalizeText(line.itemName),
      category: normalizeText(line.category),
      quantity: Number(line.quantity) || 0,
      unit: line.unit,
      vendorHint: normalizeText(line.vendorHint),
    })),
  );
}

function groceryViewFromHash(hash: string): GroceryView | null {
  const normalized = String(hash || "").toLowerCase();
  if (
    normalized === "#manager-grocery-purchases" ||
    normalized === "#manager-purchases" ||
    normalized === "#manager-purchase-entry" ||
    normalized === "#manager-purchase-history"
  ) {
    return "purchases";
  }
  if (normalized === "#manager-grocery-summary" || normalized === "#manager-spend-summary") {
    return "summary";
  }
  if (
    normalized === "#manager" ||
    normalized === "#grocery" ||
    normalized === "#manager-grocery" ||
    normalized === "#manager-grocery-list"
  ) {
    return "list";
  }
  return null;
}

export default function Grocery() {
  const [view, setView] = React.useState<GroceryView>(() => {
    const hash = (typeof window !== "undefined" && window.location.hash) || "";
    return groceryViewFromHash(hash) || "list";
  });
  const [items, setItems] = React.useState<GroceryItemDoc[]>([]);
  const [lists, setLists] = React.useState<GroceryListDoc[]>([]);
  const [purchases, setPurchases] = React.useState<GroceryPurchaseLineDoc[]>([]);
  const [selectedListPurchases, setSelectedListPurchases] = React.useState<GroceryPurchaseLineDoc[]>([]);
  const [summary, setSummary] = React.useState<FoodCostSummaryDto>(EMPTY_SUMMARY);
  const [selectedListId, setSelectedListId] = React.useState("");
  const [draftLines, setDraftLines] = React.useState<GroceryListDoc["lines"]>([]);
  const [status, setStatus] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const [rangePreset, setRangePreset] = React.useState<RangePreset>("thisMonth");
  const initialRange = React.useMemo(() => getPresetRange("thisMonth"), []);
  const [fromTs, setFromTs] = React.useState(initialRange.from);
  const [toTs, setToTs] = React.useState(initialRange.to);
  const [historySearch, setHistorySearch] = React.useState("");
  const [editingPurchaseId, setEditingPurchaseId] = React.useState<string | null>(null);
  const [addItemOpen, setAddItemOpen] = React.useState(false);
  const [addItemQuery, setAddItemQuery] = React.useState("");
  const [highlightedAddItemIndex, setHighlightedAddItemIndex] = React.useState(0);
  const [focusedListLineIndex, setFocusedListLineIndex] = React.useState<number | null>(null);
  const [showReusableItems, setShowReusableItems] = React.useState(false);
  const [showOffListPurchaseForm, setShowOffListPurchaseForm] = React.useState(false);
  const [listRecordMode, setListRecordMode] = React.useState<ListRecordMode>("item");
  const [listTotalPurchaseOpen, setListTotalPurchaseOpen] = React.useState(false);

  const [itemForm, setItemForm] = React.useState({
    name: "",
    defaultQuantity: 1,
    defaultUnit: "kg" as GroceryUnit,
    editingId: "",
  });
  const [purchaseForm, setPurchaseForm] = React.useState(defaultPurchaseForm);
  const [buyingPurchaseForm, setBuyingPurchaseForm] = React.useState(defaultBuyingPurchaseForm);
  const [listTotalPurchaseForm, setListTotalPurchaseForm] = React.useState(defaultListTotalPurchaseForm);
  const purchaseFormCardRef = React.useRef<HTMLDivElement | null>(null);
  const listLineRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const quantityInputRefs = React.useRef<Array<HTMLInputElement | null>>([]);
  const buyingPurchaseQuantityRef = React.useRef<HTMLInputElement | null>(null);
  const listTotalAmountRef = React.useRef<HTMLInputElement | null>(null);
  const pendingFocusLineIndexRef = React.useRef<number | null>(null);

  const selectView = React.useCallback((nextView: GroceryView) => {
    setView(nextView);
    if (typeof window !== "undefined") {
      window.location.hash = GROCERY_VIEW_HASH[nextView];
    }
  }, []);

  React.useEffect(() => {
    const onHashChange = () => {
      const nextView = groceryViewFromHash(window.location.hash);
      if (nextView) {
        setView(nextView);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const beginSaving = React.useCallback(() => {
    if (savingRef.current) {
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    return true;
  }, []);

  const endSaving = React.useCallback(() => {
    savingRef.current = false;
    setSaving(false);
  }, []);

  const formatCurrency = React.useCallback((value: number) => {
    try {
      return new Intl.NumberFormat(ENV.CURRENCY_LOCALE, {
        style: "currency",
        currency: ENV.CURRENCY_CODE,
        maximumFractionDigits: 2,
      }).format(Number(value || 0));
    } catch {
      return `Rs ${Math.round(Number(value || 0) * 100) / 100}`;
    }
  }, []);

  const selectedList = React.useMemo(
    () => lists.find((list) => list.id === selectedListId) || lists[0] || null,
    [lists, selectedListId],
  );

  const listTotalPurchase = React.useMemo(
    () => selectedListPurchases.find(isListTotalPurchase) || null,
    [selectedListPurchases],
  );

  const itemLevelListPurchases = React.useMemo(
    () => selectedListPurchases.filter((purchase) => !isListTotalPurchase(purchase)),
    [selectedListPurchases],
  );

  const recordedListLineKeys = React.useMemo(
    () => new Set(itemLevelListPurchases.map((purchase) => groceryRecordKey(purchase))),
    [itemLevelListPurchases],
  );

  const activeListRecordMode: ListRecordMode = listTotalPurchase
    ? "total"
    : itemLevelListPurchases.length > 0
      ? "item"
      : listRecordMode;

  const listRecordModeHint = React.useMemo(() => {
    if (listTotalPurchase) {
      return "Whole-list amount is recorded; item-wise entry is locked for this buying list.";
    }
    if (itemLevelListPurchases.length > 0) {
      return `${itemLevelListPurchases.length} item-wise purchase${
        itemLevelListPurchases.length === 1 ? "" : "s"
      } recorded; whole-list total is locked.`;
    }
    if (activeListRecordMode === "total") {
      return "Enter one paid amount for the entire buying list.";
    }
    return "Record amount against each item when individual prices are available.";
  }, [activeListRecordMode, itemLevelListPurchases.length, listTotalPurchase]);

  const buyingListHasChanges = React.useMemo(() => {
    if (!selectedList) {
      return false;
    }
    return buyingListLinesSnapshot(draftLines) !== buyingListLinesSnapshot(selectedList.lines || []);
  }, [draftLines, selectedList]);

  const canSaveListTotalPurchase = React.useMemo(
    () => {
      const totalAmount = draftNumber(listTotalPurchaseForm.totalAmount);
      return totalAmount !== null && Number.isFinite(totalAmount) && totalAmount > 0;
    },
    [listTotalPurchaseForm.totalAmount],
  );

  const canSaveBuyingListPurchase = React.useMemo(
    () => hasValidDraftPurchaseAmount(buyingPurchaseForm),
    [buyingPurchaseForm],
  );

  const canSavePurchase = React.useMemo(
    () => Boolean(normalizeText(purchaseForm.itemName)) && hasValidDraftPurchaseAmount(purchaseForm),
    [purchaseForm],
  );

  const loadItems = React.useCallback(async () => {
    setItems(await listGroceryItems());
  }, []);

  const loadLists = React.useCallback(async () => {
    const recent = await listGroceryLists({ limit: 30 });
    setLists(recent);
    if (!selectedListId && recent[0]) {
      setSelectedListId(recent[0].id);
    }
  }, [selectedListId]);

  const loadPurchases = React.useCallback(async () => {
    setPurchases(
      await listGroceryPurchases({
        from: fromTs,
        to: toTs,
        search: historySearch,
        limit: 500,
      }),
    );
  }, [fromTs, historySearch, toTs]);

  const loadSelectedListPurchases = React.useCallback(async () => {
    if (!selectedList?.id) {
      setSelectedListPurchases([]);
      return;
    }
    setSelectedListPurchases(
      await listGroceryPurchases({
        listId: selectedList.id,
        limit: null,
      }),
    );
  }, [selectedList?.id]);

  const loadSummary = React.useCallback(async () => {
    setSummary(await getFoodCostSummary({ from: fromTs, to: toTs }));
  }, [fromTs, toTs]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      await loadItems();
      await loadLists();
      await loadSelectedListPurchases();
      if (view === "purchases") {
        await loadPurchases();
      }
      if (view === "summary") {
        await loadSummary();
      }
    } catch (error) {
      setStatus(validationMessage(error, "Could not load grocery data"));
    } finally {
      setLoading(false);
    }
  }, [loadItems, loadLists, loadPurchases, loadSelectedListPurchases, loadSummary, view]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (selectedList) {
      setDraftLines(selectedList.lines || []);
      setBuyingPurchaseForm(defaultBuyingPurchaseForm());
      setListRecordMode("item");
      setListTotalPurchaseOpen(false);
      setListTotalPurchaseForm(defaultListTotalPurchaseForm());
      loadSelectedListPurchases().catch((error) => {
        setStatus(validationMessage(error, "Could not load buying list purchases"));
      });
    } else {
      setAddItemOpen(false);
      setAddItemQuery("");
      setHighlightedAddItemIndex(0);
      setBuyingPurchaseForm(defaultBuyingPurchaseForm());
      setListRecordMode("item");
      setListTotalPurchaseOpen(false);
      setListTotalPurchaseForm(defaultListTotalPurchaseForm());
      setSelectedListPurchases([]);
    }
  }, [loadSelectedListPurchases, selectedList]);

  React.useEffect(() => {
    if (listTotalPurchase) {
      setListRecordMode("total");
      setBuyingPurchaseForm(defaultBuyingPurchaseForm());
      setListTotalPurchaseOpen(false);
      return;
    }
    if (itemLevelListPurchases.length > 0) {
      setListRecordMode("item");
      setListTotalPurchaseOpen(false);
    }
  }, [itemLevelListPurchases.length, listTotalPurchase]);

  const normalizedAddItemQuery = React.useMemo(() => normalizeText(addItemQuery), [addItemQuery]);
  const addItemSearchQuery = normalizedAddItemQuery.toLowerCase();
  const shouldSearchAddItems = addItemSearchQuery.length >= ADD_ITEM_MIN_SEARCH_CHARS;

  const existingAddItemLineIndex = React.useMemo(() => {
    if (!addItemSearchQuery) {
      return -1;
    }
    return draftLines.findIndex(
      (line) => normalizeText(line.itemName).toLowerCase() === addItemSearchQuery,
    );
  }, [addItemSearchQuery, draftLines]);

  const isItemAlreadyInDraft = React.useCallback(
    (item: GroceryItemDoc) =>
      draftLines.some((line) => {
        if (line.groceryItemId && line.groceryItemId === item.id) {
          return true;
        }
        return normalizeText(line.itemName).toLowerCase() === normalizeText(item.name).toLowerCase();
      }),
    [draftLines],
  );

  const addItemFilteredItems = React.useMemo(() => {
    if (!shouldSearchAddItems) {
      return [];
    }
    return items.filter((item) => {
      if (isItemAlreadyInDraft(item)) {
        return false;
      }
      const haystack = [
        item.name,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(addItemSearchQuery);
    });
  }, [addItemSearchQuery, isItemAlreadyInDraft, items, shouldSearchAddItems]);

  const addItemMatches = React.useMemo(
    () => addItemFilteredItems.slice(0, ADD_ITEM_RESULT_LIMIT),
    [addItemFilteredItems],
  );

  const addItemCountText = React.useMemo(() => {
    if (!normalizedAddItemQuery) {
      return "Start typing to find reusable items.";
    }
    if (!shouldSearchAddItems) {
      return `Type at least ${ADD_ITEM_MIN_SEARCH_CHARS} characters to search.`;
    }
    if (existingAddItemLineIndex >= 0 && !addItemMatches.length) {
      return "This item is already on the buying list.";
    }
    if (!addItemFilteredItems.length) {
      return "No reusable item matches this search.";
    }
    if (addItemFilteredItems.length > addItemMatches.length) {
      return `Showing first ${addItemMatches.length} of ${addItemFilteredItems.length} reusable items. Type to narrow.`;
    }
    return `Showing ${addItemMatches.length} reusable items`;
  }, [
    addItemFilteredItems.length,
    addItemMatches.length,
    existingAddItemLineIndex,
    normalizedAddItemQuery,
    shouldSearchAddItems,
  ]);

  React.useEffect(() => {
    setHighlightedAddItemIndex(0);
  }, [addItemQuery, addItemMatches.length]);

  const setPreset = (preset: RangePreset) => {
    setRangePreset(preset);
    if (preset !== "custom") {
      const range = getPresetRange(preset);
      setFromTs(range.from);
      setToTs(range.to);
    }
  };

  const saveItem = async () => {
    const name = normalizeText(itemForm.name);
    if (!name) {
      setStatus("Reusable item name is required.");
      return;
    }
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    try {
      const payload = {
        name,
        category: null,
        defaultQuantity: Number(itemForm.defaultQuantity) || 1,
        defaultUnit: itemForm.defaultUnit,
        vendorHint: null,
      };
      if (itemForm.editingId) {
        await updateGroceryItem(itemForm.editingId, payload);
        setStatus("Reusable item updated");
      } else {
        await createGroceryItem(payload);
        setStatus("Reusable item added");
      }
      setItemForm({
        name: "",
        defaultQuantity: 1,
        defaultUnit: "kg",
        editingId: "",
      });
      await loadItems();
    } catch (error) {
      setStatus(validationMessage(error, "Could not save reusable item"));
    } finally {
      endSaving();
    }
  };

  const generateList = async () => {
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    try {
      const list = await createGroceryList({ listDate: Date.now() });
      setSelectedListId(list.id);
      await loadLists();
      setStatus(
        items.length
          ? "Buying list generated from reusable items"
          : "Empty buying list created. Add items manually or set up reusable items.",
      );
    } catch (error) {
      setStatus(validationMessage(error, "Could not create buying list"));
    } finally {
      endSaving();
    }
  };

  const persistSelectedList = async () => {
    if (!selectedList) {
      throw new Error("grocery-list-not-found");
    }
    const saved = await updateGroceryList(selectedList.id, { lines: draftLines });
    setSelectedListId(saved.id);
    await loadLists();
    return saved;
  };

  const saveList = async () => {
    if (!selectedList) {
      return;
    }
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    try {
      await persistSelectedList();
      setStatus("Buying list saved");
    } catch (error) {
      setStatus(validationMessage(error, "Could not save buying list"));
    } finally {
      endSaving();
    }
  };

  const focusListLine = React.useCallback((index: number) => {
    window.setTimeout(() => {
      const quantityInput = quantityInputRefs.current[index];
      const line = listLineRefs.current[index];
      const target = quantityInput || line;
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus();
      if (quantityInput) {
        quantityInput.select();
      }
      setFocusedListLineIndex(index);
      window.setTimeout(() => {
        setFocusedListLineIndex((current) => (current === index ? null : current));
      }, 1600);
    }, 0);
  }, []);

  React.useEffect(() => {
    if (pendingFocusLineIndexRef.current === null) {
      return;
    }
    const index = pendingFocusLineIndexRef.current;
    pendingFocusLineIndexRef.current = null;
    focusListLine(index);
  }, [draftLines.length, focusListLine]);

  const addLineToDraft = (item?: GroceryItemDoc, customName = "") => {
    setDraftLines((lines) => [
      ...lines,
      (() => {
        pendingFocusLineIndexRef.current = lines.length;
        return {
          id: `draft:${Date.now()}:${lines.length}`,
          groceryItemId: item?.id || null,
          itemName: item?.name || customName,
          category: item?.category || "",
          quantity: item?.defaultQuantity || 1,
          unit: item?.defaultUnit || "unit",
          vendorHint: null,
          sortOrder: lines.length,
        };
      })(),
    ]);
  };

  const addSelectedLine = (item?: GroceryItemDoc) => {
    if (!selectedList) {
      return;
    }
    if (!item && !normalizedAddItemQuery) {
      return;
    }
    addLineToDraft(item, item ? "" : normalizedAddItemQuery);
    setAddItemQuery("");
  };

  const jumpToExistingAddItem = () => {
    if (existingAddItemLineIndex < 0) {
      return;
    }
    focusListLine(existingAddItemLineIndex);
    setAddItemQuery("");
  };

  const closeAddItemPicker = () => {
    setAddItemOpen(false);
    setAddItemQuery("");
    setHighlightedAddItemIndex(0);
  };

  const toggleAddItemPicker = () => {
    if (addItemOpen) {
      closeAddItemPicker();
      return;
    }
    setAddItemOpen(true);
  };

  const handleAddItemSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAddItemPicker();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedAddItemIndex((index) => Math.min(index + 1, Math.max(addItemMatches.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedAddItemIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const highlightedItem = addItemMatches[highlightedAddItemIndex];
      if (highlightedItem) {
        addSelectedLine(highlightedItem);
        return;
      }
      if (existingAddItemLineIndex >= 0) {
        jumpToExistingAddItem();
        return;
      }
      addSelectedLine();
    }
  };

  const updateLine = (index: number, updates: Partial<GroceryListDoc["lines"][number]>) => {
    setDraftLines((lines) => lines.map((line, i) => (i === index ? { ...line, ...updates } : line)));
  };

  const removeLine = (index: number) => {
    setDraftLines((lines) => lines.filter((_, i) => i !== index));
    setBuyingPurchaseForm((form) => {
      if (form.lineIndex === null) {
        return form;
      }
      if (form.lineIndex === index) {
        return defaultBuyingPurchaseForm();
      }
      if (form.lineIndex > index) {
        return { ...form, lineIndex: form.lineIndex - 1 };
      }
      return form;
    });
  };

  const groceryListPrintLines = (list: GroceryListDoc, lines: GroceryListDoc["lines"]) => [
    "BIGBOLD:Buying List",
    `SUBHEADER:${list.title}`,
    `CENTER:${formatDate(list.listDate)}`,
    "SEP",
    ...lines.map((line) => {
      const qty = `${line.quantity} ${line.unit}`;
      return `LEFT:${line.itemName} - ${qty}`;
    }),
    "SEP",
    `LEFT:Items: ${lines.length}`,
    "BLANK",
    "CUT",
  ];

  const printList = async () => {
    if (!selectedList) {
      return;
    }
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    try {
      const saved = await persistSelectedList();
      if (!window.pos?.print) {
        throw new Error("Print is unavailable.");
      }
      const result = await window.pos.print({
        type: "receipt",
        printer: "counter",
        data: { lines: groceryListPrintLines(saved, saved.lines) },
      });
      if (!result?.ok) {
        throw new Error(result?.error || "print-failed");
      }
      await updateGroceryList(saved.id, { status: "printed" });
      await loadLists();
      setStatus("Buying list sent to printer");
    } catch (error) {
      setStatus(validationMessage(error, "Could not print buying list"));
    } finally {
      endSaving();
    }
  };

  const exportListPdf = async () => {
    if (!selectedList) {
      return;
    }
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    const rows = draftLines
      .map(
        (line) =>
          `<tr><td>${escapeHtml(line.itemName)}</td><td>${line.quantity} ${line.unit}</td></tr>`,
      )
      .join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
      body { font-family: Arial, sans-serif; padding: 28px; color: #111; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      p { margin: 0 0 20px; color: #666; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #eee; }
      th { font-size: 11px; text-transform: uppercase; color: #666; }
    </style></head><body>
      <h1>${escapeHtml(selectedList.title)}</h1>
      <p>${formatDate(selectedList.listDate)}</p>
      <table><thead><tr><th>Item</th><th>Quantity</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`;
    try {
      if (!window.pos?.exportReportPdf) {
        throw new Error("PDF export is unavailable.");
      }
      await window.pos.exportReportPdf(html, `grocery-list-${toInputDate(selectedList.listDate)}`);
      setStatus("Buying list PDF exported");
    } catch (error) {
      setStatus(validationMessage(error, "Could not export buying list"));
    } finally {
      endSaving();
    }
  };

  const selectPurchaseItem = (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    setPurchaseForm((form) => ({
      ...form,
      groceryItemId: id,
      itemName: item?.name || "",
      category: item?.category || "",
      unit: item?.defaultUnit || "kg",
      quantity: item?.defaultQuantity || 1,
    }));
  };

  const chooseListRecordMode = (mode: ListRecordMode) => {
    if (!selectedList) {
      return;
    }
    if (mode === "item" && listTotalPurchase) {
      setStatus("This buying list already has a whole-list amount recorded.");
      return;
    }
    if (mode === "total" && itemLevelListPurchases.length > 0) {
      setStatus("Item-wise purchases already exist for this buying list.");
      return;
    }
    if (mode === activeListRecordMode) {
      if (mode === "total" && !listTotalPurchase && !listTotalPurchaseOpen) {
        setListTotalPurchaseOpen(true);
        window.setTimeout(() => {
          listTotalAmountRef.current?.focus();
          listTotalAmountRef.current?.select();
        }, 0);
      }
      return;
    }
    setStatus(null);
    setListRecordMode(mode);
    setBuyingPurchaseForm(defaultBuyingPurchaseForm());
    if (mode === "total" && !listTotalPurchase) {
      setListTotalPurchaseOpen(true);
      window.setTimeout(() => {
        listTotalAmountRef.current?.focus();
        listTotalAmountRef.current?.select();
      }, 0);
      return;
    }
    setListTotalPurchaseOpen(false);
    setListTotalPurchaseForm(defaultListTotalPurchaseForm());
  };

  const startBuyingListPurchase = (index: number) => {
    const line = draftLines[index];
    if (!line) {
      return;
    }
    if (activeListRecordMode !== "item") {
      setStatus("Switch to item-wise recording before recording individual items.");
      return;
    }
    if (listTotalPurchase) {
      setStatus("This buying list already has a total amount recorded.");
      return;
    }
    if (recordedListLineKeys.has(groceryRecordKey(line))) {
      setStatus("This buying list item is already recorded.");
      return;
    }
    setStatus(null);
    setBuyingPurchaseForm({
      lineIndex: index,
      quantity: Number(line.quantity) || 1,
      unit: line.unit,
      unitPrice: "",
      totalAmount: "",
      paymentMethod: "cash",
      notes: "",
      purchasedDate: toInputDate(Date.now()),
    });
    window.setTimeout(() => {
      buyingPurchaseQuantityRef.current?.focus();
      buyingPurchaseQuantityRef.current?.select();
    }, 0);
  };

  const cancelBuyingListPurchase = () => {
    setBuyingPurchaseForm(defaultBuyingPurchaseForm());
  };

  const cancelListTotalPurchase = () => {
    setListTotalPurchaseOpen(false);
    setListTotalPurchaseForm(defaultListTotalPurchaseForm());
    if (!listTotalPurchase) {
      setListRecordMode("item");
    }
  };

  const saveListTotalPurchase = async () => {
    if (!selectedList) {
      return;
    }
    if (listTotalPurchase) {
      setStatus("This buying list already has a total amount recorded.");
      return;
    }
    if (itemLevelListPurchases.length > 0) {
      setStatus("Item-level purchases already exist for this buying list.");
      return;
    }
    const totalAmount = draftNumber(listTotalPurchaseForm.totalAmount);
    if (totalAmount === null || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      setStatus("Total amount must be greater than zero.");
      return;
    }
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    try {
      await persistSelectedList();
      const created = await createGroceryPurchase({
        listId: selectedList.id,
        groceryItemId: null,
        itemName: LIST_TOTAL_ITEM_NAME,
        category: LIST_TOTAL_CATEGORY,
        quantity: 1,
        unit: "unit",
        unitPrice: null,
        totalAmount,
        vendor: null,
        paymentMethod: listTotalPurchaseForm.paymentMethod,
        notes: normalizeText(listTotalPurchaseForm.notes) || null,
        purchasedAt: fromInputDate(listTotalPurchaseForm.purchasedDate, false),
      });
      setSelectedListPurchases((current) => [
        created,
        ...current.filter((purchase) => purchase.id !== created.id),
      ]);
      cancelListTotalPurchase();
      await Promise.all([loadPurchases(), loadSelectedListPurchases(), loadItems(), loadSummary(), loadLists()]);
      setStatus("Buying list total recorded");
    } catch (error) {
      setStatus(validationMessage(error, "Could not record buying list total"));
    } finally {
      endSaving();
    }
  };

  const saveBuyingListPurchase = async () => {
    if (!selectedList || buyingPurchaseForm.lineIndex === null) {
      return;
    }
    if (listTotalPurchase) {
      setStatus("This buying list already has a total amount recorded.");
      return;
    }
    const line = draftLines[buyingPurchaseForm.lineIndex];
    if (!line) {
      setStatus("Buying list item was not found.");
      return;
    }
    const itemName = normalizeText(line.itemName);
    if (!itemName) {
      setStatus("Buying list item name is required before recording purchase.");
      return;
    }
    const quantity = Number(buyingPurchaseForm.quantity) || 0;
    const unitPrice = Number(buyingPurchaseForm.unitPrice || 0);
    const totalAmount = draftPurchaseTotal(buyingPurchaseForm);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setStatus("Quantity must be greater than zero.");
      return;
    }
    if (!hasValidDraftPurchaseAmount(buyingPurchaseForm) || totalAmount === null) {
      setStatus("Enter a total amount greater than zero, or enter a unit price to calculate it.");
      return;
    }
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    try {
      await persistSelectedList();
      const created = await createGroceryPurchase({
        listId: selectedList.id,
        groceryItemId: line.groceryItemId || null,
        itemName,
        category: normalizeCategoryName(line.category) || null,
        quantity,
        unit: buyingPurchaseForm.unit,
        unitPrice: buyingPurchaseForm.unitPrice === "" ? null : unitPrice,
        totalAmount,
        vendor: null,
        paymentMethod: buyingPurchaseForm.paymentMethod,
        notes: normalizeText(buyingPurchaseForm.notes) || null,
        purchasedAt: fromInputDate(buyingPurchaseForm.purchasedDate, false),
      });
      setSelectedListPurchases((current) => [
        created,
        ...current.filter((purchase) => purchase.id !== created.id),
      ]);
      setBuyingPurchaseForm(defaultBuyingPurchaseForm());
      await Promise.all([loadPurchases(), loadSelectedListPurchases(), loadItems(), loadSummary(), loadLists()]);
      setStatus("Purchase recorded from buying list");
    } catch (error) {
      setStatus(validationMessage(error, "Could not record purchase from buying list"));
    } finally {
      endSaving();
    }
  };

  const savePurchase = async () => {
    const itemName = normalizeText(purchaseForm.itemName);
    if (!itemName) {
      setStatus("Purchase item name is required.");
      return;
    }
    const quantity = Number(purchaseForm.quantity) || 0;
    const unitPrice = Number(purchaseForm.unitPrice || 0);
    const totalAmount = draftPurchaseTotal(purchaseForm);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setStatus("Quantity must be greater than zero.");
      return;
    }
    if (!hasValidDraftPurchaseAmount(purchaseForm) || totalAmount === null) {
      setStatus("Enter a total amount greater than zero, or enter a unit price to calculate it.");
      return;
    }
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    try {
      const payload = {
        listId: purchaseForm.listId || null,
        groceryItemId: purchaseForm.groceryItemId || null,
        itemName,
        category: normalizeCategoryName(purchaseForm.category) || null,
        quantity,
        unit: purchaseForm.unit,
        unitPrice: purchaseForm.unitPrice === "" ? null : unitPrice,
        totalAmount,
        vendor: null,
        paymentMethod: purchaseForm.paymentMethod,
        notes: normalizeText(purchaseForm.notes) || null,
        purchasedAt: fromInputDate(purchaseForm.purchasedDate, false),
      };
      if (editingPurchaseId) {
        await updateGroceryPurchase(editingPurchaseId, payload);
        setStatus("Purchase updated");
      } else {
        await createGroceryPurchase(payload);
        setStatus("Purchase recorded");
      }
      setEditingPurchaseId(null);
      setShowOffListPurchaseForm(false);
      setPurchaseForm(defaultPurchaseForm());
      await Promise.all([loadPurchases(), loadSelectedListPurchases(), loadItems(), loadSummary(), loadLists()]);
    } catch (error) {
      setStatus(validationMessage(error, "Could not save purchase"));
    } finally {
      endSaving();
    }
  };

  const editPurchase = (purchase: GroceryPurchaseLineDoc) => {
    setEditingPurchaseId(purchase.id);
    setShowOffListPurchaseForm(true);
    setPurchaseForm({
      groceryItemId: purchase.groceryItemId || "",
      itemName: purchase.itemName,
      category: purchase.category || "",
      quantity: purchase.quantity,
      unit: purchase.unit,
      unitPrice: purchase.unitPrice === null || purchase.unitPrice === undefined ? "" : String(purchase.unitPrice),
      totalAmount: String(purchase.totalAmount),
      paymentMethod: purchase.paymentMethod || "cash",
      notes: purchase.notes || "",
      purchasedDate: toInputDate(purchase.purchasedAt),
      listId: purchase.listId || "",
    });
    selectView("purchases");
    window.setTimeout(() => {
      purchaseFormCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const voidPurchase = async (purchase: GroceryPurchaseLineDoc) => {
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    try {
      await deleteGroceryPurchase(purchase.id);
      await Promise.all([loadPurchases(), loadSelectedListPurchases(), loadItems(), loadSummary()]);
      setStatus("Purchase removed from reports");
    } catch (error) {
      setStatus(validationMessage(error, "Could not delete purchase"));
    } finally {
      endSaving();
    }
  };

  const exportSummaryPdf = async () => {
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    const topItems = summary.topItems
      .map(
        (item) =>
          `<tr><td>${escapeHtml(groceryPurchaseDisplayName(item))}</td><td>${formatCurrency(item.amount)}</td></tr>`,
      )
      .join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
      body { font-family: Arial, sans-serif; padding: 28px; color: #111; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      h2 { font-size: 16px; margin-top: 24px; }
      .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 20px 0; }
      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
      .label { color: #666; font-size: 11px; text-transform: uppercase; font-weight: bold; }
      .value { font-size: 22px; font-weight: bold; margin-top: 5px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #eee; }
      th { font-size: 11px; text-transform: uppercase; color: #666; }
    </style></head><body>
      <h1>Grocery Spend Summary</h1>
      <p>${formatDate(fromTs)} to ${formatDate(toTs)}</p>
      <div class="grid">
        <div class="card"><div class="label">Net Sales</div><div class="value">${formatCurrency(summary.netSales)}</div></div>
        <div class="card"><div class="label">Grocery Spend</div><div class="value">${formatCurrency(summary.grocerySpend)}</div></div>
        <div class="card"><div class="label">Estimated Gross Profit</div><div class="value">${formatCurrency(summary.estimatedGrossProfit)}</div></div>
        <div class="card"><div class="label">Food Cost</div><div class="value">${summary.foodCostPercent === null ? "N/A" : `${summary.foodCostPercent}%`}</div></div>
      </div>
      <h2>Top Items</h2>
      <table><thead><tr><th>Item</th><th>Spend</th></tr></thead><tbody>${topItems}</tbody></table>
    </body></html>`;
    try {
      if (!window.pos?.exportReportPdf) {
        throw new Error("PDF export is unavailable.");
      }
      await window.pos.exportReportPdf(html, `grocery-summary-${toInputDate(fromTs)}-${toInputDate(toTs)}`);
      setStatus("Summary PDF exported");
    } catch (error) {
      setStatus(validationMessage(error, "Could not export summary"));
    } finally {
      endSaving();
    }
  };

  const archiveItem = async (item: GroceryItemDoc) => {
    if (!beginSaving()) {
      return;
    }
    setStatus(null);
    try {
      await deleteGroceryItem(item.id);
      await loadItems();
      setStatus("Reusable item archived");
    } catch (error) {
      setStatus(validationMessage(error, "Could not archive reusable item"));
    } finally {
      endSaving();
    }
  };

  const renderTabs = () => (
    <div className={styles.tabs} aria-label="Grocery sections">
      {GROCERY_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={view === tab.key}
          className={`${styles.tabButton} ${view === tab.key ? styles.tabButtonActive : ""}`}
          onClick={() => selectView(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  const renderRangeControls = () => (
    <div className={styles.dateControls}>
      {(
        [
          ["today", "Today"],
          ["yesterday", "Yesterday"],
          ["thisWeek", "This Week"],
          ["thisMonth", "This Month"],
          ["custom", "Custom"],
        ] as Array<[RangePreset, string]>
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`${styles.presetBtn} ${rangePreset === key ? styles.presetActive : ""}`}
          aria-pressed={rangePreset === key}
          onClick={() => setPreset(key)}
        >
          {label}
        </button>
      ))}
      {rangePreset === "custom" && (
        <>
          <input
            className="pos-input"
            style={{ width: 145 }}
            type="date"
            value={toInputDate(fromTs)}
            onChange={(event) => setFromTs(fromInputDate(event.target.value))}
          />
          <input
            className="pos-input"
            style={{ width: 145 }}
            type="date"
            value={toInputDate(toTs)}
            onChange={(event) => setToTs(fromInputDate(event.target.value, true))}
          />
        </>
      )}
    </div>
  );

  const renderMasterItems = () => (
    <div className={`pos-card pos-card-p ${styles.templateCard}`}>
      <div className="pos-ph" style={{ marginBottom: 14 }}>
        <div>
          <h2 className="pos-ph-title">Reusable Items</h2>
          <p className="pos-ph-sub">Defaults for new buying lists; price hints update from purchases.</p>
        </div>
      </div>
      <div className={styles.formGrid}>
        <div className={styles.span2}>
          <label className="pos-label">Item Name</label>
          <input
            className="pos-input"
            value={itemForm.name}
            onChange={(event) => setItemForm((form) => ({ ...form, name: event.target.value }))}
            placeholder="Tomato"
          />
        </div>
        <div>
          <label className="pos-label">Default Qty</label>
          <input
            className="pos-input"
            type="number"
            min="0.001"
            step="0.001"
            value={itemForm.defaultQuantity}
            onChange={(event) =>
              setItemForm((form) => ({ ...form, defaultQuantity: Number(event.target.value) }))
            }
          />
        </div>
        <div>
          <label className="pos-label">Unit</label>
          <select
            className="pos-select"
            value={itemForm.defaultUnit}
            onChange={(event) =>
              setItemForm((form) => ({ ...form, defaultUnit: event.target.value as GroceryUnit }))
            }
          >
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.actions} style={{ alignSelf: "end" }}>
          <button className="pos-btn pos-btn-primary" onClick={saveItem} disabled={saving}>
            {saving ? "Saving..." : itemForm.editingId ? "Update Item" : "Add Item"}
          </button>
          {itemForm.editingId && (
            <button
              className="pos-btn pos-btn-secondary"
              onClick={() =>
                setItemForm({
                  name: "",
                  defaultQuantity: 1,
                  defaultUnit: "kg",
                  editingId: "",
                })
              }
              disabled={saving}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className="pos-table pos-table-hover">
          <thead>
            <tr>
              <th>Item</th>
              <th>Default</th>
              <th>Last Price</th>
              <th>30d Avg</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                </td>
                <td>
                  {item.defaultQuantity} {item.defaultUnit}
                </td>
                <td>
                  {item.priceHint?.lastUnitPrice
                    ? `${formatCurrency(item.priceHint.lastUnitPrice)}/${item.priceHint.lastUnit || item.defaultUnit}`
                    : "-"}
                </td>
                <td>
                  {item.priceHint?.averageUnitPrice30d
                    ? `${formatCurrency(item.priceHint.averageUnitPrice30d)}/${item.priceHint.averageUnit || item.defaultUnit}`
                    : "-"}
                </td>
                <td>
                  <div className={styles.actions}>
                    <button
                      className="pos-btn pos-btn-xs pos-btn-secondary"
                      onClick={() =>
                        setItemForm({
                          name: item.name,
                          defaultQuantity: item.defaultQuantity,
                          defaultUnit: item.defaultUnit,
                          editingId: item.id,
                        })
                      }
                      disabled={saving}
                    >
                      Edit
                    </button>
                    <button
                      className="pos-btn pos-btn-xs pos-btn-danger"
                      onClick={() => archiveItem(item)}
                      disabled={saving}
                    >
                      Archive
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={5} className="pos-empty">
                  No reusable grocery items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderListView = () => (
    <div className={styles.listPage}>
      <div className={styles.stack}>
        <div className={`pos-card pos-card-p ${styles.listCard}`}>
          <div className="pos-ph" style={{ marginBottom: 14 }}>
            <div>
              <h2 className="pos-ph-title">Buying List</h2>
              <p className="pos-ph-sub">The checklist to edit, print, or export for the selected day.</p>
            </div>
            <div className="pos-ph-actions">
              <button className="pos-btn pos-btn-primary" onClick={generateList} disabled={saving}>
                {saving ? "Working..." : "Generate Today"}
              </button>
              <button
                className="pos-btn pos-btn-secondary"
                onClick={toggleAddItemPicker}
                disabled={saving || !selectedList}
                aria-expanded={addItemOpen}
                aria-controls="grocery-add-item-panel"
              >
                {addItemOpen ? "Close Add Item" : "Add Item"}
              </button>
              <button
                className="pos-btn pos-btn-secondary"
                onClick={() => setShowReusableItems((open) => !open)}
                aria-expanded={showReusableItems}
                aria-controls="grocery-reusable-items"
              >
                {showReusableItems ? "Hide Reusable Items" : "Manage Reusable Items"}
              </button>
            </div>
          </div>
          {lists.length > 0 && (
            <div style={{ maxWidth: 360, marginBottom: 14 }}>
              <label className="pos-label">Selected Buying List</label>
              <select
                className="pos-select"
                value={selectedList?.id || ""}
                onChange={(event) => setSelectedListId(event.target.value)}
              >
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title} - {formatDate(list.listDate)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {selectedList ? (
            <>
              <div className={styles.recordModePanel}>
                <div>
                  <div className={styles.recordModeTitle}>Record purchase as</div>
                  <div className={styles.recordModeHint}>{listRecordModeHint}</div>
                </div>
                <div className={styles.recordModeOptions} role="group" aria-label="Purchase record type">
                  <button
                    type="button"
                    className={`${styles.recordModeButton} ${
                      activeListRecordMode === "item" ? styles.recordModeButtonActive : ""
                    }`}
                    onClick={() => chooseListRecordMode("item")}
                    disabled={saving || Boolean(listTotalPurchase)}
                    aria-pressed={activeListRecordMode === "item"}
                  >
                    Item-wise
                  </button>
                  <button
                    type="button"
                    className={`${styles.recordModeButton} ${
                      activeListRecordMode === "total" ? styles.recordModeButtonActive : ""
                    }`}
                    onClick={() => chooseListRecordMode("total")}
                    disabled={saving || itemLevelListPurchases.length > 0}
                    aria-pressed={activeListRecordMode === "total"}
                    aria-controls="grocery-list-total-purchase"
                  >
                    Whole list
                  </button>
                </div>
              </div>
              {listTotalPurchase && (
                <div className={styles.recordedTotal}>
                  <span>
                    Whole-list amount recorded: {formatCurrency(listTotalPurchase.totalAmount)}
                  </span>
                  <span>{formatDate(listTotalPurchase.purchasedAt)}</span>
                </div>
              )}
              {addItemOpen && (
                <div id="grocery-add-item-panel" className={styles.addItemPanel}>
                  <div className={styles.addItemFields}>
                    <div>
                      <label className="pos-label">Add to Buying List</label>
                      <input
                        className="pos-input"
                        value={addItemQuery}
                        onChange={(event) => setAddItemQuery(event.target.value)}
                        onKeyDown={handleAddItemSearchKeyDown}
                        placeholder="Search reusable item or type custom item"
                        autoFocus
                      />
                      <div className={styles.addItemHint}>
                        Results appear after typing. Use Up/Down and Enter, or add the typed item as custom.
                      </div>
                    </div>
                    <div className={styles.addItemCount}>{addItemCountText}</div>
                    {existingAddItemLineIndex >= 0 && (
                      <div className={styles.addItemExisting}>
                        <div>
                          <strong>{draftLines[existingAddItemLineIndex]?.itemName || normalizedAddItemQuery}</strong>
                          <span> is already in this buying list.</span>
                        </div>
                        <button
                          type="button"
                          className="pos-btn pos-btn-xs pos-btn-secondary"
                          onClick={jumpToExistingAddItem}
                        >
                          Jump to Item
                        </button>
                      </div>
                    )}
                    {shouldSearchAddItems && (
                      <div className={styles.addItemResults}>
                        {addItemMatches.map((item, index) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`${styles.addItemResult} ${
                              index === highlightedAddItemIndex ? styles.addItemResultActive : ""
                            }`}
                            onMouseEnter={() => setHighlightedAddItemIndex(index)}
                            onClick={() => addSelectedLine(item)}
                          >
                            <span className={styles.addItemName}>{item.name}</span>
                            <span className={styles.addItemMeta}>
                              {item.defaultQuantity} {item.defaultUnit}
                            </span>
                          </button>
                        ))}
                        {!addItemMatches.length && existingAddItemLineIndex < 0 && (
                          <div className={styles.addItemEmpty}>
                            No reusable item found. Add the typed item as custom.
                          </div>
                        )}
                      </div>
                    )}
                    {!normalizedAddItemQuery && (
                      <div className={styles.addItemEmpty}>
                        Search by item. Existing reusable items are not listed until you type.
                      </div>
                    )}
                    <div className={styles.addItemActions}>
                      <button
                        className="pos-btn pos-btn-secondary"
                        onClick={() => addSelectedLine()}
                        disabled={saving || !normalizedAddItemQuery || existingAddItemLineIndex >= 0}
                      >
                        {existingAddItemLineIndex >= 0 ? "Already in List" : "Add Custom Item"}
                      </button>
                      <button className="pos-btn pos-btn-secondary" onClick={closeAddItemPicker} disabled={saving}>
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {activeListRecordMode === "total" && listTotalPurchaseOpen && !listTotalPurchase && (
                <div id="grocery-list-total-purchase" className={styles.inlinePurchasePanel}>
                  <div className={styles.inlinePurchaseHeader}>
                    <div className={styles.inlinePurchaseTitle}>List Total Purchase</div>
                    <button
                      type="button"
                      className="pos-btn pos-btn-xs pos-btn-secondary"
                      onClick={cancelListTotalPurchase}
                      disabled={saving}
                    >
                      Close
                    </button>
                  </div>
                  <div className={styles.inlinePurchaseGrid}>
                    <div>
                      <label className="pos-label">Date</label>
                      <input
                        className="pos-input"
                        type="date"
                        value={listTotalPurchaseForm.purchasedDate}
                        onChange={(event) =>
                          setListTotalPurchaseForm((form) => ({
                            ...form,
                            purchasedDate: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="pos-label">Total Amount</label>
                      <input
                        ref={listTotalAmountRef}
                        className="pos-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={listTotalPurchaseForm.totalAmount}
                        onChange={(event) =>
                          setListTotalPurchaseForm((form) => ({
                            ...form,
                            totalAmount: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="pos-label">Payment</label>
                      <select
                        className="pos-select"
                        value={listTotalPurchaseForm.paymentMethod}
                        onChange={(event) =>
                          setListTotalPurchaseForm((form) => ({
                            ...form,
                            paymentMethod: event.target.value,
                          }))
                        }
                      >
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.inlineSpan2}>
                      <label className="pos-label">Notes</label>
                      <input
                        className="pos-input"
                        value={listTotalPurchaseForm.notes}
                        onChange={(event) =>
                          setListTotalPurchaseForm((form) => ({
                            ...form,
                            notes: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className="pos-btn pos-btn-primary"
                      onClick={saveListTotalPurchase}
                      disabled={saving || !canSaveListTotalPurchase}
                    >
                      {saving ? "Saving..." : "Save Total"}
                    </button>
                    <button
                      type="button"
                      className="pos-btn pos-btn-secondary"
                      onClick={cancelListTotalPurchase}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <div className={styles.listLines}>
                {draftLines.length > 0 && (
                  <div className={styles.listLineHeader} aria-hidden="true">
                    <span>Item</span>
                    <span>Qty</span>
                    <span>Unit</span>
                    <span>Actions</span>
                  </div>
                )}
                {draftLines.map((line, index) => {
                  const lineRecorded = recordedListLineKeys.has(groceryRecordKey(line));
                  const listTotalRecorded = Boolean(listTotalPurchase);
                  return (
                  <React.Fragment key={`${line.id}:${index}`}>
                    <div
                      ref={(element) => {
                        listLineRefs.current[index] = element;
                      }}
                      className={`${styles.listLine} ${
                        focusedListLineIndex === index ? styles.listLineActive : ""
                      }`}
                      tabIndex={-1}
                    >
                      <div className={styles.listItemField}>
                        <label className={`pos-label ${styles.lineFieldLabel}`}>Item</label>
                        <input
                          className="pos-input"
                          aria-label={`Item ${index + 1}`}
                          value={line.itemName}
                          onChange={(event) => updateLine(index, { itemName: event.target.value })}
                          placeholder="Custom item"
                        />
                      </div>
                      <div>
                        <label className={`pos-label ${styles.lineFieldLabel}`}>Qty</label>
                        <input
                          ref={(element) => {
                            quantityInputRefs.current[index] = element;
                          }}
                          className="pos-input"
                          aria-label={`Quantity for ${line.itemName || `item ${index + 1}`}`}
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={line.quantity}
                          onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })}
                        />
                      </div>
                      <div>
                        <label className={`pos-label ${styles.lineFieldLabel}`}>Unit</label>
                        <select
                          className="pos-select"
                          aria-label={`Unit for ${line.itemName || `item ${index + 1}`}`}
                          value={line.unit}
                          onChange={(event) => updateLine(index, { unit: event.target.value as GroceryUnit })}
                        >
                          {UNITS.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={styles.listLineActions}>
                        {activeListRecordMode === "item" && (
                          <button
                            type="button"
                            className={`pos-btn pos-btn-secondary ${styles.recordActionButton}`}
                            onClick={() => startBuyingListPurchase(index)}
                            disabled={saving || !normalizeText(line.itemName) || lineRecorded || listTotalRecorded}
                            aria-expanded={buyingPurchaseForm.lineIndex === index}
                            aria-controls={`grocery-line-purchase-${index}`}
                            aria-label={
                              listTotalRecorded || lineRecorded
                                ? `${line.itemName || "Item"} purchase recorded`
                                : `Record purchase for ${line.itemName || "item"}`
                            }
                          >
                            {listTotalRecorded || lineRecorded ? "Recorded" : "Record"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="pos-btn pos-btn-danger"
                          onClick={() => removeLine(index)}
                          disabled={saving}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {activeListRecordMode === "item" && buyingPurchaseForm.lineIndex === index && (
                      <div
                        id={`grocery-line-purchase-${index}`}
                        className={styles.inlinePurchasePanel}
                      >
                        <div className={styles.inlinePurchaseHeader}>
                          <div>
                            <div className={styles.inlinePurchaseTitle}>
                              Record purchase for {line.itemName || "this item"}
                            </div>
                            <div className={styles.inlinePurchaseSub}>
                              This actual spend will appear in Purchases and Spend Summary.
                            </div>
                          </div>
                          <button
                            type="button"
                            className="pos-btn pos-btn-xs pos-btn-secondary"
                            onClick={cancelBuyingListPurchase}
                            disabled={saving}
                          >
                            Close
                          </button>
                        </div>
                        <div className={styles.inlinePurchaseGrid}>
                          <div>
                            <label className="pos-label">Date</label>
                            <input
                              className="pos-input"
                              type="date"
                              value={buyingPurchaseForm.purchasedDate}
                              onChange={(event) =>
                                setBuyingPurchaseForm((form) => ({
                                  ...form,
                                  purchasedDate: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label className="pos-label">Actual Qty</label>
                            <input
                              ref={buyingPurchaseQuantityRef}
                              className="pos-input"
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={buyingPurchaseForm.quantity}
                              onChange={(event) =>
                                setBuyingPurchaseForm((form) => ({
                                  ...form,
                                  quantity: Number(event.target.value),
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label className="pos-label">Unit</label>
                            <select
                              className="pos-select"
                              value={buyingPurchaseForm.unit}
                              onChange={(event) =>
                                setBuyingPurchaseForm((form) => ({
                                  ...form,
                                  unit: event.target.value as GroceryUnit,
                                }))
                              }
                            >
                              {UNITS.map((unit) => (
                                <option key={unit} value={unit}>
                                  {unit}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="pos-label">Unit Price</label>
                            <input
                              className="pos-input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={buyingPurchaseForm.unitPrice}
                              onChange={(event) =>
                                setBuyingPurchaseForm((form) => ({
                                  ...form,
                                  unitPrice: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label className="pos-label">Total Amount</label>
                            <input
                              className="pos-input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={buyingPurchaseForm.totalAmount}
                              placeholder={
                                buyingPurchaseForm.unitPrice
                                  ? String(
                                      (
                                        Number(buyingPurchaseForm.unitPrice) *
                                        Number(buyingPurchaseForm.quantity || 0)
                                      ).toFixed(2),
                                    )
                                  : ""
                              }
                              onChange={(event) =>
                                setBuyingPurchaseForm((form) => ({
                                  ...form,
                                  totalAmount: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label className="pos-label">Payment</label>
                            <select
                              className="pos-select"
                              value={buyingPurchaseForm.paymentMethod}
                              onChange={(event) =>
                                setBuyingPurchaseForm((form) => ({
                                  ...form,
                                  paymentMethod: event.target.value,
                                }))
                              }
                            >
                              {PAYMENT_METHODS.map((method) => (
                                <option key={method} value={method}>
                                  {method}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className={styles.inlineSpan2}>
                            <label className="pos-label">Notes</label>
                            <input
                              className="pos-input"
                              value={buyingPurchaseForm.notes}
                              onChange={(event) =>
                                setBuyingPurchaseForm((form) => ({
                                  ...form,
                                  notes: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </div>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className="pos-btn pos-btn-primary"
                            onClick={saveBuyingListPurchase}
                            disabled={saving || !normalizeText(line.itemName) || !canSaveBuyingListPurchase}
                          >
                            {saving ? "Saving..." : "Save Purchase"}
                          </button>
                          <button
                            type="button"
                            className="pos-btn pos-btn-secondary"
                            onClick={cancelBuyingListPurchase}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                  );
                })}
                {!draftLines.length && (
                  <div className="pos-empty">No items yet. Use Add Item to build this buying list.</div>
                )}
              </div>
              <div className={styles.actions} style={{ marginTop: 14 }}>
                <button
                  className="pos-btn pos-btn-primary"
                  onClick={saveList}
                  disabled={saving || !buyingListHasChanges}
                >
                  {saving ? "Saving..." : buyingListHasChanges ? "Save" : "Saved"}
                </button>
                <button className="pos-btn pos-btn-secondary" onClick={printList} disabled={saving}>
                  {saving ? "Working..." : "Print"}
                </button>
                <button className="pos-btn pos-btn-secondary" onClick={exportListPdf} disabled={saving}>
                  {saving ? "Working..." : "Export PDF"}
                </button>
              </div>
            </>
          ) : (
            <div className="pos-empty">
              Generate a buying list to begin. Reusable items can be managed from the button above.
            </div>
          )}
        </div>
      </div>
      {showReusableItems && <div id="grocery-reusable-items">{renderMasterItems()}</div>}
    </div>
  );

  const renderPurchaseEntryCard = () => (
      <div className="pos-card pos-card-p" ref={purchaseFormCardRef}>
        <div className="pos-ph" style={{ marginBottom: 14 }}>
          <div>
            <h2 className="pos-ph-title">
              {editingPurchaseId ? "Edit Purchase" : "Add Off-list Purchase"}
            </h2>
            <p className="pos-ph-sub">
              {editingPurchaseId
                ? "Adjust a saved purchase line."
                : "Use this only for purchases that were not captured from the buying list."}
            </p>
          </div>
        </div>
        <div className={styles.formGridWide}>
          <div>
            <label className="pos-label">Reusable Item</label>
            <select
              className="pos-select"
              value={purchaseForm.groceryItemId}
              onChange={(event) => selectPurchaseItem(event.target.value)}
            >
              <option value="">Custom item</option>
              {purchaseForm.groceryItemId && !items.some((item) => item.id === purchaseForm.groceryItemId) && (
                <option value={purchaseForm.groceryItemId}>{purchaseForm.itemName || "Archived reusable item"}</option>
              )}
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.span2}>
            <label className="pos-label">Item Name</label>
            <input
              className="pos-input"
              value={purchaseForm.itemName}
              onChange={(event) => setPurchaseForm((form) => ({ ...form, itemName: event.target.value }))}
            />
          </div>
          <div>
            <label className="pos-label">Date</label>
            <input
              className="pos-input"
              type="date"
              value={purchaseForm.purchasedDate}
              onChange={(event) =>
                setPurchaseForm((form) => ({ ...form, purchasedDate: event.target.value }))
              }
            />
          </div>
          <div>
            <label className="pos-label">Qty</label>
            <input
              className="pos-input"
              type="number"
              min="0.001"
              step="0.001"
              value={purchaseForm.quantity}
              onChange={(event) =>
                setPurchaseForm((form) => ({ ...form, quantity: Number(event.target.value) }))
              }
            />
          </div>
          <div>
            <label className="pos-label">Unit</label>
            <select
              className="pos-select"
              value={purchaseForm.unit}
              onChange={(event) =>
                setPurchaseForm((form) => ({ ...form, unit: event.target.value as GroceryUnit }))
              }
            >
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="pos-label">Unit Price</label>
            <input
              className="pos-input"
              type="number"
              min="0"
              step="0.01"
              value={purchaseForm.unitPrice}
              onChange={(event) => setPurchaseForm((form) => ({ ...form, unitPrice: event.target.value }))}
            />
          </div>
          <div>
            <label className="pos-label">Total Amount</label>
            <input
              className="pos-input"
              type="number"
              min="0"
              step="0.01"
              value={purchaseForm.totalAmount}
              placeholder={
                purchaseForm.unitPrice
                  ? String((Number(purchaseForm.unitPrice) * Number(purchaseForm.quantity || 0)).toFixed(2))
                  : ""
              }
              onChange={(event) => setPurchaseForm((form) => ({ ...form, totalAmount: event.target.value }))}
            />
          </div>
          <div>
            <label className="pos-label">Payment</label>
            <select
              className="pos-select"
              value={purchaseForm.paymentMethod}
              onChange={(event) =>
                setPurchaseForm((form) => ({ ...form, paymentMethod: event.target.value }))
              }
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
          {editingPurchaseId && (
            <div>
              <label className="pos-label">Source Buying List</label>
              <select
                className="pos-select"
                value={purchaseForm.listId}
                onChange={(event) => setPurchaseForm((form) => ({ ...form, listId: event.target.value }))}
              >
                <option value="">None</option>
                {purchaseForm.listId && !lists.some((list) => list.id === purchaseForm.listId) && (
                  <option value={purchaseForm.listId}>Selected buying list</option>
                )}
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={styles.span3}>
            <label className="pos-label">Notes</label>
            <input
              className="pos-input"
              value={purchaseForm.notes}
              onChange={(event) => setPurchaseForm((form) => ({ ...form, notes: event.target.value }))}
            />
          </div>
        </div>
        <div className={styles.actions} style={{ marginTop: 14 }}>
          <button className="pos-btn pos-btn-primary" onClick={savePurchase} disabled={saving || !canSavePurchase}>
            {saving ? "Saving..." : editingPurchaseId ? "Update Purchase" : "Save Off-list Purchase"}
          </button>
          {(editingPurchaseId || showOffListPurchaseForm) && (
            <button
              className="pos-btn pos-btn-secondary"
              onClick={() => {
                setEditingPurchaseId(null);
                setShowOffListPurchaseForm(false);
                setPurchaseForm(defaultPurchaseForm());
              }}
              disabled={saving}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
  );

  const renderPurchaseHistoryCard = () => (
      <div className="pos-card pos-card-p">
        <div className="pos-ph" style={{ marginBottom: 14 }}>
          <div>
            <h2 className="pos-ph-title">Purchase History</h2>
            <p className="pos-ph-sub">Item-wise history by date, unit, and amount.</p>
          </div>
          <div className="pos-ph-actions">
            {renderRangeControls()}
            <input
              className="pos-input"
              style={{ width: 220 }}
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder="Search item"
            />
            {!showOffListPurchaseForm && !editingPurchaseId && (
              <button
                type="button"
                className="pos-btn pos-btn-secondary"
                onClick={() => {
                  setEditingPurchaseId(null);
                  setPurchaseForm(defaultPurchaseForm());
                  setShowOffListPurchaseForm(true);
                  window.setTimeout(() => {
                    purchaseFormCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 0);
                }}
                disabled={saving}
              >
                Add Off-list Purchase
              </button>
            )}
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className="pos-table pos-table-hover">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td>{formatDate(purchase.purchasedAt)}</td>
                  <td>
                    <strong>{groceryPurchaseDisplayName(purchase)}</strong>
                  </td>
                  <td>
                    {purchase.quantity} {purchase.unit}
                  </td>
                  <td>
                    {purchase.unitPrice === null || purchase.unitPrice === undefined
                      ? "-"
                      : `${formatCurrency(purchase.unitPrice)}/${purchase.unit}`}
                  </td>
                  <td>
                    <strong>{formatCurrency(purchase.totalAmount)}</strong>
                  </td>
                  <td>{purchase.paymentMethod || "-"}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        className="pos-btn pos-btn-xs pos-btn-secondary"
                        onClick={() => editPurchase(purchase)}
                        disabled={saving}
                      >
                        Edit
                      </button>
                      <button
                        className="pos-btn pos-btn-xs pos-btn-danger"
                        onClick={() => voidPurchase(purchase)}
                        disabled={saving}
                      >
                        {saving ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!purchases.length && (
                <tr>
                  <td colSpan={7} className="pos-empty">
                    No grocery purchases for this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
  );

  const renderPurchasesView = () => (
    <div className={styles.stack}>
      {(showOffListPurchaseForm || editingPurchaseId) && renderPurchaseEntryCard()}
      {renderPurchaseHistoryCard()}
    </div>
  );

  const renderSummaryView = () => (
    <div className={styles.stack}>
      <div className="pos-card pos-card-p">
        <div className="pos-ph" style={{ marginBottom: 14 }}>
          <div>
            <h2 className="pos-ph-title">Spend Summary</h2>
            <p className="pos-ph-sub">Compare grocery spend with net sales for the selected range.</p>
          </div>
          <div className="pos-ph-actions">
            {renderRangeControls()}
            <button className="pos-btn pos-btn-secondary" onClick={exportSummaryPdf} disabled={saving}>
              {saving ? "Working..." : "Export PDF"}
            </button>
          </div>
        </div>
        <div className={styles.kpiGrid}>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Net Sales</div>
            <div className={styles.kpiValue}>{formatCurrency(summary.netSales)}</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Grocery Spend</div>
            <div className={styles.kpiValue}>{formatCurrency(summary.grocerySpend)}</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Estimated Gross Profit</div>
            <div className={styles.kpiValue}>{formatCurrency(summary.estimatedGrossProfit)}</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Food Cost</div>
            <div className={styles.kpiValue}>
              {summary.foodCostPercent === null ? "N/A" : `${summary.foodCostPercent}%`}
            </div>
          </div>
        </div>
      </div>
      <div className={styles.stack}>
        <div className="pos-card pos-card-p">
          <div className="pos-sect-label">Top Spending Items</div>
          <table className="pos-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Spend</th>
              </tr>
            </thead>
            <tbody>
              {summary.topItems.map((item) => (
                <tr key={`${item.category || ""}:${item.itemName}`}>
                  <td>
                    <strong>{groceryPurchaseDisplayName(item)}</strong>
                  </td>
                  <td>
                    {isWholeListGroceryRecord(item) || !item.quantity
                      ? "-"
                      : `${item.quantity} ${item.unit || ""}`}
                  </td>
                  <td>{formatCurrency(item.amount)}</td>
                </tr>
              ))}
              {!summary.topItems.length && (
                <tr>
                  <td colSpan={3} className="pos-empty">
                    No item spend for this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const body =
    view === "list"
      ? renderListView()
      : view === "purchases"
        ? renderPurchasesView()
        : renderSummaryView();

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Grocery</h1>
          <p className={styles.subtitle}>Plan buying, record purchases, and review spend.</p>
        </div>
        {renderTabs()}
      </div>
      {loading && <div className={styles.status}>Loading grocery data...</div>}
      {status && <div className={styles.status} style={{ marginBottom: 12 }}>{status}</div>}
      {body}
    </div>
  );
}
