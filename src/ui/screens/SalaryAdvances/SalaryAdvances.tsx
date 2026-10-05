import React from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  createSalaryAdvance,
  listSalaryAdvances,
  listStaff,
  voidSalaryAdvance,
  type StaffDoc,
} from "../../../app/db/posRepository";
import type { SalaryAdvanceDto } from "../../../shared/pos";
import { parsePositiveMoney, todayDateOnly, validationMessage } from "../../../shared/validation";
import { TEXT_LIMITS } from "../../../shared/textLimits";
import { useToast } from "../../context/ToastContext";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Drawer } from "../../components/ui/Drawer";
import { PortalMenu, PortalMenuItem } from "../../components/ui/PortalMenu";
import { exportSalaryAdvancesExcel, type SalaryAdvanceExportMode } from "./salaryAdvanceExport";
import {
  buildEmployeeSummaries,
  buildExportFileName,
  defaultMonthAnchor,
  filterAdvanceTransactions,
  formatExportScope,
  formatMoney,
  resolveAdvanceRange,
  type AdvancePeriod,
  type EmployeeAdvanceSummary,
} from "./salaryAdvanceUtils";
import { formatMonthLabel, shiftMonth, shiftWeek } from "../Attendance/historyUtils";
import styles from "./SalaryAdvances.module.css";
import "../Expenses/Expenses.css";

export type SalaryAdvancesView = "summary" | "transactions";

type SalaryAdvancesProps = {
  embedded?: boolean;
  view?: SalaryAdvancesView;
  registerRecordAdvance?: (open: () => void) => void;
  initialStaffId?: string | null;
};

const PERIOD_OPTIONS: Array<{ value: AdvancePeriod; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "custom", label: "Custom" },
];

function toInputDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function staffIdFromHash(): string | null {
  const hash = window.location.hash || "";
  const q = hash.indexOf("?");
  if (q === -1) {
    return null;
  }
  const params = new URLSearchParams(hash.slice(q + 1));
  return params.get("staff") || params.get("staffId");
}

export default function SalaryAdvances({
  embedded = false,
  view = "summary",
  registerRecordAdvance,
  initialStaffId = null,
}: SalaryAdvancesProps) {
  const { showToast } = useToast();
  const exportBtnRef = React.useRef<HTMLSpanElement>(null);
  const [exportMenuOpen, setExportMenuOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [staff, setStaff] = React.useState<StaffDoc[]>([]);
  const [advances, setAdvances] = React.useState<SalaryAdvanceDto[]>([]);
  const [addOpen, setAddOpen] = React.useState(false);
  const [period, setPeriod] = React.useState<AdvancePeriod>("month");
  const [monthAnchor, setMonthAnchor] = React.useState(defaultMonthAnchor);
  const [weekAnchor, setWeekAnchor] = React.useState(todayDateOnly());
  const [customFrom, setCustomFrom] = React.useState(() => {
    const anchor = defaultMonthAnchor();
    return `${anchor.year}-${String(anchor.month).padStart(2, "0")}-01`;
  });
  const [customTo, setCustomTo] = React.useState(todayDateOnly());
  const [search, setSearch] = React.useState("");
  const [staffFilterId, setStaffFilterId] = React.useState<string | null>(
    () => initialStaffId || staffIdFromHash(),
  );
  const [drawerStaffId, setDrawerStaffId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    staffId: "",
    amount: "",
    advanceDate: toInputDate(Date.now()),
    note: "",
  });
  const [monthSummaryTotal, setMonthSummaryTotal] = React.useState(0);

  const resolvedRange = React.useMemo(
    () =>
      resolveAdvanceRange({
        period,
        monthAnchor,
        weekAnchor,
        customFrom,
        customTo,
      }),
    [customFrom, customTo, monthAnchor, period, weekAnchor],
  );

  React.useEffect(() => {
    registerRecordAdvance?.(() => setAddOpen(true));
  }, [registerRecordAdvance]);

  React.useEffect(() => {
    const onHash = () => {
      const id = staffIdFromHash();
      if (id) {
        setStaffFilterId(id);
        setDrawerStaffId(id);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  React.useEffect(() => {
    const id = initialStaffId || staffIdFromHash();
    if (id) {
      setStaffFilterId(id);
      setDrawerStaffId(id);
    }
  }, [initialStaffId]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [members, rows] = await Promise.all([
        listStaff({ status: "active" }),
        listSalaryAdvances({
          from: resolvedRange.fromTs,
          to: resolvedRange.toTs,
          staffId: staffFilterId || undefined,
          limit: 500,
        }),
      ]);
      setStaff(members);
      setAdvances(rows as SalaryAdvanceDto[]);
      setForm((current) =>
        current.staffId || !members[0]
          ? current
          : {
              ...current,
              staffId: staffFilterId || members[0].id,
            },
      );
    } catch (error: unknown) {
      showToast(validationMessage(error, "Could not load salary advances"), "error");
    } finally {
      setLoading(false);
    }
  }, [resolvedRange.fromTs, resolvedRange.toTs, staffFilterId, showToast]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!addOpen || !form.staffId) {
      setMonthSummaryTotal(0);
      return;
    }
    const anchor = defaultMonthAnchor();
    const range = resolveAdvanceRange({
      period: "month",
      monthAnchor: anchor,
      weekAnchor: todayDateOnly(),
      customFrom,
      customTo,
    });
    let cancelled = false;
    void listSalaryAdvances({
      from: range.fromTs,
      to: range.toTs,
      staffId: form.staffId,
      limit: 500,
    })
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setMonthSummaryTotal(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
      })
      .catch(() => {
        if (!cancelled) {
          setMonthSummaryTotal(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [addOpen, customFrom, customTo, form.staffId]);

  const summaries = React.useMemo(
    () => buildEmployeeSummaries(advances, staff, search, staffFilterId),
    [advances, staff, search, staffFilterId],
  );

  const transactions = React.useMemo(
    () => filterAdvanceTransactions(advances, staff, search, staffFilterId),
    [advances, staff, search, staffFilterId],
  );

  const employeeLabel = staffFilterId
    ? staff.find((member) => member.id === staffFilterId)?.name || null
    : null;
  const scopeLabel = formatExportScope(resolvedRange.scopeLabel, employeeLabel);

  const totalAdvanceCount = summaries.reduce((sum, row) => sum + row.advanceCount, 0);
  const totalAdvanceAmount = summaries.reduce((sum, row) => sum + row.totalAdvance, 0);
  const averagePerEmployee =
    summaries.length > 0 ? Math.round((totalAdvanceAmount / summaries.length) * 100) / 100 : 0;

  const drawerSummary = drawerStaffId
    ? summaries.find((row) => row.staffId === drawerStaffId) || null
    : null;
  const drawerTransactions = drawerStaffId
    ? transactions
        .filter((row) => row.staffId === drawerStaffId)
        .slice()
        .sort((a, b) => a.advanceDate - b.advanceDate || a.createdAt - b.createdAt)
    : [];

  const selectedStaff = staff.find((member) => member.id === form.staffId) || null;
  const pendingFormAmount = parsePositiveMoney(form.amount) || 0;
  const salaryAfterAdvances =
    selectedStaff?.salary === null || selectedStaff?.salary === undefined
      ? null
      : Math.max(0, Number(selectedStaff.salary) - monthSummaryTotal - pendingFormAmount);

  const exportExcel = (mode: SalaryAdvanceExportMode) => {
    if (summaries.length === 0 && transactions.length === 0) {
      showToast("Nothing to export for the current filters.", "info");
      return;
    }
    exportSalaryAdvancesExcel({
      mode,
      fileName: buildExportFileName(resolvedRange.fileSlug, employeeLabel),
      scopeLabel,
      summaries,
      transactions,
    });
    setExportMenuOpen(false);
    showToast("Salary advances exported to Excel.", "success");
  };

  const submit = async () => {
    const amount = parsePositiveMoney(form.amount);
    if (!form.staffId || amount === null) {
      return;
    }
    const date = new Date(form.advanceDate);
    date.setHours(12, 0, 0, 0);
    if (isNaN(date.getTime())) {
      showToast(validationMessage("salary-advance-date-invalid"), "error");
      return;
    }
    try {
      await createSalaryAdvance({
        staffId: form.staffId,
        amount,
        advanceDate: date.getTime(),
        note: form.note.trim() || null,
      });
      setAddOpen(false);
      setForm((current) => ({ ...current, amount: "", note: "" }));
      showToast("Salary advance recorded", "success");
      await refresh();
    } catch (error: unknown) {
      showToast(validationMessage(error, "Could not save salary advance"), "error");
    }
  };

  const periodNav = () => {
    if (period === "month") {
      return (
        <div className={styles.periodNav}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => setMonthAnchor((current) => shiftMonth(current.year, current.month, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <span className={styles.periodLabel}>
            {formatMonthLabel(monthAnchor.year, monthAnchor.month)}
          </span>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => setMonthAnchor((current) => shiftMonth(current.year, current.month, 1))}
            aria-label="Next month"
            disabled={
              monthAnchor.year > new Date().getFullYear() ||
              (monthAnchor.year === new Date().getFullYear() &&
                monthAnchor.month >= new Date().getMonth() + 1)
            }
          >
            <ChevronRight size={18} />
          </button>
        </div>
      );
    }
    if (period === "week") {
      return (
        <div className={styles.periodNav}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => setWeekAnchor((current) => shiftWeek(current, -1))}
            aria-label="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <span className={styles.periodLabel}>{resolvedRange.scopeLabel}</span>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => setWeekAnchor((current) => shiftWeek(current, 1))}
            aria-label="Next week"
            disabled={resolvedRange.toDate >= todayDateOnly()}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      );
    }
    return (
      <div className={styles.customRange}>
        <input
          type="date"
          className={`pos-input ${styles.dateInput}`}
          value={customFrom}
          max={todayDateOnly()}
          onChange={(event) => setCustomFrom(event.target.value)}
          aria-label="From date"
        />
        <span className={styles.rangeSep}>to</span>
        <input
          type="date"
          className={`pos-input ${styles.dateInput}`}
          value={customTo}
          max={todayDateOnly()}
          onChange={(event) => setCustomTo(event.target.value)}
          aria-label="To date"
        />
      </div>
    );
  };

  const renderSummaryView = () => {
    if (loading) {
      return <div className="pos-empty">Loading salary advances…</div>;
    }
    if (summaries.length === 0) {
      return (
        <EmptyState
          title={`No salary advances ${resolvedRange.scopeLabel.toLowerCase()}`}
          text="Record cash advances taken by staff against their monthly salary."
          actionLabel="Record Advance"
          onAction={() => setAddOpen(true)}
        />
      );
    }

    return (
      <>
        <DataTable
          columns={[
            { key: "name", header: "Employee", sortable: true },
            { key: "count", header: "Advance Count", sortable: true, align: "right", nowrap: true },
            {
              key: "total",
              header: "Total Advances",
              sortable: true,
              align: "right",
              nowrap: true,
            },
            { key: "salary", header: "Salary", sortable: true, align: "right", nowrap: true },
            {
              key: "after",
              header: "Salary After Advances",
              sortable: true,
              align: "right",
              nowrap: true,
            },
          ]}
          sortValues={summaries.map((row) => ({
            name: row.name,
            count: row.advanceCount,
            total: row.totalAdvance,
            salary: row.salary ?? -1,
            after: row.salaryAfterAdvances ?? -1,
          }))}
          rows={summaries.map((row: EmployeeAdvanceSummary) => [
            row.name,
            String(row.advanceCount),
            formatMoney(row.totalAdvance),
            formatMoney(row.salary),
            formatMoney(row.salaryAfterAdvances),
          ])}
          onRowClick={(index) => setDrawerStaffId(summaries[index]?.staffId || null)}
          empty="No matching employees"
        />
        <div className={styles.footerTotal}>
          <span>
            TOTAL · {totalAdvanceCount} advances · {summaries.length} employees
          </span>
          <span>{formatMoney(totalAdvanceAmount)}</span>
        </div>
      </>
    );
  };

  const renderTransactionsView = () => {
    if (loading) {
      return <div className="pos-empty">Loading salary advances…</div>;
    }
    if (transactions.length === 0) {
      return (
        <EmptyState
          title={`No salary advance transactions ${resolvedRange.scopeLabel.toLowerCase()}`}
          text="Individual advance records appear here as they are recorded."
          actionLabel="Record Advance"
          onAction={() => setAddOpen(true)}
        />
      );
    }

    return (
      <>
        <DataTable
          columns={[
            { key: "date", header: "Date", sortable: true, nowrap: true },
            { key: "employee", header: "Employee", sortable: true },
            { key: "amount", header: "Amount", sortable: true, align: "right", nowrap: true },
            { key: "note", header: "Note" },
            { key: "actions", header: "", align: "right", nowrap: true },
          ]}
          sortValues={transactions.map((row) => ({
            date: row.advanceDate,
            employee: row.staffName || "",
            amount: row.amount,
            note: row.note || "",
          }))}
          rows={transactions.map((row) => [
            new Date(row.advanceDate).toLocaleDateString("en-IN"),
            row.staffName || "—",
            formatMoney(row.amount),
            row.note || "—",
            <Button
              key={row.id}
              variant="danger-ghost"
              size="sm"
              onClick={async () => {
                try {
                  await voidSalaryAdvance(row.id);
                  showToast("Salary advance voided", "success");
                  await refresh();
                } catch (error: unknown) {
                  showToast(validationMessage(error, "Could not void salary advance"), "error");
                }
              }}
            >
              Void
            </Button>,
          ])}
          empty="No matching transactions"
        />
        <div className={styles.footerTotal}>
          <span>
            {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
          </span>
          <span>
            {formatMoney(transactions.reduce((sum, row) => sum + Number(row.amount || 0), 0))}
          </span>
        </div>
      </>
    );
  };

  const content = (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.periodGroup}>
          <div className={styles.periodSelectWrap}>
            <select
              className={`pos-select ${styles.periodSelect}`}
              value={period}
              onChange={(event) => setPeriod(event.target.value as AdvancePeriod)}
              aria-label="Period type"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {periodNav()}
        </div>
        <div className={styles.searchWrap}>
          <input
            className={`pos-input ${styles.searchInput}`}
            placeholder="Search employee…"
            maxLength={TEXT_LIMITS.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search employee"
          />
        </div>
        {staffFilterId ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStaffFilterId(null);
              setDrawerStaffId(null);
              window.location.hash = "#manage-people-advances";
            }}
          >
            Clear filter
          </Button>
        ) : null}
        {view === "transactions" ? (
          <div className={styles.toolbarEnd}>
            <span ref={exportBtnRef}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setExportMenuOpen((open) => !open)}
                disabled={loading || (summaries.length === 0 && transactions.length === 0)}
              >
                Export Excel <ChevronDown size={14} />
              </Button>
            </span>
            <PortalMenu
              open={exportMenuOpen}
              anchorRef={exportBtnRef}
              onClose={() => setExportMenuOpen(false)}
              align="right"
            >
              <PortalMenuItem onClick={() => exportExcel("summary")}>Summary</PortalMenuItem>
              <PortalMenuItem onClick={() => exportExcel("transactions")}>
                Transactions
              </PortalMenuItem>
              <PortalMenuItem onClick={() => exportExcel("both")}>
                Summary + Transactions
              </PortalMenuItem>
            </PortalMenu>
          </div>
        ) : null}
      </div>

      {!employeeLabel ? null : <div className={styles.scopeLine}>Filtered to {employeeLabel}</div>}

      <div className={styles.summaryStrip} aria-label="Salary advance summary">
        <span>
          <strong>{summaries.length}</strong> employees
        </span>
        <span>
          <strong>{totalAdvanceCount}</strong> advances
        </span>
        <span>
          <strong>{formatMoney(totalAdvanceAmount)}</strong> total
        </span>
        {summaries.length > 0 ? (
          <span>
            <strong>{formatMoney(averagePerEmployee)}</strong> avg / employee
          </span>
        ) : null}
      </div>

      {view === "summary" ? renderSummaryView() : renderTransactionsView()}

      <Drawer
        open={Boolean(drawerStaffId && drawerSummary)}
        title={drawerSummary?.name || "Employee"}
        onClose={() => setDrawerStaffId(null)}
        wide
      >
        {drawerSummary ? (
          <>
            <div className={styles.drawerMeta}>
              <div className={styles.drawerMetaRow}>
                <span className={styles.drawerMetaLabel}>{resolvedRange.scopeLabel}</span>
                <strong>{drawerSummary.designation || "—"}</strong>
              </div>
              <div className={styles.drawerMetaRow}>
                <span className={styles.drawerMetaLabel}>Monthly salary</span>
                <strong>{formatMoney(drawerSummary.salary)}</strong>
              </div>
              <div className={styles.drawerMetaRow}>
                <span className={styles.drawerMetaLabel}>Total advances</span>
                <strong>{formatMoney(drawerSummary.totalAdvance)}</strong>
              </div>
              <div className={styles.drawerMetaRow}>
                <span className={styles.drawerMetaLabel}>Salary after advances</span>
                <strong>{formatMoney(drawerSummary.salaryAfterAdvances)}</strong>
              </div>
            </div>
            <DataTable
              headers={["Date", "Amount", "Note"]}
              rows={drawerTransactions.map((row) => [
                new Date(row.advanceDate).toLocaleDateString("en-IN"),
                formatMoney(row.amount),
                row.note || "—",
              ])}
              empty="No advances in this period"
            />
            <div className={styles.footerTotal}>
              <span>{drawerSummary.advanceCount} advances</span>
              <span>{formatMoney(drawerSummary.totalAdvance)}</span>
            </div>
          </>
        ) : null}
      </Drawer>

      <Modal open={addOpen} title="Record Salary Advance" onClose={() => setAddOpen(false)}>
        <div className="ui-form-stack">
          <Select
            label="Employee"
            value={form.staffId}
            onChange={(event) =>
              setForm((current) => ({ ...current, staffId: event.target.value }))
            }
          >
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.designation ? ` · ${member.designation}` : ""}
              </option>
            ))}
          </Select>
          <Input
            label="Date"
            type="date"
            max={toInputDate(Date.now())}
            value={form.advanceDate}
            onChange={(event) =>
              setForm((current) => ({ ...current, advanceDate: event.target.value }))
            }
          />
          <Input
            label="Amount (₹)"
            type="number"
            min={0}
            step="0.01"
            value={form.amount}
            onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
          />
          <Input
            label="Note"
            value={form.note}
            maxLength={TEXT_LIMITS.notes}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          />
          {selectedStaff ? (
            <div className={styles.modalSummary}>
              <div className={styles.modalSummaryRow}>
                <span className={styles.modalSummaryLabel}>Monthly salary</span>
                <strong>{formatMoney(selectedStaff.salary ?? null)}</strong>
              </div>
              <div className={styles.modalSummaryRow}>
                <span className={styles.modalSummaryLabel}>Advances this month</span>
                <strong>{formatMoney(monthSummaryTotal + pendingFormAmount)}</strong>
              </div>
              <div className={styles.modalSummaryRow}>
                <span className={styles.modalSummaryLabel}>Salary after advances</span>
                <strong>{formatMoney(salaryAfterAdvances)}</strong>
              </div>
            </div>
          ) : null}
          <div className="ui-form-actions">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={!form.staffId || parsePositiveMoney(form.amount) === null}
            >
              Save Advance
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );

  if (embedded) {
    return content;
  }

  return <div className="pos-page">{content}</div>;
}
