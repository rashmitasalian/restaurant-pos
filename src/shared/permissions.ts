import type { ManagerSection, PeopleTab } from "./manageSections";

export type Role = "admin" | "cashier" | "manager";

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
  | "system:settings";

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
] as const;

/** Floor + Manage bundles per login role. Waiter is Phase 2+ (tablet app), not a desktop role. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  manager: [
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
  ],
  cashier: ["page:tables", "page:billing", "page:kot", "page:customers"],
};

export const ROLE_KEYS = Object.keys(ROLE_PERMISSIONS) as Role[];

export const DEFAULT_ROLE: Role = "cashier";

const PERMISSION_SET_CACHE = new Map<Role, Set<Permission>>(
  ROLE_KEYS.map((role) => [role, new Set(ROLE_PERMISSIONS[role])]),
);

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return PERMISSION_SET_CACHE.get(role)?.has(permission) ?? false;
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
