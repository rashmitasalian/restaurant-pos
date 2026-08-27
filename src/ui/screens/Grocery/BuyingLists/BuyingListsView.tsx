import React from "react";
import {
  listBuyingListTemplates,
  listGroceryLists,
  listGroceryPurchaseHeaders,
  type GroceryListDoc,
} from "../../../../app/db/posRepository";
import type { BuyingListTemplateDto } from "../../../../shared/pos";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { validationMessage } from "../../../../shared/validation";
import styles from "../Grocery.module.css";
import {
  formatCurrency,
  formatDayHeading,
  formatListTime,
  fromInputDate,
  getHistoryRange,
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

type ListCardModel = GroceryListDoc & {
  planned: number;
  purchased: number;
};

function dayLabel(dayKey: number, todayStart: number) {
  if (dayKey > todayStart) return `Scheduled · ${formatDayHeading(dayKey)}`;
  return formatDayHeading(dayKey);
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
      // Spend is linked by buying_list_id — query headers for those lists, not by date filter
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
    load();
  }, [load]);

  const todayStart = startOfDay(new Date()).getTime();
  const todayLists = lists.filter(
    (list) =>
      startOfDay(new Date(list.listDate)).getTime() === todayStart && list.status !== "cancelled",
  );
  const todayPlanned = todayLists.reduce((s, l) => s + l.planned, 0);
  const todayPurchased = todayLists.reduce((s, l) => s + l.purchased, 0);
  const todayPending = Math.max(0, todayPlanned - todayPurchased);

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
    // Future days first (scheduled), then today, then past
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

  const primaryAction = (list: ListCardModel) => {
    if (list.status === "completed" || list.status === "cancelled") {
      return { label: "View", run: () => setDetailId(list.id) };
    }
    return { label: "Continue", run: () => setEditId(list.id) };
  };

  return (
    <div className={styles.listPage}>
      <div className={styles.toolbarRow}>
        <div className={styles.todaySummary}>
          <strong>Today&apos;s Procurement</strong>
          <span>
            {todayLists.length} session{todayLists.length === 1 ? "" : "s"} ·{" "}
            {formatCurrency(todayPlanned)} planned · {formatCurrency(todayPurchased)} purchased ·{" "}
            {formatCurrency(todayPending)} pending
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
                  const action = primaryAction(list);
                  return (
                    <article key={list.id} className={styles.sessionCard}>
                      <div className={styles.sessionMain}>
                        <div className={styles.sessionTitleRow}>
                          <h4 className={styles.sessionTitle}>{list.title}</h4>
                          <Badge tone={statusTone(list.status)}>{statusLabel(list.status)}</Badge>
                        </div>
                        <div className={styles.sessionMeta}>
                          {formatListTime(list.createdAt || list.listDate)}
                          {list.createdBy ? ` · ${list.createdBy}` : ""}
                          {` · ${list.lines.length} items`}
                          {` · ${formatCurrency(list.planned)} planned`}
                          {list.purchased > 0 ? ` · ${formatCurrency(list.purchased)} bought` : ""}
                          {list.printCount > 0 ? ` · Printed ${list.printCount}×` : ""}
                        </div>
                      </div>
                      <div className={styles.sessionActions}>
                        <Button variant="secondary" size="sm" onClick={action.run}>
                          {action.label}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDetailId(list.id)}>
                          Details
                        </Button>
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
          // Ensure Active/custom range includes the new list date
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
        onChanged={async () => {
          await load();
        }}
      />

      {editId && (
        <BuyingListEditor
          listId={editId}
          onClose={() => setEditId(null)}
          onChanged={async () => {
            await load();
          }}
        />
      )}
    </div>
  );
}
