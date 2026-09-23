import React from "react";
import {
  listBuyingListTemplates,
  listGroceryLists,
  type GroceryListDoc,
} from "../../../../app/db/posRepository";
import type { BuyingListTemplateDto } from "../../../../shared/pos";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { validationMessage } from "../../../../shared/validation";
import styles from "../Grocery.module.css";
import {
  formatCurrency,
  formatDayHeading,
  fromInputDate,
  getHistoryRange,
  listRegisterCopy,
  startOfDay,
  statusLabel,
  statusTone,
  toInputDate,
  type HistoryPreset,
} from "../groceryUtils";
import { NewBuyingListModal } from "./NewBuyingListModal";
import { BuyingListWorkspace } from "./BuyingListWorkspace";

function dayLabel(dayKey: number, todayStart: number) {
  if (dayKey > todayStart) {
    return `Scheduled · ${formatDayHeading(dayKey)}`;
  }
  return formatDayHeading(dayKey);
}

export function BuyingListsView({
  newListRef,
}: {
  newListRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [lists, setLists] = React.useState<GroceryListDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<string | null>(null);
  const [preset, setPreset] = React.useState<HistoryPreset>("active");
  const [fromTs, setFromTs] = React.useState(() => getHistoryRange("active").from);
  const [toTs, setToTs] = React.useState(() => getHistoryRange("active").to);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [newOpen, setNewOpen] = React.useState(false);
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null);
  const [templates, setTemplates] = React.useState<BuyingListTemplateDto[]>([]);

  const applyPreset = (next: HistoryPreset) => {
    setPreset(next);
    if (next === "custom") {
      return;
    }
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
      setLists(rawLists);
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
    if (!newListRef) {
      return;
    }
    newListRef.current = () => setNewOpen(true);
    return () => {
      newListRef.current = null;
    };
  }, [newListRef]);

  const todayStart = startOfDay(new Date()).getTime();
  const filtered = lists.filter((list) => {
    if (statusFilter !== "all" && list.status !== statusFilter) {
      return false;
    }
    if (!search.trim()) {
      return true;
    }
    const q = search.trim().toLowerCase();
    return (
      list.title.toLowerCase().includes(q) ||
      (list.createdBy || "").toLowerCase().includes(q) ||
      (list.notes || "").toLowerCase().includes(q)
    );
  });

  const grouped = React.useMemo(() => {
    const map = new Map<string, GroceryListDoc[]>();
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
      if (aFuture !== bFuture) {
        return aFuture ? -1 : 1;
      }
      if (aFuture && bFuture) {
        return aN - bN;
      }
      return bN - aN;
    });
  }, [filtered, todayStart]);

  return (
    <div className={styles.listPage}>
      {status ? <div className={styles.status}>{status}</div> : null}

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
        {preset === "custom" ? (
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
        ) : null}
        <div className={styles.filterTools}>
          <Input
            placeholder="Search lists…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search lists"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="partial">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
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
              <div className={styles.registerStack}>
                {dayLists.map((list) => {
                  const spent = Number(list.spentTotal || 0);
                  return (
                    <div key={list.id} className={styles.registerRowWrap}>
                      <button
                        type="button"
                        className={styles.registerRow}
                        onClick={() => setWorkspaceId(list.id)}
                      >
                        <div className={styles.registerMain}>
                          <div className={styles.registerTitleRow}>
                            <span className={styles.registerTitle}>{list.title}</span>
                            <Badge tone={statusTone(list.status)}>{statusLabel(list.status)}</Badge>
                          </div>
                          <div className={styles.registerCopy}>{listRegisterCopy(list)}</div>
                        </div>
                        {spent > 0 ? (
                          <span className={styles.registerSide}>{formatCurrency(spent)}</span>
                        ) : null}
                      </button>
                    </div>
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
          const listDay = startOfDay(new Date(list.listDate)).getTime();
          if (listDay < fromTs || listDay > toTs) {
            applyPreset("active");
          }
          await load();
          setWorkspaceId(list.id);
        }}
      />

      {workspaceId ? (
        <BuyingListWorkspace
          listId={workspaceId}
          onClose={() => setWorkspaceId(null)}
          onChanged={load}
        />
      ) : null}
    </div>
  );
}
