export type ManagerSection =
  | "overview"
  | "grocery"
  | "expenses"
  | "menu"
  | "people"
  | "reports"
  | "history"
  | "audit"
  | "settings";

/** People sub-tab when section === "people" */
export type PeopleTab = "roster" | "attendance" | "accounts";

export const MANAGER_SECTION_HASH: Record<ManagerSection, string> = {
  overview: "#manage-overview",
  grocery: "#manage-grocery",
  expenses: "#manage-expenses",
  menu: "#manage-menu",
  people: "#manage-people",
  reports: "#reports",
  history: "#manage-history",
  audit: "#manage-audit",
  settings: "#manage-settings",
};

export const PEOPLE_TAB_HASH: Record<PeopleTab, string> = {
  roster: "#manage-people-roster",
  attendance: "#manage-people-attendance",
  accounts: "#manage-people-accounts",
};

export function peopleTabFromHash(hash: string): PeopleTab {
  const normalized = String(hash || "").toLowerCase();
  if (normalized.includes("attendance")) return "attendance";
  if (normalized.includes("account") || normalized.includes("user")) return "accounts";
  return "roster";
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
    "#staff": "people",
    "#manage-people": "people",
    "#manage-people-roster": "people",
    "#manage-people-attendance": "people",
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
