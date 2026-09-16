import React from "react";
import { listGroceryLists } from "../../../app/db/posRepository";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { ManageShell } from "./ManageShell";
import type { ManagerSection } from "./managerSections";
import {
  formatCurrency,
  formatListTime,
  getHistoryRange,
  startOfDay,
  statusLabel,
  statusTone,
} from "../Grocery/groceryUtils";
import styles from "./Overview.module.css";

type OverviewProps = {
  onNavigate: (section: ManagerSection) => void;
};

type AttentionList = {
  id: string;
  title: string;
  status: string;
  listDate: number;
};

export default function Overview({ onNavigate }: OverviewProps) {
  const [attention, setAttention] = React.useState<AttentionList[]>([]);
  const [todayStats, setTodayStats] = React.useState({
    sessions: 0,
    planned: 0,
    purchased: 0,
  });
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const range = getHistoryRange("active");
        const lists = await listGroceryLists({ from: range.from, to: range.to, limit: 50 });
        if (cancelled) {
          return;
        }
        const todayStart = startOfDay(new Date()).getTime();
        const todayLists = lists.filter(
          (list) =>
            startOfDay(new Date(list.listDate)).getTime() === todayStart &&
            list.status !== "cancelled",
        );
        const needsAttention = lists.filter(
          (list) =>
            list.status === "draft" ||
            list.status === "open" ||
            list.status === "partial" ||
            startOfDay(new Date(list.listDate)).getTime() > todayStart,
        );
        setAttention(
          needsAttention.slice(0, 6).map((list) => ({
            id: list.id,
            title: list.title,
            status: list.status,
            listDate: list.listDate,
          })),
        );
        setTodayStats({
          sessions: todayLists.length,
          planned: todayLists.reduce(
            (sum, list) =>
              sum + list.lines.reduce((s, line) => s + Number(line.estimatedTotal || 0), 0),
            0,
          ),
          purchased: 0,
        });
      } catch {
        if (!cancelled) {
          setAttention([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <ManageShell
      title="Overview"
      description={`${greeting}. Here's what needs attention.`}
      width="operational"
      primaryAction={
        <>
          <Button variant="primary" onClick={() => onNavigate("grocery")}>
            + Buying List
          </Button>
          <Button variant="secondary" onClick={() => onNavigate("expenses")}>
            Add Expense
          </Button>
        </>
      }
    >
      <section className={styles.block}>
        <h2 className={styles.blockTitle}>Procurement</h2>
        {loading ? (
          <p className={styles.muted}>Loading…</p>
        ) : attention.length === 0 ? (
          <p className={styles.muted}>No buying lists need attention right now.</p>
        ) : (
          <ul className={styles.attentionList}>
            {attention.map((item) => (
              <li key={item.id} className={styles.attentionRow}>
                <div>
                  <div className={styles.attentionTitle}>{item.title}</div>
                  <div className={styles.attentionMeta}>
                    {new Date(item.listDate).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
                    {` · ${formatListTime(item.listDate)}`}
                  </div>
                </div>
                <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" size="sm" onClick={() => onNavigate("grocery")}>
          Open Grocery
        </Button>
      </section>

      <section className={styles.kpiLine} aria-label="Today summary">
        <div>
          <span className={styles.kpiLabel}>Today&apos;s lists</span>
          <strong className={styles.kpiValue}>{todayStats.sessions}</strong>
        </div>
        <div>
          <span className={styles.kpiLabel}>Planned</span>
          <strong className={styles.kpiValue}>{formatCurrency(todayStats.planned)}</strong>
        </div>
        <div>
          <span className={styles.kpiLabel}>Pending attention</span>
          <strong className={styles.kpiValue}>{attention.length}</strong>
        </div>
      </section>
    </ManageShell>
  );
}
