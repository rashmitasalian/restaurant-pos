import { KITCHEN_NOTE_MAX } from "./kitchenNote";
import {
  CUSTOMER_NAME_LIMIT,
  CUSTOMER_PHONE_LIMIT,
  PAYMENT_TXN_REF_LIMIT,
  STAFF_TEXT_LIMITS,
} from "./validation";

/**
 * Character limits for every free-text box in RestoNiti.
 * Stored lengths match what the server accepts. Search boxes are not stored.
 * Dates, times, checkboxes, file pickers, and number steppers are not listed.
 */
export const TEXT_LIMITS = {
  /** Local filter boxes (menu, tables, history, audit, grocery, staff). */
  search: 80,
  /** People and short labels: customer, staff, rider, display name, hotel name, payee, platform. */
  personName: CUSTOMER_NAME_LIMIT,
  /** Usernames are 2–32 lowercase letters, digits, hyphens, or underscores. */
  username: 32,
  /** Passphrases. The minimum is still 8 with mixed case and a digit. */
  password: 128,
  /** Digits stored for an Indian mobile number. */
  phoneStored: CUSTOMER_PHONE_LIMIT,
  /** Room to paste +91 or a leading 0 before the value is normalized to 10 digits. */
  phoneEntry: 16,
  /** Receipt phone, which may be a landline with spaces. */
  receiptPhone: 20,
  /** Vendor phone, including landlines and short extensions. */
  vendorPhone: 40,
  email: 120,
  /** Card approval codes and UPI transaction ids. */
  paymentRef: PAYMENT_TXN_REF_LIMIT,
  /** Printed on the kitchen ticket. */
  kitchenNote: KITCHEN_NOTE_MAX,
  /** Free-text cancel and void reasons. Presets are shorter than this. */
  reason: 200,
  /** Staff notes, attendance remarks, credit notes, grocery notes, expense text. */
  notes: STAFF_TEXT_LIMITS.notes,
  /** Staff address and the GST address printed on bills. */
  address: STAFF_TEXT_LIMITS.address,
  designation: STAFF_TEXT_LIMITS.designation,
  /** Dish name on the menu and on receipts. */
  menuItemName: 80,
  /** Category chips and the menu category dropdown. */
  menuCategory: 40,
  /** Size names such as Half, Full, Family Pack. */
  menuVariant: 40,
  /** Optional item code used by CSV import. */
  sku: 32,
  groceryItemName: 120,
  groceryCategory: 80,
  vendorName: 120,
  /** Vendor contact person. */
  contactName: 120,
  invoiceNumber: 80,
  /** Buying list title and grocery template name. */
  listTitle: 80,
  templateName: 80,
  /** Indian GSTIN is 15 characters. */
  gstin: 15,
  /** Two-digit GST state code. */
  stateCode: 2,
  /** Longest current GST state name, plus a little room. */
  stateName: 50,
  /** Logo initials on receipts. */
  initials: 4,
  /** Table prefix such as GF or BAR. */
  areaPrefix: 6,
  /** Table labels. The server already keeps only the first 40 characters. */
  tableName: 40,
  /** Seating area name, such as Ground Floor or Garden. */
  areaName: 40,
  hotelName: 80,
  /** Registered legal name, which is often longer than the name on the receipt. */
  legalName: 120,
  tagline: 80,
  /** UPI virtual payment address, name@bank. */
  upiId: 100,
  /** Feedback link printed as a QR code. */
  feedbackUrl: 500,
  /** Optional line printed above the receipt QR. */
  receiptNote: 120,
  /** IPv4 address, 255.255.255.255. */
  printerIp: 15,
  /** Captain pairing code is 6 hex characters. */
  pairingCode: 8,
  /** Admin recovery code, grouped as XXXX-XXXX-… */
  recoveryCode: 32,
  /** Cloud backup recovery key, grouped in fours. */
  recoveryKey: 40,
  /** Cloud restaurant code, such as RN-XXXXX. */
  restaurantCode: 32,
  /** Read-only installation code shown on Activate. Format is RN1- plus 26 groups of 4. */
  installationCode: 133,
  /** Rupee amounts typed as text, up to 99,99,999.99. */
  money: 12,
  /** Credit due days. */
  dueDays: 4,
  /** Grocery quantities typed as text. */
  quantity: 10,
  /** Credit payment reference. */
  creditReference: 80,
} as const;
