import React from "react";
import {
  CANCEL_REASON_PRESETS,
  resolveCancelReason,
} from "../shared/cancelReasons";
import {
  captainApi,
  clearStoredSession,
  getDeviceId,
  getStoredSession,
  newClientOpId,
  type CaptainUser,
} from "./captainApi";
import { CaptainShell, type CaptainTab } from "./CaptainShell";
import { LoginScreen } from "./screens/LoginScreen";
import { TablesScreen, type TableRow } from "./screens/TablesScreen";
import { MenuScreen } from "./screens/MenuScreen";
import { KotsScreen, type CaptainKotTicket } from "./screens/KotsScreen";
import { MeScreen } from "./screens/MeScreen";
import { VariantSheet, type Variant } from "./sheets/VariantSheet";
import { OrderSheet } from "./sheets/OrderSheet";
import { VoidSheet } from "./sheets/VoidSheet";

type Screen = "login" | "floor" | "session" | "kots" | "me";

export function CaptainApp() {
  const stored = getStoredSession();
  const [screen, setScreen] = React.useState<Screen>(stored.token ? "floor" : "login");
  const [token, setToken] = React.useState<string | null>(stored.token);
  const [user, setUser] = React.useState<CaptainUser | null>(stored.user);
  const [branding, setBranding] = React.useState<{ hotelName?: string }>({});
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [addingItemId, setAddingItemId] = React.useState<string | null>(null);
  const [tablesLoading, setTablesLoading] = React.useState(Boolean(stored.token));
  const [kotsLoading, setKotsLoading] = React.useState(Boolean(stored.token));

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
  React.useEffect(() => {
    orderIdRef.current = order?._id || null;
  }, [order?._id]);

  const isAuthRequiredError = React.useCallback((err: any) => {
    const msg = String(err?.message || err || "");
    return msg === "auth-required" || msg === "http-401" || msg.includes("http-401");
  }, []);

  React.useEffect(() => {
    captainApi
      .branding()
      .then(setBranding)
      .catch(() => setBranding({}));
    captainApi
      .health()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
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
          setConnected(true);
          if (
            event?.type === "orders-changed" ||
            event?.type === "tables-changed" ||
            event?.type === "activity-changed"
          ) {
            void refreshTables(token);
            void refreshKots(token);
            if (orderIdRef.current) {
              void captainApi
                .getOrder(token, orderIdRef.current)
                .then(setOrder)
                .catch(() => undefined);
            }
          }
        },
        {
          onError: (err) => {
            const msg = String(err?.message || "");
            if (isAuthRequiredError({ message: msg, status: err.status })) {
              void logout();
              return;
            }
            if (cancelled) {
              return;
            }
            setConnected(false);
            attempt += 1;
            const delay = Math.min(8000, 700 * Math.pow(2, attempt - 1));
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
          setConnected(true);
        }
      } catch (err: any) {
        if (!cancelled) {
          if (isAuthRequiredError(err)) {
            void logout();
            return;
          }
          setConnected(false);
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
      stopEvents();
    };
  }, [token, refreshTables, refreshKots, isAuthRequiredError]);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await captainApi.login(username.trim(), password, pairingCode.trim());
      setToken(result.sessionToken);
      setUser(result.user);
      try {
        localStorage.setItem("captain-pairing-code", pairingCode.trim());
      } catch {}
      setScreen("floor");
      setTablesLoading(true);
      setConnected(true);
    } catch (err: any) {
      setError(
        err?.message === "invalid-pairing-code"
          ? "Pairing code is wrong. Check the POS gateway panel."
          : err?.message === "captain-phone-only" || err?.message === "forbidden"
            ? "This account cannot use Captain."
            : "Login failed. Check username, password, and pairing code.",
      );
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
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
    setScreen("login");
  };

  const openTable = async (table: TableRow) => {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await captainApi.openTable(token, table.id);
      setSelectedTable(table);
      setOrder(next);
      setScreen("session");
      setShowOrderSheet(false);
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout();
        return;
      }
      setError(err?.message || "Could not open table");
    } finally {
      setBusy(false);
    }
  };

  const openTableById = (tableId: number) => {
    const table = tables.find((row) => row.id === tableId);
    if (table) {
      void openTable(table);
    }
  };

  const addMenuItem = (item: any) => {
    if (!token || !order) {
      return;
    }
    if (item.variants?.length > 0) {
      setVariantItem(item);
      return;
    }
    void doAddItem(item.name, Number(item.price || 0), item._id, item.category);
  };

  const doAddItem = async (
    name: string,
    rate: number,
    menuItemId?: string,
    categoryName?: string,
  ) => {
    if (!token || !order) {
      return;
    }
    setAddingItemId(menuItemId || name);
    setError(null);
    try {
      const next = await captainApi.addItem(token, order._id, {
        name,
        qty: 1,
        rate,
        menuItemId,
        categoryName,
      });
      setOrder(next);
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout();
        return;
      }
      setError(err?.message || "Could not add item");
    } finally {
      setAddingItemId(null);
    }
  };

  const onVariantSelect = (variant: Variant | null) => {
    if (!variantItem) {
      return;
    }
    const name = variant ? `${variantItem.name} (${variant.name})` : variantItem.name;
    const rate = variant ? variant.price : Number(variantItem.price || 0);
    const itemId = variantItem._id;
    const categoryName = variantItem.category;
    setVariantItem(null);
    void doAddItem(name, rate, itemId, categoryName);
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
      const next = await captainApi.updateLines(token, order._id, lines);
      setOrder(next);
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout();
        return;
      }
      setError(err?.message || "Could not update item");
    } finally {
      setBusy(false);
    }
  };

  const sendKot = async () => {
    if (!token || !order) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await captainApi.sendKot(token, order._id, newClientOpId("send-kot"));
      setOrder(result.order || (await captainApi.getOrder(token, order._id)));
      showToast("KOT sent to kitchen");
      void refreshKots(token);
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout();
        return;
      }
      setError(
        err?.message === "kot-no-unsent-items"
          ? "No new items to send"
          : err?.message || "KOT failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmVoid = async () => {
    if (!token || !order || !voidLine) {
      return;
    }
    const reason = resolveCancelReason(voidPreset, voidOther);
    if (!reason) {
      setError("Choose a cancellation reason");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await captainApi.voidItem(
        token,
        order._id,
        { lineId: voidLine.id, finalQty: voidTargetQty, reason },
        newClientOpId("void-item"),
      );
      setOrder(result.order || (await captainApi.getOrder(token, order._id)));
      setVoidLine(null);
      showToast("Item cancelled");
    } catch (err: any) {
      if (isAuthRequiredError(err)) {
        void logout();
        return;
      }
      setError(err?.message || "Cancel failed");
    } finally {
      setBusy(false);
    }
  };

  const retryConnection = async () => {
    if (!token) {
      try {
        await captainApi.health();
        setConnected(true);
      } catch {
        setConnected(false);
      }
      return;
    }
    try {
      await captainApi.health();
      await refreshTables(token);
      await refreshKots(token);
      setConnected(true);
      setError(null);
    } catch {
      setConnected(false);
    }
  };

  const onTabChange = (tab: CaptainTab) => {
    setScreen(tab === "floor" ? "floor" : tab);
  };

  const occupied = tables.filter((table) => table.occupied).length;
  const unsentCount = kotTickets.reduce((sum, ticket) => sum + Number(ticket.unsentCount || 0), 0);
  const activeTab: CaptainTab | null =
    screen === "login" ? null : screen === "session" || screen === "floor" ? "floor" : screen;
  const shellTitle =
    screen === "kots" ? "KOTs" : screen === "me" ? "Me" : "Floor";

  return (
    <CaptainShell
      title={shellTitle}
      occupancy={activeTab === "floor" && screen !== "session" ? `${occupied}/${tables.length} occupied` : undefined}
      connected={connected}
      error={screen === "login" ? null : error}
      showNav={Boolean(token)}
      hideHeader={screen === "login" || screen === "session"}
      lockBody={screen === "session"}
      activeTab={activeTab}
      unsentCount={unsentCount}
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
          areas={areas}
          tables={tables}
          areaId={areaId}
          setAreaId={setAreaId}
          busy={busy}
          loading={tablesLoading}
          activeTableId={selectedTable?.id}
          onOpenTable={openTable}
          onResume={order && selectedTable ? () => setScreen("session") : undefined}
        />
      ) : null}

      {screen === "session" && order ? (
        <MenuScreen
          tableName={selectedTable?.name || `Table ${selectedTable?.id || ""}`}
          menuItems={menuItems}
          categories={categories}
          order={order}
          busy={busy}
          addingItemId={addingItemId}
          onBack={() => setScreen("floor")}
          onAddItem={addMenuItem}
          onChangeQty={changeQty}
          onReview={() => setShowOrderSheet(true)}
        />
      ) : null}

      {screen === "kots" ? (
        <KotsScreen tickets={kotTickets} loading={kotsLoading} onOpenTable={openTableById} />
      ) : null}

      {screen === "me" ? (
        <MeScreen
          user={user}
          hotelName={branding.hotelName}
          connected={connected}
          deviceId={getDeviceId()}
          pairingCode={pairingCode}
          onRetry={() => void retryConnection()}
          onLogout={logout}
        />
      ) : null}

      {variantItem ? (
        <VariantSheet item={variantItem} onSelect={onVariantSelect} onClose={() => setVariantItem(null)} />
      ) : null}

      {showOrderSheet && order ? (
        <OrderSheet
          order={order}
          tableName={selectedTable?.name || `Table ${selectedTable?.id || ""}`}
          busy={busy}
          onChangeQty={changeQty}
          onSendKot={sendKot}
          onClose={() => setShowOrderSheet(false)}
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
