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
export type PeopleTab = "roster" | "attendance" | "advances" | "accounts";
