export const VALIDATION_MESSAGES: Record<string, string> = {
  "item-name-required": "Item name is required.",
  "item-price-invalid": "Price must be greater than zero.",
  "item-sku-duplicate": "This SKU is already used by another item.",
  "customer-name-invalid": "Name must be at least 2 characters and include a letter.",
  "customer-phone-invalid": "Please enter a valid 10-digit Indian mobile number (starts with 6-9).",
  "customer-phone-duplicate": "This phone number is already added.",
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
  "pos-staff-api-unavailable": "Staff tools are still loading. Restart the app and try again.",
  "category-name-required": "Category name is required.",
  "category-name-duplicate": "Category already exists.",
  "delivery-platform-required": "Delivery platform is required.",
  "rider-name-required": "Rider name is required.",
  "rider-name-invalid": "Rider name must include a letter.",
  "display-name-invalid": "Display name must include a letter.",
  "rider-phone-invalid": "Please enter a valid 10-digit rider phone number, or leave it blank.",
  "kot-sent-item-requires-void": "Sent kitchen items must be voided before reducing or removing them.",
  "kot-void-reason-required": "Void reason is required.",
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
  "grocery-payment-method-too-long": "Payment method must be 40 characters or fewer.",
  "grocery-notes-too-long": "Notes must be 500 characters or fewer.",
  "grocery-item-not-found": "Grocery item was not found.",
  "grocery-list-not-found": "Grocery list was not found.",
  "grocery-purchase-not-found": "Purchase entry was not found.",
  "grocery-list-purchase-mode-conflict": "Use either whole-list or item-wise purchase amounts for one buying list, not both.",
};

export const STAFF_TEXT_LIMITS = {
  name: 80,
  designation: 80,
  address: 250,
  notes: 500,
} as const;

export function validationMessage(error: unknown, defaultMessage = "Validation failed") {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return VALIDATION_MESSAGES[raw] || raw || defaultMessage;
}

export function normalizeText(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function hasLetter(value: unknown) {
  return /\p{L}/u.test(normalizeText(value));
}

export function isValidPersonName(
  value: unknown,
  options: { min?: number; max?: number } = {},
) {
  const text = normalizeText(value);
  const min = options.min ?? 2;
  return text.length >= min && (options.max === undefined || text.length <= options.max) && hasLetter(text);
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
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parsePositiveMoney(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function parseNonNegativeMoney(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(num) && num >= 0 ? num : null;
}
