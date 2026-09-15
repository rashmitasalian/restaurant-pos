import React from "react";
import {
  getActiveOrders,
  getConfigPrinters,
  getTables,
  markOrderKotDone,
  markOrderKotFailed,
  markOrderKotSent,
  nextKotSeq,
  type OrderDoc,
} from "../../../app/db/posRepository";
import { printKOT } from "../../../app/services/printer";
import { AuthContext } from "../../context/AuthContext";
import { isKotQueueTicket } from "../../../shared/kot";
import { formatKotAge, kotAgeTone } from "../../../shared/kotAge";
import { formatTableTileLabel } from "../../../shared/floorLayout";
import { validationMessage } from "../../../shared/validation";
import { PageHeader } from "../../components/ui/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { buildKotLines } from "../Billing/utils/receiptBuilder";
import styles from "./KOTQueue.module.css";

type KOTItem = {
  orderId: string;
  table: number;
  tableLabel: string;
  status: OrderDoc["kotStatus"];
  order: OrderDoc;
  sentItems: { name: string; qty: number }[];
  pendingItems: Array<{ id: string; name: string; qty: number; sentQty: number }>;
  time: number;
};

function getPrintedItems(order: OrderDoc) {
  return (order.items || [])
    .map((it) => ({ name: it.name, qty: Math.max(0, Number(it.kotPrintedQty || 0)) }))
    .filter((it) => it.qty > 0);
}

function getPendingItems(order: OrderDoc) {
  return (order.items || [])
    .map((it) => {
      const qty = Number(it.qty || 0);
      const printedQty = Math.max(0, Number(it.kotPrintedQty || 0));
      const pendingQty = Math.max(0, qty - printedQty);
      return pendingQty > 0
        ? { id: it.id, name: it.name, qty: pendingQty, sentQty: printedQty + pendingQty }
        : null;
    })
    .filter(Boolean) as Array<{ id: string; name: string; qty: number; sentQty: number }>;
}

function buildPreview(
  order: OrderDoc,
  items: Array<{ name: string; qty: number }>,
  sentBy?: string,
  kotSeqNum?: number,
  tableLabel?: string | null,
) {
  const meta = order.meta || {};
  return {
    kotId: kotSeqNum ? String(kotSeqNum) : `KOT-${String(Date.now()).slice(-6)}`,
    orderType: order.orderType,
    platform: String(meta.platform || meta.orderSource || meta.source || ""),
    platformCode: meta.code || meta.orderCode || meta.reference || "",
    customerName: meta.parcelName || meta.customerName || "",
    customerPhone: meta.customerPhone || "",
    tableNum: order.tableId,
    tableLabel: tableLabel || undefined,
    items,
    sentBy,
  };
}

async function resolveKitchenPrinter() {
  try {
    const cfg = await getConfigPrinters();
    return cfg?.kitchenPrinterIp?.trim() || "kitchen";
  } catch {
    return "kitchen";
  }
}

export default function KOTQueue() {
  const auth = React.useContext(AuthContext);
  const [kotList, setKotList] = React.useState<KOTItem[]>([]);
  const [, tick] = React.useReducer((x: number) => x + 1, 0);
  // Per-order error messages (reprint / markDone failures)
  const [orderErrors, setOrderErrors] = React.useState<Record<string, string>>({});
  const [reprinting, setReprinting] = React.useState<Record<string, boolean>>({});
  const [markingDone, setMarkingDone] = React.useState<Record<string, boolean>>({});
  const actionInFlightRef = React.useRef(new Set<string>());

  const beginOrderAction = (key: string) => {
    if (actionInFlightRef.current.has(key)) {
      return false;
    }
    actionInFlightRef.current.add(key);
    return true;
  };

  const endOrderAction = (key: string) => {
    actionInFlightRef.current.delete(key);
  };

  // Load KOT items from database
  const loadKOTs = React.useCallback(async () => {
    try {
      const [orders, tables] = await Promise.all([getActiveOrders(), getTables()]);
      const nameById = new Map(tables.map((table) => [Number(table.id), table.name]));
      const kots: KOTItem[] = orders
        .filter((o) => isKotQueueTicket(o))
        .map((o) => {
          const printedItems = getPrintedItems(o);
          const pendingItems = getPendingItems(o);
          const tableId = o.tableId ?? 0;
          return {
            orderId: o._id,
            table: tableId,
            tableLabel: tableId
              ? formatTableTileLabel(tableId, nameById.get(tableId))
              : "",
            status: o.kotStatus,
            order: o,
            sentItems: printedItems,
            pendingItems,
            time: o.updatedAt || o.createdAt,
          };
        });
      setKotList(kots);
    } catch (e) {
      console.error("Failed to load KOTs:", e);
    }
  }, []);

  // Initial load
  React.useEffect(() => {
    loadKOTs();
  }, [loadKOTs]);

  // Listen for order / floor changes so renamed tables stay in sync
  React.useEffect(() => {
    const handleRefresh = () => {
      loadKOTs();
    };
    window.addEventListener("orders-changed", handleRefresh);
    window.addEventListener("seating-areas-changed", handleRefresh);
    return () => {
      window.removeEventListener("orders-changed", handleRefresh);
      window.removeEventListener("seating-areas-changed", handleRefresh);
    };
  }, [loadKOTs]);

  // Refresh every 30 seconds
  React.useEffect(() => {
    const id = setInterval(() => tick(), 30000);
    return () => clearInterval(id);
  }, []);

  const markDone = async (orderId: string) => {
    const actionKey = `done:${orderId}`;
    if (!beginOrderAction(actionKey)) {
      return;
    }
    setMarkingDone((prev) => ({ ...prev, [orderId]: true }));
    try {
      await markOrderKotDone(orderId);

      // Remove from local list
      setKotList((list) => list.filter((k) => k.orderId !== orderId));

      // Notify other components
      window.dispatchEvent(new Event("orders-changed"));
    } catch (e: any) {
      console.error("Failed to mark KOT as done:", e);
      const message = e?.message?.includes("kot-has-unsent-items")
        ? "Print pending KOT items before marking done."
        : "Failed to mark as done. Try again.";
      setOrderErrors((prev) => ({ ...prev, [orderId]: message }));
    } finally {
      endOrderAction(actionKey);
      setMarkingDone((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  };

  const reprintKOT = async (k: KOTItem) => {
    const actionKey = `print:${k.orderId}`;
    if (!beginOrderAction(actionKey)) {
      return;
    }
    setReprinting((prev) => ({ ...prev, [k.orderId]: true }));
    setOrderErrors((prev) => {
      const c = { ...prev };
      delete c[k.orderId];
      return c;
    });
    try {
      const currentUserLabel = auth?.session?.displayName || auth?.session?.username || "";
      const label = k.tableLabel || (k.table ? `Table ${k.table}` : "Order");
      const itemsToPrint = k.pendingItems.length > 0 ? k.pendingItems : k.sentItems;
      let kotSeqNum: number | undefined;
      if (k.pendingItems.length > 0) {
        try {
          kotSeqNum = await nextKotSeq();
        } catch {
          /* fallback to timestamp */
        }
      }
      const preview = buildPreview(k.order, itemsToPrint, currentUserLabel, kotSeqNum, k.tableLabel);
      const lines =
        k.pendingItems.length > 0
          ? buildKotLines(preview, { ...k.order, items: itemsToPrint }, k.table || null)
          : [
              "BIGBOLD:KOT - REPRINT",
              `CENTER:${label}`,
              ...(currentUserLabel ? [`LEFT:  Reprinted by: ${currentUserLabel}`] : []),
              "SEP",
              ...itemsToPrint.map((it) => `LEFT:  ${String(it.qty).padStart(3)} x ${it.name}`),
              "BLANK",
              "CUT",
            ];
      const sentLines = k.pendingItems.map((it) => ({ id: it.id, sentQty: it.sentQty }));
      await printKOT({
        lines,
        printer: await resolveKitchenPrinter(),
        orderId: k.orderId,
        sentLines,
      });
      if (k.pendingItems.length > 0) {
        await markOrderKotSent(k.orderId, sentLines);
        window.dispatchEvent(new Event("orders-changed"));
        await loadKOTs();
      }
    } catch (e: any) {
      console.error("Reprint failed:", e);
      if (k.pendingItems.length > 0) {
        try {
          await markOrderKotFailed(
            k.orderId,
            validationMessage(e, "print-failed"),
          );
        } catch {}
      }
      setOrderErrors((prev) => ({
        ...prev,
        [k.orderId]:
          k.pendingItems.length > 0
            ? "KOT print failed. Check printer connection."
            : "Reprint failed. Check printer connection.",
      }));
    } finally {
      endOrderAction(actionKey);
      setReprinting((prev) => {
        const c = { ...prev };
        delete c[k.orderId];
        return c;
      });
    }
  };

  // Since we're loading from DB, all items are "pending" until manually marked done
  // The "done" concept is handled at the order level (kotPrinted flag)
  const pending = kotList;

  return (
    <div className="pos-page">
      <PageHeader
        title="KOT Queue"
        subtitle={
          <>
            <span style={{ color: "var(--pos-teal)", fontWeight: 700 }}>{pending.length}</span> pending
            orders
          </>
        }
      />

      {pending.length === 0 && (
        <div className="pos-empty" style={{ marginTop: 32 }}>
          All clear — no pending KOTs
        </div>
      )}

      <div className={styles.grid}>
        {pending.map((k) => {
          const tone = kotAgeTone(k.time);
          const hasPendingItems = k.pendingItems.length > 0;
          const canMarkDone = k.status === "sent" && !hasPendingItems && k.sentItems.length > 0;
          const isMarkingDone = Boolean(markingDone[k.orderId]);
          const isReprinting = Boolean(reprinting[k.orderId]);
          return (
            <Card key={k.orderId} padded className={styles.ticket}>
              <div className={styles.head}>
                <div className={styles.tableAnchor}>
                  {k.table ? k.tableLabel || `Table ${k.table}` : "Takeaway / Delivery"}
                </div>
                <div className={styles.badges}>
                  {k.status === "failed" && <Badge tone="danger">Print failed</Badge>}
                  {hasPendingItems && k.status !== "failed" && (
                    <Badge tone="attention">Pending print</Badge>
                  )}
                  <Badge tone={tone === "danger" ? "danger" : tone === "attention" ? "attention" : "neutral"}>
                    {formatKotAge(k.time)} ago
                  </Badge>
                </div>
              </div>

              <div className={styles.lines}>
                {hasPendingItems && (
                  <>
                    <div className="ui-overline">Pending to print</div>
                    {k.pendingItems.map((it) => (
                      <div key={`pending-${it.id}`} className={styles.line}>
                        <span style={{ flex: 1 }}>{it.name}</span>
                        <span className={`${styles.qty} ${styles.qtyPending}`}>x{it.qty}</span>
                      </div>
                    ))}
                  </>
                )}
                {k.sentItems.length > 0 && (
                  <>
                    {hasPendingItems && <div style={{ height: 4 }} />}
                    <div className="ui-overline">Already sent</div>
                    {k.sentItems.map((it, index) => (
                      <div key={`sent-${it.name}-${index}`} className={styles.line}>
                        <span style={{ flex: 1 }}>{it.name}</span>
                        <span className={`${styles.qty} ${styles.qtySent}`}>x{it.qty}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {orderErrors[k.orderId] && (
                <div className={styles.error}>
                  <span>{orderErrors[k.orderId]}</span>
                  <button
                    onClick={() =>
                      setOrderErrors((p) => {
                        const c = { ...p };
                        delete c[k.orderId];
                        return c;
                      })
                    }
                    className="ui-btn ui-btn-ghost"
                    aria-label="Dismiss error"
                  >
                    Close
                  </button>
                </div>
              )}

              <div className={styles.actions}>
                <Button
                  variant="primary"
                  onClick={() => markDone(k.orderId)}
                  disabled={!canMarkDone || isMarkingDone || isReprinting}
                  title={canMarkDone ? "Mark KOT done" : "Print pending KOT items first"}
                  style={{ flex: 1 }}
                >
                  {isMarkingDone ? "Saving..." : "Done"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => reprintKOT(k)}
                  disabled={isReprinting || isMarkingDone}
                >
                  {isReprinting
                    ? "Printing..."
                    : hasPendingItems || k.status === "failed"
                      ? "Print pending"
                      : "Reprint"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
