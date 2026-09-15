import { isValidDateOnly, todayDateOnly } from "./validation";

export const CREDIT_CONFIG_KEY = "config:credit";

export type CreditConfig = {
  enabled: boolean;
  /** Restaurant fallback term in days when a customer has no own term. */
  defaultCreditDays: number;
};

export const DEFAULT_CREDIT_CONFIG: CreditConfig = {
  enabled: false,
  defaultCreditDays: 15,
};

export type CustomerCreditTermPreset = "today" | 7 | 15 | 30 | "custom";

export type CustomerAccountEntryType =
  | "credit_sale"
  | "payment_received"
  | "void"
  | "adjustment";

export type CustomerAccountEntryDto = {
  id: string;
  customerId: string;
  entryType: CustomerAccountEntryType;
  amount: number;
  runningBalance: number;
  orderId?: string | null;
  invoiceNumber?: string | null;
  description?: string | null;
  dueDate?: string | null;
  remaining?: number | null;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdAt: number;
  createdBy?: string | null;
};

export type CustomerAccountSummaryDto = {
  customerId: string;
  outstanding: number;
  overdue: number;
  creditLimit: number;
  availableCredit: number;
  creditEnabled: boolean;
  creditBlocked: boolean;
  defaultCreditDays: number | null;
  entryCount: number;
  /** @deprecated Prefer listAccountEntries for paged ledger; kept empty for summary. */
  entries: CustomerAccountEntryDto[];
};

export type CustomerOpenBillDto = {
  id: string;
  invoiceNumber?: string | null;
  description?: string | null;
  dueDate?: string | null;
  amount: number;
  remaining: number;
  createdAt: number;
};

export type CustomerAccountEntriesPageDto = {
  customerId: string;
  entries: CustomerAccountEntryDto[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type ReceiveCustomerPaymentResultDto = {
  account: CustomerAccountSummaryDto;
  payment: {
    entryId: string;
    amount: number;
    method: string;
    outstandingAfter: number;
    allocations: Array<{
      creditEntryId: string;
      invoiceNumber?: string | null;
      amount: number;
    }>;
  };
};

export type ReceiveCustomerPaymentInput = {
  amount: number;
  method: "cash" | "upi" | "card" | "other";
  notes?: string | null;
  reference?: string | null;
};

export function normalizeCreditConfig(input?: Partial<CreditConfig> | null): CreditConfig {
  const rawDays = Number(input?.defaultCreditDays ?? DEFAULT_CREDIT_CONFIG.defaultCreditDays);
  const defaultCreditDays = Number.isFinite(rawDays)
    ? Math.max(0, Math.min(365, Math.round(rawDays)))
    : DEFAULT_CREDIT_CONFIG.defaultCreditDays;
  return {
    enabled: Boolean(input?.enabled),
    defaultCreditDays,
  };
}

export function assertCreditConfig(input?: Partial<CreditConfig> | null): CreditConfig {
  return normalizeCreditConfig(input);
}

/** Add calendar days to a YYYY-MM-DD date (local calendar semantics). */
export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map((part) => Number(part));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Resolve due date for a credit sale.
 * Priority: explicit dueDate → customer days → restaurant default → today.
 */
export function resolveCreditDueDate(opts: {
  explicitDueDate?: string | null;
  customerDefaultDays?: number | null;
  restaurantDefaultDays?: number | null;
  saleDateOnly?: string;
}): string {
  const explicit = String(opts.explicitDueDate || "").trim();
  if (isValidDateOnly(explicit)) {
    return explicit;
  }
  const saleDate = isValidDateOnly(opts.saleDateOnly) ? String(opts.saleDateOnly) : todayDateOnly();
  const customerDays =
    opts.customerDefaultDays === null || opts.customerDefaultDays === undefined
      ? null
      : Number(opts.customerDefaultDays);
  if (customerDays !== null && Number.isFinite(customerDays) && customerDays >= 0) {
    return addDaysToDateOnly(saleDate, Math.round(customerDays));
  }
  const restaurantDays = Number(
    opts.restaurantDefaultDays ?? DEFAULT_CREDIT_CONFIG.defaultCreditDays,
  );
  const days = Number.isFinite(restaurantDays) ? Math.max(0, Math.round(restaurantDays)) : 15;
  return addDaysToDateOnly(saleDate, days);
}

export function isCreditOverdue(dueDate: string | null | undefined, remainingPaise: number, businessDateOnly?: string) {
  if (!dueDate || !isValidDateOnly(dueDate) || remainingPaise <= 0) {
    return false;
  }
  const today = businessDateOnly && isValidDateOnly(businessDateOnly) ? businessDateOnly : todayDateOnly();
  return dueDate < today;
}

export function buildCreditSaleDescription(items: Array<{ name?: string; qty?: number }> | null | undefined) {
  const lines = (items || [])
    .map((item) => {
      const name = String(item?.name || "").trim();
      if (!name) {
        return null;
      }
      const qty = Number(item?.qty);
      if (Number.isFinite(qty) && qty > 0 && qty !== 1) {
        return `${name} ×${qty % 1 === 0 ? qty : qty.toFixed(2)}`;
      }
      return name;
    })
    .filter(Boolean) as string[];
  if (!lines.length) {
    return "Credit sale";
  }
  if (lines.length <= 3) {
    return lines.join(", ");
  }
  return `${lines.slice(0, 3).join(", ")} +${lines.length - 3} more`;
}
