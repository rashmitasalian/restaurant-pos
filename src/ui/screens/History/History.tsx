import React from "react";
import {
  countPaidOrders,
  getOrderById,
  listPaidOrderIds,
  listPaidOrders,
  deleteOrderHistory,
  getConfigGst,
  getConfigBranding,
} from "../../../app/db/posRepository";
import { printReceipt } from "../../../app/services/printer";
import { useToast } from "../../context/ToastContext";
import { reportClientError } from "../../../app/utils/clientError";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useBusinessDateRange } from "../../hooks/useBusinessDateRange";
import {
  BusinessRangeControls,
} from "../../components/BusinessRangeControls";
import { buildReceiptLines } from "../Billing/utils/receiptBuilder";
import type { ReceiptBranding } from "../Billing/utils/receiptBuilder";
import {
  DEFAULT_GST_CONFIG,
  calculateGstTotals,
  formatGstRate,
  getOrderGstConfig,
  normalizeGstConfig,
} from "../../../shared/gst";
import { PRINT } from "../../theme/print-html";
import { Button } from "../../components/ui/Button";
import { PageHeader } from "../../components/ui/PageHeader";

function normalizeModeId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

function titleizeMode(modeId: string): string {
  return modeId
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type UIOrder = {
  uid: string;
  displayId: number;
  table: number | null;
  orderType: string;
  orderLabel: string; // "Table 3" | "Takeaway" | "Delivery" with id
  total: number;
  discountPercent: number;
  discountTotal: number;
  items: number;
  method: string;
  time: number;
  _id?: string;
  _rev?: string;
};

const samples: UIOrder[] = [];

export default function History({ embedded = false }: { embedded?: boolean }) {
  const { showToast } = useToast();
  const rangeState = useBusinessDateRange();
  const { fromTs, toTs, label: rangeLabel } = rangeState;
  const [search, setSearch] = React.useState("");
  const [gstConfig, setGstConfig] = React.useState(() => normalizeGstConfig(DEFAULT_GST_CONFIG));
  const [branding, setBranding] = React.useState<ReceiptBranding | null>(null);

  const [selected, setSelected] = React.useState<string[]>([]);
  const [confirmSelectedOpen, setConfirmSelectedOpen] = React.useState(false);
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = React.useState(false);
  const [deleteAllCount, setDeleteAllCount] = React.useState<number | null>(null);
  const [deleteAllCountLoading, setDeleteAllCountLoading] = React.useState(false);
  const [deletingSelected, setDeletingSelected] = React.useState(false);
  const [deletingAll, setDeletingAll] = React.useState(false);
  // page size state (used by paging functions)
  const [pageSize, setPageSize] = React.useState(10);
  // cap the number of cached pages to avoid unbounded memory growth
  const MAX_PAGES = 5;
  // whether more results are available from the DB
  const [hasMore, setHasMore] = React.useState(true);
  // page-cache for cursor-backed pagination. Each entry is an array of UIOrder for that page.
  const [pages, setPages] = React.useState<UIOrder[][]>([[]]);
  const [pageOffsets, setPageOffsets] = React.useState<number[]>([0]);
  const [currentPageIndex, setCurrentPageIndex] = React.useState(0);
  const [loadingPage, setLoadingPage] = React.useState(false);
  const deletingSelectedRef = React.useRef(false);
  const deletingAllRef = React.useRef(false);
  const reprintingRef = React.useRef(false);
  const exportingRef = React.useRef(false);

  // sentinel for infinite scroll
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  const beginAction = React.useCallback(
    (ref: React.MutableRefObject<boolean>, setBusy: React.Dispatch<React.SetStateAction<boolean>>) => {
      if (ref.current) {
        return false;
      }
      ref.current = true;
      setBusy(true);
      return true;
    },
    [],
  );

  const endAction = React.useCallback(
    (ref: React.MutableRefObject<boolean>, setBusy: React.Dispatch<React.SetStateAction<boolean>>) => {
      ref.current = false;
      setBusy(false);
    },
    [],
  );

  React.useEffect(() => {
    const loadGst = async () => {
      try {
        setGstConfig(normalizeGstConfig(await getConfigGst()));
      } catch {
        setGstConfig(normalizeGstConfig(DEFAULT_GST_CONFIG));
      }
    };
    const loadBranding = async () => {
      try {
        setBranding(await getConfigBranding());
      } catch {
        setBranding(null);
      }
    };
    loadGst();
    loadBranding();
    window.addEventListener("orders-changed", loadGst);
    window.addEventListener("branding-changed", loadBranding);
    return () => {
      window.removeEventListener("orders-changed", loadGst);
      window.removeEventListener("branding-changed", loadBranding);
    };
  }, []);

  // small helper to convert DB docs to UIOrder
  const docsToUI = (docs: any[]) =>
    docs.map((d: any, idx: number) => {
      const paymentsArr: any[] = d.payments || [];
      const paidTotal = paymentsArr.length
        ? paymentsArr.reduce((s: number, p: any) => s + (Number(p?.amount) || 0), 0)
        : 0;
      const total = paidTotal > 0 ? paidTotal : Number(d.total || 0);

      const ot: string = normalizeModeId(d.meta?.serviceModeId || d.orderType || "");
      const tableId: number | null = d.tableId ?? null;
      let orderLabel = "";
      if (ot === "takeaway") {
        const name = d.meta?.customerName || d.meta?.name || "";
        orderLabel = name ? `Takeaway – ${name}` : "Takeaway";
      } else if (ot === "delivery") {
        const platform = d.meta?.platform || "Delivery";
        const code = d.meta?.code || d.meta?.orderCode || "";
        orderLabel = code ? `${platform} #${code}` : platform;
      } else if (ot === "self_service") {
        orderLabel = "Self Service";
      } else if (ot === "table") {
        orderLabel = tableId !== null && tableId !== undefined ? `Table ${tableId}` : "Table";
      } else {
        orderLabel = ot
          ? titleizeMode(ot)
          : tableId !== null && tableId !== undefined
            ? `Table ${tableId}`
            : "Order";
      }

      // Normalise method to title-case for display
      const rawMethod = (paymentsArr[0]?.method || "").toLowerCase();
      const method =
        rawMethod === "upi"
          ? "UPI"
          : rawMethod === "cash"
            ? "Cash"
            : rawMethod === "card"
              ? "Card"
              : rawMethod === "split"
                ? "Split"
                : rawMethod
                  ? rawMethod.charAt(0).toUpperCase() + rawMethod.slice(1)
                  : "–";

      return {
        uid: d._id || d.id || String(Math.random()),
        _id: d._id,
        _rev: d._rev,
        displayId: idx + 1,
        table: tableId,
        orderType: ot,
        orderLabel,
        total,
        discountPercent: Number(d.discountPercent || 0),
        discountTotal: Number(d.discountTotal || 0),
        items: (d.items || []).length,
        method,
        time: d.createdAt || d.updatedAt || d.paidAt || Date.now(),
      } as UIOrder;
    });

  const queryPaidOrders = async (
    pageSizeLocal: number,
    searchTerm?: string,
    offset = 0,
    rangeFrom?: number,
    rangeTo?: number,
  ) => {
    const docs = await listPaidOrders({
      from: rangeFrom,
      to: rangeTo,
      search: searchTerm?.trim() || undefined,
      limit: pageSizeLocal,
      offset,
    });
    return { docs };
  };

  // helper to load the first page (most recent orders)
  const loadFirstPage = async (
    pageSizeLocal = pageSize,
    searchTerm?: string,
    rangeFrom = fromTs,
    rangeTo = toTs,
  ) => {
    setLoadingPage(true);
    try {
      const res = await queryPaidOrders(pageSizeLocal, searchTerm, 0, rangeFrom, rangeTo);
      const ui = docsToUI(res.docs || []);
      setPages([ui]);
      setPageOffsets([0]);
      setCurrentPageIndex(0);
      setHasMore(((res.docs || []) as any[]).length === pageSizeLocal);
    } catch (e) {
      console.warn("History: failed to load first page", e);
    } finally {
      setLoadingPage(false);
    }
  };

  const loadNextPage = async (pageSizeLocal = pageSize, searchTerm?: string) => {
    // if we already have the next page cached, just advance index
    if (currentPageIndex < pages.length - 1) {
      setCurrentPageIndex((i) => i + 1);
      return;
    }
    const cur = pages[currentPageIndex] || [];
    if (cur.length === 0) {
      return;
    }
    const nextOffset = (pageOffsets[currentPageIndex] || 0) + cur.length;
    setLoadingPage(true);
    try {
      const resToUse = await queryPaidOrders(pageSizeLocal, searchTerm, nextOffset, fromTs, toTs);
      const ui = docsToUI(resToUse.docs || []);
      if (ui.length) {
        // append new page but cap total cached pages
        const prevLen = pages.length;
        const newLen = Math.min(prevLen + 1, MAX_PAGES);
        const newIndex = newLen - 1;
        setPages((prev) => {
          const copy = prev.slice();
          copy.push(ui);
          while (copy.length > MAX_PAGES) {
            copy.shift();
          }
          return copy;
        });
        setPageOffsets((prev) => {
          const copy = prev.slice();
          copy.push(nextOffset);
          while (copy.length > MAX_PAGES) {
            copy.shift();
          }
          return copy;
        });
        setCurrentPageIndex(newIndex);
        setHasMore(ui.length === pageSizeLocal);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.warn("History: failed to load next page", e);
    } finally {
      setLoadingPage(false);
    }
  };

  // load more (incremental append) — fetch next batch and append into current page (useful for infinite scroll)
  const loadMore = async (pageSizeLocal = pageSize, searchTerm?: string) => {
    const cur = pages[currentPageIndex] || [];
    if (cur.length === 0) {
      return;
    }
    const nextOffset = (pageOffsets[currentPageIndex] || 0) + cur.length;
    setLoadingPage(true);
    try {
      const resToUse = await queryPaidOrders(pageSizeLocal, searchTerm, nextOffset, fromTs, toTs);
      const ui = docsToUI(resToUse.docs || []);
      if (ui.length) {
        setPages((prev) => {
          const copy = prev.slice();
          copy[currentPageIndex] = (copy[currentPageIndex] || []).concat(ui);
          return copy;
        });
        setHasMore(ui.length === pageSizeLocal);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.warn("History: failed to load more", e);
    } finally {
      setLoadingPage(false);
    }
  };

  const loadPrevPage = () => {
    if (currentPageIndex > 0) {
      setCurrentPageIndex((i) => i - 1);
    }
  };

  // Reload when date range changes
  React.useEffect(() => {
    loadFirstPage(pageSize, search, fromTs, toTs);
  }, [fromTs, toTs]);

  // load first page on mount
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      if (!mounted) {
        return;
      }
      await loadFirstPage(pageSize, undefined, fromTs, toTs);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // derived current page items
  const pageItems = pages[currentPageIndex] || [];
  const page = currentPageIndex + 1;
  const pageCount = Math.max(1, pages.length);

  const toggleSelect = (uid: string) => {
    setSelected((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));
  };

  const selectAllVisible = () => {
    // operate on current page items only
    const visibleUids = pageItems.map((v) => v.uid);
    const allSelected = visibleUids.length > 0 && visibleUids.every((id) => selected.includes(id));
    if (allSelected) {
      setSelected((prev) => prev.filter((id) => !visibleUids.includes(id)));
    } else {
      setSelected((prev) => Array.from(new Set([...prev, ...visibleUids])));
    }
  };

  const deleteSelected = async () => {
    if (selected.length === 0) {
      return;
    }
    if (!beginAction(deletingSelectedRef, setDeletingSelected)) {
      return;
    }
    try {
      const toDelete = pageItems.filter((o) => selected.includes(o.uid));
      const remainingInPage = pageItems.filter((o) => !selected.includes(o.uid));
      const ids = toDelete.map((order) => order._id).filter(Boolean) as string[];
      if (ids.length) {
        await deleteOrderHistory(ids);
      }
      // replace current page with remaining entries
      setPages((prev) => {
        const copy = prev.slice();
        copy[currentPageIndex] = remainingInPage;
        return copy;
      });
      setSelected([]);
      setConfirmSelectedOpen(false);
      showToast(`${toDelete.length} order(s) deleted`, "info", { duration: 6000 });
    } catch (e) {
      console.warn("History: failed to delete from DB", e);
      showToast("Could not delete selected orders", "error");
    } finally {
      endAction(deletingSelectedRef, setDeletingSelected);
    }
  };

  const getDeleteAllQuery = () => ({
      from: fromTs,
      to: toTs,
      search: search.trim() || undefined,
    });

  const closeSelectedConfirm = React.useCallback(() => {
    setConfirmSelectedOpen(false);
  }, []);

  const closeDeleteAllConfirm = React.useCallback(() => {
    setConfirmDeleteAllOpen(false);
    setDeleteAllCount(null);
    setDeleteAllCountLoading(false);
  }, []);

  const openDeleteAllConfirm = async () => {
    setConfirmDeleteAllOpen(true);
    setDeleteAllCount(null);
    setDeleteAllCountLoading(true);
    try {
      const count = await countPaidOrders(getDeleteAllQuery());
      setDeleteAllCount(count);
    } catch (e) {
      console.warn("History: failed to count matching orders for delete", e);
      setDeleteAllCount(0);
      showToast("Could not count matching orders", "error");
    } finally {
      setDeleteAllCountLoading(false);
    }
  };

  const deleteAll = async () => {
    if (!beginAction(deletingAllRef, setDeletingAll)) {
      return;
    }
    try {
      const ids = await listPaidOrderIds(getDeleteAllQuery());
      if (ids.length === 0) {
        showToast("No matching orders to delete", "info");
        closeDeleteAllConfirm();
        return;
      }
      await deleteOrderHistory(ids);
      setPages([[]]);
      setCurrentPageIndex(0);
      setSelected([]);
      closeDeleteAllConfirm();
      showToast(`${ids.length} order(s) deleted`, "info", { duration: 6000 });
    } catch (e) {
      console.warn("History: failed to delete all from DB", e);
      showToast("Could not delete matching orders", "error");
    } finally {
      endAction(deletingAllRef, setDeletingAll);
    }
  };

  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewFull, setPreviewFull] = React.useState<any | null>(null);
  const [reprinting, setReprinting] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  // control for simple enter/exit animation
  const [modalVisible, setModalVisible] = React.useState(false);

  const closePreview = React.useCallback(() => {
    // animate hide, then unmount after transition
    setModalVisible(false);
    setTimeout(() => {
      setPreviewOpen(false);
      setPreviewFull(null);
      setPreviewLoading(false);
    }, 220);
  }, []);

  const selectedDeleteDialogRef = useFocusTrap<HTMLDivElement>(
    confirmSelectedOpen,
    deletingSelected ? undefined : closeSelectedConfirm,
  );
  const deleteAllDialogRef = useFocusTrap<HTMLDivElement>(
    confirmDeleteAllOpen,
    deletingAll ? undefined : closeDeleteAllConfirm,
  );
  const previewDialogRef = useFocusTrap<HTMLDivElement>(
    previewOpen,
    reprinting ? undefined : closePreview,
  );

  // when modal mounts, trigger visibility for animation
  React.useEffect(() => {
    let startTimer: any = null;
    if (previewOpen) {
      // start hidden -> then visible to allow CSS transition
      setModalVisible(false);
      startTimer = setTimeout(() => setModalVisible(true), 10);
    }
    return () => {
      if (startTimer) {
        clearTimeout(startTimer);
      }
    };
  }, [previewOpen]);

  const openOrder = async (o: UIOrder) => {
    // Open a read-only preview modal for the selected history row
    setPreviewLoading(true);
    setPreviewFull(null);
    setPreviewOpen(true);
    try {
      if ((o as any)._id) {
        const full = await getOrderById((o as any)._id);
        if (full) {
          setPreviewFull(full);
        } else {
          setPreviewFull({
            _id: (o as any)._id,
            items: [],
            tableId: o.table,
            createdAt: o.time,
          });
        }
      } else {
        // synthetic preview for sample rows
        setPreviewFull({
          _id: o.uid,
          items: [],
          tableId: o.table,
          createdAt: o.time,
        });
      }
    } catch (e) {
      console.error("openOrder failed", e);
      setPreviewFull({
        _id: o.uid,
        items: [],
        tableId: o.table,
        createdAt: o.time,
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const reprintOrder = async (o: UIOrder | any) => {
    if (!beginAction(reprintingRef, setReprinting)) {
      return;
    }
    try {
      const id = (o && ((o as any)._id || (o as any).uid)) as string | undefined;
      // Try to load the full doc — use it if available, otherwise use what we have
      const full = id ? ((await getOrderById(id)) ?? o) : o;
      const tableNum: number | null = full.tableId ?? full.table ?? null;
      const discPct: number = full.discountPercent ?? 0;
      const lines = buildReceiptLines(full, tableNum, discPct, computeTotals(full), gstConfig, branding);
      await printReceipt({ lines });
      showToast("Receipt reprinted", "success");
    } catch (e: any) {
      showToast(reportClientError("history.reprint", e, "Reprint failed"), "error");
    } finally {
      endAction(reprintingRef, setReprinting);
    }
  };

  // helper to compute subtotal / GST / total for previews and reprints.
  const computeTotals = (ord: any) => {
    const itemSubtotal = (ord?.items || []).reduce(
      (s: number, it: any) => s + (it.qty || 0) * (it.rate || 0),
      0,
    );
    const cfg = getOrderGstConfig(ord, gstConfig);
    const calculated = calculateGstTotals(ord?.items || [], Number(ord?.discountPercent || 0), cfg);
    const paymentsArr = (ord?.payments || []) as any[];
    const paidTotal = paymentsArr.reduce((s: number, p: any) => s + (Number(p?.amount) || 0), 0);
    const total = typeof ord?.total === "number" ? ord.total : paidTotal > 0 ? paidTotal : calculated.total;
    const taxableSubtotal =
      typeof ord?.subtotal === "number" ? ord.subtotal : calculated.taxableSubtotal;
    const taxTotal = calculated.taxTotal;
    return {
      ...calculated,
      itemSubtotal,
      subtotal: itemSubtotal,
      taxableSubtotal,
      taxTotal,
      cgst: calculated.cgst,
      sgst: calculated.sgst,
      discountTotal:
        typeof ord?.discountTotal === "number" ? ord.discountTotal : calculated.discountTotal,
      total,
      gstEnabled: taxTotal > 0 && cfg.gstRateBps > 0,
      gstRateBps: taxTotal > 0 ? cfg.gstRateBps : 0,
      gstHalfRateBps: taxTotal > 0 ? Math.round(cfg.gstRateBps / 2) : 0,
    };
  };

  // Export helpers: selected rows export by ID; no selection exports the active filter.
  const sortOrdersNewestFirst = (docs: any[]) =>
    docs.slice().sort((a: any, b: any) => {
      const ta = a.createdAt || a.updatedAt || a.paidAt || 0;
      const tb = b.createdAt || b.updatedAt || b.paidAt || 0;
      if (ta !== tb) {
        return tb - ta;
      }
      return String(b._id || b.id || "").localeCompare(String(a._id || a.id || ""));
    });

  const fetchFilteredForExport = async (): Promise<UIOrder[]> => {
    const docs = await listPaidOrders({
      from: fromTs,
      to: toTs,
      search: search.trim() || undefined,
    });
    return docsToUI(docs || []);
  };

  const fetchSelectedForExport = async (): Promise<UIOrder[]> => {
    const ids = Array.from(new Set(selected));
    const docs = await Promise.all(
      ids.map(async (id) => {
        try {
          return await getOrderById(id);
        } catch (e) {
          console.warn("History: selected export failed to load order", id, e);
          return null;
        }
      }),
    );
    return docsToUI(
      sortOrdersNewestFirst(docs.filter(Boolean).filter((doc: any) => doc.status === "paid")),
    );
  };

  const handleExport = async () => {
    if (!beginAction(exportingRef, setExporting)) {
      return;
    }
    let allItems: UIOrder[] = [];
    const exportingSelected = selected.length > 0;
    const label = exportingSelected ? "Selected orders" : rangeLabel;
    const fileName = exportingSelected
      ? "order-history-selected"
      : `order-history-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
    try {
      allItems = exportingSelected ? await fetchSelectedForExport() : await fetchFilteredForExport();
    } catch {
      showToast("Export failed: could not load records", "error");
      endAction(exportingRef, setExporting);
      return;
    }
    if (allItems.length === 0) {
      showToast(exportingSelected ? "No selected orders to export" : "No orders to export for this filter", "error");
      endAction(exportingRef, setExporting);
      return;
    }
    const grandTotal = allItems.reduce((s, o) => s + o.total, 0);
    const grandDiscount = allItems.reduce((s, o) => s + (o.discountTotal || 0), 0);
    const fmt = (v: number) =>
      `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const rows = allItems
      .map(
        (o, i) =>
          `<tr${o.discountPercent > 0 ? ` style="background:${PRINT.dangerRow}"` : ""}>
        <td>${i + 1}</td>
        <td>${o.orderLabel}</td>
        <td>${new Date(o.time).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
        <td style="text-align:center">${o.items}</td>
        <td style="text-align:center">${o.method}</td>
        <td style="text-align:center;color:${o.discountPercent > 0 ? "var(--pos-danger)" : PRINT.faint}">${o.discountPercent > 0 ? `${o.discountPercent}% (−${fmt(o.discountTotal)})` : "—"}</td>
        <td style="text-align:right">${fmt(o.total)}</td>
      </tr>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Order History — ${label}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 32px; color: ${PRINT.ink}; font-size: 13px; }
    h1 { font-size: 18px; margin-bottom: 2px; }
    p.sub { color: ${PRINT.sub}; font-size: 12px; margin: 0 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase;
         letter-spacing: 0.06em; color: ${PRINT.sub}; border-bottom: 2px solid var(--pos-line); }
    td { padding: 9px 10px; border-bottom: 1px solid var(--pos-surface-sunken); }
    tr:nth-child(even) td { background: var(--pos-surface-hover); }
    .total-row td { font-weight: 800; border-top: 2px solid var(--pos-line); font-size: 14px; }
    footer { margin-top: 32px; font-size: 10px; color: ${PRINT.faint}; text-align: center; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>Order History</h1>
  <p class="sub">${label} &middot; ${allItems.length} order${allItems.length !== 1 ? "s" : ""}</p>
  <table>
    <thead>
      <tr><th>#</th><th>Order</th><th>Time</th><th style="text-align:center">Items</th><th style="text-align:center">Method</th><th style="text-align:center">Discount</th><th style="text-align:right">Total</th></tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td colspan="5">Total</td>
        <td style="text-align:center;color:var(--pos-danger)">${grandDiscount > 0 ? `−${fmt(grandDiscount)}` : '—'}</td>
        <td style="text-align:right">${fmt(grandTotal)}</td>
      </tr>
    </tbody>
  </table>
  <footer>Generated ${new Date().toLocaleString("en-IN")}</footer>
</body>
</html>`;

    try {
      if ((window as any).pos?.exportReportPdf) {
        await (window as any).pos.exportReportPdf(html, fileName);
      } else {
        throw new Error("PDF export is available only in Electron.");
      }
      showToast("Export saved", "success");
    } catch (e: any) {
      showToast(reportClientError("history.export", e, "Export failed"), "error");
    } finally {
      endAction(exportingRef, setExporting);
    }
  };

  return (
    <div className={embedded ? undefined : "pos-page"}>
      {!embedded && (
      <PageHeader
        title="Order History"
        subtitle="Paid orders"
        actions={
          <>
          <input
            placeholder="Search order, method…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
loadFirstPage(pageSize, search, fromTs, toTs);
}
            }}
            className="pos-input"
            style={{ width: 200 }}
          />
          <Button onClick={() => loadFirstPage(pageSize, search, fromTs, toTs)} variant="secondary">
            Search
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting}
            variant="secondary"
            title={
              selected.length > 0 ? "Save selected orders as PDF" : "Save filtered orders as PDF"
            }
          >
            {exporting
              ? "Exporting..."
              : selected.length > 0
                ? `Export Selected PDF (${selected.length})`
                : "Export PDF"}
          </Button>
          </>
        }
      />
      )}
      {embedded && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, alignItems: "center" }}>
          <input
            placeholder="Search order, method…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                loadFirstPage(pageSize, search, fromTs, toTs);
              }
            }}
            className="pos-input"
            style={{ width: 200 }}
          />
          <Button onClick={() => loadFirstPage(pageSize, search, fromTs, toTs)} variant="secondary">
            Search
          </Button>
          <Button onClick={handleExport} disabled={exporting} variant="secondary">
            {exporting
              ? "Exporting..."
              : selected.length > 0
                ? `Export Selected PDF (${selected.length})`
                : "Export PDF"}
          </Button>
        </div>
      )}

      <BusinessRangeControls rangeState={rangeState} />

      {/* Column header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "36px 56px 1fr 160px 60px 80px 160px 100px",
          columnGap: 8,
          alignItems: "center",
          padding: "8px 16px",
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <input
            type="checkbox"
            aria-label="Select all"
            onChange={selectAllVisible}
            disabled={deletingSelected || deletingAll}
            style={{ cursor: "pointer", width: 15, height: 15 }}
            checked={pageItems.length > 0 && pageItems.every((v) => selected.includes(v.uid))}
          />
        </div>
        <span>#</span>
        <span>Order</span>
        <span>Bill Created</span>
        <span style={{ textAlign: "center" }}>Items</span>
        <span style={{ textAlign: "center" }}>Method</span>
        <span style={{ textAlign: "center" }}>Actions</span>
        <span style={{ textAlign: "right" }}>Total</span>
      </div>

      {/* Rows */}
      <div style={{ display: "grid", gap: 5 }}>
        {pageItems.length === 0 && (
          <div className="pos-empty" style={{ padding: "40px 0" }}>
            No orders found
          </div>
        )}
        {pageItems.map((s, rowIdx) => (
          <div
            key={s.uid}
            style={{
              display: "grid",
              gridTemplateColumns: "36px 56px 1fr 160px 60px 80px 160px 100px",
              columnGap: 8,
              alignItems: "center",
              padding: "10px 16px",
              borderRadius: 10,
              background: selected.includes(s.uid) ? "var(--pos-saffron-tint)" : "var(--pos-surface)",
              border: selected.includes(s.uid) ? "1.5px solid var(--pos-saffron-line)" : "1px solid var(--pos-surface-sunken)",
              boxShadow: "var(--pos-shadow-1)",
              transition: "background 120ms, border-color 120ms",
            }}
          >
            {/* Checkbox */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <input
                type="checkbox"
                checked={selected.includes(s.uid)}
                onChange={() => toggleSelect(s.uid)}
                disabled={deletingSelected || deletingAll}
                style={{ cursor: "pointer", width: 15, height: 15 }}
              />
            </div>
            {/* # */}
            <span
              style={{ fontSize: 12, color: "var(--pos-tx-muted)", fontFamily: "'Courier New', monospace" }}
            >
              {rowIdx + 1}
            </span>
            {/* Order label */}
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--pos-tx)", display: "flex", alignItems: "center", gap: 6 }}>
              {s.orderLabel}
              {s.discountPercent > 0 && (
                <span
                  title={`${s.discountPercent}% discount applied (−₹${s.discountTotal.toLocaleString("en-IN")})`}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: 10,
                    background: "var(--pos-danger-tint)",
                    color: "var(--pos-danger)",
                    border: "1px solid var(--pos-danger-line)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.discountPercent}% off
                </span>
              )}
            </div>
            {/* Time */}
            <span style={{ fontSize: 12, color: "var(--pos-tx-sub)" }}>
              {new Date(s.time).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {/* Items */}
            <span style={{ textAlign: "center", fontSize: 13, color: "var(--pos-tx-sec)", fontWeight: 600 }}>
              {s.items}
            </span>
            {/* Method badge */}
            <div style={{ textAlign: "center" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: 20,
                  background:
                    s.method === "UPI"
                      ? "var(--pos-teal-tint)"
                      : s.method === "Card"
                        ? "var(--pos-teal-tint)"
                        : s.method === "Split"
                          ? "var(--pos-saffron-tint)"
                          : "var(--pos-success-tint)",
                  color:
                    s.method === "UPI"
                      ? "var(--pos-teal)"
                      : s.method === "Card"
                        ? "var(--pos-teal-strong)"
                        : s.method === "Split"
                          ? "var(--pos-saffron-text)"
                          : "var(--pos-success)",
                }}
              >
                {s.method}
              </span>
            </div>
            {/* Actions */}
            <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
              <Button size="sm" variant="secondary" onClick={() => openOrder(s)} title="Preview order">
                Preview
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => reprintOrder(s)}
                disabled={reprinting}
                title="Reprint receipt"
              >
                {reprinting ? "Printing..." : "Reprint"}
              </Button>
            </div>
            {/* Total */}
            <span style={{ textAlign: "right", fontWeight: 800, fontSize: 15, color: "var(--pos-tx)" }}>
              ₹{s.total.toLocaleString("en-IN")}
            </span>
          </div>
        ))}
      </div>

      {/* Summary bar */}
      {pageItems.length > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "12px 16px",
            borderRadius: 12,
            background: "var(--pos-saffron-tint)",
            border: "1.5px solid var(--pos-saffron-line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--pos-saffron-text)" }}>
              {pageItems.length} order{pageItems.length !== 1 ? "s" : ""}
            </span>
          </div>
          <span style={{ fontWeight: 900, fontSize: 18, color: "var(--pos-saffron-text)" }}>
            ₹{pageItems.reduce((s, o) => s + o.total, 0).toLocaleString("en-IN")}
          </span>
        </div>
      )}

      {/* Pagination */}
      {pageItems.length > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            margin: "10px 0 4px",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Button size="sm" variant="secondary" onClick={() => loadPrevPage()} disabled={currentPageIndex === 0}>
              ← Prev
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => loadNextPage(undefined, search)}
              disabled={loadingPage || (!hasMore && currentPageIndex >= pages.length - 1)}
            >
              Next →
            </Button>
            <div ref={sentinelRef as any} style={{ width: 1, height: 1 }} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "var(--pos-tx-muted)", fontSize: 12 }}>
              {loadingPage
                ? "Loading…"
                : !hasMore
                  ? "All orders loaded"
                  : `${pages.flat().length} orders`}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => loadMore(pageSize, search)}
              disabled={loadingPage || !hasMore}
            >
              Load more
            </Button>
          </div>
        </div>
      )}

      {/* Confirm delete selected */}
      {confirmSelectedOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "var(--pos-overlay)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            ref={selectedDeleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deleteSelectedTitle"
            tabIndex={-1}
            style={{
              background: "var(--pos-surface)",
              borderRadius: 14,
              padding: "24px 28px",
              width: 420,
              maxWidth: "90vw",
              boxShadow: "var(--pos-shadow-overlay)",
            }}
          >
            <h3 id="deleteSelectedTitle" style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--pos-tx)" }}>
              Delete selected orders?
            </h3>
            <p style={{ marginTop: 8, marginBottom: 20, color: "var(--pos-tx-sub)", fontSize: 14 }}>
              This will permanently delete <strong>{selected.length}</strong> selected order
              {selected.length !== 1 ? "s" : ""}.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={closeSelectedConfirm} disabled={deletingSelected}>
                Cancel
              </Button>
              <Button variant="danger" onClick={deleteSelected} disabled={deletingSelected}>
                {deletingSelected ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete all */}
      {confirmDeleteAllOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "var(--pos-overlay)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            ref={deleteAllDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deleteAllTitle"
            tabIndex={-1}
            style={{
              background: "var(--pos-surface)",
              borderRadius: 14,
              padding: "24px 28px",
              width: 420,
              maxWidth: "90vw",
              boxShadow: "var(--pos-shadow-overlay)",
            }}
          >
            <h3 id="deleteAllTitle" style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--pos-tx)" }}>
              Delete all history?
            </h3>
            <p style={{ marginTop: 8, marginBottom: 20, color: "var(--pos-tx-sub)", fontSize: 14 }}>
              {deleteAllCountLoading ? (
                "Counting matching orders..."
              ) : (
                <>
                  This will permanently delete <strong>{deleteAllCount ?? 0}</strong> matching
                  order{deleteAllCount === 1 ? "" : "s"}. This cannot be undone.
                </>
              )}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={closeDeleteAllConfirm} disabled={deletingAll}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={deleteAll}
                disabled={deleteAllCountLoading || deletingAll || (deleteAllCount ?? 0) === 0}
              >
                {deletingAll ? "Deleting..." : "Delete All"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview modal */}
      {previewOpen && (
        <div
          onClick={closePreview}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "var(--pos-overlay)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: modalVisible ? 1 : 0,
            transition: "opacity 180ms ease",
          }}
        >
          <div
            ref={previewDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="historyPreviewTitle"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 560,
              maxWidth: "94vw",
              maxHeight: "85vh",
              overflow: "auto",
              background: "var(--pos-surface)",
              borderRadius: 14,
              padding: "24px 28px",
              boxShadow: "var(--pos-shadow-overlay)",
              transform: modalVisible ? "translateY(0) scale(1)" : "translateY(8px) scale(0.98)",
              opacity: modalVisible ? 1 : 0,
              transition: "opacity 180ms ease, transform 180ms ease",
            }}
          >
            {/* Modal header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                paddingBottom: 16,
                marginBottom: 16,
                borderBottom: "1px solid var(--pos-surface-sunken)",
              }}
            >
              <div>
                <h3 id="historyPreviewTitle" style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--pos-tx)" }}>
                  {previewFull
                    ? previewFull.orderType === "takeaway"
                      ? `Takeaway${previewFull.meta?.customerName ? ` – ${previewFull.meta.customerName}` : ""}`
                      : previewFull.orderType === "delivery"
                        ? `${previewFull.meta?.platform || "Delivery"}${previewFull.meta?.code ? ` #${previewFull.meta.code}` : ""}`
                        : `Table ${previewFull.tableId ?? "–"}`
                    : "Order Preview"}
                </h3>
                {previewFull && (
                  <div style={{ fontSize: 12, color: "var(--pos-tx-muted)", marginTop: 3 }}>
                    {new Date(
                      previewFull.updatedAt || previewFull.createdAt || Date.now(),
                    ).toLocaleString("en-IN")}
                    {" · "}
                    <span style={{ fontFamily: "'Courier New', monospace" }}>
                      #{(previewFull._id || "").split(":").pop()?.slice(-8)}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => previewFull && reprintOrder(previewFull)}
                  disabled={reprinting || previewLoading}
                >
                  {reprinting ? "Printing…" : "Reprint"}
                </Button>
                <Button size="sm" variant="secondary" onClick={closePreview}>
                  Close
                </Button>
              </div>
            </div>

            {/* Loading state */}
            {previewLoading && (
              <div
                style={{ color: "var(--pos-tx-muted)", padding: "32px 0", textAlign: "center", fontSize: 14 }}
              >
                Loading…
              </div>
            )}

            {/* Order content */}
            {!previewLoading && previewFull && (
              <div style={{ display: "grid", gap: 16 }}>
                {/* Line items */}
                <div>
                  {/* Column mini-header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 60px 70px 80px",
                      columnGap: 8,
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: "var(--pos-surface-hover)",
                      fontSize: 10,
                      fontWeight: 800,
                      color: "var(--pos-tx-muted)",
                      letterSpacing: "0.07em",
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    <span>Item</span>
                    <span style={{ textAlign: "center" }}>Qty</span>
                    <span style={{ textAlign: "right" }}>Rate</span>
                    <span style={{ textAlign: "right" }}>Amount</span>
                  </div>

                  {(previewFull?.items || []).length === 0 && (
                    <div style={{ color: "var(--pos-tx-muted)", fontSize: 13, padding: "12px 0" }}>
                      No line items.
                    </div>
                  )}
                  {(previewFull?.items || []).map((it: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 60px 70px 80px",
                        columnGap: 8,
                        padding: "9px 10px",
                        borderRadius: 8,
                        background: idx % 2 === 0 ? "var(--pos-surface)" : "var(--pos-surface-hover)",
                        borderBottom: "1px solid var(--pos-surface-sunken)",
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 13, color: "var(--pos-tx)" }}>
                        {it.name || it.title || "Item"}
                      </span>
                      <span style={{ textAlign: "center", fontSize: 13, color: "var(--pos-tx-sec)" }}>
                        {it.qty}
                      </span>
                      <span style={{ textAlign: "right", fontSize: 13, color: "var(--pos-tx-sub)" }}>
                        ₹{(it.rate || 0).toLocaleString("en-IN")}
                      </span>
                      <span
                        style={{
                          textAlign: "right",
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--pos-tx)",
                        }}
                      >
                        ₹{((it.qty || 0) * (it.rate || 0)).toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Totals card */}
                {(() => {
                  const t = computeTotals(previewFull);
                  const discountPercent = previewFull?.discountPercent;
                  const discountLine =
                    t.discountTotal > 0
                      ? `${Number(discountPercent || 0)}% (−₹${t.discountTotal.toLocaleString("en-IN")})`
                      : null;
                  const paymentsArr = (previewFull?.payments || []) as any[];
                  const paidTotal = paymentsArr.reduce(
                    (s: number, p: any) => s + (Number(p?.amount) || 0),
                    0,
                  );
                  const displayTotal = paidTotal > 0 ? paidTotal : t.total;

                  return (
                    <div
                      style={{
                        background: "var(--pos-saffron-tint)",
                        border: "1.5px solid var(--pos-saffron-line)",
                        borderRadius: 10,
                        padding: "14px 16px",
                        display: "grid",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 13,
                          color: "var(--pos-tx-sec)",
                        }}
                      >
                        <span>Subtotal</span>
                        <span style={{ fontWeight: 600 }}>
                          ₹{t.subtotal.toLocaleString("en-IN")}
                        </span>
                      </div>
                      {t.gstEnabled && (
                        <>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 12,
                              color: "var(--pos-tx-sub)",
                            }}
                          >
                            <span>Taxable value</span>
                            <span>₹{t.taxableSubtotal.toLocaleString("en-IN")}</span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 12,
                              color: "var(--pos-tx-sub)",
                            }}
                          >
                            <span>CGST ({formatGstRate(t.gstHalfRateBps)})</span>
                            <span>₹{t.cgst.toLocaleString("en-IN")}</span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 12,
                              color: "var(--pos-tx-sub)",
                            }}
                          >
                            <span>SGST ({formatGstRate(t.gstHalfRateBps)})</span>
                            <span>₹{t.sgst.toLocaleString("en-IN")}</span>
                          </div>
                        </>
                      )}
                      {discountLine && (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 12,
                            color: "var(--pos-success)",
                          }}
                        >
                          <span>Discount</span>
                          <span>{discountLine}</span>
                        </div>
                      )}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          paddingTop: 8,
                          marginTop: 2,
                          borderTop: "1px solid var(--pos-saffron-line)",
                          fontSize: 16,
                          fontWeight: 900,
                          color: "var(--pos-saffron-text)",
                        }}
                      >
                        <span>Total</span>
                        <span>₹{displayTotal.toLocaleString("en-IN")}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Payments */}
                {((previewFull?.payments || []) as any[]).length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: "var(--pos-tx-muted)",
                        letterSpacing: "0.07em",
                        textTransform: "uppercase",
                        marginBottom: 8,
                      }}
                    >
                      Payments
                    </div>
                    <div style={{ display: "grid", gap: 5 }}>
                      {(previewFull!.payments || []).map((p: any, idx: number) => {
                        const method = (p?.method || p?.type || "Payment").toLowerCase();
                        const bg =
                          method === "upi"
                            ? "var(--pos-teal-tint)"
                            : method === "card"
                              ? "var(--pos-teal-tint)"
                              : method === "split"
                                ? "var(--pos-saffron-tint)"
                                : "var(--pos-success-tint)";
                        const fg =
                          method === "upi"
                            ? "var(--pos-teal)"
                            : method === "card"
                              ? "var(--pos-teal-strong)"
                              : method === "split"
                                ? "var(--pos-saffron-text)"
                                : "var(--pos-success)";
                        return (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "8px 12px",
                              borderRadius: 8,
                              background: "var(--pos-surface-hover)",
                              border: "1px solid var(--pos-surface-sunken)",
                            }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "3px 10px",
                                borderRadius: 20,
                                fontSize: 11,
                                fontWeight: 700,
                                background: bg,
                                color: fg,
                              }}
                            >
                              {p?.method || p?.type || "Payment"}
                            </span>
                            <span style={{ fontWeight: 800, fontSize: 14, color: "var(--pos-tx)" }}>
                              ₹{(+(p?.amount || 0)).toLocaleString("en-IN")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
