import React from "react";
import {
  createBuyingListTemplate,
  deleteGroceryList,
  getGroceryList,
  listGroceryPurchaseHeaders,
  updateGroceryList,
  voidGroceryPurchaseHeader,
  type GroceryListDoc,
} from "../../../../app/db/posRepository";
import { validationMessage } from "../../../../shared/validation";
import { Drawer } from "../../../components/ui/Drawer";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Input } from "../../../components/ui/Input";
import { Modal } from "../../../components/ui/Modal";
import { buyingListHtml, buyingListPrintLines } from "../buyingListPrint";
import {
  formatCurrency,
  formatListDate,
  formatListTime,
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
  onChanged: () => void | Promise<void>;
};

function rateVariance(planned: number | null | undefined, purchased: number | null | undefined) {
  if (planned == null || purchased == null) return null;
  return purchased - planned;
}

export function BuyingListDetail({ listId, onClose, onEdit, onChanged }: Props) {
  const [list, setList] = React.useState<GroceryListDoc | null>(null);
  const [purchases, setPurchases] = React.useState<PurchaseHeader[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [templateName, setTemplateName] = React.useState("");

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
    load(listId);
  }, [listId, load]);

  const purchasedTotal = purchases
    .filter((p) => p.status !== "voided")
    .reduce((sum, p) => sum + Number(p.total || 0), 0);
  const planned = plannedTotal(list?.lines || []);
  const remaining = Math.max(0, planned - purchasedTotal);

  const refresh = async () => {
    if (listId) await load(listId);
    await onChanged();
  };

  const run = async (fn: () => Promise<void>, fallback: string) => {
    if (busy || !list) return;
    setBusy(true);
    setStatus(null);
    try {
      await fn();
      await refresh();
    } catch (error) {
      setStatus(validationMessage(error, fallback));
    } finally {
      setBusy(false);
    }
  };

  const printList = async (withDetails = false) => {
    if (!list) return;
    await run(async () => {
      const updated = await updateGroceryList(list.id, { recordPrint: true });
      setList(updated);
      if (!window.pos?.print) throw new Error("Print is unavailable.");
      const result = await window.pos.print({
        type: "receipt",
        printer: "counter",
        data: { lines: buyingListPrintLines(updated, withDetails) },
      });
      if (!result?.ok) throw new Error(result?.error || "print-failed");
      setStatus("Buying list sent to printer");
    }, "Could not print buying list");
  };

  const exportPdf = async () => {
    if (!list) return;
    await run(async () => {
      if (!window.pos?.exportReportPdf) throw new Error("PDF export is unavailable.");
      await window.pos.exportReportPdf(
        buyingListHtml(list),
        `buying-list-${list.id.slice(-8)}`,
      );
      setStatus("Buying list PDF exported");
    }, "Could not export PDF");
  };

  const completeList = () =>
    run(async () => {
      await updateGroceryList(list!.id, { status: "completed" });
      setStatus("List marked complete");
    }, "Could not complete list");

  const cancelList = () => {
    if (!window.confirm("Cancel this buying list? It will remain in history.")) return;
    run(async () => {
      await updateGroceryList(list!.id, { status: "cancelled" });
      setStatus("List cancelled");
    }, "Could not cancel list");
  };

  const removeList = () => {
    if (!window.confirm("Delete this draft buying list permanently?")) return;
    run(async () => {
      await deleteGroceryList(list!.id);
      await onChanged();
      onClose();
    }, "Could not delete list");
  };

  const saveTemplate = async () => {
    if (!list || !templateName.trim()) {
      setStatus("Template name is required");
      return;
    }
    await run(async () => {
      await createBuyingListTemplate({
        name: templateName.trim(),
        sourceListId: list.id,
      });
      setTemplateOpen(false);
      setTemplateName("");
      setStatus("Saved as template");
    }, "Could not save template");
  };

  const voidPurchase = (id: string) => {
    if (!window.confirm("Void this purchase? It cannot be deleted.")) return;
    run(async () => {
      await voidGroceryPurchaseHeader(id);
      setStatus("Purchase voided");
    }, "Could not void purchase");
  };

  const open = Boolean(listId);
  const editable =
    list && list.status !== "completed" && list.status !== "cancelled";

  return (
    <>
      <Drawer
        open={open}
        wide
        title={list?.title || "Buying List"}
        onClose={onClose}
        footer={
          list ? (
            <div className={styles.actions}>
              <Button variant="primary" size="sm" onClick={() => printList(false)} disabled={busy}>
                Print
              </Button>
              <Button variant="secondary" size="sm" onClick={exportPdf} disabled={busy}>
                PDF
              </Button>
              {editable && (
                <Button variant="secondary" size="sm" onClick={() => onEdit(list.id)} disabled={busy}>
                  Edit
                </Button>
              )}
              {editable && list.status !== "completed" && (
                <Button variant="ghost" size="sm" onClick={completeList} disabled={busy}>
                  Complete
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTemplateName(list.title);
                  setTemplateOpen(true);
                }}
                disabled={busy}
              >
                Template
              </Button>
              {list.status === "draft" ? (
                <Button variant="danger" size="sm" onClick={removeList} disabled={busy}>
                  Delete
                </Button>
              ) : list.status !== "cancelled" ? (
                <Button variant="danger-ghost" size="sm" onClick={cancelList} disabled={busy}>
                  Cancel
                </Button>
              ) : null}
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

            <div className={styles.kpiGrid} style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Planned</div>
                <div className={styles.kpiValue}>{formatCurrency(planned)}</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Purchased</div>
                <div className={styles.kpiValue}>{formatCurrency(purchasedTotal)}</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Remaining</div>
                <div className={styles.kpiValue}>{formatCurrency(remaining)}</div>
              </div>
            </div>

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
                        <th>Planned</th>
                        <th>Purchased</th>
                        <th>Est.</th>
                        <th>Actual</th>
                        <th>Rate Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.lines.map((line) => {
                        const delta = rateVariance(
                          line.estimatedUnitPrice,
                          line.purchasedUnitPrice,
                        );
                        return (
                          <tr key={line.id}>
                            <td>
                              <strong>{line.itemName}</strong>
                              {line.category ? (
                                <div className={styles.hint}>{line.category}</div>
                              ) : null}
                            </td>
                            <td>
                              {line.quantity} {line.unit}
                            </td>
                            <td>
                              {line.purchasedQuantity != null
                                ? `${line.purchasedQuantity} ${line.unit}`
                                : "—"}
                            </td>
                            <td>
                              {line.estimatedTotal != null
                                ? formatCurrency(line.estimatedTotal)
                                : "—"}
                            </td>
                            <td>
                              {line.purchasedTotal != null
                                ? formatCurrency(line.purchasedTotal)
                                : "—"}
                            </td>
                            <td>
                              {delta == null ? (
                                "—"
                              ) : (
                                <span
                                  className={
                                    delta > 0
                                      ? styles.varianceUp
                                      : delta < 0
                                        ? styles.varianceDown
                                        : undefined
                                  }
                                >
                                  {delta > 0 ? "+" : ""}
                                  {formatCurrency(delta)}/unit
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className={styles.dayHeading}>Linked purchases</h3>
              {purchases.length === 0 ? (
                <div className={styles.hint}>No purchases linked to this list yet.</div>
              ) : (
                <div className={styles.sessionStack}>
                  {purchases.map((purchase) => (
                    <article key={purchase.id} className={styles.sessionCard}>
                      <div className={styles.sessionMain}>
                        <div className={styles.sessionTitleRow}>
                          <h4 className={styles.sessionTitle}>
                            {purchase.vendorName || "No vendor"}
                          </h4>
                          <Badge
                            tone={purchase.status === "voided" ? "danger" : "success"}
                          >
                            {purchase.status === "voided" ? "Voided" : "Recorded"}
                          </Badge>
                        </div>
                        <div className={styles.sessionMeta}>
                          {formatListDate(purchase.purchaseDate)}
                          {purchase.invoiceNumber ? ` · Inv ${purchase.invoiceNumber}` : ""}
                          {purchase.paymentMethod ? ` · ${purchase.paymentMethod}` : ""}
                        </div>
                        <div className={styles.sessionStats}>
                          {Array.isArray(purchase.lines) ? purchase.lines.length : 0} lines ·{" "}
                          {formatCurrency(purchase.total)}
                        </div>
                      </div>
                      {purchase.status !== "voided" && (
                        <div className={styles.sessionActions}>
                          <Button
                            variant="danger-ghost"
                            size="sm"
                            onClick={() => voidPurchase(purchase.id)}
                            disabled={busy}
                          >
                            Void
                          </Button>
                        </div>
                      )}
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

      <Modal
        open={templateOpen}
        title="Save as template"
        onClose={() => setTemplateOpen(false)}
      >
        <div className="ui-form-stack">
          <Input
            label="Template name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            autoFocus
          />
          <div className="ui-form-actions">
            <Button variant="secondary" onClick={() => setTemplateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveTemplate} loading={busy}>
              Save template
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
