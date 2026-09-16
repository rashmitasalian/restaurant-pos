import React from "react";
import { CANCEL_REASON_PRESETS, resolveCancelReason } from "../shared/cancelReasons";
import {
  captainApi,
  clearStoredSession,
  getStoredSession,
  newClientOpId,
  nextSseBackoffMs,
  type CaptainUser,
} from "./captainApi";
import { formatTableLabel } from "../shared/floorLayout";
import { isAuthRequiredError, isOrderConflictError, waiterError, type ConnectionState } from "./copy";
import { CaptainShell, type CaptainTab } from "./CaptainShell";
import { LoginScreen } from "./screens/LoginScreen";
import { TablesScreen, type TableRow } from "./screens/TablesScreen";
import { MenuScreen } from "./screens/MenuScreen";
import { KotsScreen, type CaptainKotTicket } from "./screens/KotsScreen";
import { MeScreen } from "./screens/MeScreen";
import { VariantSheet, type Variant } from "./sheets/VariantSheet";
import { OrderSheet, type KotSendPhase } from "./sheets/OrderSheet";
import { VoidSheet } from "./sheets/VoidSheet";

type Screen = "login" | "floor" | "menu" | "kots" | "me";

export function CaptainApp() {
  const stored = getStoredSession();
  const [screen, setScreen] = React.useState<Screen>(stored.token ? "floor" : "login");
  const [token, setToken] = React.useState<string | null>(stored.token);
  const [user, setUser] = React.useState<CaptainUser | null>(stored.user);
  const [branding, setBranding] = React.useState<{ hotelName?: string }>({});
  const [connection, setConnection] = React.useState<ConnectionState>(
    stored.token ? "reconnecting" : "offline",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [addingItemId, setAddingItemId] = React.useState<string | null>(null);
  const [tablesLoading, setTablesLoading] = React.useState(Boolean(stored.token));
  const [kotsLoading, setKotsLoading] = React.useState(Boolean(stored.token));
  const [sendPhase, setSendPhase] = React.useState<KotSendPhase>("idle");
  const [sendError, setSendError] = React.useState<string | null>(null);

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pairingCode, setPairingCode] = React.useState(() => {
    try {
      return localStorage.getItem("captain-pairing-code") || "";
    } catch {
      return "";
    }
  });

  const [areas, setAreas] = React.useState<Array<{ id: string; name: string }>>([]);
  const [tables, setTables] = React.useState<TableRow[]>([]);
  const [areaId, setAreaId] = React.useState<string | null>(null);
  const [kotTickets, setKotTickets] = React.useState<CaptainKotTicket[]>([]);

  const [order, setOrder] = React.useState<any | null>(null);
  const [menuItems, setMenuItems] = React.useState<any[]>([]);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [selectedTable, setSelectedTable] = React.useState<TableRow | null>(null);
  const [variantItem, setVariantItem] = React.useState<any | null>(null);
  const [showOrderSheet, setShowOrderSheet] = React.useState(false);

  const [voidLine, setVoidLine] = React.useState<any | null>(null);
  const [voidTargetQty, setVoidTargetQty] = React.useState(0);
  const [voidPreset, setVoidPreset] = React.useState<string>(CANCEL_REASON_PRESETS[0]);
  const [voidOther, setVoidOther] = React.useState("");
  const [toast, setToast] = React.useState<string | null>(null);
  const toastTimer = React.useRef<number | null>(null);
  const sendTimer = React.useRef<number | null>(null);

  const showToast = React.useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  const refreshTables = React.useCallback(async (sessionToken: string) => {
    const snapshot = await captainApi.tables(sessionToken);
    setAreas((snapshot.areas || []).filter((a: any) => a.active !== false));
    setTables(snapshot.tables || []);
    setTablesLoading(false);
  }, []);

  const refreshKots = React.useCallback(async (sessionToken: string) => {
    const snapshot = await captainApi.kots(sessionToken);
    setKotTickets(snapshot.tickets || []);
    setKotsLoading(false);
  }, []);

  const orderIdRef = React.useRef<string | null>(null);
  const orderRef = React.useRef<any>(null);
  const ensureOrderLock = React.useRef<Promise<any> | null>(null);
  const refreshDueRef = React.useRef(false);
  const refreshInFlightRef = React.useRef(false);
  const refreshTimerRef = React.useRef<number | null>(null);
  const LIVE_REFRESH_DEBOUNCE_MS = 200;

  React.useEffect(() => {
    orderIdRef.current = order?._id || null;
    orderRef.current = order;
  }, [order, order?._id]);

  const mutationError = React.useCallback(
    (err: any, fallback: string) => waiterError(err, fallback),
    [],
  );

  const reloadOpenOrder = React.useCallback(async (sessionToken: string) => {
    const id = orderIdRef.current;
    if (!id) {
      return;
    }
    try {
      const next = await captainApi.getOrder(sessionToken, id);
      if (orderIdRef.current === id) {
        orderRef.current = next;
        setOrder(next);
      }
    } catch {
      // ignore — next SSE/visibility refresh will retry
    }
  }, []);

  const runCoalescedLiveRefresh = React.useCallback(
    async (sessionToken: string) => {
      if (refreshInFlightRef.current) {
        refreshDueRef.current = true;
        return;
      }
      refreshInFlightRef.current = true;
      try {
        do {
          refreshDueRef.current = false;
          await refreshTables(sessionToken);
          await refreshKots(sessionToken);
          await reloadOpenOrder(sessionToken);
        } while (refreshDueRef.current);
      } finally {
        refreshInFlightRef.current = false;
      }
    },
    [refreshTables, refreshKots, reloadOpenOrder],
  );

  const scheduleLiveRefresh = React.useCallback(
    (sessionToken: string) => {
      refreshDueRef.current = true;
      if (refreshTimerRef.current != null) {
        return;
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void runCoalescedLiveRefresh(sessionToken);
      }, LIVE_REFRESH_DEBOUNCE_MS);
    },
    [runCoalescedLiveRefresh],
  );

  const handleOrderConflict = React.useCallback(
    async (sessionToken: string, err: unknown) => {
      await reloadOpenOrder(sessionToken);
      void refreshTables(sessionToken);
      void refreshKots(sessionToken);
      showToast(waiterError(err, "Ticket updated by someone else — review qty."));
    },
    [reloadOpenOrder, refreshTables, refreshKots, showToast],
  );

  React.useEffect(() => {
    captainApi
      .branding()
      .then(setBranding)
      .catch(() => setBranding({}));
    captainApi
      .health()
      .then(() => setConnection("live"))
      .catch(() => setConnection("offline"));
  }, []);

  React.useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    let retryTimer: number | null = null;
    let stopEvents: () => void = () => {};
    let attempt = 0;

    const connect = () => {
      if (cancelled) {
        return;
      }
      stopEvents = captainApi.openEvents(
        token,
        (event) => {
          setConnection("live");
          attempt = 0;
          if (
            event?.type === "orders-changed" ||
            event?.type === "tables-changed" ||
            event?.type === "activity-changed"
          ) {
            scheduleLiveRefresh(token);
          }
        },
        {
          onError: (err) => {
            if (isAuthRequiredError({ message: err?.message, status: err.status })) {
              void logout("pos-restart");
              return;
            }
            if (cancelled) {
              return;
            }
            setConnection("reconnecting");
            attempt += 1;
            const delay = nextSseBackoffMs(attempt);
            retryTimer = window.setTimeout(connect, delay);
          },
        },
      );
    };

    void (async () => {
      try {
        await refreshTables(token);
        await refreshKots(token);
        const menu = await captainApi.menu(token);
        if (!cancelled) {
          setMenuItems(menu.items || []);
          setCategories(menu.categories || []);
          setConnection("live");
        }
      } catch (err: any) {
        if (!cancelled) {
          if (isAuthRequiredError(err)) {
            void logout("pos-restart");
            return;
          }
          setConnection("offline");
          setTablesLoading(false);
          setKotsLoading(false);
        }
      }
    })();

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (refreshTimerRef.current != null) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      stopEvents();
    };
  }, [token, refreshTables, refreshKots, scheduleLiveRefresh]);

  React.useEffect(() => {
    if (!token) {
      return;
    }
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void (async () => {
        try {
          setConnection("reconnecting");
          await captainApi.health();
          await refreshTables(token);
          await refreshKots(token);
          if (orderIdRef.current) {
            const id = orderIdRef.current;
            const next = await captainApi.getOrder(token, id);
            if (orderIdRef.current === id) {
              setOrder(next);
            }
          }
          setConnection("live");
        } catch (err: any) {
          if (isAuthRequiredError(err)) {
            void logout("pos-restart");
            return;
          }
          setConnection("offline");
        }
      })();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [token, refreshTables, refreshKots]);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await captainApi.login(username.trim(), password, pairingCode.trim());
      setToken(result.sessionToken);
      setUser(result.user);
      try {
        localStorage.setItem("captain-pairing-code", pairingCode.trim());
      } catch {
        /* ignore */
      }
      setScreen("floor");
      setTablesLoading(true);
      setConnection("live");
    } catch (err: any) {
      setError(waiterError(err, "Couldn’t sign in. Check username, password, and pairing code."));
    } finally {
      setBusy(false);
    }
  };

  const logout = async (reason?: "pos-restart") => {
    if (token) {
      try {
        await captainApi.logout(token);
      } catch {
        clearStoredSession();
      }
    } else {
      clearStoredSession();
    }
    setToken(null);
    setUser(null);
    setOrder(null);
    setSelectedTable(null);
    setKotTickets([]);
    setShowOrderSheet(false);
    setSendPhase("idle");
    setScreen("login");
    setConnection("offline");
    if (reason === "pos-restart") {
      setError("The restaurant POS was restarted. Sign in again when it is ready.");
    }
  };

  const enterTable = async (table: TableRow) => {
    if (!token) {
      return;
    }
    setError(null);
    setShowOrderSheet(false);
    setSendPhase("idle");
    setSelectedTable(table);
    const hasLiveOrder = Boolean(table.occupied && (table.orderId || table.count));
    if (!hasLiveOrder) {
      orderIdRef.current = null;
      orderRef.current = { items: [], total: 0 };
      setOrder({ items: [], total: 0 });
      setScreen("menu");
      return;
    }
    setBusy(true);
    orderIdRef.current = null;
    try {
      const next = table.orderId
        ? await captainApi.getOrder(token, table.orderId)
        : await captainApi.openTable(token, table.id, newClientOpId("open-table"));
      orderRef.current = next;
      orderIdRef.current = next?._id || null;
      setOrder(next);
      setScreen("menu");
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout("pos-restart");
        return;
      }
      setError(mutationError(err, "Couldn’t open this table."));
    } finally {
      setBusy(false);
    }
  };

  const ensureOrder = async () => {
    const existing = orderRef.current;
    if (existing?._id) {
      return existing;
    }
    if (!token || !selectedTable) {
      throw new Error("no-table");
    }
    if (!ensureOrderLock.current) {
      ensureOrderLock.current = (async () => {
        const next = await captainApi.openTable(
          token,
          selectedTable.id,
          newClientOpId("open-table"),
        );
        orderRef.current = next;
        orderIdRef.current = next?._id || null;
        setOrder(next);
        return next;
      })().finally(() => {
        ensureOrderLock.current = null;
      });
    }
    return ensureOrderLock.current;
  };

  const openTableById = (tableId: number) => {
    const table = tables.find((row) => row.id === tableId);
    if (table) {
      void enterTable(table);
    }
  };

  const addMenuItem = (item: any) => {
    if (!token || !selectedTable) {
      return;
    }
    if (item.variants?.length > 0) {
      setVariantItem(item);
      return;
    }
    void doAddItem(item.name, Number(item.price || 0), item._id, item.category, 1);
  };

  const doAddItem = async (
    name: string,
    rate: number,
    menuItemId?: string,
    categoryName?: string,
    qty = 1,
  ) => {
    if (!token || !selectedTable) {
      return;
    }
    setAddingItemId(menuItemId || name);
    setError(null);
    try {
      const ticket = await ensureOrder();
      const next = await captainApi.addItem(
        token,
        ticket._id,
        {
          name,
          qty,
          rate,
          menuItemId,
          categoryName,
          baseUpdatedAt: ticket.updatedAt ?? null,
        },
        newClientOpId("add-item"),
      );
      orderRef.current = next;
      setOrder(next);
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout("pos-restart");
        return;
      }
      if (isOrderConflictError(err)) {
        await handleOrderConflict(token, err);
        return;
      }
      setError(mutationError(err, "Couldn’t add that item."));
    } finally {
      setAddingItemId(null);
    }
  };

  const onVariantSelect = (variant: Variant | null, qty: number) => {
    if (!variantItem) {
      return;
    }
    const name = variant ? `${variantItem.name} (${variant.name})` : variantItem.name;
    const rate = variant ? variant.price : Number(variantItem.price || 0);
    const itemId = variantItem._id;
    const categoryName = variantItem.category;
    setVariantItem(null);
    void doAddItem(name, rate, itemId, categoryName, qty);
  };

  const changeQty = async (line: any, nextQty: number) => {
    if (!token || !order) {
      return;
    }
    const printed = Math.max(0, Number(line.kotPrintedQty || 0));
    if (nextQty < printed) {
      setVoidLine(line);
      setVoidTargetQty(Math.max(0, nextQty));
      setVoidPreset(CANCEL_REASON_PRESETS[0]);
      setVoidOther("");
      return;
    }
    const lines = (order.items || [])
      .map((candidate: any) =>
        candidate.id === line.id ? { ...candidate, qty: nextQty } : candidate,
      )
      .filter((candidate: any) => Number(candidate.qty || 0) > 0);
    setBusy(true);
    try {
      const next = await captainApi.updateLines(
        token,
        order._id,
        lines,
        newClientOpId("update-lines"),
        order.updatedAt ?? null,
      );
      setOrder(next);
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout("pos-restart");
        return;
      }
      if (isOrderConflictError(err)) {
        await handleOrderConflict(token, err);
        return;
      }
      setError(mutationError(err, "Couldn’t update that item."));
    } finally {
      setBusy(false);
    }
  };

  const sendKot = async () => {
    if (!token || !order || sendPhase === "sending") {
      return;
    }
    const pending = (order.items || []).reduce(
      (sum: number, line: any) =>
        sum + Math.max(0, Number(line.qty || 0) - Number(line.kotPrintedQty || 0)),
      0,
    );
    if (pending <= 0) {
      showToast("No new KOT items to send");
      return;
    }
    setShowOrderSheet(true);
    setSendPhase("confirm");
    setSendError(null);
    setError(null);
  };

  const confirmSendKot = async () => {
    if (!token || !order || sendPhase === "sending") {
      return;
    }
    setShowOrderSheet(true);
    setSendPhase("sending");
    setSendError(null);
    setError(null);
    try {
      const result = await captainApi.sendKot(
        token,
        order._id,
        newClientOpId("send-kot"),
        order.updatedAt ?? null,
      );
      setOrder(result.order || (await captainApi.getOrder(token, order._id)));
      setSendPhase("sent");
      void refreshKots(token);
      if (sendTimer.current) {
        clearTimeout(sendTimer.current);
      }
      sendTimer.current = window.setTimeout(() => {
        setShowOrderSheet(false);
        setSendPhase("idle");
        setScreen("menu");
      }, 1400);
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout("pos-restart");
        return;
      }
      if (isOrderConflictError(err)) {
        await handleOrderConflict(token, err);
        setSendPhase("idle");
        return;
      }
      const message = mutationError(err, "Your order has not been confirmed.");
      setSendPhase("failed");
      setSendError(message);
    }
  };

  const confirmVoid = async () => {
    if (!token || !order || !voidLine) {
      return;
    }
    const reason = resolveCancelReason(voidPreset, voidOther);
    if (!reason) {
      setError("Choose a reason before reducing a sent item.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await captainApi.voidItem(
        token,
        order._id,
        {
          lineId: voidLine.id,
          finalQty: voidTargetQty,
          reason,
          baseUpdatedAt: order.updatedAt ?? null,
        },
        newClientOpId("void-item"),
      );
      setOrder(result.order || (await captainApi.getOrder(token, order._id)));
      setVoidLine(null);
      showToast("Void KOT printed and order updated");
      void refreshKots(token);
      void refreshTables(token);
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout("pos-restart");
        return;
      }
      if (isOrderConflictError(err)) {
        await handleOrderConflict(token, err);
        setVoidLine(null);
        return;
      }
      setError(mutationError(err, "Void KOT could not be printed. Order was not changed."));
    } finally {
      setBusy(false);
    }
  };

  const retryConnection = async () => {
    if (!token) {
      try {
        await captainApi.health();
        setConnection("live");
      } catch {
        setConnection("offline");
      }
      return;
    }
    try {
      setConnection("reconnecting");
      await captainApi.health();
      await refreshTables(token);
      await refreshKots(token);
      setConnection("live");
      setError(null);
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout("pos-restart");
        return;
      }
      setConnection("offline");
    }
  };

  const onTabChange = (tab: CaptainTab) => {
    setScreen(tab === "floor" ? "floor" : tab);
  };

  const kotBadgeCount = kotTickets.filter((ticket) => Number(ticket.unsentCount || 0) > 0).length;
  const activeTab: CaptainTab | null =
    screen === "login" || screen === "menu" ? null : screen === "floor" ? "floor" : screen;
  const tableName = formatTableLabel(selectedTable?.id, selectedTable?.name);

  return (
    <CaptainShell
      connection={connection}
      error={screen === "login" ? null : error}
      showNav={Boolean(token)}
      hideHeader={screen === "login" || screen === "menu"}
      lockBody={screen === "menu"}
      activeTab={activeTab}
      unsentCount={kotBadgeCount}
      onTabChange={onTabChange}
    >
      {screen === "login" ? (
        <LoginScreen
          brandingName={branding.hotelName}
          username={username}
          password={password}
          pairingCode={pairingCode}
          setUsername={setUsername}
          setPassword={setPassword}
          setPairingCode={setPairingCode}
          busy={busy}
          error={error}
          onLogin={login}
        />
      ) : null}

      {screen === "floor" ? (
        <TablesScreen
          waiterName={user?.displayName}
          waiterUsername={user?.username}
          areas={areas}
          tables={tables}
          areaId={areaId}
          setAreaId={setAreaId}
          kotTickets={kotTickets}
          busy={busy}
          loading={tablesLoading}
          activeTableId={selectedTable?.id}
          onOpenTable={enterTable}
        />
      ) : null}

      {screen === "menu" && selectedTable ? (
        <MenuScreen
          tableName={tableName}
          menuItems={menuItems}
          categories={categories}
          order={order}
          busy={busy}
          addingItemId={addingItemId}
          onBack={() => setScreen("floor")}
          onAddItem={addMenuItem}
          onChangeQty={changeQty}
          onReview={() => {
            setSendPhase("idle");
            setShowOrderSheet(true);
          }}
        />
      ) : null}

      {screen === "kots" ? (
        <KotsScreen tickets={kotTickets} loading={kotsLoading} onOpenTable={openTableById} />
      ) : null}

      {screen === "me" ? (
        <MeScreen
          user={user}
          hotelName={branding.hotelName}
          connection={connection}
          pairingCode={pairingCode}
          onRetry={() => void retryConnection()}
          onLogout={() => logout()}
        />
      ) : null}

      {variantItem ? (
        <VariantSheet
          item={variantItem}
          busy={Boolean(addingItemId)}
          onSelect={onVariantSelect}
          onClose={() => setVariantItem(null)}
        />
      ) : null}

      {showOrderSheet && order ? (
        <OrderSheet
          order={order}
          tableName={tableName}
          sendPhase={sendPhase}
          sendError={sendError}
          onChangeQty={changeQty}
          onSendKot={sendKot}
          onConfirmSendKot={() => void confirmSendKot()}
          onCancelSendConfirm={() => setSendPhase("idle")}
          onAddMore={() => {
            setShowOrderSheet(false);
            setScreen("menu");
          }}
          onClose={() => {
            if (sendPhase !== "sending") {
              setShowOrderSheet(false);
              setSendPhase("idle");
            }
          }}
        />
      ) : null}

      {voidLine ? (
        <VoidSheet
          lineName={voidLine.name}
          sentQty={Number(voidLine.kotPrintedQty || 0)}
          targetQty={voidTargetQty}
          preset={voidPreset}
          other={voidOther}
          busy={busy}
          onPreset={setVoidPreset}
          onOther={setVoidOther}
          onConfirm={confirmVoid}
          onClose={() => setVoidLine(null)}
        />
      ) : null}

      {toast ? (
        <div className="cap-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </CaptainShell>
  );
}
