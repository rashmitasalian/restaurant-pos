export type ManagerSection =
  | "grocery"
  | "menu"
  | "history"
  | "staff"
  | "attendance"
  | "users"
  | "audit"
  | "settings";

export const MANAGER_SECTION_HASH: Record<ManagerSection, string> = {
  grocery: "#manager-grocery",
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
    "#manager-grocery-purchases": "grocery",
    "#manager-grocery-summary": "grocery",
    "#manager-purchase-entry": "grocery",
    "#manager-purchases": "grocery",
    "#manager-purchase-history": "grocery",
    "#manager-spend-summary": "grocery",
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
