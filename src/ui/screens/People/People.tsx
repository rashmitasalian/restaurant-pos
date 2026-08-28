import React from "react";
import { ManageShell } from "../Manager/ManageShell";
import {
  PEOPLE_TAB_HASH,
  peopleTabFromHash,
  type PeopleTab,
} from "../Manager/managerSections";
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

function staffIdFromHash(): string | null {
  const hash = window.location.hash || "";
  const q = hash.indexOf("?");
  if (q === -1) return null;
  const params = new URLSearchParams(hash.slice(q + 1));
  return params.get("staff") || params.get("staffId");
}

export default function People() {
  const [tab, setTab] = React.useState<PeopleTab>(() =>
    peopleTabFromHash(typeof window !== "undefined" ? window.location.hash : ""),
  );
  const [attendanceView, setAttendanceView] = React.useState<AttendanceView>("daily");
  const [advancesView, setAdvancesView] = React.useState<AdvancesView>("summary");
  const addStaffRef = React.useRef<(() => void) | null>(null);
  const addUserRef = React.useRef<(() => void) | null>(null);
  const recordAdvanceRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    const onHash = () => setTab(peopleTabFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  React.useEffect(() => {
    const hash = String(window.location.hash || "").toLowerCase();
    if (hash === "#manage-people" || hash === "#staff" || hash === "#attendance" || hash === "#users") {
      window.location.hash = PEOPLE_TAB_HASH.attendance;
    }
  }, []);

  const primaryAction =
    tab === "roster" ? (
      <Button variant="primary" onClick={() => addStaffRef.current?.()}>
        + Add Staff
      </Button>
    ) : tab === "accounts" ? (
      <Button variant="primary" onClick={() => addUserRef.current?.()}>
        Add User
      </Button>
    ) : tab === "advances" ? (
      <Button variant="primary" onClick={() => recordAdvanceRef.current?.()}>
        + Record Advance
      </Button>
    ) : undefined;

  const title =
    tab === "attendance"
      ? "Attendance"
      : tab === "roster"
        ? "Roster"
        : tab === "advances"
          ? "Salary Advances"
          : "Accounts";
  const description =
    tab === "attendance"
      ? "Mark daily attendance and review history"
      : tab === "roster"
        ? "Manage staff profiles and employment"
        : tab === "advances"
          ? "Record salary advances taken by staff"
          : "Manage login accounts and access";

  return (
    <ManageShell
      title={title}
      description={description}
      primaryAction={primaryAction}
      tabs={
        tab === "attendance"
          ? ATTENDANCE_VIEW_TABS
          : tab === "advances"
            ? ADVANCES_VIEW_TABS
            : undefined
      }
      tab={
        tab === "attendance"
          ? attendanceView
          : tab === "advances"
            ? advancesView
            : undefined
      }
      onTabChange={
        tab === "attendance"
          ? (next) => setAttendanceView(next as AttendanceView)
          : tab === "advances"
            ? (next) => setAdvancesView(next as AdvancesView)
            : undefined
      }
      width="operational"
    >
      {tab === "attendance" && attendanceView === "daily" && <Attendance embedded />}
      {tab === "attendance" && attendanceView === "history" && <AttendanceHistory embedded />}
      {tab === "roster" && <Staff embedded registerAddStaff={(fn) => { addStaffRef.current = fn; }} />}
      {tab === "advances" && (
        <SalaryAdvances
          embedded
          view={advancesView}
          initialStaffId={staffIdFromHash()}
          registerRecordAdvance={(fn) => {
            recordAdvanceRef.current = fn;
          }}
        />
      )}
      {tab === "accounts" && <UsersScreen embedded registerAddUser={(fn) => { addUserRef.current = fn; }} />}
    </ManageShell>
  );
}
