import React from "react";
import { ChevronDown, ChevronRight, ChevronUp, RefreshCw } from "lucide-react";
import { getOrderTimeline, getStaffActivity, listReviewItems } from "../../../app/db/posRepository";
import { useBusinessDateRange } from "../../hooks/useBusinessDateRange";
import { BusinessRangeControls } from "../../components/BusinessRangeControls";
import { ManageShell } from "../Manager/ManageShell";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Drawer } from "../../components/ui/Drawer";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/ui/Icon";
import { Select } from "../../components/ui/Select";
import { validationMessage } from "../../../shared/validation";
import {
  PRIMARY_REVIEW_RULES,
  actorKey,
  reviewQueueFact,
  summarizeReviewItems,
  timelineEventDetail,
  timelineForReview,
  type OrderTimelineEventDto,
  type ReviewItemDto,
  type ReviewRuleId,
  type StaffActivityRowDto,
} from "../../../shared/ownerReview";
import type { OrderDto } from "../../../shared/pos";
import styles from "./OwnerReview.module.css";

type RuleFilter = "all" | ReviewRuleId;

function formatMoney(amount: number) {
  return `₹${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatWhen(ts?: number | null) {
  if (!ts) {
    return "—";
  }
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatClock(ts?: number | null) {
  if (!ts) {
    return "—";
  }
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function staffLabel(row: Pick<StaffActivityRowDto, "username" | "displayName">) {
  return row.displayName || row.username;
}

function actorDisplayName(username: string | null | undefined, staff: StaffActivityRowDto[]) {
  if (!username) {
    return "Staff";
  }
  const row = staff.find((entry) => actorKey(entry.username) === actorKey(username));
  return row ? staffLabel(row) : username;
}

export default function OwnerReview({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const rangeState = useBusinessDateRange();
  const { fromTs, toTs, range } = rangeState;
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<ReviewItemDto[]>([]);
  const [staff, setStaff] = React.useState<StaffActivityRowDto[]>([]);
  const [ruleFilter, setRuleFilter] = React.useState<RuleFilter>("all");
  const [actorFilter, setActorFilter] = React.useState<string | null>(null);
  const [staffOpen, setStaffOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<ReviewItemDto | null>(null);
  const [timeline, setTimeline] = React.useState<{
    order: OrderDto;
    events: OrderTimelineEventDto[];
  } | null>(null);
  const [timelineLoading, setTimelineLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = { from: fromTs, to: toTs };
      const [nextItems, nextStaff] = await Promise.all([
        listReviewItems(query),
        getStaffActivity(query),
      ]);
      setItems(nextItems);
      setStaff(nextStaff);
    } catch (err) {
      setError(validationMessage(err, "Could not load review activity"));
      setItems([]);
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }, [fromTs, toTs]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const itemCounts = React.useMemo(() => summarizeReviewItems(items), [items]);
  const visibleItems = React.useMemo(() => {
    return items.filter((item) => {
      if (ruleFilter !== "all" && item.rule !== ruleFilter) {
        return false;
      }
      if (actorFilter && actorKey(item.actor) !== actorKey(actorFilter)) {
        return false;
      }
      return PRIMARY_REVIEW_RULES.includes(item.rule);
    });
  }, [items, ruleFilter, actorFilter]);

  const selectedStaffName = actorFilter ? actorDisplayName(actorFilter, staff) : null;
  const selectedStaffIndex = staff.findIndex(
    (row) => actorKey(row.username) === actorKey(actorFilter),
  );
  const queueTime = (ts: number) => (range.preset === "today" ? formatClock(ts) : formatWhen(ts));

  const openItem = async (item: ReviewItemDto) => {
    setSelected(item);
    setTimeline(null);
    setTimelineLoading(true);
    try {
      setTimeline(await getOrderTimeline(item.orderId));
    } catch (err) {
      setError(validationMessage(err, "Could not load this transaction"));
    } finally {
      setTimelineLoading(false);
    }
  };

  const closeDrawer = () => {
    setSelected(null);
    setTimeline(null);
  };

  const timelineRows =
    selected && !timelineLoading ? timelineForReview(timeline?.events || [], selected) : [];
  const orderItems = timeline?.order.items || [];

  const staffRows = staff.map((row) => [
    staffLabel(row),
    String(row.orders ?? 0),
    String(row.voids ?? 0),
    String(row.discounts ?? 0),
    String(row.afterKot ?? 0),
  ]);

  const scenarioCards: Array<{ id: RuleFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: itemCounts.needsReview },
    { id: "item_void", label: "Item voids", count: itemCounts.itemVoids },
    { id: "discount_applied", label: "Discount applied", count: itemCounts.discountsApplied },
    {
      id: "cancellation_after_kot",
      label: "Cancelled after KOT",
      count: itemCounts.cancellationAfterKot,
    },
  ];

  return (
    <ManageShell
      title="Owner Review"
      description="Review voids, discounts, and cancellations after KOT"
      width="full"
      primaryAction={
        <Button variant="secondary" onClick={() => void load()} loading={loading}>
          <Icon icon={RefreshCw} size="sm" /> Refresh
        </Button>
      }
      toolbar={<BusinessRangeControls rangeState={rangeState} />}
    >
      {error ? <p className={styles.status}>{error}</p> : null}

      <div className={styles.kpiGrid} role="tablist" aria-label="Review type">
        {scenarioCards.map((card) => {
          const active = ruleFilter === card.id;
          const hasCount = card.id !== "all" && !loading && card.count > 0;
          return (
            <button
              key={card.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.kpiCard}${active || hasCount ? ` ${styles.kpiCardActive}` : ""}${active ? ` ${styles.kpiCardSelected}` : ""}`}
              onClick={() => setRuleFilter(card.id)}
            >
              <span className={styles.kpiLabel}>{card.label}</span>
              <span className={styles.kpiValue}>{loading ? "—" : card.count}</span>
            </button>
          );
        })}
      </div>

      <section className={styles.queueSection} aria-label="Needs Review">
        <div className={styles.queueHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Needs Review</h2>
            <p className={styles.queueCount}>
              {loading
                ? "Loading…"
                : visibleItems.length === 1
                  ? "1 transaction"
                  : `${visibleItems.length} transactions`}
              {selectedStaffName ? ` · ${selectedStaffName}` : ""}
            </p>
          </div>
          <div className={styles.queueTools}>
            <div className={styles.staffSelectWrap}>
              <Select
                label="Staff"
                labelHidden
                value={actorFilter || ""}
                onChange={(event) => setActorFilter(event.target.value || null)}
              >
                <option value="">All staff</option>
                {staff.map((row) => (
                  <option key={row.username} value={row.username}>
                    {staffLabel(row)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        {selectedStaffName ? (
          <div className={styles.filterBanner}>
            <span>
              Showing activity by <strong>{selectedStaffName}</strong>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setActorFilter(null)}>
              Clear filter
            </Button>
          </div>
        ) : null}

        {loading ? (
          <p className={styles.muted}>Loading…</p>
        ) : visibleItems.length === 0 ? (
          <EmptyState
            title="Nothing needs review"
            text={
              selectedStaffName
                ? `No matching activity for ${selectedStaffName} in this period.`
                : "No item voids, discounts, or cancellation after KOT in this period."
            }
          />
        ) : (
          <ul className={styles.queue}>
            {visibleItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.queueItem}
                  onClick={() => void openItem(item)}
                >
                  <div className={styles.queueTop}>
                    <span className={styles.queueRule}>{item.label}</span>
                    <span className={styles.queueTime}>{queueTime(item.occurredAt)}</span>
                  </div>
                  <div className={styles.queueWhere}>
                    {item.orderLabel} · {formatMoney(item.amount)}
                  </div>
                  <div className={styles.queueBottom}>
                    <span className={styles.queueFact}>
                      {reviewQueueFact(item, actorDisplayName(item.actor, staff))}
                    </span>
                    <span className={styles.queueView}>
                      View
                      <Icon icon={ChevronRight} size="sm" />
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.staffSection}>
        <button
          type="button"
          className={styles.staffToggle}
          aria-expanded={staffOpen}
          onClick={() => setStaffOpen((open) => !open)}
        >
          <span>
            <span className={styles.sectionTitle}>Staff activity</span>
            <span className={styles.staffHint}>Activity during selected period</span>
          </span>
          <Icon icon={staffOpen ? ChevronUp : ChevronDown} size="md" />
        </button>
        {staffOpen ? (
          staff.length === 0 && !loading ? (
            <p className={styles.muted}>No attributable order activity in this period.</p>
          ) : (
            <DataTable
              dense
              columns={[
                { key: "employee", header: "Staff" },
                { key: "orders", header: "Orders", align: "right" },
                { key: "voids", header: "Item Voids", align: "right" },
                { key: "discounts", header: "Discount", align: "right" },
                { key: "afterKot", header: "Cancelled After KOT", align: "right" },
              ]}
              rows={staffRows}
              loading={loading}
              empty="No staff activity in this period."
              selectedIndexes={selectedStaffIndex >= 0 ? [selectedStaffIndex] : []}
              onRowClick={(index) => {
                const row = staff[index];
                if (!row) {
                  return;
                }
                setActorFilter(
                  actorKey(row.username) === actorKey(actorFilter) ? null : row.username,
                );
                setStaffOpen(true);
              }}
            />
          )
        ) : null}
      </section>

      <Drawer
        open={Boolean(selected)}
        title={selected ? selected.orderLabel : "Transaction"}
        onClose={closeDrawer}
        wide
        footer={
          selected ? (
            <>
              {timeline?.order.status === "paid" && onOpenHistory ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    closeDrawer();
                    onOpenHistory();
                  }}
                >
                  Open in History
                </Button>
              ) : null}
              <Button variant="ghost" onClick={closeDrawer}>
                Close
              </Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className={styles.drawerBody}>
            <p className={styles.drawerAmount}>
              {formatMoney(selected.amount)}
              {timeline?.order.tableId != null || selected.tableName
                ? ` · ${selected.orderLabel}`
                : ""}
            </p>
            <div className={styles.whyBox}>
              <h3>Why this needs review</h3>
              <p>{selected.why}</p>
            </div>
            <h3 className={styles.timelineHeading}>Transaction timeline</h3>
            {timelineLoading ? (
              <p className={styles.muted}>Loading…</p>
            ) : timelineRows.length > 0 ? (
              <ol className={styles.eventList}>
                {timelineRows.map((event, index) => (
                  <li
                    key={`${event.action}-${event.timestamp}-${index}`}
                    className={event.highlight ? styles.eventHighlight : undefined}
                  >
                    <span className={styles.eventTime}>{formatClock(event.timestamp)}</span>
                    <span className={styles.eventDot} aria-hidden="true" />
                    <strong>{event.label}</strong>
                    {timelineEventDetail(event) ? (
                      <span className={styles.eventDetail}>{timelineEventDetail(event)}</span>
                    ) : null}
                    {event.actor ? (
                      <span className={styles.eventActor}>
                        {actorDisplayName(event.actor, staff)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.muted}>No change history is available for this order.</p>
            )}
            {orderItems.length > 0 ? (
              <>
                <h3 className={styles.timelineHeading}>Items</h3>
                <ul className={styles.itemList}>
                  {orderItems.map((line) => (
                    <li key={line.id}>
                      <span>{line.name}</span>
                      <span className={styles.itemQty}>{line.qty}</span>
                      <span className={styles.itemAmt}>
                        {formatMoney(Number(line.rate || 0) * Number(line.qty || 0))}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </ManageShell>
  );
}
