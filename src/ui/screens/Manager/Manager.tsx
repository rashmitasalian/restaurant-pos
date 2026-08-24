import React from "react";
import AuditViewer from "../Audit/AuditViewer";
import Grocery from "../Grocery/Grocery";
import History from "../History/History";
import ItemsEditor from "../ItemsEditor/ItemsEditor";
import Settings from "../Settings/Settings";
import Staff from "../Staff/Staff";
import Attendance from "../Attendance/Attendance";
import UsersScreen from "../Users/UsersScreen";
import styles from "./Manager.module.css";
import { type ManagerSection } from "./managerSections";
import { Icon } from "../../components/ui/Icon";
import {
  ShoppingBasket,
  UtensilsCrossed,
  History as HistoryIcon,
  Users,
  CalendarCheck,
  Shield,
  ScrollText,
  Settings as SettingsIcon,
} from "lucide-react";

type ManagerProps = {
  section: ManagerSection;
  onSectionChange: (section: ManagerSection) => void;
};

const SECTIONS: Array<{
  key: ManagerSection;
  label: string;
  group: "Grocery" | "Admin Tools";
  icon: typeof ShoppingBasket;
}> = [
  { key: "grocery", label: "Grocery", group: "Grocery", icon: ShoppingBasket },
  { key: "menu", label: "Menu", group: "Admin Tools", icon: UtensilsCrossed },
  { key: "history", label: "History", group: "Admin Tools", icon: HistoryIcon },
  { key: "staff", label: "Staff", group: "Admin Tools", icon: Users },
  { key: "attendance", label: "Attendance", group: "Admin Tools", icon: CalendarCheck },
  { key: "users", label: "Users", group: "Admin Tools", icon: Shield },
  { key: "audit", label: "Audit", group: "Admin Tools", icon: ScrollText },
  { key: "settings", label: "Settings", group: "Admin Tools", icon: SettingsIcon },
];

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
    if (section === "attendance") {
      return <Attendance />;
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
                  <span className={styles.sectionIcon}>
                    <Icon icon={item.icon} size="sm" />
                  </span>
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
