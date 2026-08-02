export type Role = "admin" | "cashier";

export type OrderType = string;
export type OrderStatus = "open" | "held" | "ready" | "assigned" | "paid" | "cancelled";
export type PaymentMethod = "cash" | "upi" | "card" | "voucher" | "online" | "split" | "other";
export type KotStatus = "pending" | "sent" | "printed" | "failed";
export type AttendanceStatus =
  | "present"
  | "absent"
  | "half-day"
  | "leave"
  | "holiday"
  | "week-off"
  | "late";
export type GroceryUnit =
  | "g"
  | "kg"
  | "ml"
  | "L"
  | "unit"
  | "packet"
  | "box"
  | "dozen"
  | "bunch";

export type PosSession = {
  sessionToken: string;
  username: string;
  role: Role;
  displayName?: string;
  sessionStart: number;
  requirePasswordChange?: boolean;
};

export type TableDto = {
  _id: string;
  type: "table";
  id: number;
  name?: string;
  seats: number;
  order?: number;
  active?: boolean;
};

export type MenuItemDto = {
  _id: string;
  type: "item";
  sku?: string;
  name: string;
  price: number;
  category?: string;
  available?: boolean;
  favorite?: boolean;
  taxRateBps?: number;
  variants?: MenuItemVariantDto[];
};

export type MenuItemVariantDto = {
  id: string;
  name: string;
  price: number;
  sortOrder?: number;
};

export type OrderLineDto = {
  id: string;
  menuItemId?: string | null;
  categoryName?: string | null;
  name: string;
  qty: number;
  rate: number;
  taxRateBps?: number;
  kotPrintedQty?: number;
};

export type PaymentDto = {
  id?: string;
  method: PaymentMethod | string;
  amount: number;
  amountPaid?: number;
  change?: number;
  txnRef?: string;
  splitBreakdown?: unknown;
  status?: "completed" | "voided" | "refunded";
  receivedAt?: number;
  receivedBy?: string | null;
};

export type OrderDto = {
  _id: string;
  type: "order";
  orderType: OrderType;
  tableId: number | null;
  customerId?: string | null;
  items: OrderLineDto[];
  status: OrderStatus;
  meta?: Record<string, unknown>;
  kotStatus?: KotStatus;
  kotSent?: boolean;
  kotPrinted?: boolean;
  payments?: PaymentDto[];
  discountPercent?: number;
  subtotal?: number;
  taxTotal?: number;
  discountTotal?: number;
  total?: number;
  invoiceNumber?: string | null;
  paidAt?: number | null;
  createdAt: number;
  updatedAt: number;
  createdBy?: string | null;
};

export type UserDto = {
  _id: string;
  type: "user";
  username: string;
  displayName: string;
  role: Role;
  passwordHash?: string;
  salt?: string;
  hashAlgo?: string;
  createdAt: number;
  updatedAt?: number;
  active?: boolean;
  requirePasswordChange?: boolean;
};

export type CustomerDto = {
  id: string;
  name: string;
  phone: string;
  address?: string;
  notes?: string;
  createdAt: number | string;
  updatedAt?: number | string;
  active?: boolean;
};

export type StaffDto = {
  id: string;
  name: string;
  phone: string;
  designation?: string | null;
  joiningDate?: string | null;
  salary?: number | null;
  address?: string | null;
  notes?: string | null;
  photoMime?: string | null;
  photoBase64?: string | null;
  createdAt: number | string;
  updatedAt?: number | string;
  active?: boolean;
};

export type AttendanceDto = {
  id: string;
  staffId: string;
  staffName: string;
  role?: string | null;
  attendanceDate: string;
  shiftId?: string | null;
  status: AttendanceStatus;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  breakMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  remarks?: string | null;
  createdBy?: string | null;
  createdOn: number;
  updatedBy?: string | null;
  updatedOn: number;
};

export type AuditDto = {
  _id: string;
  type: "audit";
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  orderId?: string | null;
  user?: string | null;
  detail?: unknown;
  timestamp: number;
};

export type AuditArchiveDto = {
  _id: string;
  type: "audit-archive";
  startDate: number;
  endDate: number;
  count: number;
  archivedAt: number;
  compressed: boolean;
  fileSize: number;
};

export type ConfigDto = {
  _id: string;
  type: "config";
  [key: string]: unknown;
};

export type GstConfigDto = ConfigDto & {
  _id: "config:gst";
  enabled: boolean;
  gstin: string;
  legalName: string;
  registeredAddress: string;
  stateCode: string;
  stateName: string;
  gstRateBps: number;
  priceIncludesTax: boolean;
  updatedAt?: number;
};

export type PrintJobDto = {
  _id: string;
  type: "print-job";
  printerName: string;
  jobType: "receipt" | "kot" | "label";
  content: string | unknown;
  createdAt: number;
  retryCount: number;
  maxRetries: number;
  lastRetryAt?: number;
  completedAt?: number;
  status: "pending" | "completed" | "failed";
  error?: string;
};

export type GroceryPriceHintDto = {
  lastUnitPrice?: number | null;
  lastUnit?: GroceryUnit | null;
  lastVendor?: string | null;
  lastPurchasedAt?: number | null;
  averageUnitPrice30d?: number | null;
  averageUnit?: GroceryUnit | null;
};

export type GroceryItemDto = {
  _id: string;
  id: string;
  type: "grocery-item";
  name: string;
  category?: string | null;
  defaultUnit: GroceryUnit;
  defaultQuantity: number;
  vendorHint?: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  priceHint?: GroceryPriceHintDto;
};

export type GroceryListLineDto = {
  id: string;
  groceryItemId?: string | null;
  itemName: string;
  category?: string | null;
  quantity: number;
  unit: GroceryUnit;
  vendorHint?: string | null;
  sortOrder?: number;
};

export type GroceryListDto = {
  _id: string;
  id: string;
  type: "grocery-list";
  title: string;
  listDate: number;
  status: "draft" | "printed" | "purchased";
  lines: GroceryListLineDto[];
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type GroceryPurchaseLineDto = {
  _id: string;
  id: string;
  type: "grocery-purchase";
  listId?: string | null;
  groceryItemId?: string | null;
  itemName: string;
  category?: string | null;
  quantity: number;
  unit: GroceryUnit;
  unitPrice?: number | null;
  totalAmount: number;
  vendor?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
  purchasedAt: number;
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
  active: boolean;
};

export type PosDoc =
  | TableDto
  | MenuItemDto
  | OrderDto
  | UserDto
  | StaffDto
  | AttendanceDto
  | AuditDto
  | AuditArchiveDto
  | ConfigDto
  | PrintJobDto
  | GroceryItemDto
  | GroceryListDto
  | GroceryPurchaseLineDto;

export type SalesSummaryDto = {
  total: number;
  subtotal?: number;
  taxTotal?: number;
  discountTotal?: number;
  orders: number;
  payments: number;
};

export type ProductSalesReportDto = {
  categorySales: Array<{
    category: string;
    sales: number;
    units: number;
  }>;
  itemSales: Array<{
    itemName: string;
    category: string;
    sales: number;
    units: number;
  }>;
  totals: {
    totalSales: number;
    totalUnits: number;
  };
};

export type FoodCostSummaryDto = {
  netSales: number;
  grossSales: number;
  grocerySpend: number;
  estimatedGrossProfit: number;
  foodCostPercent: number | null;
  purchaseCount: number;
  topItems: Array<{
    itemName: string;
    category?: string | null;
    amount: number;
    quantity: number;
    unit?: GroceryUnit | null;
  }>;
  topVendors: Array<{
    vendor: string;
    amount: number;
    purchaseCount: number;
  }>;
};

export type PaidOrderQueryDto = {
  from?: number;
  to?: number;
  search?: string;
  limit?: number;
  offset?: number;
};
