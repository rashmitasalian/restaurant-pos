import type { ManagerSection, PeopleTab } from "./manageSections";

export type Role = "admin" | "cashier" | "manager" | "captain";

/** Capability keys — roles are bundles of these permissions. */
export type Permission =
  | "page:tables"
  | "page:billing"
  | "page:kot"
  | "page:customers"
  | "page:manager"
  | "manage:overview"
  | "manage:grocery"
  | "manage:expenses"
  | "manage:menu"
  | "people:attendance"
  | "people:roster"
  | "people:advances"
  | "people:accounts"
  | "business:reports"
  | "business:history"
  | "system:audit"
  | "system:settings"
  | "order:open"
  | "order:add-item"
  | "order:send-kot"
  | "order:void-item"
  | "order:pay"
  | "order:cancel";

export const ALL_PERMISSIONS: readonly Permission[] = [
  "page:tables",
  "page:billing",
  "page:kot",
  "page:customers",
  "page:manager",
  "manage:overview",
  "manage:grocery",
  "manage:expenses",
  "manage:menu",
  "people:attendance",
  "people:roster",
  "people:advances",
  "people:accounts",
  "business:reports",
  "business:history",
  "system:audit",
  "system:settings",
  "order:open",
  "order:add-item",
  "order:send-kot",
  "order:void-item",
  "order:pay",
  "order:cancel",
] as const;

const FLOOR_ORDER_PERMISSIONS: readonly Permission[] = [
  "page:tables",
  "page:billing",
  "page:kot",
  "page:customers",
  "order:open",
  "order:add-item",
  "order:send-kot",
  "order:void-item",
  "order:pay",
  "order:cancel",
];

/** Floor + Manage bundles per login role. Captain is phone-only (Local Gateway), not desktop. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  manager: [
    ...FLOOR_ORDER_PERMISSIONS,
    "page:manager",
    "manage:overview",
    "manage:grocery",
    "manage:expenses",
    "manage:menu",
    "people:attendance",
    "people:roster",
    "people:advances",
  ],
  cashier: [...FLOOR_ORDER_PERMISSIONS],
  captain: ["order:open", "order:add-item", "order:send-kot", "order:void-item"],
};

export const ROLE_KEYS = Object.keys(ROLE_PERMISSIONS) as Role[];

export const DEFAULT_ROLE: Role = "cashier";

/** Roles allowed to log into the desktop POS window. */
export const DESKTOP_LOGIN_ROLES: readonly Role[] = ["admin", "manager", "cashier"];

const PERMISSION_SET_CACHE = new Map<Role, Set<Permission>>(
  ROLE_KEYS.map((role) => [role, new Set(ROLE_PERMISSIONS[role])]),
);

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return PERMISSION_SET_CACHE.get(role)?.has(permission) ?? false;
}

export function isDesktopLoginRole(role: Role): boolean {
  return (DESKTOP_LOGIN_ROLES as readonly string[]).includes(role);
}

export function permissionsToPages(permissions: readonly Permission[]): string[] {
  return permissions
    .filter((p) => p.startsWith("page:"))
    .map((p) => p.slice("page:".length));
}

export function managerSectionPermission(section: ManagerSection): Permission {
  switch (section) {
    case "overview":
      return "manage:overview";
    case "grocery":
      return "manage:grocery";
    case "expenses":
      return "manage:expenses";
    case "menu":
      return "manage:menu";
    case "people":
      return "people:attendance";
    case "reports":
      return "business:reports";
    case "history":
      return "business:history";
    case "audit":
      return "system:audit";
    case "settings":
      return "system:settings";
    default:
      return "system:settings";
  }
}

export function peopleTabPermission(tab: PeopleTab): Permission {
  switch (tab) {
    case "attendance":
      return "people:attendance";
    case "roster":
      return "people:roster";
    case "advances":
      return "people:advances";
    case "accounts":
      return "people:accounts";
    default:
      return "people:accounts";
  }
}

export function canAccessManageSection(role: Role, section: ManagerSection): boolean {
  if (section === "people") {
    return getAllowedPeopleTabs(role).length > 0;
  }
  return roleHasPermission(role, managerSectionPermission(section));
}

export function canAccessPeopleTab(role: Role, tab: PeopleTab): boolean {
  return roleHasPermission(role, peopleTabPermission(tab));
}

const MANAGE_SECTION_ORDER: ManagerSection[] = [
  "overview",
  "grocery",
  "expenses",
  "menu",
  "people",
  "reports",
  "history",
  "audit",
  "settings",
];

const PEOPLE_TAB_ORDER: PeopleTab[] = ["attendance", "roster", "advances", "accounts"];

export function getAllowedManageSections(role: Role): ManagerSection[] {
  return MANAGE_SECTION_ORDER.filter((section) => canAccessManageSection(role, section));
}

export function getAllowedPeopleTabs(role: Role): PeopleTab[] {
  return PEOPLE_TAB_ORDER.filter((tab) => canAccessPeopleTab(role, tab));
}

export function getDefaultManageSection(role: Role): ManagerSection {
  return getAllowedManageSections(role)[0] ?? "overview";
}

export function getDefaultPeopleTab(role: Role): PeopleTab {
  return getAllowedPeopleTabs(role)[0] ?? "attendance";
}

/** True when role has Reports but not the full Manage workspace (reserved for future roles). */
export function isReportsOnlyRole(role: Role): boolean {
  return roleHasPermission(role, "business:reports") && !roleHasPermission(role, "page:manager");
}

/** Audit actions shown in Live Activity (operational projection). */
export const LIVE_ACTIVITY_ACTIONS = [
  "order.created",
  "item.added",
  "order.lines.updated",
  "order.kot.sent",
  "order.kot.void",
  "order.kot.failed",
  "order.kot.printed",
  "order.cancelled",
  "order.paid",
  "order.discount.updated",
] as const;
