import type { ManagerSection, PeopleTab } from "../../../shared/manageSections";

export type { ManagerSection, PeopleTab } from "../../../shared/manageSections";

export const PEOPLE_TABS: Array<{ id: PeopleTab; label: string }> = [
  { id: "attendance", label: "Attendance" },
  { id: "roster", label: "Roster" },
  { id: "advances", label: "Salary Advances" },
  { id: "accounts", label: "Accounts" },
];

export const MANAGER_SECTION_HASH: Record<ManagerSection, string> = {
  overview: "#manage-overview",
  grocery: "#manage-grocery",
  expenses: "#manage-expenses",
  menu: "#manage-menu",
  people: "#manage-people-attendance",
  reports: "#reports",
  history: "#manage-history",
  review: "#manage-review",
  audit: "#manage-audit",
  settings: "#manage-settings",
};

export const PEOPLE_TAB_HASH: Record<PeopleTab, string> = {
  roster: "#manage-people-roster",
  attendance: "#manage-people-attendance",
  advances: "#manage-people-advances",
  accounts: "#manage-people-accounts",
};

export function peopleTabFromHash(hash: string): PeopleTab {
  const normalized = String(hash || "").toLowerCase();
  if (normalized.includes("roster")) {
    return "roster";
  }
  if (normalized.includes("advance")) {
    return "advances";
  }
  if (normalized.includes("attendance")) {
    return "attendance";
  }
  if (normalized.includes("account") || normalized.includes("user")) {
    return "accounts";
  }
  return "attendance";
}

export function managerSectionFromHash(hash: string): ManagerSection | null {
  const normalized = String(hash || "").toLowerCase();
  const aliases: Record<string, ManagerSection> = {
    "#manager": "overview",
    "#manage": "overview",
    "#manage-overview": "overview",
    "#grocery": "grocery",
    "#manager-grocery": "grocery",
    "#manage-grocery": "grocery",
    "#manager-grocery-list": "grocery",
    "#manager-grocery-lists": "grocery",
    "#manager-grocery-purchases": "grocery",
    "#manager-grocery-vendors": "grocery",
    "#manager-grocery-items": "grocery",
    "#manager-grocery-insights": "grocery",
    "#manager-grocery-summary": "grocery",
    "#manager-purchase-entry": "grocery",
    "#manager-purchases": "grocery",
    "#manager-purchase-history": "grocery",
    "#manager-spend-summary": "grocery",
    "#manage-grocery-lists": "grocery",
    "#manage-grocery-purchases": "grocery",
    "#manage-grocery-vendors": "grocery",
    "#manage-grocery-items": "grocery",
    "#manager-expenses": "expenses",
    "#manage-expenses": "expenses",
    "#expenses": "expenses",
    "#menu": "menu",
    "#manage-menu": "menu",
    "#reports": "reports",
    "#manage-reports": "reports",
    "#history": "history",
    "#manage-history": "history",
    "#review": "review",
    "#manage-review": "review",
    "#owner-review": "review",
    "#staff": "people",
    "#manage-people": "people",
    "#manage-people-roster": "people",
    "#manage-people-attendance": "people",
    "#manage-people-advances": "people",
    "#manage-people-accounts": "people",
    "#attendance": "people",
    "#manager-attendance": "people",
    "#users": "people",
    "#audit": "audit",
    "#manage-audit": "audit",
    "#settings": "settings",
    "#manage-settings": "settings",
  };
  return aliases[normalized] || null;
}
