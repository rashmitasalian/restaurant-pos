import React from "react";
import { ManageShell } from "../Manager/ManageShell";
import {
  PEOPLE_TAB_HASH,
  peopleTabFromHash,
  type PeopleTab,
} from "../Manager/managerSections";
import { getDefaultPeopleTab } from "../../../shared/permissions";
import Attendance from "../Attendance/Attendance";
import AttendanceHistory from "../Attendance/AttendanceHistory";
import Staff from "../Staff/Staff";
import UsersScreen from "../Users/UsersScreen";
import SalaryAdvances from "../SalaryAdvances/SalaryAdvances";
import { Button } from "../../components/ui/Button";

const ATTENDANCE_VIEW_TABS = [
  { id: "daily", label: "Daily" },
  { id: "history", label: "History" },
];

const ADVANCES_VIEW_TABS = [
  { id: "summary", label: "Summary" },
  { id: "transactions", label: "Transactions" },
];

type AttendanceView = "daily" | "history";
type AdvancesView = "summary" | "transactions";

type PeopleProps = {
  allowedPeopleTabs: PeopleTab[];
};

function staffIdFromHash(): string | null {
  const hash = window.location.hash || "";
  const q = hash.indexOf("?");
  if (q === -1) return null;
  const params = new URLSearchParams(hash.slice(q + 1));
  return params.get("staff") || params.get("staffId");
}

export default function People({ allowedPeopleTabs }: PeopleProps) {
  const [tab, setTab] = React.useState<PeopleTab>(() => {
    const fromHash = peopleTabFromHash(typeof window !== "undefined" ? window.location.hash : "");
    if (allowedPeopleTabs.includes(fromHash)) {
      return fromHash;
    }
    return allowedPeopleTabs[0] ?? getDefaultPeopleTab("admin");
  });
  const [attendanceView, setAttendanceView] = React.useState<AttendanceView>("daily");
  const [advancesView, setAdvancesView] = React.useState<AdvancesView>("summary");
  const addStaffRef = React.useRef<(() => void) | null>(null);
  const addUserRef = React.useRef<(() => void) | null>(null);
  const recordAdvanceRef = React.useRef<(() => void) | null>(null);

  const effectiveTab = allowedPeopleTabs.includes(tab)
    ? tab
    : allowedPeopleTabs[0] ?? getDefaultPeopleTab("admin");

  React.useEffect(() => {
    const onHash = () => {
      const next = peopleTabFromHash(window.location.hash);
      setTab(allowedPeopleTabs.includes(next) ? next : allowedPeopleTabs[0] ?? getDefaultPeopleTab("admin"));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [allowedPeopleTabs]);

  React.useEffect(() => {
    const hash = String(window.location.hash || "").toLowerCase();
    if (hash === "#manage-people" || hash === "#staff" || hash === "#attendance" || hash === "#users") {
      window.location.hash = PEOPLE_TAB_HASH[effectiveTab];
    }
  }, [effectiveTab]);

  React.useEffect(() => {
    if (!allowedPeopleTabs.includes(tab) && allowedPeopleTabs.length > 0) {
      window.location.hash = PEOPLE_TAB_HASH[allowedPeopleTabs[0]];
      setTab(allowedPeopleTabs[0]);
    }
  }, [allowedPeopleTabs, tab]);

  const primaryAction =
    effectiveTab === "roster" ? (
      <Button variant="primary" onClick={() => addStaffRef.current?.()}>
        + Add Staff
      </Button>
    ) : effectiveTab === "accounts" ? (
      <Button variant="primary" onClick={() => addUserRef.current?.()}>
        Add User
      </Button>
    ) : effectiveTab === "advances" ? (
      <Button variant="primary" onClick={() => recordAdvanceRef.current?.()}>
        + Record Advance
      </Button>
    ) : undefined;

  const title =
    effectiveTab === "attendance"
      ? "Attendance"
      : effectiveTab === "roster"
        ? "Roster"
        : effectiveTab === "advances"
          ? "Salary Advances"
          : "Accounts";
  const description =
    effectiveTab === "attendance"
      ? "Mark daily attendance and review history"
      : effectiveTab === "roster"
        ? "Manage staff profiles and employment"
        : effectiveTab === "advances"
          ? "Record salary advances taken by staff"
          : "Manage login accounts and access";

  return (
    <ManageShell
      title={title}
      description={description}
      primaryAction={primaryAction}
      tabs={
        effectiveTab === "attendance"
          ? ATTENDANCE_VIEW_TABS
          : effectiveTab === "advances"
            ? ADVANCES_VIEW_TABS
            : undefined
      }
      tab={
        effectiveTab === "attendance"
          ? attendanceView
          : effectiveTab === "advances"
            ? advancesView
            : undefined
      }
      onTabChange={
        effectiveTab === "attendance"
          ? (next) => setAttendanceView(next as AttendanceView)
          : effectiveTab === "advances"
            ? (next) => setAdvancesView(next as AdvancesView)
            : undefined
      }
      width="operational"
    >
      {effectiveTab === "attendance" && attendanceView === "daily" && <Attendance embedded />}
      {effectiveTab === "attendance" && attendanceView === "history" && <AttendanceHistory embedded />}
      {effectiveTab === "roster" && (
        <Staff
          embedded
          registerAddStaff={(fn) => {
            addStaffRef.current = fn;
          }}
        />
      )}
      {effectiveTab === "advances" && (
        <SalaryAdvances
          embedded
          view={advancesView}
          initialStaffId={staffIdFromHash()}
          registerRecordAdvance={(fn) => {
            recordAdvanceRef.current = fn;
          }}
        />
      )}
      {effectiveTab === "accounts" && (
        <UsersScreen
          embedded
          registerAddUser={(fn) => {
            addUserRef.current = fn;
          }}
        />
      )}
    </ManageShell>
  );
}
