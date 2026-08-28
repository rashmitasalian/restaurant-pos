import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";
import path from "path";
import type { Role, UserDto } from "../../src/shared/pos";
import { posService } from "../services/posService";
import { updateService } from "../services/updateService";
import {
  createMainSession,
  destroyMainSession,
  getMainSession,
  refreshMainSession,
} from "../services/sessionManager";

type WindowGetter = () => BrowserWindow | null;

const ADMIN_ROLES: Role[] = ["admin"];
const CUSTOMER_ROLES: Role[] = ["admin", "cashier"];
const CASHIER_READABLE_SETTINGS = new Set([
  "config:gst",
  "config:printers",
  "config:seating-areas",
  "config:service-modes",
  "config:tables",
  "config:categories",
  "config:branding",
]);
const WRITABLE_SETTINGS = new Set([
  "config:attendance",
  "config:audit",
  "config:branding",
  "config:categories",
  "config:gst",
  "config:history",
  "config:printers",
  "config:seating-areas",
  "config:service-modes",
  "config:tables",
]);

function publicUser(user: UserDto) {
  return {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    requirePasswordChange: user.requirePasswordChange ?? false,
  };
}

function requireSession(
  event: IpcMainInvokeEvent,
  token?: string | null,
  roles?: Role[],
  options: { allowPasswordChange?: boolean } = {},
) {
  const session = getMainSession(token, event.sender.id);
  if (!session) {
    throw new Error("auth-required");
  }

  const user = posService.getUserByUsername(session.username);
  if (!user || user.active === false) {
    destroyMainSession(token);
    throw new Error("auth-required");
  }
  if (user.requirePasswordChange && !options.allowPasswordChange) {
    throw new Error("password-change-required");
  }
  if (roles?.length && !roles.includes(user.role)) {
    throw new Error("forbidden");
  }

  refreshMainSession(session.token, user);
  return user;
}

export function registerPosIpc(getMainWindow: WindowGetter) {
  ipcMain.handle("pos:db:ready", () => posService.ensureReady());

  ipcMain.handle("pos:auth:has-users", () => posService.hasUsers());
  ipcMain.handle("pos:auth:create-first-admin", (_event, payload) =>
    posService.createFirstAdmin(payload),
  );
  ipcMain.handle("pos:auth:login", (event, username: string, password: string) => {
    const result = posService.login(username, password) as any;
    if (!result.ok || !result.user) {
      return result;
    }
    const session = createMainSession(event.sender.id, result.user);
    return {
      ...result,
      sessionToken: session.token,
      user: publicUser({
        ...result.user,
        _id: `user:${result.user.username}`,
        type: "user",
      } as UserDto),
    };
  });
  ipcMain.handle("pos:auth:logout", (event, token?: string | null) => {
    const session = getMainSession(token, event.sender.id);
    if (session) {
      posService.logout(session.username);
    }
    destroyMainSession(token);
    return { ok: true };
  });
  ipcMain.handle("pos:auth:refresh-user", (event, token?: string | null) => {
    const user = requireSession(event, token, undefined, { allowPasswordChange: true });
    return user;
  });
  ipcMain.handle(
    "pos:auth:change-password",
    (event, token: string | null, currentPassword: string, newPassword: string) => {
      const user = requireSession(event, token, undefined, { allowPasswordChange: true });
      return posService.changeOwnPassword(user.username, currentPassword, newPassword);
    },
  );
  ipcMain.handle("pos:auth:recovery-status", () => posService.recoveryStatus());
  ipcMain.handle("pos:auth:recover-last-admin", (_event, payload) =>
    posService.recoverLastAdmin(payload),
  );
  ipcMain.handle("pos:branding:get-public", () => {
    const cfg = (posService.getConfigDoc("config:branding") || {}) as any;
    return {
      hotelName: String(cfg.hotelName || ""),
      hotelInitials: String(cfg.hotelInitials || ""),
      tagline: String(cfg.tagline || "POINT OF SALE"),
      logoDataUrl: cfg.logoDataUrl || null,
    };
  });
  ipcMain.handle("pos:auth:regenerate-recovery-codes", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.regenerateRecoveryCodes({
      actorUsername: user.username,
      actorPassword: payload?.actorPassword,
    });
  });

  ipcMain.handle("pos:users:list", (event, token?: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listUsers();
  });
  ipcMain.handle("pos:users:create", (event, token: string | null, payload) => {
    const actor = requireSession(event, token, ADMIN_ROLES);
    return posService.createUser({ ...payload, actorUsername: actor.username });
  });
  ipcMain.handle(
    "pos:users:update",
    (
      event,
      token: string | null,
      username: string,
      updates,
      _actorUsername?: string | null,
      actorPassword?: string | null,
    ) => {
      const actor = requireSession(event, token, ADMIN_ROLES);
      return posService.updateUser(username, updates, actor.username, actorPassword);
    },
  );
  ipcMain.handle(
    "pos:users:reset-password",
    (
      event,
      token: string | null,
      username: string,
      password: string,
      _actorUsername?: string | null,
      actorPassword?: string | null,
    ) => {
      const actor = requireSession(event, token, ADMIN_ROLES);
      return posService.resetUserPassword(username, password, actor.username, actorPassword);
    },
  );

  ipcMain.handle("pos:tables:seed", (event, token: string | null) => {
    requireSession(event, token);
    return posService.ensureConfiguredTables();
  });
  ipcMain.handle("pos:tables:list", (event, token?: string | null) => {
    requireSession(event, token);
    return posService.getTables();
  });
  ipcMain.handle("pos:tables:configured-count", (event, token: string | null) => {
    requireSession(event, token);
    return posService.getConfiguredTableCount();
  });
  ipcMain.handle("pos:tables:snapshot", (event, token?: string | null) => {
    requireSession(event, token);
    return posService.getTablesSnapshot();
  });
  ipcMain.handle("pos:tables:set-area", (event, token: string | null, tableId: number, areaId: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.setTableArea(tableId, areaId, user.username);
  });
  ipcMain.handle("pos:tables:set-seats", (event, token: string | null, tableId: number, seats: number) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.setTableSeats(tableId, seats, user.username);
  });
  ipcMain.handle("pos:seating-areas:list", (event, token?: string | null, includeDisabled?: boolean) => {
    requireSession(event, token);
    return posService.getSeatingAreas(Boolean(includeDisabled));
  });
  ipcMain.handle("pos:seating-areas:save", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.setSeatingAreas(payload, user.username);
  });
  ipcMain.handle(
    "pos:seating-areas:delete",
    (event, token: string | null, areaId: string, reassignToAreaId: string) => {
      const user = requireSession(event, token, ADMIN_ROLES);
      return posService.deleteSeatingArea(areaId, reassignToAreaId, user.username);
    },
  );

  ipcMain.handle("pos:menu:seed", (event, token?: string | null) => {
    requireSession(event, token);
    return posService.seedItems();
  });
  ipcMain.handle("pos:menu:list-items", (event, token?: string | null) => {
    requireSession(event, token);
    return posService.getItems();
  });
  ipcMain.handle("pos:menu:get-item", (event, token: string | null, id: string) => {
    requireSession(event, token);
    return posService.getItemById(id);
  });
  ipcMain.handle("pos:menu:create-item", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.createItem(payload, user.username);
  });
  ipcMain.handle("pos:menu:update-item", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.updateItem(payload, user.username);
  });
  ipcMain.handle("pos:menu:delete-item", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.deleteItem(id, user.username);
  });
  ipcMain.handle("pos:menu:list-categories", (event, token?: string | null) => {
    requireSession(event, token);
    return posService.getCategories();
  });
  ipcMain.handle("pos:menu:set-categories", (event, token: string | null, categories: string[]) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.setCategories(categories, user.username);
  });
  ipcMain.handle("pos:menu:list-variant-options", (event, token?: string | null) => {
    requireSession(event, token);
    return posService.getVariantOptions();
  });
  ipcMain.handle(
    "pos:menu:set-variant-options",
    (event, token: string | null, options: string[]) => {
      const user = requireSession(event, token, ADMIN_ROLES);
      return posService.setVariantOptions(options, user.username);
    },
  );

  ipcMain.handle("pos:orders:create", (event, token: string | null, payload) => {
    const user = requireSession(event, token);
    return posService.createOrder({ ...payload, createdBy: user.username });
  });
  ipcMain.handle("pos:orders:next-kot-seq", (event, token: string | null) => {
    requireSession(event, token);
    return posService.getNextKotSeq();
  });
  ipcMain.handle("pos:orders:get", (event, token: string | null, id: string) => {
    const user = requireSession(event, token);
    const order = posService.getOrderById(id);
    if (user.role !== "admin" && (order?.status === "paid" || order?.status === "cancelled")) {
      throw new Error("forbidden");
    }
    return order;
  });
  ipcMain.handle("pos:orders:get-open-table", (event, token: string | null, tableId: number) => {
    requireSession(event, token);
    return posService.getOpenOrderForTable(tableId);
  });
  ipcMain.handle(
    "pos:orders:get-or-create-table",
    (event, token: string | null, tableId: number) => {
      const user = requireSession(event, token);
      return posService.getOrCreateOrderForTable(tableId, user.username);
    },
  );
  ipcMain.handle("pos:orders:list-open", (event, token?: string | null) => {
    requireSession(event, token);
    return posService.getOpenOrders();
  });
  ipcMain.handle("pos:orders:list-active", (event, token?: string | null) => {
    requireSession(event, token);
    return posService.getActiveOrders();
  });
  ipcMain.handle("pos:orders:list-paid", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listPaidOrders(opts);
  });
  ipcMain.handle("pos:orders:count-paid", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.countPaidOrders(opts);
  });
  ipcMain.handle("pos:orders:summarize-paid", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.summarizePaidOrders(opts);
  });
  ipcMain.handle("pos:orders:list-paid-ids", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listPaidOrderIds(opts);
  });
  ipcMain.handle("pos:orders:add-line", (event, token: string | null, orderId: string, item) => {
    requireSession(event, token);
    return posService.addItemToOrder(orderId, item);
  });
  ipcMain.handle(
    "pos:orders:update-lines",
    (event, token: string | null, orderId: string, lines) => {
      const user = requireSession(event, token);
      return posService.updateOrderLines(orderId, lines, user.username);
    },
  );
  ipcMain.handle(
    "pos:orders:set-discount",
    (event, token: string | null, orderId: string, discountPercent: number) => {
      const user = requireSession(event, token);
      return posService.setOrderDiscount(orderId, discountPercent, user.username);
    },
  );
  ipcMain.handle(
    "pos:orders:set-status",
    (event, token: string | null, orderId: string, status, payload) => {
      const user = requireSession(event, token);
      return posService.setOrderStatus(orderId, status, payload, user.username);
    },
  );
  ipcMain.handle(
    "pos:orders:mark-kot-sent",
    (event, token: string | null, orderId: string, sentLines) => {
      const user = requireSession(event, token);
      return posService.markKotSent(orderId, sentLines, user.username);
    },
  );
  ipcMain.handle(
    "pos:orders:mark-kot-failed",
    (event, token: string | null, orderId: string, error?: string | null) => {
      const user = requireSession(event, token);
      return posService.markKotFailed(orderId, error, user.username);
    },
  );
  ipcMain.handle(
    "pos:orders:void-kot-line",
    (event, token: string | null, orderId: string, payload) => {
      const user = requireSession(event, token);
      return posService.voidKotLine(orderId, payload, user.username);
    },
  );
  ipcMain.handle("pos:orders:mark-kot-done", (event, token: string | null, orderId: string) => {
    const user = requireSession(event, token);
    return posService.markKotDone(orderId, user.username);
  });
  ipcMain.handle("pos:orders:mark-kot-printed", (event, token: string | null, orderId: string) => {
    const user = requireSession(event, token);
    return posService.markKotPrinted(orderId, user.username);
  });
  ipcMain.handle("pos:orders:pay", (event, token: string | null, orderId: string, payment) => {
    const user = requireSession(event, token);
    return posService.setOrderPaid(orderId, {
      ...payment,
      receivedBy: payment?.receivedBy || user.username,
    });
  });
  ipcMain.handle("pos:orders:cancel", (event, token: string | null, orderId: string) => {
    const user = requireSession(event, token);
    return posService.cancelOrder(orderId, user.username);
  });
  ipcMain.handle("pos:orders:delete-history", (event, token: string | null, orderIds: string[]) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.deleteClosedOrders(orderIds, user.username);
  });
  ipcMain.handle("pos:orders:restore-history", (event, token: string | null, orders) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return (orders || []).map((order: any) =>
      posService.restoreOrderSnapshot(order, user.username),
    );
  });

  ipcMain.handle("pos:customers:list", (event, token?: string | null) => {
    requireSession(event, token, CUSTOMER_ROLES);
    return posService.listCustomers();
  });
  ipcMain.handle("pos:customers:create", (event, token: string | null, payload) => {
    requireSession(event, token, CUSTOMER_ROLES);
    return posService.createCustomer(payload);
  });
  ipcMain.handle("pos:customers:update", (event, token: string | null, id: string, updates) => {
    requireSession(event, token, CUSTOMER_ROLES);
    return posService.updateCustomer(id, updates);
  });
  ipcMain.handle("pos:customers:delete", (event, token: string | null, id: string) => {
    requireSession(event, token, CUSTOMER_ROLES);
    return posService.deleteCustomer(id);
  });

  ipcMain.handle(
    "pos:staff:list",
    (event, token?: string | null, opts?: { includeInactive?: boolean; status?: string; includePhotos?: boolean }) => {
      requireSession(event, token, ADMIN_ROLES);
      return posService.listStaff(opts as any);
    },
  );
  ipcMain.handle("pos:staff:get", (event, token: string | null, id: string) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.getStaff(id);
  });
  ipcMain.handle("pos:staff:create", (event, token: string | null, payload) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.createStaff(payload);
  });
  ipcMain.handle("pos:staff:update", (event, token: string | null, id: string, updates) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.updateStaff(id, updates, user.username);
  });
  ipcMain.handle("pos:staff:delete", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.deleteStaff(id, user.username);
  });

  ipcMain.handle("pos:attendance:list", (event, token: string | null, input) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listAttendance(input || {});
  });
  ipcMain.handle("pos:attendance:listRange", (event, token: string | null, input) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listAttendanceRange(input || {});
  });
  ipcMain.handle("pos:attendance:upsert", (event, token: string | null, input) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.upsertAttendanceRows(input || {}, user.username);
  });
  ipcMain.handle("pos:attendance:copy", (event, token: string | null, fromDate: string, toDate: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.copyAttendance(fromDate, toDate, user.username);
  });
  ipcMain.handle("pos:attendance:delete", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.deleteAttendance(id, user.username);
  });

  ipcMain.handle("pos:settings:get", (event, token: string | null, key: string) => {
    const user = requireSession(event, token);
    if (user.role !== "admin" && !CASHIER_READABLE_SETTINGS.has(String(key || ""))) {
      throw new Error("forbidden");
    }
    return posService.getConfigDoc(key);
  });
  ipcMain.handle("pos:settings:set", (event, token: string | null, key: string, value) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    if (!WRITABLE_SETTINGS.has(String(key || ""))) {
      throw new Error("invalid-setting-key");
    }
    return posService.setSetting(key, value, user.username);
  });
  ipcMain.handle("pos:settings:prune-audit", (event, token?: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.pruneAuditLogs();
  });
  ipcMain.handle("pos:settings:prune-history", (event, token?: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.pruneOrderHistory();
  });

  ipcMain.handle("pos:reports:sales-summary", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.getSalesSummary(opts);
  });
  ipcMain.handle("pos:reports:payment-breakdown", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.getPaymentBreakdown(opts);
  });
  ipcMain.handle("pos:reports:product-sales", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.getProductSalesReport(opts);
  });
  ipcMain.handle("pos:reports:order-history", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listPaidOrders(opts);
  });
  ipcMain.handle("pos:reports:food-cost-summary", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.getFoodCostSummary(opts);
  });

  ipcMain.handle("pos:grocery:items:list", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listGroceryItems(opts || {});
  });
  ipcMain.handle("pos:grocery:items:create", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.createGroceryItem(payload, user.username);
  });
  ipcMain.handle("pos:grocery:items:update", (event, token: string | null, id: string, updates) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.updateGroceryItem(id, updates, user.username);
  });
  ipcMain.handle("pos:grocery:items:delete", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.deleteGroceryItem(id, user.username);
  });
  ipcMain.handle("pos:grocery:lists:list", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listGroceryLists(opts || {});
  });
  ipcMain.handle("pos:grocery:lists:get", (event, token: string | null, id: string) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.getGroceryList(id);
  });
  ipcMain.handle("pos:grocery:lists:create", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.createGroceryList(payload, user.username);
  });
  ipcMain.handle("pos:grocery:lists:update", (event, token: string | null, id: string, updates) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.updateGroceryList(id, updates, user.username);
  });
  ipcMain.handle("pos:grocery:lists:delete", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.deleteGroceryList(id, user.username);
  });
  ipcMain.handle("pos:grocery:purchases:list", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listGroceryPurchases(opts || {});
  });
  ipcMain.handle("pos:grocery:purchases:create", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.createGroceryPurchase(payload, user.username);
  });
  ipcMain.handle(
    "pos:grocery:purchases:update",
    (event, token: string | null, id: string, updates) => {
      const user = requireSession(event, token, ADMIN_ROLES);
      return posService.updateGroceryPurchase(id, updates, user.username);
    },
  );
  ipcMain.handle("pos:grocery:purchases:delete", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.deleteGroceryPurchase(id, user.username);
  });

  ipcMain.handle("pos:grocery:purchase-headers:list", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listGroceryPurchaseHeaders(opts || {});
  });

  ipcMain.handle("pos:grocery:purchase-headers:void", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.voidGroceryPurchaseHeader(id, user.username);
  });

  ipcMain.handle("pos:vendors:list", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listVendors(opts || {});
  });

  ipcMain.handle("pos:vendors:create", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.createVendor(payload, user.username);
  });

  ipcMain.handle("pos:vendors:update", (event, token: string | null, id: string, updates) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.updateVendor(id, updates, user.username);
  });

  ipcMain.handle("pos:vendors:delete", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.deleteVendor(id, user.username);
  });

  ipcMain.handle("pos:expenses:categories:list", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listExpenseCategories(opts || {});
  });

  ipcMain.handle("pos:expenses:list", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listExpenses(opts || {});
  });

  ipcMain.handle("pos:expenses:create", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.createExpense(payload, user.username);
  });

  ipcMain.handle("pos:expenses:update", (event, token: string | null, id: string, updates) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.updateExpense(id, updates, user.username);
  });

  ipcMain.handle("pos:expenses:void", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.voidExpense(id, user.username);
  });

  ipcMain.handle("pos:salary-advances:list", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listSalaryAdvances(opts || {});
  });

  ipcMain.handle("pos:salary-advances:create", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.createSalaryAdvance(payload, user.username);
  });

  ipcMain.handle("pos:salary-advances:void", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.voidSalaryAdvance(id, user.username);
  });

  ipcMain.handle("pos:grocery:templates:list", (event, token: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listBuyingListTemplates();
  });

  ipcMain.handle("pos:grocery:templates:create", (event, token: string | null, payload) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.createBuyingListTemplate(payload, user.username);
  });

  ipcMain.handle("pos:grocery:templates:delete", (event, token: string | null, id: string) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    return posService.deleteBuyingListTemplate(id, user.username);
  });

  ipcMain.handle("pos:reports:profitability", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.getProfitabilitySummary(opts || {});
  });

  ipcMain.handle(
    "pos:audit:create",
    (
      event,
      token: string | null,
      action: string,
      orderId?: string | null,
      _user?: string | null,
      detail?: unknown,
    ) => {
      const user = requireSession(event, token, undefined, { allowPasswordChange: true });
      return posService.createAudit(action, orderId, user.username, detail);
    },
  );
  ipcMain.handle("pos:audit:list", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.getAudits(opts);
  });
  ipcMain.handle("pos:audit:count", (event, token: string | null, opts) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.countAudits(opts);
  });
  ipcMain.handle(
    "pos:audit-archives:create",
    (event, token: string | null, retentionDays: number) => {
      requireSession(event, token, ADMIN_ROLES);
      return posService.createAuditArchive(retentionDays);
    },
  );
  ipcMain.handle("pos:audit-archives:list", (event, token?: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listAuditArchives();
  });
  ipcMain.handle("pos:audit-archives:export", (event, token: string | null, id: string) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.exportAuditArchive(id);
  });
  ipcMain.handle("pos:audit-archives:delete", (event, token: string | null, id: string) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.deleteAuditArchive(id);
  });
  ipcMain.handle(
    "pos:audit-archives:cleanup-old",
    (event, token: string | null, ageMonths: number) => {
      requireSession(event, token, ADMIN_ROLES);
      return posService.cleanupOldAuditArchives(ageMonths);
    },
  );

  ipcMain.handle("pos:print-queue:add", (event, token: string | null, payload) => {
    requireSession(event, token);
    return posService.addPrintJob(payload);
  });
  ipcMain.handle("pos:print-queue:list", (event, token: string | null, status) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listPrintJobs(status);
  });
  ipcMain.handle("pos:print-queue:mark-completed", (event, token: string | null, id: string) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.markPrintJobCompleted(id);
  });
  ipcMain.handle("pos:print-queue:retry", (event, token: string | null, id: string) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.retryPrintJob(id);
  });
  ipcMain.handle("pos:print-queue:clear-old", (event, token: string | null, ageHours: number) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.clearOldPrintJobs(ageHours);
  });

  ipcMain.handle("pos:backup:create-local", async (event, token?: string | null) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const defaultPath = path.join(
      app.getPath("documents"),
      `pos-sqlite-backup-${timestamp}.sqlite`,
    );
    const options = {
      title: "Save SQLite Backup",
      defaultPath,
      filters: [{ name: "SQLite Database", extensions: ["sqlite", "db"] }],
    };
    const win = getMainWindow();
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { ok: false, reason: "cancelled" };
    }
    return posService.createLocalBackup(result.filePath, user.username);
  });
  ipcMain.handle("pos:backup:list", (event, token?: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return posService.listBackups();
  });
  ipcMain.handle("pos:backup:restore-local", async (event, token?: string | null) => {
    const user = requireSession(event, token, ADMIN_ROLES);
    const options: OpenDialogOptions = {
      title: "Restore SQLite Backup",
      filters: [{ name: "SQLite Database", extensions: ["sqlite", "db"] }],
      properties: ["openFile"],
    };
    const win = getMainWindow();
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths?.[0]) {
      return { ok: false, reason: "cancelled" };
    }
    return posService.restoreLocalBackup(result.filePaths[0], user.username);
  });

  ipcMain.handle("pos:app:info", (event, token?: string | null) => {
    requireSession(event, token);
    return updateService.appInfo();
  });
  ipcMain.handle("pos:updates:check", async (event, token?: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return updateService.checkForUpdates();
  });
  ipcMain.handle(
    "pos:updates:prepare",
    async (event, token?: string | null, options?: { allowBusinessActivity?: boolean }) => {
      requireSession(event, token, ADMIN_ROLES);
      return updateService.prepareUpdate(options || {});
    },
  );
  ipcMain.handle("pos:updates:launch", async (event, token?: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return updateService.launchPreparedUpdate();
  });
  ipcMain.handle("pos:updates:status", (event, token?: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return updateService.getStatus();
  });
  ipcMain.handle("pos:updates:startup-health", (event, token?: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return updateService.processStartupState();
  });
  ipcMain.handle(
    "pos:updates:rollback",
    async (event, token?: string | null, options?: { confirmed?: boolean }) => {
      requireSession(event, token, ADMIN_ROLES);
      return updateService.rollbackLast(options || {});
    },
  );
  ipcMain.handle("pos:support:export-diagnostics", (event, token?: string | null) => {
    requireSession(event, token, ADMIN_ROLES);
    return updateService.exportDiagnostics();
  });
}
