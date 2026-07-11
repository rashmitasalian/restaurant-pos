import React from "react";
import {
  getActiveOrders,
  getConfigPrinters,
  markOrderKotDone,
  markOrderKotFailed,
  markOrderKotSent,
  nextKotSeq,
  type OrderDoc,
} from "../../../app/db/posRepository";
import { printKOT } from "../../../app/services/printer";
import { AuthContext } from "../../context/AuthContext";
import { buildKotLines } from "../Billing/utils/receiptBuilder";

type KOTItem = {
  orderId: string;
  table: number;
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
) {
  const meta = order.meta || {};
  return {
    kotId: kotSeqNum ? String(kotSeqNum) : `KOT-${String(Date.now()).slice(-6)}`,
    orderType: order.orderType,
    platform: String(meta.platform || meta.orderSource || meta.source || ""),
    platformCode: meta.code || meta.orderCode || meta.reference || "",
    customerName: meta.parcelName || meta.customerName || "",
    tableNum: order.tableId,
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
      const orders = await getActiveOrders();
      const kots: KOTItem[] = orders
        .filter((o) => {
          const sentItems = getPrintedItems(o);
          const pendingItems = getPendingItems(o);
          return (
            o.kotStatus === "sent" ||
            o.kotStatus === "failed" ||
            (sentItems.length > 0 && pendingItems.length > 0)
          );
        })
        .map((o) => {
          const printedItems = getPrintedItems(o);
          const pendingItems = getPendingItems(o);
          return {
            orderId: o._id,
            table: o.tableId ?? 0,
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

  // Listen for order changes
  React.useEffect(() => {
    const handleOrdersChanged = () => {
      loadKOTs();
    };
    window.addEventListener("orders-changed", handleOrdersChanged);
    return () => window.removeEventListener("orders-changed", handleOrdersChanged);
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
      const label = k.table ? `Table ${k.table}` : "Order";
      const itemsToPrint = k.pendingItems.length > 0 ? k.pendingItems : k.sentItems;
      let kotSeqNum: number | undefined;
      if (k.pendingItems.length > 0) {
        try {
          kotSeqNum = await nextKotSeq();
        } catch {
          /* fallback to timestamp */
        }
      }
      const preview = buildPreview(k.order, itemsToPrint, currentUserLabel, kotSeqNum);
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
          await markOrderKotFailed(k.orderId, e?.message || String(e));
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

  const ageColor = (ms: number) => {
    const mins = Math.round(ms / 60000);
    if (mins < 5) {
      return "#16a34a";
    }
    if (mins < 15) {
      return "#d97706";
    }
    return "#dc2626";
  };

  return (
    <div className="pos-page">
      {/* Header */}
      <div className="pos-ph">
        <div>
          <h2 className="pos-ph-title">KOT Queue</h2>
          <p className="pos-ph-sub">
            <span style={{ color: "var(--pos-brand-deep,#d97706)", fontWeight: 700 }}>
              {pending.length}
            </span>{" "}
            pending orders
          </p>
        </div>
      </div>

      {/* Empty state */}
      {pending.length === 0 && (
        <div className="pos-empty" style={{ marginTop: 32 }}>
          All clear — no pending KOTs
        </div>
      )}

      {/* KOT grid */}
      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
        }}
      >
        {pending.map((k) => {
          const ageMins = Math.round((Date.now() - k.time) / 60000);
          const ageBg = ageMins < 5 ? "#dcfce7" : ageMins < 15 ? "#fef3c7" : "#fee2e2";
          const ageClr = ageColor(Date.now() - k.time);
          const hasPendingItems = k.pendingItems.length > 0;
          const canMarkDone = k.status === "sent" && !hasPendingItems && k.sentItems.length > 0;
          const isMarkingDone = Boolean(markingDone[k.orderId]);
          const isReprinting = Boolean(reprinting[k.orderId]);
          return (
            <div key={k.orderId} className="pos-card" style={{ padding: "18px 20px" }}>
              {/* Card header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 800,
                    color: "var(--pos-tx,#111827)",
                    letterSpacing: -0.3,
                  }}
                >
                  {k.table ? `Table ${k.table}` : "Takeaway / Delivery"}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {k.status === "failed" && (
                    <span
                      className="pos-badge"
                      style={{
                        background: "#fee2e2",
                        color: "#b91c1c",
                        borderColor: "transparent",
                      }}
                    >
                      Print failed
                    </span>
                  )}
                  {hasPendingItems && k.status !== "failed" && (
                    <span
                      className="pos-badge"
                      style={{
                        background: "#fffbeb",
                        color: "#92400e",
                        borderColor: "transparent",
                      }}
                    >
                      Pending print
                    </span>
                  )}
                  <span
                    className="pos-badge"
                    style={{ background: ageBg, color: ageClr, borderColor: "transparent" }}
                  >
                    {ageMins}m ago
                  </span>
                </div>
              </div>

              {/* Items */}
              <div style={{ display: "grid", gap: 5, marginBottom: 16 }}>
                {hasPendingItems && (
                  <>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#92400e",
                        textTransform: "uppercase",
                      }}
                    >
                      Pending to print
                    </div>
                    {k.pendingItems.map((it) => (
                      <div
                        key={`pending-${it.id}`}
                        style={{
                          fontSize: 13,
                          color: "var(--pos-tx-sec,#374151)",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span style={{ color: "#d97706", fontSize: 11 }}>›</span>
                        <span style={{ flex: 1 }}>{it.name}</span>
                        <span
                          style={{
                            color: "#92400e",
                            fontSize: 12,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          ×{it.qty}
                        </span>
                      </div>
                    ))}
                  </>
                )}
                {k.sentItems.length > 0 && (
                  <>
                    {hasPendingItems && <div style={{ height: 4 }} />}
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#6b7280",
                        textTransform: "uppercase",
                      }}
                    >
                      Already sent
                    </div>
                    {k.sentItems.map((it, index) => (
                      <div
                        key={`sent-${it.name}-${index}`}
                        style={{
                          fontSize: 13,
                          color: "var(--pos-tx-sec,#374151)",
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span style={{ color: "var(--pos-brand-deep,#d97706)", fontSize: 11 }}>
                          ›
                        </span>
                        <span style={{ flex: 1 }}>{it.name}</span>
                        <span
                          style={{
                            color: "var(--pos-muted,#9ca3af)",
                            fontSize: 12,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          ×{it.qty}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Error */}
              {orderErrors[k.orderId] && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#991b1b",
                    fontSize: 12,
                    fontWeight: 600,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span>⚠ {orderErrors[k.orderId]}</span>
                  <button
                    onClick={() =>
                      setOrderErrors((p) => {
                        const c = { ...p };
                        delete c[k.orderId];
                        return c;
                      })
                    }
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 16,
                      color: "#991b1b",
                      lineHeight: 1,
                      padding: 0,
                    }}
                    aria-label="Dismiss error"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => markDone(k.orderId)}
                  disabled={!canMarkDone || isMarkingDone || isReprinting}
                  className="pos-btn pos-btn-primary"
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    background: "#16a34a",
                    borderColor: "#16a34a",
                    boxShadow: "0 2px 8px rgba(22,163,74,0.25)",
                    opacity: canMarkDone && !isMarkingDone && !isReprinting ? 1 : 0.55,
                  }}
                  title={canMarkDone ? "Mark KOT done" : "Print pending KOT items first"}
                >
                  {isMarkingDone ? "Saving..." : "✓ Done"}
                </button>
                <button
                  onClick={() => reprintKOT(k)}
                  disabled={isReprinting || isMarkingDone}
                  className="pos-btn pos-btn-secondary"
                >
                  {isReprinting
                    ? "Printing..."
                    : hasPendingItems || k.status === "failed"
                      ? "Print pending"
                      : "Reprint"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
