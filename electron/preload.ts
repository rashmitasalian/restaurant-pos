// Use CommonJS require to avoid ESM import errors in preload when loaded via the shim
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args);
const MAIN_SESSION_TOKEN_KEY = "pos-main-session-token";

function getSessionToken() {
  try {
    return (globalThis as any).localStorage?.getItem(MAIN_SESSION_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

const authInvoke = (channel: string, ...args: any[]) => invoke(channel, getSessionToken(), ...args);

function buildTestPrintPayload(printer: any) {
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
  print: async (payload: any) => ipcRenderer.invoke("printer:print", getSessionToken(), payload),
  listPrinters: async () => ipcRenderer.invoke("printer:list", getSessionToken()),
  // simple test-print helper
  testPrint: async (printer: any) =>
    ipcRenderer.invoke("printer:print", getSessionToken(), buildTestPrintPayload(printer)),
  // Persist a log entry to file via main process
  writeLog: async (level: string, message: string, context?: any) =>
    ipcRenderer
      .invoke("log:write", getSessionToken(), level, message, context)
      .catch(() => ({ ok: false })),
  copyText: async (text: string) =>
    ipcRenderer.invoke("clipboard:writeText", getSessionToken(), text),
  // Export report as PDF via native save dialog
  exportReportPdf: async (html: string, defaultFileName: string) =>
    ipcRenderer.invoke("report:exportPdf", getSessionToken(), html, defaultFileName),
  // Expose environment variables needed by renderer
  env: {
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
  },
  db: {
    ready: () => invoke("pos:db:ready"),
  },
  auth: {
    hasUsers: () => invoke("pos:auth:has-users"),
    createFirstAdmin: (payload: any) => invoke("pos:auth:create-first-admin", payload),
    login: (username: string, password: string) => invoke("pos:auth:login", username, password),
    logout: () => authInvoke("pos:auth:logout"),
    refreshUser: (_username?: string) => authInvoke("pos:auth:refresh-user"),
    changePassword: (username: string, currentPassword: string, newPassword: string) =>
      authInvoke("pos:auth:change-password", currentPassword, newPassword),
    recoveryStatus: () => invoke("pos:auth:recovery-status"),
    recoverLastAdmin: (payload: any) => invoke("pos:auth:recover-last-admin", payload),
    regenerateRecoveryCodes: (payload: any) =>
      authInvoke("pos:auth:regenerate-recovery-codes", payload),
  },
  branding: {
    getPublic: () => invoke("pos:branding:get-public"),
  },
  users: {
    list: () => authInvoke("pos:users:list"),
    create: (payload: any) => authInvoke("pos:users:create", payload),
    update: (
      username: string,
      updates: any,
      actorUsername?: string | null,
      actorPassword?: string | null,
    ) => authInvoke("pos:users:update", username, updates, actorUsername, actorPassword),
    resetPassword: (
      username: string,
      password: string,
      actorUsername?: string | null,
      actorPassword?: string | null,
    ) => authInvoke("pos:users:reset-password", username, password, actorUsername, actorPassword),
  },
  tables: {
    seed: (_count?: number) => authInvoke("pos:tables:seed"),
    list: () => authInvoke("pos:tables:list"),
    configuredCount: () => authInvoke("pos:tables:configured-count"),
    snapshot: () => authInvoke("pos:tables:snapshot"),
    setArea: (tableId: number, areaId: string) =>
      authInvoke("pos:tables:set-area", tableId, areaId),
    setSeats: (tableId: number, seats: number) =>
      authInvoke("pos:tables:set-seats", tableId, seats),
    setName: (tableId: number, name: string) => authInvoke("pos:tables:set-name", tableId, name),
    applyFloorLayout: (payload: any) => authInvoke("pos:tables:apply-floor-layout", payload),
  },
  seatingAreas: {
    list: (includeDisabled?: boolean) => authInvoke("pos:seating-areas:list", includeDisabled),
    save: (areas: any[]) => authInvoke("pos:seating-areas:save", areas),
    delete: (areaId: string, reassignToAreaId: string) =>
      authInvoke("pos:seating-areas:delete", areaId, reassignToAreaId),
  },
  menu: {
    seed: () => authInvoke("pos:menu:seed"),
    listItems: () => authInvoke("pos:menu:list-items"),
    getItem: (id: string) => authInvoke("pos:menu:get-item", id),
    createItem: (payload: any) => authInvoke("pos:menu:create-item", payload),
    updateItem: (payload: any) => authInvoke("pos:menu:update-item", payload),
    deleteItem: (id: string) => authInvoke("pos:menu:delete-item", id),
    reorderItems: (ids: string[]) => authInvoke("pos:menu:reorder-items", ids),
    listCategories: () => authInvoke("pos:menu:list-categories"),
    setCategories: (categories: string[]) => authInvoke("pos:menu:set-categories", categories),
    importMenu: (payload: { csv: string; fileName?: string; mode?: "upsert" | "replace" }) =>
      authInvoke("pos:menu:import", payload),
    listVariantOptions: () => authInvoke("pos:menu:list-variant-options"),
    setVariantOptions: (options: string[]) => authInvoke("pos:menu:set-variant-options", options),
  },
  orders: {
    create: (payload: any) => authInvoke("pos:orders:create", payload),
    nextKotSeq: () => authInvoke("pos:orders:next-kot-seq"),
    get: (id: string) => authInvoke("pos:orders:get", id),
    getOpenForTable: (tableId: number) => authInvoke("pos:orders:get-open-table", tableId),
    getOrCreateForTable: (tableId: number) => authInvoke("pos:orders:get-or-create-table", tableId),
    listOpen: () => authInvoke("pos:orders:list-open"),
    listActive: () => authInvoke("pos:orders:list-active"),
    listPaid: (opts?: any) => authInvoke("pos:orders:list-paid", opts),
    countPaid: (opts?: any) => authInvoke("pos:orders:count-paid", opts),
    summarizePaid: (opts?: any) => authInvoke("pos:orders:summarize-paid", opts),
    listPaidIds: (opts?: any) => authInvoke("pos:orders:list-paid-ids", opts),
    addLine: (orderId: string, item: any) => authInvoke("pos:orders:add-line", orderId, item),
    updateLines: (orderId: string, lines: any[]) =>
      authInvoke("pos:orders:update-lines", orderId, lines),
    setDiscount: (orderId: string, discount: number | { mode?: "percent" | "amount"; percent?: number; amount?: number }) =>
      authInvoke("pos:orders:set-discount", orderId, discount),
    setStatus: (orderId: string, status: string, payload?: any) =>
      authInvoke("pos:orders:set-status", orderId, status, payload),
    markKotSent: (orderId: string, sentLines?: any[]) =>
      authInvoke("pos:orders:mark-kot-sent", orderId, sentLines),
    markKotFailed: (orderId: string, error?: string | null) =>
      authInvoke("pos:orders:mark-kot-failed", orderId, error),
    voidKotLine: (orderId: string, payload: any) =>
      authInvoke("pos:orders:void-kot-line", orderId, payload),
    markKotDone: (orderId: string) => authInvoke("pos:orders:mark-kot-done", orderId),
    markKotPrinted: (orderId: string) => authInvoke("pos:orders:mark-kot-printed", orderId),
    markBillPrinted: (orderId: string) => authInvoke("pos:orders:mark-bill-printed", orderId),
    pay: (orderId: string, payment: any) => authInvoke("pos:orders:pay", orderId, payment),
    cancel: (orderId: string, reason: string) => authInvoke("pos:orders:cancel", orderId, reason),
    deleteHistory: (orderIds: string[]) => authInvoke("pos:orders:delete-history", orderIds),
    restoreHistory: (orders: any[]) => authInvoke("pos:orders:restore-history", orders),
  },
  customers: {
    list: (opts?: any) => authInvoke("pos:customers:list", opts),
    create: (payload: any) => authInvoke("pos:customers:create", payload),
    update: (id: string, updates: any) => authInvoke("pos:customers:update", id, updates),
    delete: (id: string) => authInvoke("pos:customers:delete", id),
    account: (customerId: string) => authInvoke("pos:customers:account", customerId),
    accountEntries: (customerId: string, opts?: { limit?: number; offset?: number }) =>
      authInvoke("pos:customers:account-entries", customerId, opts),
    openBills: (customerId: string) => authInvoke("pos:customers:open-bills", customerId),
    receivePayment: (customerId: string, payload: any) =>
      authInvoke("pos:customers:receive-payment", customerId, payload),
    voidCreditSale: (creditEntryId: string, payload?: any) =>
      authInvoke("pos:customers:void-credit-sale", creditEntryId, payload),
  },
  staff: {
    list: (opts?: any) => authInvoke("pos:staff:list", opts),
    get: (id: string) => authInvoke("pos:staff:get", id),
    create: (payload: any) => authInvoke("pos:staff:create", payload),
    update: (id: string, updates: any) => authInvoke("pos:staff:update", id, updates),
    delete: (id: string) => authInvoke("pos:staff:delete", id),
  },
  attendance: {
    list: (input: any) => authInvoke("pos:attendance:list", input),
    listRange: (input: any) => authInvoke("pos:attendance:listRange", input),
    upsert: (input: any) => authInvoke("pos:attendance:upsert", input),
    copy: (fromDate: string, toDate: string) => authInvoke("pos:attendance:copy", fromDate, toDate),
    delete: (id: string) => authInvoke("pos:attendance:delete", id),
  },
  settings: {
    get: (key: string) => authInvoke("pos:settings:get", key),
    set: (key: string, value: any) => authInvoke("pos:settings:set", key, value),
    pruneAudit: () => authInvoke("pos:settings:prune-audit"),
    pruneHistory: () => authInvoke("pos:settings:prune-history"),
  },
  reports: {
    salesFacts: (opts?: any) => authInvoke("pos:reports:sales-facts", opts),
    salesSummary: (opts?: any) => authInvoke("pos:reports:sales-summary", opts),
    paymentBreakdown: (opts?: any) => authInvoke("pos:reports:payment-breakdown", opts),
    creditCollections: (opts?: any) => authInvoke("pos:reports:credit-collections", opts),
    creditTotals: () => authInvoke("pos:reports:credit-totals"),
    productSales: (opts?: any) => authInvoke("pos:reports:product-sales", opts),
    orderHistory: (opts?: any) => authInvoke("pos:reports:order-history", opts),
    foodCostSummary: (opts?: any) => authInvoke("pos:reports:food-cost-summary", opts),
    profitability: (opts?: any) => authInvoke("pos:reports:profitability", opts),
    groceryPurchases: (opts?: any) => authInvoke("pos:reports:grocery-purchases", opts),
  },
  review: {
    summary: (opts?: any) => authInvoke("pos:review:summary", opts),
    items: (opts?: any) => authInvoke("pos:review:items", opts),
    staffActivity: (opts?: any) => authInvoke("pos:review:staff-activity", opts),
    timeline: (orderId: string) => authInvoke("pos:review:timeline", orderId),
  },
  grocery: {
    listItems: (opts?: any) => authInvoke("pos:grocery:items:list", opts),
    createItem: (payload: any) => authInvoke("pos:grocery:items:create", payload),
    updateItem: (id: string, updates: any) => authInvoke("pos:grocery:items:update", id, updates),
    deleteItem: (id: string) => authInvoke("pos:grocery:items:delete", id),
    listLists: (opts?: any) => authInvoke("pos:grocery:lists:list", opts),
    getList: (id: string) => authInvoke("pos:grocery:lists:get", id),
    createList: (payload: any) => authInvoke("pos:grocery:lists:create", payload),
    updateList: (id: string, updates: any) => authInvoke("pos:grocery:lists:update", id, updates),
    changeListLines: (id: string, change: any) =>
      authInvoke("pos:grocery:lists:change-lines", id, change),
    deleteList: (id: string) => authInvoke("pos:grocery:lists:delete", id),
    listPurchases: (opts?: any) => authInvoke("pos:grocery:purchases:list", opts),
    createPurchase: (payload: any) => authInvoke("pos:grocery:purchases:create", payload),
    updatePurchase: (id: string, updates: any) =>
      authInvoke("pos:grocery:purchases:update", id, updates),
    deletePurchase: (id: string) => authInvoke("pos:grocery:purchases:delete", id),
    listPurchaseHeaders: (opts?: any) => authInvoke("pos:grocery:purchase-headers:list", opts),
    createPurchaseHeader: (payload: any) => authInvoke("pos:grocery:purchase-headers:create", payload),
    updatePurchaseHeader: (id: string, updates: any) =>
      authInvoke("pos:grocery:purchase-headers:update", id, updates),
    voidPurchaseHeader: (id: string) => authInvoke("pos:grocery:purchase-headers:void", id),
    listTemplates: () => authInvoke("pos:grocery:templates:list"),
    createTemplate: (payload: any) => authInvoke("pos:grocery:templates:create", payload),
    deleteTemplate: (id: string) => authInvoke("pos:grocery:templates:delete", id),
  },
  vendors: {
    list: (opts?: any) => authInvoke("pos:vendors:list", opts),
    create: (payload: any) => authInvoke("pos:vendors:create", payload),
    update: (id: string, updates: any) => authInvoke("pos:vendors:update", id, updates),
    delete: (id: string) => authInvoke("pos:vendors:delete", id),
  },
  expenses: {
    listCategories: (opts?: any) => authInvoke("pos:expenses:categories:list", opts),
    list: (opts?: any) => authInvoke("pos:expenses:list", opts),
    create: (payload: any) => authInvoke("pos:expenses:create", payload),
    update: (id: string, updates: any) => authInvoke("pos:expenses:update", id, updates),
    void: (id: string) => authInvoke("pos:expenses:void", id),
  },
  salaryAdvances: {
    list: (opts?: any) => authInvoke("pos:salary-advances:list", opts),
    create: (payload: any) => authInvoke("pos:salary-advances:create", payload),
    void: (id: string) => authInvoke("pos:salary-advances:void", id),
  },
  audit: {
    create: (action: string, orderId?: string | null, user?: string | null, detail?: any) =>
      authInvoke("pos:audit:create", action, orderId, user, detail),
    list: (opts?: any) => authInvoke("pos:audit:list", opts),
    count: (opts?: any) => authInvoke("pos:audit:count", opts),
    liveActivity: (opts?: any) => authInvoke("pos:activity:live", opts),
  },
  auditArchives: {
    create: (retentionDays: number) => authInvoke("pos:audit-archives:create", retentionDays),
    list: () => authInvoke("pos:audit-archives:list"),
    export: (id: string) => authInvoke("pos:audit-archives:export", id),
    delete: (id: string) => authInvoke("pos:audit-archives:delete", id),
    cleanupOld: (ageMonths: number) => authInvoke("pos:audit-archives:cleanup-old", ageMonths),
  },
  printQueue: {
    add: (payload: any) => authInvoke("pos:print-queue:add", payload),
    list: (status?: string) => authInvoke("pos:print-queue:list", status),
    markCompleted: (id: string) => authInvoke("pos:print-queue:mark-completed", id),
    retry: (id: string) => authInvoke("pos:print-queue:retry", id),
    clearOld: (ageHours: number) => authInvoke("pos:print-queue:clear-old", ageHours),
  },
  backupSqlite: {
    createLocal: (_actor?: string | null) => authInvoke("pos:backup:create-local"),
    restoreLocal: () => authInvoke("pos:backup:restore-local"),
    list: () => authInvoke("pos:backup:list"),
    status: () => authInvoke("pos:backup:status"),
    create: () => authInvoke("pos:backup:create"),
    history: () => authInvoke("pos:backup:history"),
    restore: (backupId: string) => authInvoke("pos:backup:restore", backupId),
    activateCloud: () => authInvoke("pos:backup:activate-cloud"),
    recoverCloud: (payload: { restaurantCode: string; recoveryKey: string }) =>
      authInvoke("pos:backup:recover-cloud", payload),
    listCloud: () => authInvoke("pos:backup:list-cloud"),
    restoreCloud: (backupId: string) => authInvoke("pos:backup:restore-cloud", backupId),
    exportRecoveryKey: (recoveryKey: string) =>
      authInvoke("pos:backup:export-recovery-key", recoveryKey),
    relaunch: () => authInvoke("pos:backup:relaunch"),
  },
  app: {
    info: () => authInvoke("pos:app:info"),
  },
  updates: {
    check: () => authInvoke("pos:updates:check"),
    prepare: (options?: any) => authInvoke("pos:updates:prepare", options),
    launch: () => authInvoke("pos:updates:launch"),
    status: () => authInvoke("pos:updates:status"),
    startupHealth: () => authInvoke("pos:updates:startup-health"),
    rollback: (options?: any) => authInvoke("pos:updates:rollback", options),
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
    importLicense: (filePath?: string) => invoke("license:import", filePath),
  },
  events: {
    onDomainEvent: (listener: (event: any) => void) => {
      const handler = (_event: unknown, payload: any) => listener(payload);
      ipcRenderer.on("pos:domain-event", handler);
      return () => ipcRenderer.removeListener("pos:domain-event", handler);
    },
  },
});
