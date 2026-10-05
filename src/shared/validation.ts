import { logger } from "../app/utils/logger";

export const VALIDATION_MESSAGES: Record<string, string> = {
  "item-name-required": "Item name is required.",
  "item-price-invalid": "Price must be greater than zero.",
  "item-sku-duplicate": "This SKU is already used by another item.",
  "item-variant-name-required": "Each variant must have a name.",
  "item-variant-price-invalid": "Each variant price must be greater than zero.",
  "item-variant-duplicate": "Variant names must be unique for an item.",
  "customer-name-invalid": "Name must be 2 to 80 characters and include a letter.",
  "payment-txn-ref-too-long": "Transaction reference must be 40 characters or fewer.",
  "customer-phone-invalid": "Please enter a valid 10-digit Indian mobile number (starts with 6-9).",
  "customer-phone-duplicate": "This phone number is already added.",
  "customer-has-outstanding": "Clear this customer's outstanding balance before removing them.",
  "cannot-delete-order-with-credit":
    "This bill still has unpaid customer credit and cannot be deleted.",
  "credit-disabled": "Customer credit is turned off in Settings.",
  "credit-customer-required": "Select a saved customer to put this bill on credit.",
  "credit-customer-blocked": "This customer's credit account is blocked.",
  "credit-not-enabled-for-customer": "Credit is not enabled for this customer.",
  "credit-limit-exceeded": "This sale would exceed the customer's credit limit.",
  "credit-amount-invalid": "Enter a valid payment amount.",
  "credit-amount-exceeds-outstanding": "Amount is more than the outstanding balance.",
  "credit-due-date-invalid": "Enter a valid due date.",
  "credit-payment-method-invalid": "Choose cash, UPI, card, or other.",
  "credit-split-not-allowed":
    "Only one part of a split can go on the customer's account.",
  "credit-reference-too-long": "Reference must be 80 characters or fewer.",
  "credit-notes-too-long": "Notes must be 500 characters or fewer.",
  "credit-manage-forbidden":
    "Only a manager or admin can change credit limits or void credit bills.",
  "credit-allocation-incomplete":
    "Could not allocate this payment against open credit bills. Try again.",
  "credit-sale-not-found": "That credit bill was not found.",
  "credit-sale-already-settled": "This credit bill is already fully settled.",
  "credit-void-reason-too-long": "Void reason must be 500 characters or fewer.",
  "staff-name-invalid": "Staff name must be 2 to 80 characters and include a letter.",
  "staff-phone-invalid": "Please enter a valid 10-digit Indian mobile number (starts with 6-9).",
  "staff-phone-duplicate": "This phone number is already used by another staff member.",
  "staff-designation-too-long": "Designation must be 80 characters or fewer.",
  "staff-joining-date-invalid": "Joining date must be a valid date.",
  "staff-salary-invalid": "Salary must be zero or greater.",
  "staff-address-too-long": "Address must be 250 characters or fewer.",
  "staff-notes-too-long": "Notes must be 500 characters or fewer.",
  "staff-photo-invalid": "Please choose a valid image file.",
  "staff-photo-too-large": "Staff photo must be 500 KB or smaller after compression.",
  "staff-has-attendance":
    "This staff member has attendance records. Mark them as Left instead of deleting.",
  "staff-has-account":
    "This staff member has a linked RestoNiti account. Mark them as Left instead of deleting.",
  "staff-has-history":
    "This staff member has historical records. Mark them as Left instead of deleting.",
  "staff-account-already-linked": "This staff member already has a RestoNiti account.",
  "salary-advance-amount-invalid": "Advance amount must be greater than zero.",
  "salary-advance-date-invalid": "Advance date must be valid.",
  "salary-advance-staff-required": "Employee is required.",
  "salary-advance-staff-not-found": "Employee was not found.",
  "salary-advance-not-found": "Salary advance was not found.",
  "salary-advance-note-too-long": "Note must be 500 characters or fewer.",
  "attendance-date-required": "Attendance date is required.",
  "attendance-date-invalid": "Attendance date must be a valid date.",
  "attendance-date-future": "Attendance date cannot be in the future.",
  "attendance-staff-required": "Staff member is required.",
  "attendance-status-invalid": "Attendance status is invalid.",
  "attendance-time-invalid": "Check-in and check-out must use HH:MM format.",
  "attendance-checkout-before-checkin": "Check-out cannot be earlier than check-in.",
  "attendance-break-invalid": "Break minutes must be zero or greater.",
  "attendance-break-exceeds-worked": "Break minutes cannot exceed worked duration.",
  "attendance-remarks-required-for-leave": "Remarks are required when status is Leave.",
  "attendance-duplicate-day": "An attendance record already exists for this employee on this date.",
  "attendance-not-found": "Attendance record was not found.",
  "pos-attendance-api-unavailable":
    "Attendance tools are still loading. Restart the app and try again.",
  "pos-staff-api-unavailable": "Staff tools are still loading. Restart the app and try again.",
  "pos-review-api-unavailable":
    "Owner Review tools are still loading. Restart the app and try again.",
  "category-name-required": "Category name is required.",
  "category-name-duplicate": "Category already exists.",
  "delivery-platform-required": "Delivery platform is required.",
  "rider-name-required": "Rider name is required.",
  "rider-name-invalid": "Rider name must include a letter.",
  "display-name-invalid": "Display name must include a letter.",
  "display-name-too-long": "Display name must be 80 characters or fewer.",
  "password-too-long": "Password must be 128 characters or fewer.",
  "menu-item-name-too-long": "Item name must be 80 characters or fewer.",
  "menu-item-sku-too-long": "SKU must be 32 characters or fewer.",
  "menu-category-too-long": "Category must be 40 characters or fewer.",
  "menu-variant-name-too-long": "Variant name must be 40 characters or fewer.",
  "cancel-reason-too-long": "Reason must be 200 characters or fewer.",
  "kot-void-reason-too-long": "Void reason must be 200 characters or fewer.",
  "grocery-list-title-too-long": "List name must be 80 characters or fewer.",
  "template-name-too-long": "Template name must be 80 characters or fewer.",
  "rider-phone-invalid": "Please enter a valid 10-digit rider phone number, or leave it blank.",
  "kot-sent-item-requires-void":
    "Sent kitchen items must be voided before reducing or removing them.",
  "kot-void-reason-required": "Void reason is required.",
  "cancel-reason-required": "A cancellation reason is required.",
  "cannot-delete-cancelled-order": "Cancelled orders cannot be deleted.",
  "order-closed": "This order is already paid or cancelled.",
  "kot-void-not-required": "No sent kitchen quantity needs to be voided.",
  "qty-invalid": "Quantity must be a whole number greater than zero.",
  "rate-invalid": "Rate must be a valid amount.",
  "grocery-item-name-required": "Grocery item name is required.",
  "grocery-item-name-too-long": "Grocery item name must be 120 characters or fewer.",
  "grocery-category-too-long": "Grocery category must be 80 characters or fewer.",
  "grocery-vendor-too-long": "Vendor name must be 120 characters or fewer.",
  "grocery-unit-invalid": "Choose a valid grocery unit.",
  "grocery-quantity-invalid": "Quantity must be greater than zero.",
  "grocery-unit-price-invalid": "Unit price must be zero or greater.",
  "grocery-total-invalid": "Total amount must be greater than zero.",
  "grocery-date-invalid": "Purchase date must be valid.",
  "grocery-purchase-date-future": "Purchase date cannot be in the future.",
  "grocery-received-quantity-invalid": "Received quantity must be greater than zero.",
  "grocery-payment-method-too-long": "Payment method must be 40 characters or fewer.",
  "grocery-notes-too-long": "Notes must be 500 characters or fewer.",
  "grocery-item-not-found": "Grocery item was not found.",
  "grocery-list-not-found": "Grocery list was not found.",
  "grocery-list-cancelled": "This list was cancelled and can no longer be changed.",
  "grocery-list-line-not-found": "That item is no longer on this list. Reopen the list.",
  "grocery-list-line-duplicate": "That item is already on this list.",
  "grocery-purchase-not-found": "Purchase entry was not found.",
  "grocery-list-purchase-mode-conflict":
    "This buying list already has a purchase recorded. Add pending items, then record another purchase.",
  "grocery-list-status-derived": "List status is calculated automatically and cannot be set by hand.",
  "grocery-list-line-covered": "Void the purchase to change this item.",
  "grocery-purchase-empty-coverage": "Add an item before recording another purchase.",
  "grocery-purchase-linked-none":
    "A purchase linked to a list must cover at least one pending item.",
  "grocery-purchase-selected-invalid":
    "One or more selected items are missing, belong to another list, or are already purchased.",
  "grocery-purchase-voided": "This bill was voided and can no longer be edited.",
  "grocery-purchase-lines-exceed-total": "Item amounts add up to more than the bill total.",
  "grocery-vendor-id-and-name": "Choose an existing vendor or type a new name, not both.",
  "grocery-vendor-not-found": "Vendor was not found.",
};

export const SYSTEM_MESSAGES: Record<string, string> = {
  "auth-required": "Your session has expired. Please sign in again.",
  forbidden: "You do not have permission to do that.",
  "password-change-required": "Please change your password before continuing.",
  "internal-error": "Something went wrong. Please try again.",
  "unknown-error": "Something went wrong. Please try again.",
};

export const CUSTOMER_NAME_LIMIT = 80;
export const CUSTOMER_PHONE_LIMIT = 10;
/** Card approval codes and UPI transaction ids are short. 40 covers a 35-character UPI id. */
export const PAYMENT_TXN_REF_LIMIT = 40;

export const STAFF_TEXT_LIMITS = {
  name: 80,
  designation: 80,
  address: 250,
  notes: 500,
} as const;

export function normalizeClientErrorMessage(error: unknown): string {
  const initial = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  let message = initial.trim();
  const ipcMatch = message.match(/^Error invoking remote method '[^']+':\s*(.+)$/s);
  if (ipcMatch) {
    message = ipcMatch[1].trim();
  }
  if (message.startsWith("Error: ")) {
    message = message.slice(7).trim();
  }
  const typedMatch = message.match(
    /^(?:SqliteError|TypeError|ReferenceError|RangeError):\s*(.+)$/i,
  );
  if (typedMatch) {
    message = typedMatch[1].trim();
  }
  return message;
}

export function isTechnicalErrorMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("error invoking remote method")) {
    return true;
  }
  if (lower.includes("sqliteerror") || lower.includes("sqlite_")) {
    return true;
  }
  if (/^(?:error|typeerror|referenceerror|rangeerror|syntaxerror)\b/.test(lower)) {
    return true;
  }
  if (/^[a-z]+error:/i.test(trimmed)) {
    return true;
  }
  if (/^[A-Z][A-Z0-9_]*:/.test(trimmed)) {
    return true;
  }
  if (/\bambiguous column\b/.test(lower)) {
    return true;
  }
  if (/\bsyntax error\b/.test(lower)) {
    return true;
  }
  if (/\bno such table\b/.test(lower)) {
    return true;
  }
  if (/\bno such column\b/.test(lower)) {
    return true;
  }
  if (/\n\s+at\s+/m.test(trimmed)) {
    return true;
  }
  if (trimmed.length > 240) {
    return true;
  }
  return false;
}

export function logSanitizedClientError(error: unknown, defaultMessage: string) {
  const err = error instanceof Error ? error : new Error(String(error ?? "unknown"));
  logger.error(`[ui] ${defaultMessage}`, err);
}

export function validationMessage(
  error: unknown,
  defaultMessage = "Something went wrong. Please try again.",
) {
  const raw = normalizeClientErrorMessage(error);
  if (!raw) {
    return defaultMessage;
  }
  if (raw === "internal-error") {
    logSanitizedClientError(error, defaultMessage);
    return defaultMessage;
  }
  if (VALIDATION_MESSAGES[raw]) {
    return VALIDATION_MESSAGES[raw];
  }
  if (SYSTEM_MESSAGES[raw]) {
    return SYSTEM_MESSAGES[raw];
  }
  if (isTechnicalErrorMessage(raw)) {
    logSanitizedClientError(error, defaultMessage);
    return defaultMessage;
  }
  return raw;
}

/** Strip internal failures before they reach the renderer over IPC. */
export function sanitizeIpcError(error: unknown): never {
  const raw = normalizeClientErrorMessage(error);
  if (raw && !isTechnicalErrorMessage(raw)) {
    throw error instanceof Error ? error : new Error(raw);
  }
  console.error("[ipc]", error);
  throw new Error("internal-error");
}

export function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function hasLetter(value: unknown) {
  return /\p{L}/u.test(normalizeText(value));
}

export function isValidPersonName(value: unknown, options: { min?: number; max?: number } = {}) {
  const text = normalizeText(value);
  const min = options.min ?? 2;
  return (
    text.length >= min &&
    (options.max === undefined || text.length <= options.max) &&
    hasLetter(text)
  );
}

export function normalizeSku(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeCategoryName(value: unknown) {
  return normalizeText(value);
}

export function normalizePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^91[6-9]\d{9}$/.test(digits)) {
    return digits.slice(2);
  }
  if (/^0[6-9]\d{9}$/.test(digits)) {
    return digits.slice(1);
  }
  return digits;
}

export function isValidIndianMobile(value: unknown) {
  return /^[6-9]\d{9}$/.test(normalizePhone(value));
}

export function isValidDateOnly(value: unknown) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isFutureDateOnly(value: unknown) {
  if (!isValidDateOnly(value)) {
    return false;
  }
  const text = String(value);
  const [year, month, day] = text.split("-").map((part) => Number(part));
  const input = new Date(year, month - 1, day);
  input.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return input.getTime() > today.getTime();
}

/** Local calendar date as YYYY-MM-DD — matches HTML date inputs. */
export function todayDateOnly(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Clip a read-only attendance range so future days are never queried. */
export function clipAttendanceQueryRange(fromDate: string, toDate: string) {
  const today = todayDateOnly();
  const clippedTo = toDate > today ? today : toDate;
  return { fromDate, toDate: clippedTo, empty: fromDate > clippedTo };
}

export function parsePositiveMoney(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function parseNonNegativeMoney(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(num) && num >= 0 ? num : null;
}
