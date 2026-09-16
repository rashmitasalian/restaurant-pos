/**
 * Centralised role registry.
 *
 * Roles are bundles of permissions defined in `src/shared/permissions.ts`.
 * To add a new desktop login role:
 *   1. Add it to the `Role` union and `ROLE_PERMISSIONS` in permissions.ts.
 *   2. Add label + badgeClass here.
 * Nav gating, IPC checks, user management UI, and DB types derive from permissions.
 *
 * Captain is phone-only (Local Gateway) — not a desktop login role.
 */

import { type Role, ROLE_KEYS, ROLE_PERMISSIONS, permissionsToPages } from "../shared/permissions";

export type { Role };
export { ROLE_KEYS } from "../shared/permissions";

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
    pages: permissionsToPages(ROLE_PERMISSIONS.admin),
    badgeClass: "admin",
  },
  manager: {
    label: "Manager",
    pages: permissionsToPages(ROLE_PERMISSIONS.manager),
    badgeClass: "manager",
  },
  cashier: {
    label: "Cashier",
    pages: permissionsToPages(ROLE_PERMISSIONS.cashier),
    badgeClass: "cashier",
  },
  captain: {
    label: "Captain",
    pages: permissionsToPages(ROLE_PERMISSIONS.captain),
    badgeClass: "captain",
  },
};

/** Default role assigned to new users. */
export const DEFAULT_ROLE: Role = "cashier";

/** Human-friendly page labels for display. */
export const PAGE_LABELS: Record<string, string> = {
  tables: "Tables",
  billing: "Billing",
  kot: "KOT Queue",
  reports: "Reports",
  customers: "Customers",
  manager: "Manage",
};
