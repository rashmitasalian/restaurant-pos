import React from "react";
import { Check } from "lucide-react";
import {
  getGroceryList,
  listGroceryPurchaseHeaders,
  type GroceryListDoc,
} from "../../../../app/db/posRepository";
import { validationMessage } from "../../../../shared/validation";
import { Drawer } from "../../../components/ui/Drawer";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import {
  costVariance,
  formatCurrency,
  formatEstimatedAmount,
  formatListDate,
  formatListTime,
  formatVariance,
  isFullyPurchased,
  itemsPendingCount,
  lineProgress,
  listTypeLabel,
  plannedTotal,
  statusLabel,
  statusTone,
} from "../groceryUtils";
import styles from "../Grocery.module.css";

type PurchaseHeader = {
  id: string;
  buyingListId?: string | null;
  vendorName?: string | null;
  purchaseDate: number;
  invoiceNumber?: string | null;
  paymentMethod?: string | null;
  status: string;
  total: number;
  lines?: unknown[];
};

type Props = {
  listId: string | null;
  onClose: () => void;
  onEdit: (id: string) => void;
  onRecordPurchase?: (id: string) => void;
  onChanged: () => void | Promise<void>;
};

function lineStateLabel(line: GroceryListDoc["lines"][number]) {
  if (line.lineStatus === "purchased" || line.purchasedQuantity != null) return "Purchased";
  if (line.lineStatus === "skipped") return "Skipped";
  return "Pending";
}

export function BuyingListDetail({
  listId,
  onClose,
  onEdit,
  onRecordPurchase,
  onChanged: _onChanged,
}: Props) {
  const [list, setList] = React.useState<GroceryListDoc | null>(null);
  const [purchases, setPurchases] = React.useState<PurchaseHeader[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  const load = React.useCallback(async (id: string) => {
    setLoading(true);
    setStatus(null);
    try {
      const [doc, headers] = await Promise.all([
        getGroceryList(id),
        listGroceryPurchaseHeaders({ listId: id, limit: 50, includeVoided: true }),
      ]);
      setList(doc);
      setPurchases((headers as PurchaseHeader[]) || []);
    } catch (error) {
      setStatus(validationMessage(error, "Could not load buying list"));
      setList(null);
      setPurchases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!listId) {
      setList(null);
      setPurchases([]);
      setStatus(null);
      return;
    }
    void load(listId);
  }, [listId, load]);

  const purchasedTotal = purchases
    .filter((p) => p.status !== "voided")
    .reduce((sum, p) => sum + Number(p.total || 0), 0);
  const planned = plannedTotal(list?.lines || []);
  const progress = lineProgress(list?.lines || []);
  const pendingItems = itemsPendingCount(list?.lines || []);
  const variance = costVariance(planned, purchasedTotal, list?.lines || []);
  const fulfilled = isFullyPurchased(list?.lines || []);
  const open = Boolean(listId);
  const editable = list && list.status !== "completed" && list.status !== "cancelled";
  const activePurchases = purchases.filter((p) => p.status !== "voided");

  return (
    <Drawer
      open={open}
      wide
      title={list?.title || "Buying List"}
      onClose={onClose}
      footer={
        list ? (
          <div className={styles.actions}>
            {editable ? (
              <Button variant="primary" size="sm" onClick={() => onEdit(list.id)}>
                Continue
              </Button>
            ) : null}
            {editable && list.lines.length > 0 && onRecordPurchase ? (
              <Button variant="secondary" size="sm" onClick={() => onRecordPurchase(list.id)}>
                Record Purchase
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : null
      }
    >
      {loading && <div className={styles.status}>Loading…</div>}
      {status && <div className={styles.status}>{status}</div>}
      {!loading && list && (
        <div className={styles.stack}>
          <div className={styles.sessionMeta}>
            {formatListDate(list.listDate)}
            {list.createdAt ? ` · Created ${formatListTime(list.createdAt)}` : ""}
            {list.createdBy ? ` by ${list.createdBy}` : ""}
            {" · "}
            {listTypeLabel(list.listType)}
            {" · "}
            <Badge tone={statusTone(list.status)}>{statusLabel(list.status)}</Badge>
            {list.printCount > 0 ? ` · Printed ${list.printCount}×` : ""}
          </div>

          <section>
            <h3 className={styles.dayHeading}>Progress</h3>
            <div className={styles.progressTrack} aria-hidden>
              <div
                className={styles.progressFill}
                style={{ width: `${Math.round(progress.pct * 100)}%` }}
              />
            </div>
            <div className={styles.hint}>
              {progress.purchased} / {progress.total} items purchased
              {!fulfilled && pendingItems > 0
                ? ` · ${pendingItems} item${pendingItems === 1 ? "" : "s"} pending`
                : ""}
            </div>
          </section>

          <section>
            <h3 className={styles.dayHeading}>Financial summary</h3>
            <div className={styles.kpiGrid} style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>
                  {fulfilled || list.status === "completed" ? "Planned / Estimated" : "Estimated"}
                </div>
                <div className={styles.kpiValue}>
                  {formatEstimatedAmount(planned, list.lines || [])}
                </div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Actual purchased</div>
                <div className={styles.kpiValue}>{formatCurrency(purchasedTotal)}</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>
                  {fulfilled || list.status === "completed" ? "Variance" : "Items pending"}
                </div>
                <div className={styles.kpiValue}>
                  {fulfilled || list.status === "completed"
                    ? formatVariance(variance)
                    : String(pendingItems)}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 className={styles.dayHeading}>Items</h3>
            {list.lines.length === 0 ? (
              <div className={styles.hint}>No items on this list yet.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className="pos-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Status</th>
                      <th>Planned</th>
                      <th>Purchased</th>
                      <th>Est.</th>
                      <th>Actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.lines.map((line) => (
                      <tr key={line.id}>
                        <td>
                          <strong>{line.itemName}</strong>
                          {line.category ? <div className={styles.hint}>{line.category}</div> : null}
                        </td>
                        <td>{lineStateLabel(line)}</td>
                        <td>
                          {line.quantity} {line.unit}
                        </td>
                        <td>
                          {line.purchasedQuantity != null
                            ? `${line.purchasedQuantity} ${line.unit}`
                            : line.lineStatus === "purchased"
                              ? <Check size={14} aria-label="Purchased" />
                              : "—"}
                        </td>
                        <td>
                          {line.estimatedTotal != null ? formatCurrency(line.estimatedTotal) : "—"}
                        </td>
                        <td>
                          {line.purchasedTotal != null ? formatCurrency(line.purchasedTotal) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className={styles.dayHeading}>Linked purchases</h3>
            {activePurchases.length === 0 ? (
              <div className={styles.hint}>No purchases linked to this list yet.</div>
            ) : (
              <div className={styles.sessionStack}>
                {activePurchases.map((purchase) => (
                  <article key={purchase.id} className={styles.sessionCard}>
                    <div className={styles.sessionMain}>
                      <div className={styles.sessionTitleRow}>
                        <h4 className={styles.sessionTitle}>
                          {purchase.id.length > 12 ? purchase.id.slice(-8).toUpperCase() : purchase.id}
                        </h4>
                        <Badge tone="success">Recorded</Badge>
                      </div>
                      <div className={styles.sessionMeta}>
                        {purchase.vendorName || "Not specified"}
                        {" · "}
                        {formatListDate(purchase.purchaseDate)}
                        {purchase.paymentMethod ? ` · ${purchase.paymentMethod}` : ""}
                      </div>
                      <div className={styles.sessionStats}>
                        {Array.isArray(purchase.lines) ? purchase.lines.length : 0} lines ·{" "}
                        {formatCurrency(purchase.total)}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {list.notes ? (
            <section>
              <h3 className={styles.dayHeading}>Notes</h3>
              <p className={styles.hint} style={{ whiteSpace: "pre-wrap" }}>
                {list.notes}
              </p>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
