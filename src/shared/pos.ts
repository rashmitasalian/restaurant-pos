import type { Role } from "./permissions";

export type { Role };

export type OrderType = string;
export type OrderStatus = "open" | "held" | "ready" | "assigned" | "paid" | "cancelled";
export type PaymentMethod =
  | "cash"
  | "upi"
  | "card"
  | "voucher"
  | "online"
  | "split"
  | "other"
  | "credit";
export type KotStatus = "pending" | "sent" | "printed" | "failed";
export type AttendanceStatus = "present" | "absent" | "half-day" | "leave" | "holiday";
export type GroceryUnit = "g" | "kg" | "ml" | "L" | "unit" | "packet" | "box" | "dozen" | "bunch";

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
  areaId: string;
  areaName?: string;
  active?: boolean;
};

export type SeatingAreaDto = {
  _id: string;
  type: "seating-area";
  id: string;
  name: string;
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
  /** YYYY-MM-DD due date when method is credit. */
  dueDate?: string | null;
  /** Attach customer at pay time when the order has none (credit only). */
  customerId?: string | null;
};

export type OrderDto = {
  _id: string;
  type: "order";
  orderType: OrderType;
  tableId: number | null;
  /** Configured floor label (F1, G1). Resolved from tables at read time. */
  tableName?: string | null;
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
  cancelledAt?: number | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
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
  /** Optional link to a staff roster record */
  staffId?: string | null;
  linkedStaffName?: string | null;
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
  creditEnabled?: boolean;
  creditBlocked?: boolean;
  /** Rupees. 0 means no credit allowed for this customer. */
  creditLimit?: number;
  /** Days; null inherits restaurant default. */
  defaultCreditDays?: number | null;
  /** Rupees outstanding on the customer account. */
  outstanding?: number;
  /** Rupees overdue (remaining on past-due credit sales). */
  overdue?: number;
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
  /** Linked RestoNiti login account, if any */
  linkedUsername?: string | null;
  linkedAccountActive?: boolean | null;
  /** 0=Sunday … 6=Saturday */
  weeklyOffDays?: number[];
  defaultShiftId?: string | null;
};

export type AttendanceDto = {
  id: string;
  staffId: string;
  staffName: string;
  role?: string | null;
  attendanceDate: string;
  shiftId?: string | null;
  status: AttendanceStatus;
  isLate?: boolean;
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

export type GroceryListStatus = "draft" | "open" | "partial" | "completed" | "cancelled";
export type GroceryListType = "regular" | "refill" | "emergency" | "custom";
export type GroceryListLineStatus = "pending" | "partial" | "purchased" | "skipped";
export type GroceryPurchaseStatus = "recorded" | "voided";
export type GroceryPaymentStatus = "pending" | "partial" | "paid";
export type GroceryPaymentMethod = "cash" | "upi" | "card" | "bank_transfer" | "credit" | "other";

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
  deletedAt?: number | null;
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
  estimatedUnitPrice?: number | null;
  estimatedTotal?: number | null;
  purchasedQuantity?: number | null;
  purchasedUnitPrice?: number | null;
  purchasedTotal?: number | null;
  lineStatus?: GroceryListLineStatus;
};

export type GroceryListDto = {
  _id: string;
  id: string;
  type: "grocery-list";
  title: string;
  listDate: number;
  listType: GroceryListType;
  status: GroceryListStatus;
  notes?: string | null;
  lines: GroceryListLineDto[];
  spentTotal: number;
  pendingCount: number;
  purchasedCount: number;
  itemCount: number;
  createdBy?: string | null;
  updatedBy?: string | null;
  completedAt?: number | null;
  printCount: number;
  lastPrintedAt?: number | null;
  createdAt: number;
  updatedAt: number;
};

export type GroceryPurchaseCoverage = "pending" | "selected" | "none";

export type GroceryPurchaseHeaderCreateInput = {
  buyingListId?: string | null;
  vendorId?: string | null;
  vendorName?: string | null;
  total: number;
  paymentMethod?: string | null;
  purchaseDate?: number;
  invoiceNumber?: string | null;
  notes?: string | null;
  coverage: GroceryPurchaseCoverage;
  lines?: Array<{
    listLineId: string;
    quantity?: number;
    unit?: GroceryUnit;
    unitPrice?: number | null;
    lineTotal?: number | null;
  }>;
};

export type GroceryListLinesChange = {
  add?: Array<Partial<GroceryListLineDto>>;
  update?: Array<{ id: string; quantity?: number; unit?: GroceryUnit }>;
  remove?: string[];
};

export type GroceryPurchaseHeaderUpdateInput = {
  total?: number;
  vendorId?: string | null;
  vendorName?: string | null;
  paymentMethod?: string | null;
  purchaseDate?: number;
  invoiceNumber?: string | null;
  lines?: Array<{ purchaseLineId: string; lineTotal?: number | null; quantity?: number }>;
};

export type GroceryPurchasePricePoint = {
  unitPrice: number;
  date: number;
  vendorName: string;
};

export type GroceryPurchaseAnalysisDto = {
  from: number;
  to: number;
  summary: {
    purchaseTotal: number;
    billCount: number;
    priceIncreaseCount: number;
    unallocatedTotal: number;
  };
  purchaseRows: Array<{
    key: string;
    itemName: string;
    unit: string;
    purchasedQuantity: number;
    previousQuantity: number;
    quantityChangePct: number | null;
    avgPurchasedPerDay: number;
    purchaseValue: number;
    billCount: number;
  }>;
  priceRows: Array<{
    key: string;
    itemName: string;
    unit: string;
    latest: GroceryPurchasePricePoint;
    previous: GroceryPurchasePricePoint | null;
    changePct: number | null;
    periodLow: number;
    periodHigh: number;
  }>;
  itemDetails: Record<
    string,
    {
      avgRecordedPrice: number | null;
      vendorPrices: Array<{ vendorName: string; unitPrice: number; date: number }>;
      recentPurchases: Array<{
        date: number;
        quantity: number;
        unit: string;
        unitPrice: number | null;
        vendorName: string;
        billTotal: number;
      }>;
    }
  >;
};

/** @deprecated Prefer GroceryPurchaseDto header + lines. Kept for line-level IPC compatibility. */
export type GroceryPurchaseLineDto = {
  _id: string;
  id: string;
  type: "grocery-purchase";
  purchaseId?: string | null;
  listId?: string | null;
  listLineId?: string | null;
  groceryItemId?: string | null;
  itemName: string;
  category?: string | null;
  quantity: number;
  unit: GroceryUnit;
  unitPrice?: number | null;
  totalAmount: number;
  vendor?: string | null;
  vendorId?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
  purchasedAt: number;
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
  active: boolean;
};

export type VendorDto = {
  _id: string;
  id: string;
  type: "vendor";
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
  notes?: string | null;
  active: boolean;
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};

export type GroceryPurchaseDto = {
  _id: string;
  id: string;
  type: "grocery-purchase-header";
  buyingListId?: string | null;
  buyingListTitle?: string | null;
  vendorId?: string | null;
  vendorName?: string | null;
  purchaseDate: number;
  invoiceNumber?: string | null;
  paymentMethod?: string | null;
  status: GroceryPurchaseStatus;
  paymentStatus: GroceryPaymentStatus;
  amountPaid: number;
  outstanding: number;
  subtotal: number;
  tax: number;
  total: number;
  notes?: string | null;
  migrationSource?: string | null;
  lines: GroceryPurchaseLineDto[];
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ExpenseCategoryDto = {
  _id: string;
  id: string;
  type: "expense-category";
  name: string;
  slug: string;
  sortOrder: number;
  isSystem: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};

export type ExpenseDto = {
  _id: string;
  id: string;
  type: "expense";
  categoryId: string;
  categoryName?: string | null;
  amount: number;
  expenseDate: number;
  vendorId?: string | null;
  vendorName?: string | null;
  description?: string | null;
  paymentMethod?: string | null;
  invoiceNumber?: string | null;
  recurringExpenseId?: string | null;
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};

export type SalaryAdvanceDto = {
  _id: string;
  id: string;
  type: "salary-advance";
  staffId: string;
  staffName?: string | null;
  staffDesignation?: string | null;
  amount: number;
  advanceDate: number;
  note?: string | null;
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};

export type BuyingListTemplateLineDto = {
  id: string;
  groceryItemId?: string | null;
  itemName: string;
  category?: string | null;
  defaultQuantity?: number | null;
  unit: GroceryUnit;
  sortOrder?: number;
};

export type BuyingListTemplateDto = {
  _id: string;
  id: string;
  type: "grocery-list-template";
  name: string;
  description?: string | null;
  active: boolean;
  lines: BuyingListTemplateLineDto[];
  createdBy?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
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
  | GroceryPurchaseLineDto
  | GroceryPurchaseDto
  | VendorDto
  | ExpenseDto
  | ExpenseCategoryDto
  | BuyingListTemplateDto;

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

export type SalesFactsDto = {
  from: number;
  to: number;
  /** True when any qualifying bill has stored tax. Amounts stay present when false. */
  hasTax: boolean;
  netSales: number;
  billCount: number;
  averageBill: number;
  discountTotal: number;
  /** Weighted discounts / pre-discount bases. Null when the base is zero. */
  discountPercent: number | null;
  billTotal: number;
  amountCollected: number;
  /** Open credit across all dates. Not Bill Total minus Amount Collected. */
  outstandingCredit: number;
  /** total_paise - (subtotal_paise + tax_total_paise), summed. */
  inclusiveResidual: number;
  untaxedNetSales: number;
  daily: Array<{ date: string; netSales: number; bills: number; averageBill: number }>;
  categories: Array<{ category: string; netSales: number; units: number }>;
  items: Array<{ itemName: string; category: string; netSales: number; units: number }>;
  serviceModes: Array<{ modeId: string; label: string; bills: number; netSales: number; averageBill: number }>;
  tenders: Array<{ method: string; label: string; amount: number; percent: number }>;
  gst: {
    cgst: number;
    sgst: number;
    totalTax: number;
    rates: Array<{
      rateBps: number;
      rateLabel: string;
      taxable: number;
      cgst: number;
      sgst: number;
      totalTax: number;
    }>;
    invoices: Array<{
      invoiceNumber: string | null;
      date: string;
      customerName: string | null;
      taxable: number;
      cgst: number;
      sgst: number;
      total: number;
      /** Blank when no GST was recorded on the bill. Not a 0% rate. */
      rateLabel: string | null;
    }>;
  };
};

export type ProfitabilitySummaryDto = {
  from: number;
  to: number;
  revenue: number;
  /** Grocery purchases / Net Sales. Null when Net Sales is zero. */
  recordedPurchaseCostPercent: number | null;
  /** False unless a Staff expense was recorded for the period. */
  staffCostRecorded: boolean;
  foodCost: {
    openingInventory: number | null;
    purchases: number;
    closingInventory: number | null;
    amount: number;
    basis: "purchases" | "inventory_adjusted";
  };
  grossContribution: number;
  operatingExpenses: number;
  expenseBreakdown: Array<{
    categoryId: string;
    categoryName: string;
    amount: number;
    percentOfRevenue: number | null;
  }>;
  estimatedOperatingProfit: number;
  operatingMarginPercent: number | null;
  disclaimer: string;
};

export type PaidOrdersSummaryDto = {
  count: number;
  total: number;
};

export type PaidOrderQueryDto = {
  from?: number;
  to?: number;
  search?: string;
  limit?: number;
  offset?: number;
};
