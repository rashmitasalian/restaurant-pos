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
import type { Permission } from "../../src/shared/permissions";
import { roleHasPermission } from "../../src/shared/permissions";
import { sanitizeIpcError } from "../../src/shared/validation";
import { posService } from "../services/posService";
import { updateService } from "../services/updateService";
import {
  createMainSession,
  destroyMainSession,
  getMainSession,
  refreshMainSession,
} from "../services/sessionManager";
import {
  getGatewayStatus,
  rotateGatewayPairingCode,
  startLocalGateway,
  stopLocalGateway,
} from "../gateway/localGateway";

type WindowGetter = () => BrowserWindow | null;

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

function canReadSetting(role: Role, key: string): boolean {
  if (roleHasPermission(role, "system:settings")) {
    return true;
  }
  if (CASHIER_READABLE_SETTINGS.has(key)) {
    return true;
  }
  if (key === "config:attendance") {
    return (
      roleHasPermission(role, "people:attendance") || roleHasPermission(role, "people:roster")
    );
  }
  return false;
}

function publicUser(user: UserDto) {
  return {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    requirePasswordChange: user.requirePasswordChange ?? false,
    active: user.active !== false,
  };
}

function sanitizeLogoDataUrl(value: unknown): string | null {
  const raw = String(value || "").replace(/\s/g, "");
  if (!raw || raw.length > 2_000_000) {
    return null;
  }
  if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+=*$/i.test(raw)) {
    return null;
  }
  return raw;
}

const RENDERER_AUDIT_ACTIONS = new Set([
  "staff.export.csv",
  "staff.export.pdf",
  "staff.photo.downloaded",
]);

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

function requirePermission(
  event: IpcMainInvokeEvent,
  token: string | null | undefined,
  permission: Permission,
  options: { allowPasswordChange?: boolean } = {},
) {
  const user = requireSession(event, token, undefined, options);
  if (!roleHasPermission(user.role, permission)) {
    throw new Error("forbidden");
  }
  return user;
}

function installIpcErrorSanitizer() {
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel: string, listener: (...args: any[]) => any) =>
    originalHandle(channel, async (event: IpcMainInvokeEvent, ...args: any[]) => {
      try {
        return await listener(event, ...args);
      } catch (error) {
        sanitizeIpcError(error);
      }
    });
}

export function registerPosIpc(getMainWindow: WindowGetter) {
  installIpcErrorSanitizer();
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
    return publicUser(user);
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
      logoDataUrl: sanitizeLogoDataUrl(cfg.logoDataUrl),
    };
  });
  ipcMain.handle("pos:auth:regenerate-recovery-codes", (event, token: string | null, payload) => {
    const user = requirePermission(event, token, "system:settings");
    return posService.regenerateRecoveryCodes({
      actorUsername: user.username,
      actorPassword: payload?.actorPassword,
    });
  });

  ipcMain.handle("pos:users:list", (event, token?: string | null) => {
    requirePermission(event, token, "people:accounts");
    return posService.listUsers();
  });
  ipcMain.handle("pos:users:create", (event, token: string | null, payload) => {
    const actor = requirePermission(event, token, "people:accounts");
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
      const actor = requirePermission(event, token, "people:accounts");
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
      const actor = requirePermission(event, token, "people:accounts");
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
    const user = requirePermission(event, token, "system:settings");
    return posService.setTableArea(tableId, areaId, user.username);
  });
  ipcMain.handle("pos:tables:set-seats", (event, token: string | null, tableId: number, seats: number) => {
    const user = requirePermission(event, token, "system:settings");
    return posService.setTableSeats(tableId, seats, user.username);
  });
  ipcMain.handle("pos:tables:set-name", (event, token: string | null, tableId: number, name: string) => {
    const user = requirePermission(event, token, "system:settings");
    return posService.setTableName(tableId, name, user.username);
  });
  ipcMain.handle("pos:tables:apply-floor-layout", (event, token: string | null, payload: any) => {
    const user = requirePermission(event, token, "system:settings");
    return posService.applyFloorLayout(payload || {}, user.username);
  });
  ipcMain.handle("pos:seating-areas:list", (event, token?: string | null, includeDisabled?: boolean) => {
    requireSession(event, token);
    return posService.getSeatingAreas(Boolean(includeDisabled));
  });
  ipcMain.handle("pos:seating-areas:save", (event, token: string | null, payload) => {
    const user = requirePermission(event, token, "system:settings");
    return posService.setSeatingAreas(payload, user.username);
  });
  ipcMain.handle(
    "pos:seating-areas:delete",
    (event, token: string | null, areaId: string, reassignToAreaId: string) => {
      const user = requirePermission(event, token, "system:settings");
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
    const user = requirePermission(event, token, "manage:menu");
    return posService.createItem(payload, user.username);
  });
  ipcMain.handle("pos:menu:update-item", (event, token: string | null, payload) => {
    const user = requirePermission(event, token, "manage:menu");
    return posService.updateItem(payload, user.username);
  });
  ipcMain.handle("pos:menu:delete-item", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "manage:menu");
    return posService.deleteItem(id, user.username);
  });
  ipcMain.handle("pos:menu:list-categories", (event, token?: string | null) => {
    requireSession(event, token);
    return posService.getCategories();
  });
  ipcMain.handle("pos:menu:set-categories", (event, token: string | null, categories: string[]) => {
    const user = requirePermission(event, token, "manage:menu");
    return posService.setCategories(categories, user.username);
  });
  ipcMain.handle("pos:menu:list-variant-options", (event, token?: string | null) => {
    requireSession(event, token);
    return posService.getVariantOptions();
  });
  ipcMain.handle(
    "pos:menu:set-variant-options",
    (event, token: string | null, options: string[]) => {
      const user = requirePermission(event, token, "system:settings");
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
    if (
      !roleHasPermission(user.role, "business:history") &&
      (order?.status === "paid" || order?.status === "cancelled")
    ) {
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
    requirePermission(event, token, "business:history");
    return posService.listPaidOrders(opts);
  });
  ipcMain.handle("pos:orders:count-paid", (event, token: string | null, opts) => {
    requirePermission(event, token, "business:history");
    return posService.countPaidOrders(opts);
  });
  ipcMain.handle("pos:orders:summarize-paid", (event, token: string | null, opts) => {
    requirePermission(event, token, "business:history");
    return posService.summarizePaidOrders(opts);
  });
  ipcMain.handle("pos:orders:list-paid-ids", (event, token: string | null, opts) => {
    requirePermission(event, token, "business:history");
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
  ipcMain.handle("pos:orders:mark-bill-printed", (event, token: string | null, orderId: string) => {
    const user = requireSession(event, token);
    return posService.markBillPrinted(orderId, user.username);
  });
  ipcMain.handle("pos:orders:pay", (event, token: string | null, orderId: string, payment) => {
    const user = requireSession(event, token);
    return posService.setOrderPaid(orderId, {
      ...payment,
      receivedBy: user.username,
    });
  });
  ipcMain.handle("pos:orders:cancel", (event, token: string | null, orderId: string, reason: string) => {
    const user = requirePermission(event, token, "order:cancel");
    return posService.cancelOrder(orderId, user.username, reason);
  });
  ipcMain.handle("pos:orders:delete-history", (event, token: string | null, orderIds: string[]) => {
    const user = requirePermission(event, token, "business:history");
    return posService.deleteClosedOrders(orderIds, user.username);
  });
  ipcMain.handle("pos:orders:restore-history", (event, token: string | null, orders) => {
    const user = requirePermission(event, token, "business:history");
    return (orders || []).map((order: any) =>
      posService.restoreOrderSnapshot(order, user.username),
    );
  });

  ipcMain.handle("pos:customers:list", (event, token?: string | null) => {
    requirePermission(event, token, "page:customers");
    return posService.listCustomers();
  });
  ipcMain.handle("pos:customers:create", (event, token: string | null, payload) => {
    requirePermission(event, token, "page:customers");
    return posService.createCustomer(payload);
  });
  ipcMain.handle("pos:customers:update", (event, token: string | null, id: string, updates) => {
    requirePermission(event, token, "page:customers");
    return posService.updateCustomer(id, updates);
  });
  ipcMain.handle("pos:customers:delete", (event, token: string | null, id: string) => {
    requirePermission(event, token, "page:customers");
    return posService.deleteCustomer(id);
  });

  ipcMain.handle(
    "pos:staff:list",
    (event, token?: string | null, opts?: { includeInactive?: boolean; status?: string; includePhotos?: boolean }) => {
      requirePermission(event, token, "people:roster");
      return posService.listStaff(opts as any);
    },
  );
  ipcMain.handle("pos:staff:get", (event, token: string | null, id: string) => {
    requirePermission(event, token, "people:roster");
    return posService.getStaff(id);
  });
  ipcMain.handle("pos:staff:create", (event, token: string | null, payload) => {
    requirePermission(event, token, "people:roster");
    return posService.createStaff(payload);
  });
  ipcMain.handle("pos:staff:update", (event, token: string | null, id: string, updates) => {
    const user = requirePermission(event, token, "people:roster");
    return posService.updateStaff(id, updates, user.username);
  });
  ipcMain.handle("pos:staff:delete", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "people:roster");
    return posService.deleteStaff(id, user.username);
  });

  ipcMain.handle("pos:attendance:list", (event, token: string | null, input) => {
    requirePermission(event, token, "people:attendance");
    return posService.listAttendance(input || {});
  });
  ipcMain.handle("pos:attendance:listRange", (event, token: string | null, input) => {
    requirePermission(event, token, "people:attendance");
    return posService.listAttendanceRange(input || {});
  });
  ipcMain.handle("pos:attendance:upsert", (event, token: string | null, input) => {
    const user = requirePermission(event, token, "people:attendance");
    return posService.upsertAttendanceRows(input || {}, user.username);
  });
  ipcMain.handle("pos:attendance:copy", (event, token: string | null, fromDate: string, toDate: string) => {
    const user = requirePermission(event, token, "people:attendance");
    return posService.copyAttendance(fromDate, toDate, user.username);
  });
  ipcMain.handle("pos:attendance:delete", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "people:attendance");
    return posService.deleteAttendance(id, user.username);
  });

  ipcMain.handle("pos:settings:get", (event, token: string | null, key: string) => {
    const user = requireSession(event, token);
    const settingKey = String(key || "");
    if (!canReadSetting(user.role, settingKey)) {
      throw new Error("forbidden");
    }
    const value = posService.getConfigDoc(settingKey);
    if (settingKey === "config:branding" && value && typeof value === "object") {
      return {
        ...value,
        logoDataUrl: sanitizeLogoDataUrl((value as { logoDataUrl?: unknown }).logoDataUrl),
      };
    }
    return value;
  });
  ipcMain.handle("pos:settings:set", (event, token: string | null, key: string, value) => {
    const user = requirePermission(event, token, "system:settings");
    const settingKey = String(key || "");
    if (!WRITABLE_SETTINGS.has(settingKey)) {
      throw new Error("invalid-setting-key");
    }
    let nextValue = value;
    if (settingKey === "config:branding" && value && typeof value === "object") {
      nextValue = {
        ...value,
        logoDataUrl: sanitizeLogoDataUrl((value as { logoDataUrl?: unknown }).logoDataUrl),
      };
    }
    return posService.setSetting(settingKey, nextValue, user.username);
  });
  ipcMain.handle("pos:settings:prune-audit", (event, token?: string | null) => {
    requirePermission(event, token, "system:settings");
    return posService.pruneAuditLogs();
  });
  ipcMain.handle("pos:settings:prune-history", (event, token?: string | null) => {
    requirePermission(event, token, "system:settings");
    return posService.pruneOrderHistory();
  });

  ipcMain.handle("pos:reports:sales-summary", (event, token: string | null, opts) => {
    requirePermission(event, token, "business:reports");
    return posService.getSalesSummary(opts);
  });
  ipcMain.handle("pos:reports:payment-breakdown", (event, token: string | null, opts) => {
    requirePermission(event, token, "business:reports");
    return posService.getPaymentBreakdown(opts);
  });
  ipcMain.handle("pos:reports:product-sales", (event, token: string | null, opts) => {
    requirePermission(event, token, "business:reports");
    return posService.getProductSalesReport(opts);
  });
  ipcMain.handle("pos:reports:order-history", (event, token: string | null, opts) => {
    requirePermission(event, token, "business:reports");
    return posService.listPaidOrders(opts);
  });
  ipcMain.handle("pos:reports:food-cost-summary", (event, token: string | null, opts) => {
    requirePermission(event, token, "business:reports");
    return posService.getFoodCostSummary(opts);
  });

  ipcMain.handle("pos:grocery:items:list", (event, token: string | null, opts) => {
    requirePermission(event, token, "manage:grocery");
    return posService.listGroceryItems(opts || {});
  });
  ipcMain.handle("pos:grocery:items:create", (event, token: string | null, payload) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.createGroceryItem(payload, user.username);
  });
  ipcMain.handle("pos:grocery:items:update", (event, token: string | null, id: string, updates) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.updateGroceryItem(id, updates, user.username);
  });
  ipcMain.handle("pos:grocery:items:delete", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.deleteGroceryItem(id, user.username);
  });
  ipcMain.handle("pos:grocery:lists:list", (event, token: string | null, opts) => {
    requirePermission(event, token, "manage:grocery");
    return posService.listGroceryLists(opts || {});
  });
  ipcMain.handle("pos:grocery:lists:get", (event, token: string | null, id: string) => {
    requirePermission(event, token, "manage:grocery");
    return posService.getGroceryList(id);
  });
  ipcMain.handle("pos:grocery:lists:create", (event, token: string | null, payload) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.createGroceryList(payload, user.username);
  });
  ipcMain.handle("pos:grocery:lists:update", (event, token: string | null, id: string, updates) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.updateGroceryList(id, updates, user.username);
  });
  ipcMain.handle("pos:grocery:lists:delete", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.deleteGroceryList(id, user.username);
  });
  ipcMain.handle("pos:grocery:purchases:list", (event, token: string | null, opts) => {
    requirePermission(event, token, "manage:grocery");
    return posService.listGroceryPurchases(opts || {});
  });
  ipcMain.handle("pos:grocery:purchases:create", (event, token: string | null, payload) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.createGroceryPurchase(payload, user.username);
  });
  ipcMain.handle(
    "pos:grocery:purchases:update",
    (event, token: string | null, id: string, updates) => {
      const user = requirePermission(event, token, "manage:grocery");
      return posService.updateGroceryPurchase(id, updates, user.username);
    },
  );
  ipcMain.handle("pos:grocery:purchases:delete", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.deleteGroceryPurchase(id, user.username);
  });

  ipcMain.handle("pos:grocery:purchase-headers:list", (event, token: string | null, opts) => {
    requirePermission(event, token, "manage:grocery");
    return posService.listGroceryPurchaseHeaders(opts || {});
  });

  ipcMain.handle("pos:grocery:purchase-headers:void", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.voidGroceryPurchaseHeader(id, user.username);
  });

  ipcMain.handle("pos:vendors:list", (event, token: string | null, opts) => {
    requirePermission(event, token, "manage:grocery");
    return posService.listVendors(opts || {});
  });

  ipcMain.handle("pos:vendors:create", (event, token: string | null, payload) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.createVendor(payload, user.username);
  });

  ipcMain.handle("pos:vendors:update", (event, token: string | null, id: string, updates) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.updateVendor(id, updates, user.username);
  });

  ipcMain.handle("pos:vendors:delete", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.deleteVendor(id, user.username);
  });

  ipcMain.handle("pos:expenses:categories:list", (event, token: string | null, opts) => {
    requirePermission(event, token, "manage:expenses");
    return posService.listExpenseCategories(opts || {});
  });

  ipcMain.handle("pos:expenses:list", (event, token: string | null, opts) => {
    requirePermission(event, token, "manage:expenses");
    return posService.listExpenses(opts || {});
  });

  ipcMain.handle("pos:expenses:create", (event, token: string | null, payload) => {
    const user = requirePermission(event, token, "manage:expenses");
    return posService.createExpense(payload, user.username);
  });

  ipcMain.handle("pos:expenses:update", (event, token: string | null, id: string, updates) => {
    const user = requirePermission(event, token, "manage:expenses");
    return posService.updateExpense(id, updates, user.username);
  });

  ipcMain.handle("pos:expenses:void", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "manage:expenses");
    return posService.voidExpense(id, user.username);
  });

  ipcMain.handle("pos:salary-advances:list", (event, token: string | null, opts) => {
    requirePermission(event, token, "people:advances");
    return posService.listSalaryAdvances(opts || {});
  });

  ipcMain.handle("pos:salary-advances:create", (event, token: string | null, payload) => {
    const user = requirePermission(event, token, "people:advances");
    return posService.createSalaryAdvance(payload, user.username);
  });

  ipcMain.handle("pos:salary-advances:void", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "people:advances");
    return posService.voidSalaryAdvance(id, user.username);
  });

  ipcMain.handle("pos:grocery:templates:list", (event, token: string | null) => {
    requirePermission(event, token, "manage:grocery");
    return posService.listBuyingListTemplates();
  });

  ipcMain.handle("pos:grocery:templates:create", (event, token: string | null, payload) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.createBuyingListTemplate(payload, user.username);
  });

  ipcMain.handle("pos:grocery:templates:delete", (event, token: string | null, id: string) => {
    const user = requirePermission(event, token, "manage:grocery");
    return posService.deleteBuyingListTemplate(id, user.username);
  });

  ipcMain.handle("pos:reports:profitability", (event, token: string | null, opts) => {
    requirePermission(event, token, "business:reports");
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
      const actionName = String(action || "").trim();
      if (!RENDERER_AUDIT_ACTIONS.has(actionName)) {
        throw new Error("invalid-audit-action");
      }
      return posService.createAudit(actionName, orderId, user.username, detail);
    },
  );
  ipcMain.handle("pos:audit:list", (event, token: string | null, opts) => {
    requirePermission(event, token, "system:audit");
    return posService.getAudits(opts);
  });
  ipcMain.handle("pos:audit:count", (event, token: string | null, opts) => {
    requirePermission(event, token, "system:audit");
    return posService.countAudits(opts);
  });
  ipcMain.handle("pos:activity:live", (event, token: string | null, opts) => {
    requirePermission(event, token, "page:tables");
    return posService.getLiveActivity(opts);
  });
  ipcMain.handle("pos:review:summary", (event, token: string | null, opts) => {
    requirePermission(event, token, "manage:review");
    return posService.getReviewSummary(opts || {});
  });
  ipcMain.handle("pos:review:items", (event, token: string | null, opts) => {
    requirePermission(event, token, "manage:review");
    return posService.listReviewItems(opts || {});
  });
  ipcMain.handle("pos:review:staff-activity", (event, token: string | null, opts) => {
    requirePermission(event, token, "manage:review");
    return posService.getStaffActivity(opts || {});
  });
  ipcMain.handle("pos:review:timeline", (event, token: string | null, orderId: string) => {
    requirePermission(event, token, "manage:review");
    return posService.getOrderTimeline(orderId);
  });
  ipcMain.handle(
    "pos:audit-archives:create",
    (event, token: string | null, retentionDays: number) => {
      requirePermission(event, token, "system:audit");
      return posService.createAuditArchive(retentionDays);
    },
  );
  ipcMain.handle("pos:audit-archives:list", (event, token?: string | null) => {
    requirePermission(event, token, "system:audit");
    return posService.listAuditArchives();
  });
  ipcMain.handle("pos:audit-archives:export", (event, token: string | null, id: string) => {
    requirePermission(event, token, "system:audit");
    return posService.exportAuditArchive(id);
  });
  ipcMain.handle("pos:audit-archives:delete", (event, token: string | null, id: string) => {
    requirePermission(event, token, "system:audit");
    return posService.deleteAuditArchive(id);
  });
  ipcMain.handle(
    "pos:audit-archives:cleanup-old",
    (event, token: string | null, ageMonths: number) => {
      requirePermission(event, token, "system:audit");
      return posService.cleanupOldAuditArchives(ageMonths);
    },
  );

  ipcMain.handle("pos:print-queue:add", (event, token: string | null, payload) => {
    requireSession(event, token);
    return posService.addPrintJob(payload);
  });
  ipcMain.handle("pos:print-queue:list", (event, token: string | null, status) => {
    requirePermission(event, token, "system:settings");
    return posService.listPrintJobs(status);
  });
  ipcMain.handle("pos:print-queue:mark-completed", (event, token: string | null, id: string) => {
    requirePermission(event, token, "system:settings");
    return posService.markPrintJobCompleted(id);
  });
  ipcMain.handle("pos:print-queue:retry", (event, token: string | null, id: string) => {
    requirePermission(event, token, "system:settings");
    return posService.retryPrintJob(id);
  });
  ipcMain.handle("pos:print-queue:clear-old", (event, token: string | null, ageHours: number) => {
    requirePermission(event, token, "system:settings");
    return posService.clearOldPrintJobs(ageHours);
  });

  ipcMain.handle("pos:backup:create-local", async (event, token?: string | null) => {
    const user = requirePermission(event, token, "system:settings");
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
    requirePermission(event, token, "system:settings");
    return posService.listBackups();
  });
  ipcMain.handle("pos:backup:restore-local", async (event, token?: string | null) => {
    const user = requirePermission(event, token, "system:settings");
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
    const user = requireSession(event, token);
    const info = updateService.appInfo();
    if (!roleHasPermission(user.role, "system:settings")) {
      return { version: info.version };
    }
    return info;
  });
  ipcMain.handle("pos:updates:check", async (event, token?: string | null) => {
    requirePermission(event, token, "system:settings");
    return updateService.checkForUpdates();
  });
  ipcMain.handle(
    "pos:updates:prepare",
    async (event, token?: string | null, options?: { allowBusinessActivity?: boolean }) => {
      requirePermission(event, token, "system:settings");
      return updateService.prepareUpdate(options || {});
    },
  );
  ipcMain.handle("pos:updates:launch", async (event, token?: string | null) => {
    requirePermission(event, token, "system:settings");
    return updateService.launchPreparedUpdate();
  });
  ipcMain.handle("pos:updates:status", (event, token?: string | null) => {
    requirePermission(event, token, "system:settings");
    return updateService.getStatus();
  });
  ipcMain.handle("pos:updates:startup-health", (event, token?: string | null) => {
    requirePermission(event, token, "system:settings");
    return updateService.processStartupState();
  });
  ipcMain.handle(
    "pos:updates:rollback",
    async (event, token?: string | null, options?: { confirmed?: boolean }) => {
      requirePermission(event, token, "system:settings");
      return updateService.rollbackLast(options || {});
    },
  );
  ipcMain.handle("pos:support:export-diagnostics", (event, token?: string | null) => {
    requirePermission(event, token, "system:settings");
    return updateService.exportDiagnostics();
  });

  ipcMain.handle("pos:gateway:status", (event, token?: string | null) => {
    requireSession(event, token);
    return getGatewayStatus();
  });
  ipcMain.handle("pos:gateway:start", async (event, token?: string | null) => {
    requirePermission(event, token, "system:settings");
    return startLocalGateway();
  });
  ipcMain.handle("pos:gateway:stop", async (event, token?: string | null) => {
    requirePermission(event, token, "system:settings");
    return stopLocalGateway();
  });
  ipcMain.handle("pos:gateway:rotate-pairing", (event, token?: string | null) => {
    requirePermission(event, token, "system:settings");
    const pairingCode = rotateGatewayPairingCode();
    return { ...getGatewayStatus(), pairingCode };
  });
}
