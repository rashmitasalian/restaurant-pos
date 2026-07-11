import React from "react";
import AuditViewer from "../Audit/AuditViewer";
import Grocery from "../Grocery/Grocery";
import History from "../History/History";
import ItemsEditor from "../ItemsEditor/ItemsEditor";
import Settings from "../Settings/Settings";
import Staff from "../Staff/Staff";
import UsersScreen from "../Users/UsersScreen";
import styles from "./Manager.module.css";

export type ManagerSection =
  | "grocery"
  | "menu"
  | "history"
  | "staff"
  | "users"
  | "audit"
  | "settings";

type ManagerProps = {
  section: ManagerSection;
  onSectionChange: (section: ManagerSection) => void;
};

const SECTIONS: Array<{
  key: ManagerSection;
  label: string;
  group: "Grocery" | "Admin Tools";
  icon: string;
}> = [
  { key: "grocery", label: "Grocery", group: "Grocery", icon: "GR" },
  { key: "menu", label: "Menu", group: "Admin Tools", icon: "MN" },
  { key: "history", label: "History", group: "Admin Tools", icon: "HI" },
  { key: "staff", label: "Staff", group: "Admin Tools", icon: "ST" },
  { key: "users", label: "Users", group: "Admin Tools", icon: "US" },
  { key: "audit", label: "Audit", group: "Admin Tools", icon: "AU" },
  { key: "settings", label: "Settings", group: "Admin Tools", icon: "SE" },
];

export const MANAGER_SECTION_HASH: Record<ManagerSection, string> = {
  grocery: "#manager-grocery",
  menu: "#menu",
  history: "#history",
  staff: "#staff",
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
    "#users": "users",
    "#audit": "audit",
    "#settings": "settings",
  };
  return aliases[normalized] || null;
}

export default function Manager({ section, onSectionChange }: ManagerProps) {
  const renderSection = () => {
    if (section === "grocery") {
      return <Grocery />;
    }
    if (section === "menu") {
      return <ItemsEditor />;
    }
    if (section === "history") {
      return <History />;
    }
    if (section === "staff") {
      return <Staff />;
    }
    if (section === "users") {
      return <UsersScreen />;
    }
    if (section === "audit") {
      return <AuditViewer />;
    }
    return <Settings />;
  };

  let currentGroup: string | null = null;

  return (
    <div className={styles.managerRoot}>
      <aside className={styles.rail} aria-label="Manager navigation">
        <div>
          <h2 className={styles.railTitle}>Manager</h2>
          <p className={styles.railSub}>Back office tools and owner reports</p>
        </div>
        {SECTIONS.map((item) => {
          const showGroup = currentGroup !== item.group;
          currentGroup = item.group;
          return (
            <React.Fragment key={item.key}>
              {showGroup && <div className={styles.groupLabel}>{item.group}</div>}
              <button
                type="button"
                className={`${styles.railButton} ${
                  section === item.key ? styles.railButtonActive : ""
                }`}
                aria-current={section === item.key ? "page" : undefined}
                onClick={() => onSectionChange(item.key)}
              >
                <span className={styles.buttonMain}>
                  <span className={styles.sectionIcon}>{item.icon}</span>
                  <span className={styles.buttonText}>{item.label}</span>
                </span>
              </button>
            </React.Fragment>
          );
        })}
      </aside>
      <section className={styles.content}>{renderSection()}</section>
    </div>
  );
}
