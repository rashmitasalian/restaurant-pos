import React from "react";
import {
  createBuyingListTemplate,
  deleteGroceryList,
  listBuyingListTemplates,
  listGroceryLists,
  listGroceryPurchaseHeaders,
  updateGroceryList,
  type GroceryListDoc,
} from "../../../../app/db/posRepository";
import type { BuyingListTemplateDto } from "../../../../shared/pos";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input } from "../../../components/ui/Input";
import { Modal } from "../../../components/ui/Modal";
import { Select } from "../../../components/ui/Select";
import { validationMessage } from "../../../../shared/validation";
import { buyingListHtml, buyingListPrintLines } from "../buyingListPrint";
import styles from "../Grocery.module.css";
import {
  formatCurrency,
  formatDayHeading,
  formatEstimatedAmount,
  formatListDate,
  formatListTime,
  formatVariance,
  fromInputDate,
  getHistoryRange,
  costVariance,
  itemsPendingCount,
  isFullyPurchased,
  lineProgress,
  listTypeLabel,
  plannedTotal,
  startOfDay,
  statusLabel,
  statusTone,
  toInputDate,
  type HistoryPreset,
} from "../groceryUtils";
import { NewBuyingListModal } from "./NewBuyingListModal";
import { BuyingListDetail } from "./BuyingListDetail";
import { BuyingListEditor } from "./BuyingListEditor";
import { RecordPurchaseFlow } from "../Purchases/RecordPurchaseFlow";

type ListCardModel = GroceryListDoc & {
  planned: number;
  purchased: number;
};

function dayLabel(dayKey: number, todayStart: number) {
  if (dayKey > todayStart) return `Scheduled · ${formatDayHeading(dayKey)}`;
  return formatDayHeading(dayKey);
}

function ListMoreMenu({
  list,
  onQuickView,
  onChanged,
  onCloseMenu,
}: {
  list: ListCardModel;
  onQuickView: () => void;
  onChanged: () => void | Promise<void>;
  onCloseMenu: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [templateName, setTemplateName] = React.useState(list.title);
  const [status, setStatus] = React.useState<string | null>(null);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await fn();
      await onChanged();
      onCloseMenu();
    } catch (error) {
      setStatus(validationMessage(error, fallback));
    } finally {
      setBusy(false);
    }
  };

  const printList = () =>
    run(async () => {
      const updated = await updateGroceryList(list.id, { recordPrint: true });
      if (!window.pos?.print) throw new Error("Print is unavailable.");
      const result = await window.pos.print({
        type: "receipt",
        printer: "counter",
        data: { lines: buyingListPrintLines(updated, false) },
      });
      if (!result?.ok) throw new Error(result?.error || "print-failed");
    }, "Could not print");

  const exportPdf = () =>
    run(async () => {
      if (!window.pos?.exportReportPdf) throw new Error("PDF export is unavailable.");
      await window.pos.exportReportPdf(buyingListHtml(list), `buying-list-${list.id.slice(-8)}`);
    }, "Could not export PDF");

  const completeList = () =>
    run(async () => {
      await updateGroceryList(list.id, { status: "completed" });
    }, "Could not complete list");

  const cancelList = () => {
    if (!window.confirm("Cancel this buying list? It will remain in history.")) return;
    void run(async () => {
      await updateGroceryList(list.id, { status: "cancelled" });
    }, "Could not cancel list");
  };

  const removeList = () => {
    if (!window.confirm("Delete this draft buying list permanently?")) return;
    void run(async () => {
      await deleteGroceryList(list.id);
    }, "Could not delete list");
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      setStatus("Template name is required");
      return;
    }
    await run(async () => {
      await createBuyingListTemplate({ name: templateName.trim(), sourceListId: list.id });
      setTemplateOpen(false);
    }, "Could not save template");
  };

  const canComplete =
    list.status !== "completed" && list.status !== "cancelled" && list.status !== "draft";

  return (
    <>
      <div className={styles.moreMenu} role="menu">
        {status && <div className={styles.status}>{status}</div>}
        <button type="button" role="menuitem" className={styles.moreItem} onClick={onQuickView}>
          Quick view
        </button>
        <button type="button" role="menuitem" className={styles.moreItem} onClick={() => void printList()} disabled={busy}>
          Print
        </button>
        <button type="button" role="menuitem" className={styles.moreItem} onClick={() => void exportPdf()} disabled={busy}>
          Save as PDF
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.moreItem}
          onClick={() => {
            setTemplateName(list.title);
            setTemplateOpen(true);
          }}
          disabled={busy}
        >
          Save as Template
        </button>
        {canComplete ? (
          <button type="button" role="menuitem" className={styles.moreItem} onClick={() => void completeList()} disabled={busy}>
            Complete
          </button>
        ) : null}
        {list.status === "draft" ? (
          <button type="button" role="menuitem" className={`${styles.moreItem} ${styles.moreDanger}`} onClick={removeList} disabled={busy}>
            Delete
          </button>
        ) : list.status !== "cancelled" ? (
          <button type="button" role="menuitem" className={`${styles.moreItem} ${styles.moreDanger}`} onClick={cancelList} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
      <Modal open={templateOpen} title="Save as template" onClose={() => setTemplateOpen(false)}>
        <div className="ui-form-stack">
          <Input label="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} autoFocus />
          <div className="ui-form-actions">
            <Button variant="secondary" onClick={() => setTemplateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveTemplate()} loading={busy}>
              Save template
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function BuyingListsView() {
  const [lists, setLists] = React.useState<ListCardModel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<string | null>(null);
  const [preset, setPreset] = React.useState<HistoryPreset>("active");
  const [fromTs, setFromTs] = React.useState(() => getHistoryRange("active").from);
  const [toTs, setToTs] = React.useState(() => getHistoryRange("active").to);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [newOpen, setNewOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [purchaseId, setPurchaseId] = React.useState<string | null>(null);
  const [menuId, setMenuId] = React.useState<string | null>(null);
  const [templates, setTemplates] = React.useState<BuyingListTemplateDto[]>([]);

  const applyPreset = (next: HistoryPreset) => {
    setPreset(next);
    if (next === "custom") return;
    const range = getHistoryRange(next);
    setFromTs(range.from);
    setToTs(range.to);
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [rawLists, tpls] = await Promise.all([
        listGroceryLists({ from: fromTs, to: toTs, limit: 100 }),
        listBuyingListTemplates(),
      ]);
      const headers =
        rawLists.length === 0
          ? []
          : await Promise.all(
              rawLists.map((list) =>
                listGroceryPurchaseHeaders({ listId: list.id, includeVoided: false, limit: 50 }),
              ),
            );
      const spendByList = new Map<string, number>();
      headers.flat().forEach((header: any) => {
        if (header.status === "voided" || !header.buyingListId) return;
        spendByList.set(
          header.buyingListId,
          (spendByList.get(header.buyingListId) || 0) + Number(header.total || 0),
        );
      });
      setLists(
        rawLists.map((list) => ({
          ...list,
          planned: plannedTotal(list.lines || []),
          purchased: spendByList.get(list.id) || 0,
        })),
      );
      setTemplates(tpls);
    } catch (error) {
      setStatus(validationMessage(error, "Could not load buying lists"));
    } finally {
      setLoading(false);
    }
  }, [fromTs, toTs]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!menuId) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(`[data-more-for="${menuId}"]`)) return;
      if (target?.closest?.(".ui-overlay")) return;
      setMenuId(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuId]);

  const todayStart = startOfDay(new Date()).getTime();
  const todayLists = lists.filter(
    (list) =>
      startOfDay(new Date(list.listDate)).getTime() === todayStart && list.status !== "cancelled",
  );
  const todayPurchased = todayLists.reduce((s, l) => s + l.purchased, 0);
  const todayActive = todayLists.filter(
    (list) => list.status !== "completed" && list.status !== "cancelled",
  ).length;
  const todayItemsPending = todayLists.reduce(
    (sum, list) => sum + itemsPendingCount(list.lines || []),
    0,
  );

  const filtered = lists.filter((list) => {
    if (statusFilter !== "all" && list.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      list.title.toLowerCase().includes(q) ||
      (list.createdBy || "").toLowerCase().includes(q) ||
      (list.notes || "").toLowerCase().includes(q)
    );
  });

  const grouped = React.useMemo(() => {
    const map = new Map<string, ListCardModel[]>();
    for (const list of filtered) {
      const key = String(startOfDay(new Date(list.listDate)).getTime());
      const bucket = map.get(key) || [];
      bucket.push(list);
      map.set(key, bucket);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const aN = Number(a[0]);
      const bN = Number(b[0]);
      const aFuture = aN > todayStart;
      const bFuture = bN > todayStart;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      if (aFuture && bFuture) return aN - bN;
      return bN - aN;
    });
  }, [filtered, todayStart]);

  const openPurchase = (id: string) => {
    setDetailId(null);
    setEditId(null);
    setMenuId(null);
    setPurchaseId(id);
  };

  return (
    <div className={styles.listPage}>
      <div className={styles.toolbarRow}>
        <div className={styles.todaySummary}>
          <strong>Buying Lists</strong>
          <span>
            Today · {todayLists.length} list{todayLists.length === 1 ? "" : "s"}
            {todayLists.length > 0
              ? ` · ${todayActive} active · ${formatCurrency(todayPurchased)} purchased · ${todayItemsPending} item${
                  todayItemsPending === 1 ? "" : "s"
                } pending`
              : ""}
          </span>
        </div>
        <Button variant="primary" onClick={() => setNewOpen(true)}>
          + New Buying List
        </Button>
      </div>

      {status && <div className={styles.status}>{status}</div>}

      <div className={styles.filterBar}>
        <div className={styles.presetRow}>
          {(
            [
              ["active", "Active"],
              ["today", "Today"],
              ["7d", "7 Days"],
              ["30d", "30 Days"],
              ["custom", "Custom"],
            ] as Array<[HistoryPreset, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`${styles.presetBtn} ${preset === id ? styles.presetActive : ""}`}
              onClick={() => applyPreset(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className={styles.dateControls}>
            <Input
              type="date"
              value={toInputDate(fromTs)}
              onChange={(e) => setFromTs(fromInputDate(e.target.value))}
              aria-label="From date"
            />
            <Input
              type="date"
              value={toInputDate(toTs)}
              onChange={(e) => setToTs(fromInputDate(e.target.value, true))}
              aria-label="To date"
            />
          </div>
        )}
        <Input
          placeholder="Search lists…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 240 }}
        />
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="open">Open</option>
          <option value="partial">Partially Purchased</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {loading ? (
        <div className={styles.status}>Loading buying lists…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={lists.length === 0 ? "No buying lists in this range" : "No lists match filters"}
          text={
            lists.length === 0
              ? "Create a morning or evening procurement list. Scheduled (future) lists appear under Active."
              : "Try another date range or clear the status filter."
          }
          actionLabel="+ New Buying List"
          onAction={() => setNewOpen(true)}
        />
      ) : (
        <div className={styles.historyStack}>
          {grouped.map(([dayKey, dayLists]) => (
            <section key={dayKey} className={styles.dayGroup}>
              <h3 className={styles.dayHeading}>{dayLabel(Number(dayKey), todayStart)}</h3>
              <div className={styles.sessionStack}>
                {dayLists.map((list) => {
                  const progress = lineProgress(list.lines || []);
                  const pendingItems = itemsPendingCount(list.lines || []);
                  const completeByItems = isFullyPurchased(list.lines || []);
                  const variance = costVariance(list.planned, list.purchased, list.lines || []);
                  const terminal = list.status === "completed" || list.status === "cancelled";
                  const canRecordPurchase = !terminal && (list.lines || []).length > 0;
                  const listDay = startOfDay(new Date(list.listDate)).getTime();
                  const showDateInMeta = listDay !== todayStart;
                  return (
                    <article key={list.id} className={styles.sessionCard}>
                      <div className={styles.sessionMain}>
                        <div className={styles.sessionTitleRow}>
                          <h4 className={styles.sessionTitle}>{list.title}</h4>
                          <Badge tone={statusTone(list.status)}>{statusLabel(list.status)}</Badge>
                        </div>
                        <div className={styles.sessionMeta}>
                          {showDateInMeta ? `${formatListDate(list.listDate)} · ` : ""}
                          {formatListTime(list.createdAt || list.listDate)}
                          {list.createdBy ? ` · ${list.createdBy}` : ""}
                          {` · ${listTypeLabel(list.listType)}`}
                          {progress.total > 0
                            ? ` · ${progress.purchased}/${progress.total} items`
                            : ` · ${list.lines.length} items`}
                        </div>
                        <div className={styles.sessionStats}>
                          {completeByItems || terminal ? (
                            <>
                              Planned {formatEstimatedAmount(list.planned, list.lines || [])}
                              {" · "}Purchased {formatCurrency(list.purchased)}
                              {" · "}Variance {formatVariance(variance)}
                            </>
                          ) : (
                            <>
                              Estimated {formatEstimatedAmount(list.planned, list.lines || [])}
                              {" · "}Purchased {formatCurrency(list.purchased)}
                              {" · "}
                              {pendingItems} item{pendingItems === 1 ? "" : "s"} pending
                            </>
                          )}
                        </div>
                      </div>
                      <div className={styles.sessionActions} data-more-for={list.id}>
                        {terminal ? (
                          <Button variant="secondary" size="sm" onClick={() => setDetailId(list.id)}>
                            View
                          </Button>
                        ) : (
                          <>
                            <Button variant="primary" size="sm" onClick={() => setEditId(list.id)}>
                              Continue
                            </Button>
                            {canRecordPurchase ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => openPurchase(list.id)}
                              >
                                Record Purchase
                              </Button>
                            ) : null}
                          </>
                        )}
                        <div className={styles.moreWrap}>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-haspopup="menu"
                            aria-expanded={menuId === list.id}
                            onClick={() => setMenuId((id) => (id === list.id ? null : list.id))}
                          >
                            Details ⋯
                          </Button>
                          {menuId === list.id ? (
                            <ListMoreMenu
                              list={list}
                              onQuickView={() => {
                                setMenuId(null);
                                setDetailId(list.id);
                              }}
                              onChanged={load}
                              onCloseMenu={() => setMenuId(null)}
                            />
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <NewBuyingListModal
        open={newOpen}
        templates={templates}
        recentLists={lists.slice(0, 12)}
        onClose={() => setNewOpen(false)}
        onCreated={async (list) => {
          setNewOpen(false);
          setStatus(`Created ${list.title}`);
          const listDay = startOfDay(new Date(list.listDate)).getTime();
          if (listDay < fromTs || listDay > toTs) {
            applyPreset("active");
          }
          await load();
          setEditId(list.id);
        }}
      />

      <BuyingListDetail
        listId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(id) => {
          setDetailId(null);
          setEditId(id);
        }}
        onRecordPurchase={openPurchase}
        onChanged={load}
      />

      {editId && (
        <BuyingListEditor
          listId={editId}
          onClose={() => setEditId(null)}
          onChanged={load}
          onRecordPurchase={(id) => {
            setEditId(null);
            openPurchase(id);
          }}
        />
      )}

      {purchaseId && (
        <RecordPurchaseFlow
          listId={purchaseId}
          onClose={() => setPurchaseId(null)}
          onChanged={async () => {
            await load();
            setStatus("Purchase recorded");
          }}
        />
      )}
    </div>
  );
}
