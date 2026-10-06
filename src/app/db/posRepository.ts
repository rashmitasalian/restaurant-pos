import type {
  AuditDto,
  AttendanceDto,
  AttendanceStatus,
  ConfigDto,
  FoodCostSummaryDto,
  GstConfigDto,
  GroceryItemDto,
  GroceryListDto,
  GroceryPurchaseDto,
  GroceryPurchaseAnalysisDto,
  GroceryPurchaseHeaderCreateInput,
  GroceryPurchaseHeaderUpdateInput,
  GroceryListLinesChange,
  GroceryPurchaseLineDto,
  MenuItemDto,
  OrderDto,
  OrderLineDto,
  OrderStatus,
  PaidOrderQueryDto,
  PaidOrdersSummaryDto,
  PaymentDto,
  ProductSalesReportDto,
  Role,
  SeatingAreaDto,
  StaffDto,
  TableDto,
  PrintJobDto,
  UserDto,
} from "../../shared/pos";
import { DEFAULT_GST_CONFIG, normalizeGstConfig, type GstConfig } from "../../shared/gst";
import { clipAttendanceQueryRange, todayDateOnly } from "../../shared/validation";
import { kotSentLinesNeedPrint } from "../../shared/kot";
import type {
  OrderTimelineEventDto,
  ReviewItemDto,
  ReviewRangeQuery,
  ReviewSummaryDto,
  StaffActivityRowDto,
} from "../../shared/ownerReview";
import {
  SERVICE_MODE_CONFIG_KEY,
  normalizeServiceModes,
  type ServiceMode,
} from "../../shared/serviceModes";

export type TableDoc = TableDto;
export type SeatingAreaDoc = SeatingAreaDto;
export type OrderLine = OrderLineDto;
export type OrderDoc = OrderDto;
export type ItemDoc = MenuItemDto;
export type UserDoc = UserDto;
export type StaffDoc = StaffDto;
export type AttendanceDoc = AttendanceDto;
export type AuditDoc = AuditDto;
export type PrintJobDoc = PrintJobDto;
export type GroceryItemDoc = GroceryItemDto;
export type GroceryListDoc = GroceryListDto;
export type GroceryPurchaseLineDoc = GroceryPurchaseLineDto;

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_DURATION = 900_000;

function api() {
  if (!window.pos) {
    throw new Error("pos-api-unavailable");
  }
  return window.pos;
}

function reviewApi() {
  const review = api().review;
  if (!review?.summary || !review.items || !review.staffActivity || !review.timeline) {
    throw new Error("pos-review-api-unavailable");
  }
  return review;
}

function staffApi() {
  const staff = api().staff;
  if (!staff?.list || !staff.create || !staff.update || !staff.delete) {
    throw new Error("pos-staff-api-unavailable");
  }
  return staff;
}

export async function ensureIndexes() {
  await api().db?.ready();
}

export function startPeriodicCompaction() {
  return undefined;
}

export function stopPeriodicCompaction() {
  return undefined;
}

export async function seedTables(count = 12) {
  return api().tables!.seed(count);
}

export async function getTables(): Promise<TableDoc[]> {
  return api().tables!.list();
}

export async function getTablesSnapshot(): Promise<{
  areas: SeatingAreaDoc[];
  tables: Array<
    TableDoc & {
      status?: string;
      count?: number;
      total?: number;
      occupied?: boolean;
      orderId?: string | null;
      openedAt?: number | null;
      unsentCount?: number;
      sentCount?: number;
    }
  >;
  byArea: Record<
    string,
    Array<
      TableDoc & {
        status?: string;
        count?: number;
        total?: number;
        occupied?: boolean;
        orderId?: string | null;
        openedAt?: number | null;
        unsentCount?: number;
        sentCount?: number;
      }
    >
  >;
}> {
  return api().tables!.snapshot();
}

export async function setTableArea(tableId: number, areaId: string): Promise<TableDoc | null> {
  return api().tables!.setArea(tableId, areaId);
}

export async function setTableSeats(tableId: number, seats: number): Promise<TableDoc | null> {
  return api().tables!.setSeats(tableId, seats);
}

export async function setTableName(tableId: number, name: string): Promise<TableDoc | null> {
  return api().tables!.setName(tableId, name);
}

export async function applyFloorLayout(payload: {
  areas: Array<{
    id?: string;
    name?: string;
    active?: boolean;
    order?: number;
    tableCount?: number;
    namingMode?: "number" | "prefix";
    prefix?: string;
    defaultSeats?: number;
  }>;
  tableOverrides?: Array<{
    areaId?: string;
    plannedName?: string;
    name?: string;
    seats?: number;
  }>;
}): Promise<{
  areas: SeatingAreaDoc[];
  tables: TableDoc[];
  tableCount: number;
}> {
  return api().tables!.applyFloorLayout(payload);
}

export async function getSeatingAreas(includeDisabled = true): Promise<SeatingAreaDoc[]> {
  return api().seatingAreas!.list(includeDisabled);
}

export async function saveSeatingAreas(
  areas: Array<{ id?: string; name?: string; active?: boolean; order?: number }>,
): Promise<SeatingAreaDoc[]> {
  return api().seatingAreas!.save(areas);
}

export async function deleteSeatingArea(areaId: string, reassignToAreaId: string) {
  return api().seatingAreas!.delete(areaId, reassignToAreaId);
}

export async function createOrderForTable(tableId: number | null): Promise<OrderDoc> {
  return api().orders!.create({ tableId, orderType: tableId !== null ? "table" : "takeaway" });
}

export async function createOrder(input: {
  tableId?: number | null;
  orderType?: string;
  serviceModeId?: string;
  customerId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<OrderDoc> {
  return api().orders!.create(input);
}

export async function getOpenOrderForTable(tableId: number): Promise<OrderDoc | null> {
  return api().orders!.getOpenForTable(tableId);
}

export async function getOpenOrders(): Promise<OrderDoc[]> {
  return api().orders!.listOpen();
}

export async function getActiveOrders(): Promise<OrderDoc[]> {
  return api().orders!.listActive();
}

export async function getOrderById(id: string): Promise<OrderDoc | null> {
  return api().orders!.get(id);
}

export async function getOrCreateOrderForTable(tableId: number) {
  return api().orders!.getOrCreateForTable(tableId);
}

export async function addItemToOrder(
  orderId: string,
  item: {
    name: string;
    qty: number;
    rate: number;
    menuItemId?: string | null;
    categoryName?: string | null;
  },
) {
  return api().orders!.addLine(orderId, item);
}

export async function updateOrder(order: OrderDoc) {
  return api().orders!.updateLines(order._id, order.items || []);
}

export async function updateOrderLines(orderId: string, lines: OrderLineDto[]) {
  return api().orders!.updateLines(orderId, lines);
}

export async function setOrderDiscount(
  orderId: string,
  discount: number | { mode?: "percent" | "amount"; percent?: number; amount?: number },
) {
  return api().orders!.setDiscount(orderId, discount);
}

export async function setOrderStatus(
  orderId: string,
  status: Extract<OrderStatus, "open" | "held" | "ready" | "assigned">,
  payload?: { meta?: Record<string, unknown> | null },
) {
  return api().orders!.setStatus(orderId, status, payload);
}

export async function markOrderKotPrinted(orderId: string) {
  return api().orders!.markKotPrinted(orderId);
}

export async function markOrderBillPrinted(orderId: string) {
  return api().orders!.markBillPrinted(orderId);
}

export async function markOrderKotSent(
  orderId: string,
  sentLines?: Array<{ id: string; sentQty: number }>,
  options?: { clearPendingKotVoidIds?: string[] },
) {
  return api().orders!.markKotSent(orderId, sentLines, options);
}

export async function markOrderKotFailed(orderId: string, error?: string | null) {
  return api().orders!.markKotFailed(orderId, error || null);
}

export async function voidOrderKotLine(
  orderId: string,
  payload: {
    lineId: string;
    finalQty: number;
    reason: string;
    replacement?: {
      name: string;
      qty: number;
      rate: number;
      menuItemId?: string | null;
      categoryName?: string | null;
      kitchenNote?: string | null;
    } | null;
  },
) {
  return api().orders!.voidKotLine(orderId, payload);
}

export async function markOrderKotDone(orderId: string) {
  return api().orders!.markKotDone(orderId);
}

export async function setOrderPaid(orderId: string, payment: PaymentDto) {
  return api().orders!.pay(orderId, payment);
}

export async function nextKotSeq(): Promise<number> {
  return api().orders!.nextKotSeq();
}

export async function cancelOrder(orderId: string, reason: string) {
  return api().orders!.cancel(orderId, reason);
}

export async function listPaidOrders(opts?: PaidOrderQueryDto): Promise<OrderDoc[]> {
  return api().orders!.listPaid(opts);
}

export async function countPaidOrders(opts?: PaidOrderQueryDto): Promise<number> {
  return api().orders!.countPaid(opts);
}

export async function summarizePaidOrders(opts?: PaidOrderQueryDto): Promise<PaidOrdersSummaryDto> {
  return api().orders!.summarizePaid(opts);
}

export async function listPaidOrderIds(opts?: PaidOrderQueryDto): Promise<string[]> {
  return api().orders!.listPaidIds(opts);
}

export async function deleteOrderHistory(
  orderIds: string[],
): Promise<{ ok: boolean; deleted: number }> {
  return api().orders!.deleteHistory(orderIds);
}

export async function restoreOrderHistory(orders: OrderDoc[]): Promise<OrderDoc[]> {
  return api().orders!.restoreHistory(orders);
}

export async function seedItems() {
  return api().menu!.seed();
}

export async function getItems(): Promise<ItemDoc[]> {
  return api().menu!.listItems();
}

export async function getItemById(id: string): Promise<ItemDoc | null> {
  return api().menu!.getItem(id);
}

export async function createItem(item: {
  sku?: string;
  name: string;
  price: number;
  category?: string;
  available?: boolean;
  favorite?: boolean;
  diet?: "veg" | "non-veg" | "egg" | null;
  variants?: Array<{ id?: string; name: string; price: number; sortOrder?: number }>;
}) {
  return api().menu!.createItem(item);
}

export async function updateItem(item: ItemDoc) {
  return api().menu!.updateItem(item);
}

export async function deleteItem(id: string): Promise<void> {
  await api().menu!.deleteItem(id);
}

export async function reorderItems(ids: string[]) {
  return api().menu!.reorderItems(ids);
}

export async function importMenu(payload: {
  csv: string;
  fileName?: string;
  mode?: "upsert" | "replace";
}) {
  return api().menu!.importMenu!(payload);
}

export async function listStaff(opts?: {
  includeInactive?: boolean;
  status?: "active" | "left" | "all";
  includePhotos?: boolean;
}): Promise<StaffDoc[]> {
  return staffApi().list(opts);
}

export async function getStaff(id: string): Promise<StaffDoc | null> {
  const staff = api().staff;
  if (staff?.get) {
    return staff.get(id);
  }
  const rows = await listStaff({ status: "all", includePhotos: true });
  return rows.find((member) => member.id === id) || null;
}

export async function createStaff(staff: {
  name: string;
  phone: string;
  designation?: string | null;
  joiningDate?: string | null;
  salary?: number | string | null;
  address?: string | null;
  notes?: string | null;
  photoMime?: string | null;
  photoBase64?: string | null;
  weeklyOffDays?: number[] | null;
  defaultShiftId?: string | null;
}): Promise<StaffDoc> {
  return staffApi().create(staff);
}

export async function updateStaff(
  id: string,
  updates: Partial<StaffDoc>,
): Promise<StaffDoc | null> {
  return staffApi().update(id, updates);
}

export async function deleteStaff(id: string): Promise<void> {
  await staffApi().delete(id);
}

function attendanceApi() {
  const attendance = api().attendance;
  if (!attendance?.list || !attendance?.upsert || !attendance?.copy || !attendance?.delete) {
    throw new Error("pos-attendance-api-unavailable");
  }
  return attendance;
}

export async function listAttendance(input: {
  date?: string;
  fromDate?: string;
  toDate?: string;
  shiftId?: string | null;
  status?: AttendanceStatus | null;
  search?: string;
}): Promise<AttendanceDoc[]> {
  return attendanceApi().list(input);
}

function enumerateDateRange(fromDate: string, toDate: string) {
  const days: string[] = [];
  const [fromY, fromM, fromD] = fromDate.split("-").map((part) => Number(part));
  const [toY, toM, toD] = toDate.split("-").map((part) => Number(part));
  const cursor = new Date(fromY, fromM - 1, fromD);
  const end = new Date(toY, toM - 1, toD);
  while (cursor <= end) {
    days.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`,
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export async function listAttendanceRange(input: {
  fromDate: string;
  toDate: string;
  shiftId?: string | null;
  search?: string;
}): Promise<AttendanceDoc[]> {
  const clipped = clipAttendanceQueryRange(input.fromDate, input.toDate);
  if (clipped.empty) {
    return [];
  }
  const query = { ...input, fromDate: clipped.fromDate, toDate: clipped.toDate };
  const attendance = attendanceApi();
  try {
    const ranged = await attendance.list({
      fromDate: query.fromDate,
      toDate: query.toDate,
      shiftId: query.shiftId,
      search: query.search,
    });
    if (Array.isArray(ranged)) {
      return ranged;
    }
  } catch {
    // Older main process — fall through.
  }
  if (attendance.listRange) {
    try {
      return await attendance.listRange(query);
    } catch {
      // Fall through to per-day fallback.
    }
  }
  const today = todayDateOnly();
  const days = enumerateDateRange(query.fromDate, query.toDate).filter((date) => date <= today);
  const rows: AttendanceDoc[] = [];
  for (const date of days) {
    const dayRows = await listAttendance({
      date,
      shiftId: query.shiftId,
      search: query.search,
    });
    rows.push(...dayRows);
  }
  return rows;
}

export async function upsertAttendanceRows(input: {
  attendanceDate: string;
  rows: Array<{
    id?: string;
    staffId: string;
    shiftId?: string | null;
    status: AttendanceStatus;
    isLate?: boolean;
    checkInTime?: string | null;
    checkOutTime?: string | null;
    breakMinutes?: number;
    overtimeMinutes?: number | null;
    remarks?: string | null;
  }>;
}): Promise<AttendanceDoc[]> {
  return attendanceApi().upsert(input);
}

export async function copyAttendance(fromDate: string, toDate: string): Promise<AttendanceDoc[]> {
  return attendanceApi().copy(fromDate, toDate);
}

export async function deleteAttendance(id: string): Promise<{ ok: boolean }> {
  return attendanceApi().delete(id);
}

export async function createUser(
  username: string,
  password: string,
  role: Role = "cashier",
  displayName?: string,
  requirePasswordChange = false,
  actorUsername?: string | null,
  actorPassword?: string | null,
  staffId?: string | null,
): Promise<UserDoc> {
  return api().users!.create({
    username,
    password,
    role,
    displayName,
    requirePasswordChange,
    actorUsername,
    actorPassword,
    staffId,
  });
}

export async function createFirstAdmin(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ user: UserDoc; recoveryCodes: string[] }> {
  return api().auth!.createFirstAdmin(input);
}

export async function hasUsers(): Promise<boolean> {
  return Boolean(await api().auth!.hasUsers());
}

export async function getUserByUsername(username: string): Promise<UserDoc | null> {
  return api().auth!.refreshUser(username);
}

export async function verifyUser(
  username: string,
  password: string,
): Promise<{
  ok: boolean;
  user?: UserDoc;
  reason?: "not-found" | "inactive" | "wrong-password" | "locked";
}> {
  const res = await api().auth!.login(username, password);
  if (res.ok) {
    return { ok: true, user: res.user };
  }
  const reason =
    res.reason === "inactive" ? "inactive" : res.reason === "locked" ? "locked" : "wrong-password";
  return { ok: false, reason };
}

export async function listUsers(): Promise<UserDoc[]> {
  return api().users!.list();
}

export async function updateUser(
  username: string,
  updates: Partial<Pick<UserDoc, "displayName" | "role" | "active">>,
  actorUsername?: string | null,
  actorPassword?: string | null,
): Promise<UserDoc> {
  return api().users!.update(username, updates, actorUsername, actorPassword);
}

export async function setUserPassword(
  username: string,
  newPassword: string,
  actorUsername?: string | null,
  actorPassword?: string | null,
): Promise<void> {
  await api().users!.resetPassword(username, newPassword, actorUsername, actorPassword);
}

export async function recoverLastAdmin(input: {
  username: string;
  recoveryCode: string;
  newPassword: string;
}): Promise<{ ok: boolean; reason?: string; lockedSeconds?: number }> {
  return api().auth!.recoverLastAdmin(input);
}

export async function getRecoveryStatus(): Promise<any> {
  return api().auth!.recoveryStatus();
}

export async function regenerateRecoveryCodes(input: {
  actorUsername: string;
  actorPassword: string;
}): Promise<{ recoveryCodes: string[] }> {
  return api().auth!.regenerateRecoveryCodes(input);
}

export async function createSqliteBackup(): Promise<any> {
  return api().backupSqlite!.createLocal();
}

export async function restoreSqliteBackup(): Promise<any> {
  return api().backupSqlite!.restoreLocal();
}

export async function listSqliteBackups(): Promise<any[]> {
  return api().backupSqlite!.list();
}

export async function getBackupStatus(): Promise<any> {
  return api().backupSqlite!.status();
}

export async function createManagedBackup(): Promise<any> {
  return api().backupSqlite!.create();
}

export async function getBackupHistory(): Promise<any> {
  return api().backupSqlite!.history();
}

export async function restoreManagedBackup(backupId: string): Promise<any> {
  return api().backupSqlite!.restore(backupId);
}

export async function activateCloudBackup(): Promise<any> {
  return api().backupSqlite!.activateCloud();
}

export async function recoverCloudBackup(payload: {
  restaurantCode: string;
  recoveryKey: string;
}): Promise<any> {
  return api().backupSqlite!.recoverCloud(payload);
}

export async function listCloudBackups(): Promise<any> {
  return api().backupSqlite!.listCloud();
}

export async function restoreCloudBackup(backupId: string): Promise<any> {
  return api().backupSqlite!.restoreCloud(backupId);
}

export async function exportRecoveryKeyFile(recoveryKey: string): Promise<any> {
  return api().backupSqlite!.exportRecoveryKey(recoveryKey);
}

export async function relaunchAfterBackupRestore(): Promise<any> {
  return api().backupSqlite!.relaunch();
}

export async function getAppInfo(): Promise<any> {
  return api().app!.info();
}

export async function checkForUpdates(): Promise<any> {
  return api().updates!.check();
}

export async function prepareUpdate(options?: { allowBusinessActivity?: boolean }): Promise<any> {
  return api().updates!.prepare(options);
}

export async function launchPreparedUpdate(): Promise<any> {
  return api().updates!.launch();
}

export async function getUpdateStatus(): Promise<any> {
  return api().updates!.status();
}

export async function rollbackLastUpdate(options?: { confirmed?: boolean }): Promise<any> {
  return api().updates!.rollback(options);
}

export async function exportDiagnostics(): Promise<any> {
  return api().support!.exportDiagnostics();
}

export async function getSalesFacts(opts?: {
  from?: number;
  to?: number;
}): Promise<import("../../shared/pos").SalesFactsDto> {
  return api().reports!.salesFacts!(opts);
}

export async function getSalesSummary(opts?: { from?: number; to?: number }): Promise<{
  total: number;
  subtotal?: number;
  taxTotal?: number;
  discountTotal?: number;
  orders: number;
  payments: number;
}> {
  return api().reports!.salesSummary(opts);
}

export async function getPaymentBreakdown(opts?: {
  from?: number;
  to?: number;
}): Promise<Record<string, number>> {
  return api().reports!.paymentBreakdown(opts);
}

export async function getProductSalesReport(opts?: {
  from?: number;
  to?: number;
}): Promise<ProductSalesReportDto> {
  return api().reports!.productSales(opts);
}

export async function getFoodCostSummary(opts?: {
  from?: number;
  to?: number;
}): Promise<FoodCostSummaryDto> {
  return api().reports!.foodCostSummary(opts);
}

export async function getProfitabilitySummary(opts?: {
  from?: number;
  to?: number;
}): Promise<import("../../shared/pos").ProfitabilitySummaryDto> {
  return api().reports!.profitability(opts);
}

export async function getGroceryPurchaseAnalysis(opts?: {
  from?: number;
  to?: number;
}): Promise<GroceryPurchaseAnalysisDto> {
  return api().reports!.groceryPurchases(opts);
}

function groceryApi() {
  const grocery = api().grocery;
  if (!grocery) {
    throw new Error("pos-grocery-api-unavailable");
  }
  return grocery;
}

export async function listGroceryItems(opts?: {
  includeInactive?: boolean;
}): Promise<GroceryItemDoc[]> {
  return groceryApi().listItems(opts);
}

export async function createGroceryItem(input: {
  name: string;
  category?: string | null;
  defaultUnit: GroceryItemDoc["defaultUnit"];
  defaultQuantity: number;
  vendorHint?: string | null;
}): Promise<GroceryItemDoc> {
  return groceryApi().createItem(input);
}

export async function updateGroceryItem(
  id: string,
  updates: Partial<GroceryItemDoc>,
): Promise<GroceryItemDoc> {
  return groceryApi().updateItem(id, updates);
}

export async function deleteGroceryItem(id: string): Promise<{ ok: boolean }> {
  return groceryApi().deleteItem(id);
}

export async function listGroceryLists(opts?: {
  from?: number;
  to?: number;
  limit?: number;
}): Promise<GroceryListDoc[]> {
  return groceryApi().listLists(opts);
}

export async function getGroceryList(id: string): Promise<GroceryListDoc | null> {
  return groceryApi().getList(id);
}

export async function createGroceryList(input: {
  title?: string;
  listDate?: number;
  listType?: GroceryListDoc["listType"];
  notes?: string | null;
  lines?: Partial<GroceryListDoc["lines"][number]>[];
  templateId?: string;
  sourceListId?: string;
}): Promise<GroceryListDoc> {
  return groceryApi().createList(input);
}

export async function updateGroceryList(
  id: string,
  updates: Partial<
    Pick<GroceryListDoc, "title" | "listDate" | "listType" | "notes" | "status" | "lines">
  > & { recordPrint?: boolean },
): Promise<GroceryListDoc> {
  return groceryApi().updateList(id, updates);
}

export async function changeGroceryListLines(
  id: string,
  change: GroceryListLinesChange,
): Promise<GroceryListDoc> {
  return groceryApi().changeListLines(id, change);
}

export async function deleteGroceryList(id: string): Promise<{ ok: boolean }> {
  return groceryApi().deleteList(id);
}

export async function listGroceryPurchases(opts?: {
  from?: number;
  to?: number;
  listId?: string;
  itemId?: string;
  search?: string;
  limit?: number | null;
  offset?: number;
}): Promise<GroceryPurchaseLineDoc[]> {
  return groceryApi().listPurchases(opts);
}

export async function createGroceryPurchase(
  input: Partial<GroceryPurchaseLineDoc>,
): Promise<GroceryPurchaseLineDoc> {
  return groceryApi().createPurchase(input);
}

export async function updateGroceryPurchase(
  id: string,
  updates: Partial<GroceryPurchaseLineDoc>,
): Promise<GroceryPurchaseLineDoc> {
  return groceryApi().updatePurchase(id, updates);
}

export async function deleteGroceryPurchase(id: string): Promise<{ ok: boolean }> {
  return groceryApi().deletePurchase(id);
}

export async function listGroceryPurchaseHeaders(opts?: {
  from?: number;
  to?: number;
  listId?: string;
  vendorId?: string;
  includeVoided?: boolean;
  limit?: number;
  offset?: number;
}): Promise<GroceryPurchaseDto[]> {
  return groceryApi().listPurchaseHeaders(opts);
}

export async function createGroceryPurchaseHeader(input: GroceryPurchaseHeaderCreateInput) {
  return groceryApi().createPurchaseHeader(input) as Promise<GroceryPurchaseDto>;
}

export async function updateGroceryPurchaseHeader(
  id: string,
  updates: GroceryPurchaseHeaderUpdateInput,
) {
  return groceryApi().updatePurchaseHeader(id, updates) as Promise<GroceryPurchaseDto>;
}

export async function voidGroceryPurchaseHeader(id: string) {
  return groceryApi().voidPurchaseHeader(id);
}

export async function listBuyingListTemplates() {
  return groceryApi().listTemplates();
}

export async function createBuyingListTemplate(input: {
  name: string;
  description?: string | null;
  lines?: any[];
  sourceListId?: string;
}) {
  return groceryApi().createTemplate(input);
}

export async function deleteBuyingListTemplate(id: string) {
  return groceryApi().deleteTemplate(id);
}

function vendorsApi() {
  const vendors = api().vendors;
  if (!vendors) {
    throw new Error("pos-vendors-api-unavailable");
  }
  return vendors;
}

export async function listVendors(opts?: { includeInactive?: boolean; search?: string }) {
  return vendorsApi().list(opts);
}

export async function createVendor(input: {
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
  notes?: string | null;
}) {
  return vendorsApi().create(input);
}

export async function updateVendor(id: string, updates: Record<string, unknown>) {
  return vendorsApi().update(id, updates);
}

export async function deleteVendor(id: string) {
  return vendorsApi().delete(id);
}

function expensesApi() {
  const expenses = api().expenses;
  if (!expenses) {
    throw new Error("pos-expenses-api-unavailable");
  }
  return expenses;
}

export async function listExpenseCategories(opts?: { includeInactive?: boolean }) {
  return expensesApi().listCategories(opts);
}

export async function listExpenses(opts?: {
  from?: number;
  to?: number;
  categoryId?: string;
  limit?: number;
  offset?: number;
}) {
  return expensesApi().list(opts);
}

export async function createExpense(input: {
  categoryId: string;
  amount: number;
  expenseDate?: number;
  vendorId?: string | null;
  description?: string | null;
  paymentMethod?: string | null;
  invoiceNumber?: string | null;
}) {
  return expensesApi().create(input);
}

export async function updateExpense(id: string, updates: Record<string, unknown>) {
  return expensesApi().update(id, updates);
}

export async function voidExpense(id: string) {
  return expensesApi().void(id);
}

function salaryAdvancesApi() {
  const salaryAdvances = api().salaryAdvances;
  if (!salaryAdvances) {
    throw new Error("pos-salary-advances-api-unavailable");
  }
  return salaryAdvances;
}

export async function listSalaryAdvances(opts?: {
  from?: number;
  to?: number;
  staffId?: string;
  limit?: number;
  offset?: number;
}) {
  return salaryAdvancesApi().list(opts);
}

export async function createSalaryAdvance(input: {
  staffId: string;
  amount: number;
  advanceDate?: number;
  note?: string | null;
}) {
  return salaryAdvancesApi().create(input);
}

export async function voidSalaryAdvance(id: string) {
  return salaryAdvancesApi().void(id);
}

export type ConfigGstDoc = GstConfigDto;

export async function getConfigGst(): Promise<ConfigGstDoc> {
  const cfg = await api().settings!.get("config:gst");
  return {
    _id: "config:gst",
    type: "config",
    ...normalizeGstConfig((cfg as Partial<GstConfig>) || DEFAULT_GST_CONFIG),
    updatedAt: cfg?.updatedAt,
  } as ConfigGstDoc;
}

export async function setConfigGst(cfg: Partial<GstConfig>): Promise<ConfigGstDoc> {
  const saved = await api().settings!.set("config:gst", normalizeGstConfig(cfg));
  return {
    _id: "config:gst",
    type: "config",
    ...normalizeGstConfig(saved as Partial<GstConfig>),
    updatedAt: saved?.updatedAt,
  } as ConfigGstDoc;
}

export type ConfigPrintersDoc = ConfigDto & {
  counterPrinterIp?: string;
  kitchenPrinterIp?: string;
  printerPort?: number;
  updatedAt?: number;
};

export async function getConfigPrinters(): Promise<ConfigPrintersDoc | null> {
  return api().settings!.get("config:printers");
}

export async function setConfigPrinters(cfg: {
  counterPrinterIp?: string;
  kitchenPrinterIp?: string;
  printerPort?: number;
}) {
  return api().settings!.set("config:printers", cfg);
}

export type ConfigBrandingDoc = ConfigDto & {
  hotelName: string;
  hotelInitials: string;
  tagline?: string;
  phone?: string;
  email?: string;
  logoDataUrl?: string | null;
  receiptLogoRaster?: {
    width: number;
    height: number;
    dataBase64: string;
  } | null;
  logoUpdatedAt?: number;
  receiptQr?: {
    mode?: "off" | "feedback" | "pay";
    feedbackUrl?: string;
    upiId?: string;
    payeeName?: string;
    includeAmount?: boolean;
    note?: string;
  };
  updatedAt?: number;
};

export async function getConfigBranding(): Promise<ConfigBrandingDoc> {
  return (
    (await api().settings!.get("config:branding")) || {
      _id: "config:branding",
      type: "config",
      hotelName: "",
      hotelInitials: "",
      tagline: "POINT OF SALE",
      phone: "",
      email: "",
      logoDataUrl: null,
      receiptLogoRaster: null,
      logoUpdatedAt: 0,
      receiptQr: { mode: "off" },
    }
  );
}

export async function setConfigBranding(cfg: {
  hotelName?: string;
  hotelInitials?: string;
  tagline?: string;
  phone?: string;
  email?: string;
  logoDataUrl?: string | null;
  receiptLogoRaster?: {
    width: number;
    height: number;
    dataBase64: string;
  } | null;
  logoUpdatedAt?: number;
  receiptQr?: {
    mode?: "off" | "feedback" | "pay";
    feedbackUrl?: string;
    upiId?: string;
    payeeName?: string;
    includeAmount?: boolean;
    note?: string;
  };
}) {
  return api().settings!.set("config:branding", cfg);
}

export type ConfigTablesDoc = ConfigDto & {
  _id: "config:tables";
  tableCount: number;
  defaultSeats?: number;
  layout?: Array<{
    id: string;
    tableCount: number;
    namingMode?: "number" | "prefix";
    prefix?: string;
    defaultSeats?: number;
  }>;
  updatedAt: number;
};

export type ConfigServiceModesDoc = ConfigDto & {
  _id: "config:service-modes";
  modes: ServiceMode[];
  updatedAt?: number;
};

export async function getConfigTables(): Promise<ConfigTablesDoc | null> {
  return api().settings!.get("config:tables");
}

export async function getConfigServiceModes(): Promise<ConfigServiceModesDoc> {
  const cfg = await api().settings!.get(SERVICE_MODE_CONFIG_KEY);
  return {
    _id: SERVICE_MODE_CONFIG_KEY,
    type: "config",
    modes: normalizeServiceModes(cfg),
    updatedAt: Number((cfg as any)?.updatedAt || 0) || undefined,
  } as ConfigServiceModesDoc;
}

export async function setConfigServiceModes(modes: ServiceMode[]): Promise<ConfigServiceModesDoc> {
  const saved = await api().settings!.set(SERVICE_MODE_CONFIG_KEY, { modes });
  return {
    _id: SERVICE_MODE_CONFIG_KEY,
    type: "config",
    modes: normalizeServiceModes(saved),
    updatedAt: Number((saved as any)?.updatedAt || 0) || undefined,
  } as ConfigServiceModesDoc;
}

export async function getEnabledServiceModes(): Promise<ServiceMode[]> {
  const cfg = await getConfigServiceModes();
  return (cfg.modes || []).filter((mode) => mode.enabled);
}

export async function setConfigTables(
  tableCount: number,
  defaultSeats = 4,
): Promise<ConfigTablesDoc> {
  const seats = Math.max(1, Math.min(50, Math.trunc(Number(defaultSeats) || 4)));
  return api().settings!.set("config:tables", { tableCount, defaultSeats: seats });
}

export async function getConfiguredTableCount(): Promise<number> {
  return api().tables!.configuredCount();
}

export type ConfigCategoriesDoc = ConfigDto & {
  _id: "config:categories";
  categories: string[];
  updatedAt: number;
};

export async function getConfigCategories(): Promise<string[]> {
  return api().menu!.listCategories();
}

export async function setConfigCategories(categories: string[]): Promise<void> {
  await api().menu!.setCategories(categories);
}

export async function getConfigMenuVariantOptions(): Promise<string[]> {
  return api().menu!.listVariantOptions();
}

export async function setConfigMenuVariantOptions(options: string[]): Promise<void> {
  await api().menu!.setVariantOptions(options);
}

export type ConfigAuditDoc = ConfigDto & {
  retentionDays: number | null;
  updatedAt?: number;
};

export async function getConfigAudit(): Promise<{ retentionDays: number | null }> {
  const cfg = await api().settings!.get("config:audit");
  return { retentionDays: cfg?.retentionDays === undefined ? 90 : cfg.retentionDays };
}

export async function setConfigAudit(cfg: { retentionDays: number | null }): Promise<void> {
  await api().settings!.set("config:audit", cfg);
}

export async function pruneAuditLogs(): Promise<number> {
  return api().settings!.pruneAudit();
}

export type ConfigHistoryDoc = ConfigDto & {
  retentionDays: number | null;
  updatedAt?: number;
};

export async function getConfigHistory(): Promise<{ retentionDays: number | null }> {
  const cfg = await api().settings!.get("config:history");
  return { retentionDays: cfg?.retentionDays === undefined ? null : cfg.retentionDays };
}

export async function setConfigHistory(cfg: { retentionDays: number | null }): Promise<void> {
  await api().settings!.set("config:history", cfg);
}

export type AttendanceShiftConfig = {
  id: string;
  label: string;
  hours: number;
};

export type AttendanceConfig = {
  shifts: AttendanceShiftConfig[];
  holidays: string[];
};

export async function getAttendanceConfig(): Promise<AttendanceConfig> {
  const cfg = await api().settings!.get("config:attendance");
  const shifts = Array.isArray((cfg as any)?.shifts) ? (cfg as any).shifts : [];
  const holidays = Array.isArray((cfg as any)?.holidays) ? (cfg as any).holidays : [];
  return {
    shifts: shifts
      .map((entry: any) => ({
        id: String(entry?.id || "")
          .trim()
          .toLowerCase(),
        label: String(entry?.label || "").trim(),
        hours: Number(entry?.hours || 0),
      }))
      .filter(
        (entry: AttendanceShiftConfig) =>
          entry.id &&
          entry.label &&
          entry.id !== "half-day" &&
          entry.id !== "half" &&
          entry.hours > 0,
      ),
    holidays: holidays.map((entry: unknown) => String(entry || "").trim()).filter(Boolean),
  };
}

export async function getConfigShifts(): Promise<AttendanceShiftConfig[]> {
  const config = await getAttendanceConfig();
  return config.shifts;
}

export async function getConfigHolidays(): Promise<string[]> {
  const config = await getAttendanceConfig();
  return config.holidays;
}

export async function setAttendanceConfig(config: AttendanceConfig): Promise<void> {
  await api().settings!.set("config:attendance", config);
}

export async function setConfigShifts(shifts: AttendanceShiftConfig[]): Promise<void> {
  const current = await getAttendanceConfig();
  await setAttendanceConfig({ ...current, shifts });
}

export async function setConfigHolidays(holidays: string[]): Promise<void> {
  const current = await getAttendanceConfig();
  await setAttendanceConfig({ ...current, holidays });
}

export async function pruneOrderHistory(): Promise<number> {
  return api().settings!.pruneHistory();
}

export async function createAudit(
  action: string,
  orderId?: string | null,
  user?: string | null,
  detail?: unknown,
) {
  return api().audit!.create(action, orderId, user, detail);
}

export async function getAudits(
  opts: { from?: number; to?: number; search?: string; limit?: number; offset?: number } = {},
) {
  return api().audit!.list(opts);
}

export async function countAudits(opts: { from?: number; to?: number; search?: string } = {}) {
  return api().audit!.count(opts);
}

export async function getLiveActivity(opts: { limit?: number; since?: number } = {}) {
  return api().audit!.liveActivity(opts);
}

export async function getReviewSummary(opts: ReviewRangeQuery = {}): Promise<ReviewSummaryDto> {
  return reviewApi().summary(opts);
}

export async function listReviewItems(opts: ReviewRangeQuery = {}): Promise<ReviewItemDto[]> {
  return reviewApi().items(opts);
}

export async function getStaffActivity(
  opts: ReviewRangeQuery = {},
): Promise<StaffActivityRowDto[]> {
  return reviewApi().staffActivity(opts);
}

export async function getOrderTimeline(
  orderId: string,
): Promise<{ order: OrderDto; events: OrderTimelineEventDto[] }> {
  return reviewApi().timeline(orderId);
}

export async function listPrintJobs(status?: PrintJobDto["status"]): Promise<PrintJobDoc[]> {
  return api().printQueue!.list(status);
}

export async function retryPrintJob(jobId: string): Promise<boolean> {
  const jobs = (await api().printQueue!.list()) as PrintJobDoc[];
  const job = jobs.find((candidate) => candidate._id === jobId);
  if (!job) {
    return false;
  }
  const content =
    typeof job.content === "string"
      ? { text: job.content, printer: job.printerName }
      : (job.content as any) || {};
  if (job.jobType === "kot" && content?.orderId && Array.isArray(content?.sentLines)) {
    const order = await api().orders!.get(content.orderId);
    if (!kotSentLinesNeedPrint(order, content.sentLines, content.clearPendingKotVoidIds)) {
      await api().printQueue!.markCompleted(jobId);
      return true;
    }
  }
  const result = await api().print?.({
    type: job.jobType,
    data: content,
    printer: content?.printer || job.printerName,
  });
  if (result?.ok) {
    if (job.jobType === "kot" && content?.orderId && Array.isArray(content?.sentLines)) {
      try {
        await api().orders!.markKotSent(content.orderId, content.sentLines, {
          clearPendingKotVoidIds: content.clearPendingKotVoidIds,
        });
      } catch (error: any) {
        const message = String(error?.message || error || "");
        if (!message.includes("kot-no-unsent-items") && !message.includes("order-closed")) {
          return api().printQueue!.retry(jobId);
        }
      }
    }
    await api().printQueue!.markCompleted(jobId);
    return true;
  }
  return api().printQueue!.retry(jobId);
}

export async function clearOldPrintJobs(ageHours = 24): Promise<number> {
  return api().printQueue!.clearOld(ageHours);
}

export async function pbkdf2Hash() {
  throw new Error("password-hashing-is-main-process-only");
}

export async function generateSaltHex() {
  throw new Error("password-salt-generation-is-main-process-only");
}
