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
  listPrinters: () => ipcRenderer.invoke("printer:list", getSessionToken()),
  testPrint: (printer) =>
    ipcRenderer.invoke("printer:print", getSessionToken(), buildTestPrintPayload(printer)),
  writeLog: (level, message, context) =>
    ipcRenderer
      .invoke("log:write", getSessionToken(), level, message, context)
      .catch(() => ({ ok: false })),
  copyText: (text) => ipcRenderer.invoke("clipboard:writeText", getSessionToken(), text),
  exportReportPdf: (html, defaultFileName, landscape) =>
    ipcRenderer.invoke("report:exportPdf", getSessionToken(), html, defaultFileName, landscape),
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
    pickLogo: () => authInvoke("pos:branding:pick-logo"),
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
    setSeats: (tableId, seats) => authInvoke("pos:tables:set-seats", tableId, seats),
    setName: (tableId, name) => authInvoke("pos:tables:set-name", tableId, name),
    applyFloorLayout: (payload) => authInvoke("pos:tables:apply-floor-layout", payload),
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
    reorderItems: (ids) => authInvoke("pos:menu:reorder-items", ids),
    listCategories: () => authInvoke("pos:menu:list-categories"),
    setCategories: (categories) => authInvoke("pos:menu:set-categories", categories),
    importMenu: (payload) => authInvoke("pos:menu:import", payload),
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
    summarizePaid: (opts) => authInvoke("pos:orders:summarize-paid", opts),
    listPaidIds: (opts) => authInvoke("pos:orders:list-paid-ids", opts),
    addLine: (orderId, item) => authInvoke("pos:orders:add-line", orderId, item),
    updateLines: (orderId, lines) => authInvoke("pos:orders:update-lines", orderId, lines),
    setDiscount: (orderId, discount) =>
      authInvoke("pos:orders:set-discount", orderId, discount),
    setStatus: (orderId, status, payload) =>
      authInvoke("pos:orders:set-status", orderId, status, payload),
    markKotSent: (orderId, sentLines, options) =>
      authInvoke("pos:orders:mark-kot-sent", orderId, sentLines, options),
    markKotFailed: (orderId, error) => authInvoke("pos:orders:mark-kot-failed", orderId, error),
    voidKotLine: (orderId, payload) => authInvoke("pos:orders:void-kot-line", orderId, payload),
    markKotDone: (orderId) => authInvoke("pos:orders:mark-kot-done", orderId),
    markKotPrinted: (orderId) => authInvoke("pos:orders:mark-kot-printed", orderId),
    markBillPrinted: (orderId) => authInvoke("pos:orders:mark-bill-printed", orderId),
    pay: (orderId, payment) => authInvoke("pos:orders:pay", orderId, payment),
    cancel: (orderId, reason) => authInvoke("pos:orders:cancel", orderId, reason),
    deleteHistory: (orderIds) => authInvoke("pos:orders:delete-history", orderIds),
    restoreHistory: (orders) => authInvoke("pos:orders:restore-history", orders),
  },
  customers: {
    list: (opts) => authInvoke("pos:customers:list", opts),
    create: (payload) => authInvoke("pos:customers:create", payload),
    update: (id, updates) => authInvoke("pos:customers:update", id, updates),
    delete: (id) => authInvoke("pos:customers:delete", id),
    account: (customerId) => authInvoke("pos:customers:account", customerId),
    accountEntries: (customerId, opts) =>
      authInvoke("pos:customers:account-entries", customerId, opts),
    openBills: (customerId) => authInvoke("pos:customers:open-bills", customerId),
    receivePayment: (customerId, payload) =>
      authInvoke("pos:customers:receive-payment", customerId, payload),
    voidCreditSale: (creditEntryId, payload) =>
      authInvoke("pos:customers:void-credit-sale", creditEntryId, payload),
  },
  staff: {
    list: (opts) => authInvoke("pos:staff:list", opts),
    get: (id) => authInvoke("pos:staff:get", id),
    create: (payload) => authInvoke("pos:staff:create", payload),
    update: (id, updates) => authInvoke("pos:staff:update", id, updates),
    delete: (id) => authInvoke("pos:staff:delete", id),
  },
  attendance: {
    list: (input) => authInvoke("pos:attendance:list", input),
    listRange: (input) => authInvoke("pos:attendance:listRange", input),
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
    salesFacts: (opts) => authInvoke("pos:reports:sales-facts", opts),
    salesSummary: (opts) => authInvoke("pos:reports:sales-summary", opts),
    paymentBreakdown: (opts) => authInvoke("pos:reports:payment-breakdown", opts),
    creditCollections: (opts) => authInvoke("pos:reports:credit-collections", opts),
    creditTotals: () => authInvoke("pos:reports:credit-totals"),
    productSales: (opts) => authInvoke("pos:reports:product-sales", opts),
    orderHistory: (opts) => authInvoke("pos:reports:order-history", opts),
    foodCostSummary: (opts) => authInvoke("pos:reports:food-cost-summary", opts),
    profitability: (opts) => authInvoke("pos:reports:profitability", opts),
    groceryPurchases: (opts) => authInvoke("pos:reports:grocery-purchases", opts),
  },
  review: {
    summary: (opts) => authInvoke("pos:review:summary", opts),
    items: (opts) => authInvoke("pos:review:items", opts),
    staffActivity: (opts) => authInvoke("pos:review:staff-activity", opts),
    timeline: (orderId) => authInvoke("pos:review:timeline", orderId),
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
    changeListLines: (id, change) => authInvoke("pos:grocery:lists:change-lines", id, change),
    deleteList: (id) => authInvoke("pos:grocery:lists:delete", id),
    listPurchases: (opts) => authInvoke("pos:grocery:purchases:list", opts),
    createPurchase: (payload) => authInvoke("pos:grocery:purchases:create", payload),
    updatePurchase: (id, updates) => authInvoke("pos:grocery:purchases:update", id, updates),
    deletePurchase: (id) => authInvoke("pos:grocery:purchases:delete", id),
    listPurchaseHeaders: (opts) => authInvoke("pos:grocery:purchase-headers:list", opts),
    createPurchaseHeader: (payload) => authInvoke("pos:grocery:purchase-headers:create", payload),
    updatePurchaseHeader: (id, updates) =>
      authInvoke("pos:grocery:purchase-headers:update", id, updates),
    voidPurchaseHeader: (id) => authInvoke("pos:grocery:purchase-headers:void", id),
    listTemplates: () => authInvoke("pos:grocery:templates:list"),
    createTemplate: (payload) => authInvoke("pos:grocery:templates:create", payload),
    deleteTemplate: (id) => authInvoke("pos:grocery:templates:delete", id),
  },
  vendors: {
    list: (opts) => authInvoke("pos:vendors:list", opts),
    create: (payload) => authInvoke("pos:vendors:create", payload),
    update: (id, updates) => authInvoke("pos:vendors:update", id, updates),
    delete: (id) => authInvoke("pos:vendors:delete", id),
  },
  expenses: {
    listCategories: (opts) => authInvoke("pos:expenses:categories:list", opts),
    list: (opts) => authInvoke("pos:expenses:list", opts),
    create: (payload) => authInvoke("pos:expenses:create", payload),
    update: (id, updates) => authInvoke("pos:expenses:update", id, updates),
    void: (id) => authInvoke("pos:expenses:void", id),
  },
  salaryAdvances: {
    list: (opts) => authInvoke("pos:salary-advances:list", opts),
    create: (payload) => authInvoke("pos:salary-advances:create", payload),
    void: (id) => authInvoke("pos:salary-advances:void", id),
  },
  audit: {
    create: (action, orderId, user, detail) =>
      authInvoke("pos:audit:create", action, orderId, user, detail),
    list: (opts) => authInvoke("pos:audit:list", opts),
    count: (opts) => authInvoke("pos:audit:count", opts),
    liveActivity: (opts) => authInvoke("pos:activity:live", opts),
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
    status: () => authInvoke("pos:backup:status"),
    create: () => authInvoke("pos:backup:create"),
    history: () => authInvoke("pos:backup:history"),
    restore: (backupId) => authInvoke("pos:backup:restore", backupId),
    activateCloud: () => authInvoke("pos:backup:activate-cloud"),
    recoverCloud: (payload) => authInvoke("pos:backup:recover-cloud", payload),
    listCloud: () => authInvoke("pos:backup:list-cloud"),
    restoreCloud: (backupId) => authInvoke("pos:backup:restore-cloud", backupId),
    exportRecoveryKey: (recoveryKey) => authInvoke("pos:backup:export-recovery-key", recoveryKey),
    relaunch: () => authInvoke("pos:backup:relaunch"),
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
  gateway: {
    status: () => authInvoke("pos:gateway:status"),
    start: () => authInvoke("pos:gateway:start"),
    stop: () => authInvoke("pos:gateway:stop"),
    rotatePairing: () => authInvoke("pos:gateway:rotate-pairing"),
  },
  license: {
    getStatus: () => invoke("license:get-status"),
    getInstallationCode: () => invoke("license:get-installation-code"),
    copyInstallationCode: () => invoke("license:copy-installation-code"),
    importLicense: (filePath) => invoke("license:import", filePath),
  },
  events: {
    onDomainEvent: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("pos:domain-event", handler);
      return () => ipcRenderer.removeListener("pos:domain-event", handler);
    },
  },
});
