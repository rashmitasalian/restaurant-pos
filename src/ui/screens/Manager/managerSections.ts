export type ManagerSection =
  | "grocery"
  | "expenses"
  | "menu"
  | "history"
  | "staff"
  | "attendance"
  | "users"
  | "audit"
  | "settings";

export const MANAGER_SECTION_HASH: Record<ManagerSection, string> = {
  grocery: "#manager-grocery",
  expenses: "#manager-expenses",
  menu: "#menu",
  history: "#history",
  staff: "#staff",
  attendance: "#attendance",
  users: "#users",
  audit: "#audit",
  settings: "#settings",
};

export function managerSectionFromHash(hash: string): ManagerSection | null {
  const normalized = String(hash || "").toLowerCase();
  const aliases: Record<string, ManagerSection> = {
    "#manager": "grocery",
    "#grocery": "grocery",
    "#manager-grocery": "grocery",
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
    "#manager-expenses": "expenses",
    "#expenses": "expenses",
    "#menu": "menu",
    "#history": "history",
    "#staff": "staff",
    "#attendance": "attendance",
    "#manager-attendance": "attendance",
    "#users": "users",
    "#audit": "audit",
    "#settings": "settings",
  };
  return aliases[normalized] || null;
}
