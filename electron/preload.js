// Preload (CommonJS) - plain JS to avoid ts-node requirement in dev
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const MAIN_SESSION_TOKEN_KEY = "pos-main-session-token";

function getSessionToken() {
  try {
    return globalThis.localStorage?.getItem(MAIN_SESSION_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

const authInvoke = (channel, ...args) => invoke(channel, getSessionToken(), ...args);

function buildTestPrintPayload(printer) {
  const key = String(printer || "counter").toLowerCase();
  const isKitchen = key === "kitchen";
  const now = new Date().toLocaleString("en-IN");
  return {
    type: isKitchen ? "kot" : "receipt",
    printer: isKitchen ? "kitchen" : "counter",
    data: {
      lines: isKitchen
        ? [
            "BIGBOLD:RestoNiti",
            "SUBHEADER:-----TEST KOT-----",
            `CENTER:${now}`,
            "SEP",
            "LEFT:Kitchen printer test",
            "LEFT:If you can read this,",
            "LEFT:printing is configured.",
            "BLANK",
            "CUT",
          ]
        : [
            "BIGBOLD:RestoNiti",
            "SUBHEADER:-----TEST RECEIPT-----",
            `CENTER:${now}`,
            "SEP",
            "CENTER:Counter printer test",
            "CENTER:Printing is configured.",
            "BLANK",
            "CUT",
          ],
    },
  };
}

contextBridge.exposeInMainWorld("pos", {
  print: (payload) => ipcRenderer.invoke("printer:print", getSessionToken(), payload),
  testPrint: (printer) =>
    ipcRenderer.invoke("printer:print", getSessionToken(), buildTestPrintPayload(printer)),
  writeLog: (level, message, context) =>
    getSessionToken()
      ? ipcRenderer
          .invoke("log:write", getSessionToken(), level, message, context)
          .catch(() => ({ ok: false }))
      : Promise.resolve({ ok: false }),
  exportReportPdf: (html, defaultFileName) =>
    ipcRenderer.invoke("report:exportPdf", getSessionToken(), html, defaultFileName),
  db: {
    ready: () => invoke("pos:db:ready"),
  },
  auth: {
    hasUsers: () => invoke("pos:auth:has-users"),
    createFirstAdmin: (payload) => invoke("pos:auth:create-first-admin", payload),
    login: (username, password) => invoke("pos:auth:login", username, password),
    logout: () => authInvoke("pos:auth:logout"),
    refreshUser: () => authInvoke("pos:auth:refresh-user"),
    changePassword: (_username, currentPassword, newPassword) =>
      authInvoke("pos:auth:change-password", currentPassword, newPassword),
    recoveryStatus: () => invoke("pos:auth:recovery-status"),
    recoverLastAdmin: (payload) => invoke("pos:auth:recover-last-admin", payload),
    regenerateRecoveryCodes: (payload) => authInvoke("pos:auth:regenerate-recovery-codes", payload),
  },
  branding: {
    getPublic: () => invoke("pos:branding:get-public"),
  },
  users: {
    list: () => authInvoke("pos:users:list"),
    create: (payload) => authInvoke("pos:users:create", payload),
    update: (username, updates, actorUsername, actorPassword) =>
      authInvoke("pos:users:update", username, updates, actorUsername, actorPassword),
    resetPassword: (username, password, actorUsername, actorPassword) =>
      authInvoke("pos:users:reset-password", username, password, actorUsername, actorPassword),
  },
  tables: {
    seed: () => authInvoke("pos:tables:seed"),
    list: () => authInvoke("pos:tables:list"),
    configuredCount: () => authInvoke("pos:tables:configured-count"),
    snapshot: () => authInvoke("pos:tables:snapshot"),
    setArea: (tableId, areaId) => authInvoke("pos:tables:set-area", tableId, areaId),
  },
  seatingAreas: {
    list: (includeDisabled) => authInvoke("pos:seating-areas:list", includeDisabled),
    save: (areas) => authInvoke("pos:seating-areas:save", areas),
    delete: (areaId, reassignToAreaId) =>
      authInvoke("pos:seating-areas:delete", areaId, reassignToAreaId),
  },
  menu: {
    seed: () => authInvoke("pos:menu:seed"),
    listItems: () => authInvoke("pos:menu:list-items"),
    getItem: (id) => authInvoke("pos:menu:get-item", id),
    createItem: (payload) => authInvoke("pos:menu:create-item", payload),
    updateItem: (payload) => authInvoke("pos:menu:update-item", payload),
    deleteItem: (id) => authInvoke("pos:menu:delete-item", id),
    listCategories: () => authInvoke("pos:menu:list-categories"),
    setCategories: (categories) => authInvoke("pos:menu:set-categories", categories),
    listVariantOptions: () => authInvoke("pos:menu:list-variant-options"),
    setVariantOptions: (options) => authInvoke("pos:menu:set-variant-options", options),
  },
  orders: {
    create: (payload) => authInvoke("pos:orders:create", payload),
    nextKotSeq: () => authInvoke("pos:orders:next-kot-seq"),
    get: (id) => authInvoke("pos:orders:get", id),
    getOpenForTable: (tableId) => authInvoke("pos:orders:get-open-table", tableId),
    getOrCreateForTable: (tableId) => authInvoke("pos:orders:get-or-create-table", tableId),
    listOpen: () => authInvoke("pos:orders:list-open"),
    listActive: () => authInvoke("pos:orders:list-active"),
    listPaid: (opts) => authInvoke("pos:orders:list-paid", opts),
    countPaid: (opts) => authInvoke("pos:orders:count-paid", opts),
    listPaidIds: (opts) => authInvoke("pos:orders:list-paid-ids", opts),
    addLine: (orderId, item) => authInvoke("pos:orders:add-line", orderId, item),
    updateLines: (orderId, lines) => authInvoke("pos:orders:update-lines", orderId, lines),
    setDiscount: (orderId, discountPercent) =>
      authInvoke("pos:orders:set-discount", orderId, discountPercent),
    setStatus: (orderId, status, payload) =>
      authInvoke("pos:orders:set-status", orderId, status, payload),
    markKotSent: (orderId, sentLines) => authInvoke("pos:orders:mark-kot-sent", orderId, sentLines),
    markKotFailed: (orderId, error) => authInvoke("pos:orders:mark-kot-failed", orderId, error),
    voidKotLine: (orderId, payload) => authInvoke("pos:orders:void-kot-line", orderId, payload),
    markKotDone: (orderId) => authInvoke("pos:orders:mark-kot-done", orderId),
    markKotPrinted: (orderId) => authInvoke("pos:orders:mark-kot-printed", orderId),
    pay: (orderId, payment) => authInvoke("pos:orders:pay", orderId, payment),
    cancel: (orderId, actor) => authInvoke("pos:orders:cancel", orderId, actor),
    deleteHistory: (orderIds) => authInvoke("pos:orders:delete-history", orderIds),
    restoreHistory: (orders) => authInvoke("pos:orders:restore-history", orders),
  },
  customers: {
    list: () => authInvoke("pos:customers:list"),
    create: (payload) => authInvoke("pos:customers:create", payload),
    update: (id, updates) => authInvoke("pos:customers:update", id, updates),
    delete: (id) => authInvoke("pos:customers:delete", id),
  },
  staff: {
    list: (opts) => authInvoke("pos:staff:list", opts),
    create: (payload) => authInvoke("pos:staff:create", payload),
    update: (id, updates) => authInvoke("pos:staff:update", id, updates),
    delete: (id) => authInvoke("pos:staff:delete", id),
  },
  attendance: {
    list: (input) => authInvoke("pos:attendance:list", input),
    upsert: (input) => authInvoke("pos:attendance:upsert", input),
    copy: (fromDate, toDate) => authInvoke("pos:attendance:copy", fromDate, toDate),
    delete: (id) => authInvoke("pos:attendance:delete", id),
  },
  settings: {
    get: (key) => authInvoke("pos:settings:get", key),
    set: (key, value) => authInvoke("pos:settings:set", key, value),
    pruneAudit: () => authInvoke("pos:settings:prune-audit"),
    pruneHistory: () => authInvoke("pos:settings:prune-history"),
  },
  reports: {
    salesSummary: (opts) => authInvoke("pos:reports:sales-summary", opts),
    paymentBreakdown: (opts) => authInvoke("pos:reports:payment-breakdown", opts),
    productSales: (opts) => authInvoke("pos:reports:product-sales", opts),
    orderHistory: (opts) => authInvoke("pos:reports:order-history", opts),
    foodCostSummary: (opts) => authInvoke("pos:reports:food-cost-summary", opts),
  },
  grocery: {
    listItems: (opts) => authInvoke("pos:grocery:items:list", opts),
    createItem: (payload) => authInvoke("pos:grocery:items:create", payload),
    updateItem: (id, updates) => authInvoke("pos:grocery:items:update", id, updates),
    deleteItem: (id) => authInvoke("pos:grocery:items:delete", id),
    listLists: (opts) => authInvoke("pos:grocery:lists:list", opts),
    getList: (id) => authInvoke("pos:grocery:lists:get", id),
    createList: (payload) => authInvoke("pos:grocery:lists:create", payload),
    updateList: (id, updates) => authInvoke("pos:grocery:lists:update", id, updates),
    deleteList: (id) => authInvoke("pos:grocery:lists:delete", id),
    listPurchases: (opts) => authInvoke("pos:grocery:purchases:list", opts),
    createPurchase: (payload) => authInvoke("pos:grocery:purchases:create", payload),
    updatePurchase: (id, updates) => authInvoke("pos:grocery:purchases:update", id, updates),
    deletePurchase: (id) => authInvoke("pos:grocery:purchases:delete", id),
  },
  audit: {
    create: (action, orderId, user, detail) =>
      authInvoke("pos:audit:create", action, orderId, user, detail),
    list: (opts) => authInvoke("pos:audit:list", opts),
    count: (opts) => authInvoke("pos:audit:count", opts),
  },
  auditArchives: {
    create: (retentionDays) => authInvoke("pos:audit-archives:create", retentionDays),
    list: () => authInvoke("pos:audit-archives:list"),
    export: (id) => authInvoke("pos:audit-archives:export", id),
    delete: (id) => authInvoke("pos:audit-archives:delete", id),
    cleanupOld: (ageMonths) => authInvoke("pos:audit-archives:cleanup-old", ageMonths),
  },
  printQueue: {
    add: (payload) => authInvoke("pos:print-queue:add", payload),
    list: (status) => authInvoke("pos:print-queue:list", status),
    markCompleted: (id) => authInvoke("pos:print-queue:mark-completed", id),
    retry: (id) => authInvoke("pos:print-queue:retry", id),
    clearOld: (ageHours) => authInvoke("pos:print-queue:clear-old", ageHours),
  },
  backupSqlite: {
    createLocal: () => authInvoke("pos:backup:create-local"),
    restoreLocal: () => authInvoke("pos:backup:restore-local"),
    list: () => authInvoke("pos:backup:list"),
  },
  app: {
    info: () => authInvoke("pos:app:info"),
  },
  updates: {
    check: () => authInvoke("pos:updates:check"),
    prepare: (options) => authInvoke("pos:updates:prepare", options),
    launch: () => authInvoke("pos:updates:launch"),
    status: () => authInvoke("pos:updates:status"),
    startupHealth: () => authInvoke("pos:updates:startup-health"),
    rollback: (options) => authInvoke("pos:updates:rollback", options),
  },
  support: {
    exportDiagnostics: () => authInvoke("pos:support:export-diagnostics"),
  },
});

// Developer convenience: attempt to load React DevTools if present
try {
  const installExtension = require("electron-devtools-installer");
  window.__installReactDevTools = async () => {
    try {
      const result = await installExtension.default(installExtension.REACT_DEVELOPER_TOOLS);
      console.log("React DevTools installed:", result);
    } catch (error) {
      console.warn("React DevTools install failed", error && error.message);
    }
  };
} catch (e) {
  window.__installReactDevTools = async () => {};
}
