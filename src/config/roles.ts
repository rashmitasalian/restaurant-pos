/**
 * Centralised role registry.
 *
 * To add a new role (e.g. "waiter", "captain"):
 *   1. Add it to the `Role` union type below.
 *   2. Add an entry in `ROLE_CONFIG`.
 * That's it — nav gating, user management UI, badge styles, and
 * DB types will all pick it up automatically.
 */

export type Role = "admin" | "cashier";

export type RoleConfig = {
  label: string;
  /** Page keys this role is allowed to access. */
  pages: string[];
  /** CSS class suffix applied as a role badge (must match Users.module.css). */
  badgeClass: string;
};

export const ROLES: Record<Role, RoleConfig> = {
  admin: {
    label: "Admin",
    pages: [
      "tables",
      "billing",
      "kot",
      "reports",
      "customers",
      "manager",
    ],
    badgeClass: "admin",
  },
  cashier: {
    label: "Cashier",
    pages: ["tables", "billing", "kot", "customers"],
    badgeClass: "cashier",
  },
};

/** All valid role keys, for use in dropdowns / validation. */
export const ROLE_KEYS = Object.keys(ROLES) as Role[];

/** Default role assigned to new users. */
export const DEFAULT_ROLE: Role = "cashier";

/** Human-friendly page labels for display. */
export const PAGE_LABELS: Record<string, string> = {
  tables: "Tables",
  billing: "Billing",
  kot: "KOT Queue",
  reports: "Reports",
  customers: "Customers",
  manager: "Manager",
};
