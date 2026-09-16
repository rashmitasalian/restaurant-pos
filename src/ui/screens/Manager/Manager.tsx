import React from "react";
import { ManageShell } from "./ManageShell";
import { CommandPalette, buildManageCommands } from "./CommandPalette";
import styles from "./Manager.module.css";
import { PageLoadingFallback } from "../../components/PageLoadingFallback";
import {
  type ManagerSection,
  MANAGER_SECTION_HASH,
  PEOPLE_TAB_HASH,
  peopleTabFromHash,
  type PeopleTab,
} from "./managerSections";
import { Icon } from "../../components/ui/Icon";
import { Button } from "../../components/ui/Button";
import {
  LayoutDashboard,
  ShoppingBasket,
  Wallet,
  UtensilsCrossed,
  History as HistoryIcon,
  ScrollText,
  Settings as SettingsIcon,
  BarChart3,
  ClipboardCheck,
  CalendarDays,
  Users,
  IndianRupee,
  Shield,
} from "lucide-react";

const Overview = React.lazy(() => import("./Overview"));
const Grocery = React.lazy(() => import("../Grocery/Grocery"));
const Expenses = React.lazy(() => import("../Expenses/Expenses"));
const ItemsEditor = React.lazy(() => import("../ItemsEditor/ItemsEditor"));
const Settings = React.lazy(() => import("../Settings/Settings"));
const People = React.lazy(() => import("../People/People"));
const Reports = React.lazy(() => import("../Reports/Reports"));
const History = React.lazy(() => import("../History/History"));
const OwnerReview = React.lazy(() => import("../Review/OwnerReview"));
const AuditViewer = React.lazy(() => import("../Audit/AuditViewer"));

type ManagerProps = {
  section: ManagerSection;
  onSectionChange: (section: ManagerSection) => void;
  allowedManageSections: ManagerSection[];
  allowedPeopleTabs: PeopleTab[];
  /** When true, only Reports is allowed — hide rail */
  reportsOnly?: boolean;
};

const SECTIONS: Array<{
  key: ManagerSection;
  label: string;
  group: " " | "Operations" | "Business" | "System";
  icon: typeof ShoppingBasket;
}> = [
  { key: "overview", label: "Overview", group: " ", icon: LayoutDashboard },
  { key: "grocery", label: "Grocery", group: "Operations", icon: ShoppingBasket },
  { key: "expenses", label: "Expenses", group: "Operations", icon: Wallet },
  { key: "menu", label: "Menu", group: "Operations", icon: UtensilsCrossed },
  { key: "reports", label: "Reports", group: "Business", icon: BarChart3 },
  { key: "history", label: "History", group: "Business", icon: HistoryIcon },
  { key: "review", label: "Review", group: "Business", icon: ClipboardCheck },
  { key: "audit", label: "Audit", group: "System", icon: ScrollText },
  { key: "settings", label: "Settings", group: "System", icon: SettingsIcon },
];

const PEOPLE_RAIL: Array<{
  tab: PeopleTab;
  label: string;
  icon: typeof CalendarDays;
}> = [
  { tab: "attendance", label: "Attendance", icon: CalendarDays },
  { tab: "roster", label: "Roster", icon: Users },
  { tab: "advances", label: "Salary Advances", icon: IndianRupee },
  { tab: "accounts", label: "Accounts", icon: Shield },
];

const SETTINGS_TABS = [
  { id: "identity", label: "Identity" },
  { id: "hardware", label: "Hardware" },
  { id: "backup", label: "Backup" },
  { id: "operations", label: "Operations" },
  { id: "retention", label: "Retention" },
];

function MenuSection() {
  const addItemRef = React.useRef<(() => void) | null>(null);
  return (
    <ManageShell
      title="Menu"
      description="Edit items and prices"
      width="full"
      primaryAction={
        <Button variant="primary" onClick={() => addItemRef.current?.()}>
          + Add Item
        </Button>
      }
    >
      <div className={styles.embedBody}>
        <ItemsEditor embedded addItemRef={addItemRef} />
      </div>
    </ManageShell>
  );
}

function SettingsSection() {
  const [tab, setTab] = React.useState("identity");

  return (
    <ManageShell
      title="Settings"
      description="Configure your POS system"
      tabs={SETTINGS_TABS}
      tab={tab}
      onTabChange={setTab}
      width="form"
    >
      <div className={styles.settingsEmbed} data-settings-focus={tab}>
        <Settings embedded focusSection={tab} />
      </div>
    </ManageShell>
  );
}

function ManagerInner({
  section,
  onSectionChange,
  allowedManageSections,
  allowedPeopleTabs,
  reportsOnly,
}: ManagerProps) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [peopleTab, setPeopleTab] = React.useState<PeopleTab>(() =>
    peopleTabFromHash(typeof window !== "undefined" ? window.location.hash : ""),
  );

  React.useEffect(() => {
    const onHash = () => {
      setPeopleTab(peopleTabFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          return;
        }
        // Don't steal focus from Billing — only when Manage is showing
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = (next: ManagerSection) => {
    onSectionChange(next);
    window.location.hash = MANAGER_SECTION_HASH[next];
  };

  const navigatePeopleTab = (tab: PeopleTab) => {
    if (!allowedPeopleTabs.includes(tab)) {
      return;
    }
    onSectionChange("people");
    setPeopleTab(tab);
    window.location.hash = PEOPLE_TAB_HASH[tab];
  };

  const allowedSectionSet = React.useMemo(
    () => new Set<ManagerSection>(allowedManageSections),
    [allowedManageSections],
  );

  const commands = React.useMemo(() => {
    const all = buildManageCommands(navigate, {
      allowedManageSections,
      allowedPeopleTabs,
    });
    if (!reportsOnly) {
      return all;
    }
    return all.filter((item) => item.id === "reports");
  }, [allowedManageSections, allowedPeopleTabs, onSectionChange, reportsOnly]);

  const visibleMainSections = SECTIONS.slice(0, 4).filter((item) =>
    allowedSectionSet.has(item.key),
  );
  const visibleBusinessSections = SECTIONS.slice(4).filter((item) =>
    allowedSectionSet.has(item.key),
  );
  const visiblePeopleTabs = PEOPLE_RAIL.filter((item) => allowedPeopleTabs.includes(item.tab));

  const effectiveSection = React.useMemo(() => {
    if (reportsOnly) {
      return "reports" as ManagerSection;
    }
    if (section === "people") {
      const tab = peopleTabFromHash(typeof window !== "undefined" ? window.location.hash : "");
      if (allowedPeopleTabs.includes(tab)) {
        return section;
      }
      return allowedManageSections[0] ?? "overview";
    }
    if (allowedSectionSet.has(section)) {
      return section;
    }
    return allowedManageSections[0] ?? "overview";
  }, [allowedManageSections, allowedPeopleTabs, allowedSectionSet, reportsOnly, section]);

  const renderSection = () => {
    const section = (
      <>
        {effectiveSection === "overview" && <Overview onNavigate={onSectionChange} />}
        {effectiveSection === "grocery" && <Grocery />}
        {effectiveSection === "expenses" && <Expenses />}
        {effectiveSection === "menu" && <MenuSection />}
        {effectiveSection === "people" && <People allowedPeopleTabs={allowedPeopleTabs} />}
        {effectiveSection === "reports" && (
          <ManageShell title="Reports" description="Sales and profitability" width="full">
            <Reports embedded />
          </ManageShell>
        )}
        {effectiveSection === "history" && (
          <ManageShell title="Order History" description="Paid orders" width="full">
            <div className={styles.embedBody}>
              <History embedded />
            </div>
          </ManageShell>
        )}
        {effectiveSection === "review" && <OwnerReview onOpenHistory={() => navigate("history")} />}
        {effectiveSection === "audit" && <AuditViewer />}
        {effectiveSection === "settings" && <SettingsSection />}
      </>
    );

    return (
      <React.Suspense fallback={<PageLoadingFallback variant="manage" label="Loading section" />}>
        {section}
      </React.Suspense>
    );
  };

  if (reportsOnly) {
    return (
      <div className={styles.managerRootSolo}>
        {renderSection()}
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commands} />
      </div>
    );
  }

  let currentGroup: string | null = null;

  const renderGroupLabel = (group: string) => {
    if (currentGroup === group || !group.trim()) {
      return null;
    }
    currentGroup = group;
    return <div className={styles.groupLabel}>{group}</div>;
  };

  return (
    <div className={styles.managerRoot}>
      <aside className={styles.rail} aria-label="Manage navigation">
        <div className={styles.railBrand}>
          <h2 className={styles.railTitle}>Manage</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            className={styles.jumpBtn}
          >
            Jump (Ctrl+K)
          </Button>
        </div>
        {visibleMainSections.map((item) => (
          <React.Fragment key={item.key}>
            {renderGroupLabel(item.group)}
            <button
              type="button"
              className={`${styles.railButton} ${effectiveSection === item.key ? styles.railButtonActive : ""}`}
              aria-current={effectiveSection === item.key ? "page" : undefined}
              onClick={() => navigate(item.key)}
            >
              <span className={styles.buttonMain}>
                <span className={styles.sectionIcon} aria-hidden="true">
                  <Icon icon={item.icon} size="sm" />
                </span>
                <span className={styles.buttonText}>{item.label}</span>
              </span>
            </button>
          </React.Fragment>
        ))}
        {visiblePeopleTabs.length > 0 && renderGroupLabel("People")}
        {visiblePeopleTabs.map((item) => (
          <button
            key={item.tab}
            type="button"
            className={`${styles.railButton} ${
              effectiveSection === "people" && peopleTab === item.tab ? styles.railButtonActive : ""
            }`}
            aria-current={
              effectiveSection === "people" && peopleTab === item.tab ? "page" : undefined
            }
            onClick={() => navigatePeopleTab(item.tab)}
          >
            <span className={styles.buttonMain}>
              <span className={styles.sectionIcon} aria-hidden="true">
                <Icon icon={item.icon} size="sm" />
              </span>
              <span className={styles.buttonText}>{item.label}</span>
            </span>
          </button>
        ))}
        {visibleBusinessSections.map((item) => (
          <React.Fragment key={item.key}>
            {renderGroupLabel(item.group)}
            <button
              type="button"
              className={`${styles.railButton} ${effectiveSection === item.key ? styles.railButtonActive : ""}`}
              aria-current={effectiveSection === item.key ? "page" : undefined}
              onClick={() => navigate(item.key)}
            >
              <span className={styles.buttonMain}>
                <span className={styles.sectionIcon} aria-hidden="true">
                  <Icon icon={item.icon} size="sm" />
                </span>
                <span className={styles.buttonText}>{item.label}</span>
              </span>
            </button>
          </React.Fragment>
        ))}
      </aside>
      <section className={styles.content}>{renderSection()}</section>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commands} />
    </div>
  );
}

export default function Manager(props: ManagerProps) {
  return <ManagerInner {...props} />;
}
