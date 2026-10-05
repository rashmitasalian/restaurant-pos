import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  getConfigShifts,
  listAttendanceRange,
  listStaff,
  type AttendanceDoc,
  type StaffDoc,
} from "../../../app/db/posRepository";
import { todayDateOnly, validationMessage } from "../../../shared/validation";
import { TEXT_LIMITS } from "../../../shared/textLimits";
import { useToast } from "../../context/ToastContext";
import { Button } from "../../components/ui/Button";
import { filterStaffBySearch } from "../People/peopleUtils";
import { exportAttendanceHistoryExcel } from "./attendanceHistoryExport";
import styles from "./AttendanceHistory.module.css";
import {
  buildAttendanceMatrix,
  enumerateDays,
  formatDayHeader,
  formatMonthLabel,
  formatOtHoursTotal,
  formatWeekLabel,
  monthRange,
  shiftMonth,
  shiftWeek,
  statusCode,
  statusCellTitle,
  weekRange,
  type HistoryPeriod,
} from "./historyUtils";

type ShiftOption = { value: string; label: string };

const PERIOD_OPTIONS: Array<{ value: HistoryPeriod; label: string }> = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "custom", label: "Custom" },
];

function defaultMonthAnchor() {
  const today = todayDateOnly();
  const [year, month] = today.split("-").map((part) => Number(part));
  return { year, month };
}

export default function AttendanceHistory({ embedded = false }: { embedded?: boolean }) {
  const { showToast } = useToast();
  const [period, setPeriod] = React.useState<HistoryPeriod>("month");
  const [monthAnchor, setMonthAnchor] = React.useState(defaultMonthAnchor);
  const [weekAnchor, setWeekAnchor] = React.useState(todayDateOnly());
  const [customFrom, setCustomFrom] = React.useState(() => {
    const { year, month } = defaultMonthAnchor();
    return `${year}-${String(month).padStart(2, "0")}-01`;
  });
  const [customTo, setCustomTo] = React.useState(todayDateOnly());
  const [shiftFilter, setShiftFilter] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [shiftOptions, setShiftOptions] = React.useState<ShiftOption[]>([
    { value: "morning", label: "Morning" },
    { value: "evening", label: "Evening" },
    { value: "night", label: "Night" },
  ]);
  const [staff, setStaff] = React.useState<StaffDoc[]>([]);
  const [records, setRecords] = React.useState<AttendanceDoc[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const resolvedRange = React.useMemo(() => {
    if (period === "week") {
      return weekRange(weekAnchor);
    }
    if (period === "custom") {
      const fromDate = customFrom <= customTo ? customFrom : customTo;
      const toDate = customFrom <= customTo ? customTo : customFrom;
      return { fromDate, toDate, days: enumerateDays(fromDate, toDate) };
    }
    return monthRange(monthAnchor.year, monthAnchor.month);
  }, [customFrom, customTo, monthAnchor.month, monthAnchor.year, period, weekAnchor]);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [staffRows, shifts] = await Promise.all([
        listStaff({ status: "all" }),
        getConfigShifts(),
      ]);
      setStaff(staffRows);
      if (Array.isArray(shifts) && shifts.length > 0) {
        setShiftOptions(
          shifts
            .filter(
              (entry) => entry.id && entry.label && entry.id !== "half-day" && entry.id !== "half",
            )
            .map((entry) => ({
              value: String(entry.id).toLowerCase(),
              label: String(entry.label),
            })),
        );
      }
      const attendance = await listAttendanceRange({
        fromDate: resolvedRange.fromDate,
        toDate: resolvedRange.toDate,
        shiftId: shiftFilter === "all" ? null : shiftFilter,
      });
      setRecords(attendance);
    } catch (loadError) {
      setError(validationMessage(loadError, "Could not load attendance history."));
    } finally {
      setLoading(false);
    }
  }, [resolvedRange.fromDate, resolvedRange.toDate, shiftFilter]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const matrix = React.useMemo(
    () => buildAttendanceMatrix(staff, records, resolvedRange.days, search),
    [records, resolvedRange.days, search, staff],
  );

  const scopeLabel = React.useMemo(() => {
    if (period === "week") {
      return formatWeekLabel(resolvedRange.fromDate, resolvedRange.toDate);
    }
    if (period === "custom") {
      return `${resolvedRange.fromDate} to ${resolvedRange.toDate}`;
    }
    return formatMonthLabel(monthAnchor.year, monthAnchor.month);
  }, [monthAnchor.month, monthAnchor.year, period, resolvedRange.fromDate, resolvedRange.toDate]);

  const shiftLabel =
    shiftFilter === "all"
      ? "All Shifts"
      : shiftOptions.find((option) => option.value === shiftFilter)?.label || shiftFilter;

  const exportExcel = React.useCallback(() => {
    exportAttendanceHistoryExcel({
      fileName: `attendance-history-${resolvedRange.fromDate}-to-${resolvedRange.toDate}.xlsx`,
      scopeLabel,
      shiftLabel,
      period,
      matrix,
    });
    showToast(`Exported ${scopeLabel} · ${shiftLabel}`, "success");
  }, [
    matrix,
    period,
    resolvedRange.fromDate,
    resolvedRange.toDate,
    scopeLabel,
    shiftLabel,
    showToast,
  ]);

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
          <span className={styles.periodLabel}>
            {formatWeekLabel(resolvedRange.fromDate, resolvedRange.toDate)}
          </span>
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

  return (
    <div className={embedded ? styles.rootEmbedded : styles.root}>
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.title}>Attendance History</h2>
            <p className={styles.subtitle}>
              {scopeLabel} · {matrix.rows.length} employees
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportExcel}
            disabled={loading || matrix.rows.length === 0}
          >
            Export Excel
          </Button>
        </div>

        <div className={styles.filters}>
          <select
            className={`pos-select ${styles.periodSelect}`}
            value={period}
            onChange={(event) => setPeriod(event.target.value as HistoryPeriod)}
            aria-label="Period type"
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {periodNav()}
          <select
            className={`pos-select ${styles.shiftFilter}`}
            value={shiftFilter}
            onChange={(event) => setShiftFilter(event.target.value)}
            aria-label="Filter by shift"
          >
            <option value="all">All Shifts</option>
            {shiftOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            className={`pos-input ${styles.searchInput}`}
            placeholder="Search employee..."
            maxLength={TEXT_LIMITS.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className={styles.summaryStrip} aria-label="History summary">
        <span>
          <strong>{matrix.summary.present}</strong> Present
        </span>
        <span>
          <strong>{matrix.summary.absent}</strong> Absent
        </span>
        <span>
          <strong>{matrix.summary.leave}</strong> Leave
        </span>
        <span>
          <strong>{matrix.summary.halfDay}</strong> Half Day
        </span>
        <span>
          <strong>{formatOtHoursTotal(matrix.summary.overtimeMinutes)}h</strong> OT
        </span>
      </div>

      {error ? (
        <div className={styles.errorPanel} role="alert">
          <div>
            <strong>Unable to load attendance history</strong>
            <p>{error}</p>
          </div>
          <Button variant="secondary" onClick={() => void loadData()}>
            Try Again
          </Button>
        </div>
      ) : null}

      {loading ? <div className={styles.loading}>Loading attendance...</div> : null}

      {!loading && !error && matrix.rows.length === 0 ? (
        <div className={styles.empty}>
          No attendance records found. Try another date range, shift, or employee.
        </div>
      ) : null}

      {!loading && !error && matrix.rows.length > 0 ? (
        <>
          <div className={styles.matrixWrap}>
            <table className={styles.matrix}>
              <thead>
                <tr>
                  <th className={styles.stickyCol}>Employee</th>
                  {resolvedRange.days.map((day) => (
                    <th key={day} className={styles.dayCol}>
                      {formatDayHeader(day, period)}
                    </th>
                  ))}
                  <th className={`${styles.summaryCol} ${styles.summaryColPresent}`}>Present</th>
                  <th className={`${styles.summaryCol} ${styles.summaryColAbsent}`}>Absent</th>
                  <th className={`${styles.summaryCol} ${styles.summaryColHalfDay}`}>Half Day</th>
                  <th className={`${styles.summaryCol} ${styles.summaryColLeave}`}>Leave</th>
                  <th className={`${styles.summaryCol} ${styles.summaryColOt}`}>OT</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.staffId}>
                    <td className={styles.stickyCol}>
                      <div className={styles.employeeName}>{row.employee}</div>
                      {row.role ? <div className={styles.employeeRole}>{row.role}</div> : null}
                    </td>
                    {resolvedRange.days.map((day) => {
                      const cell = row.cells[day];
                      return (
                        <td
                          key={`${row.staffId}-${day}`}
                          className={`${styles.dayCell} ${cell?.status ? styles.dayCellRecorded : styles.dayCellEmpty}`}
                          title={statusCellTitle(cell)}
                        >
                          {statusCode(cell)}
                        </td>
                      );
                    })}
                    <td className={`${styles.summaryCell} ${styles.summaryCellPresent}`}>
                      {row.totals.present}
                    </td>
                    <td className={`${styles.summaryCell} ${styles.summaryCellAbsent}`}>
                      {row.totals.absent}
                    </td>
                    <td className={`${styles.summaryCell} ${styles.summaryCellHalfDay}`}>
                      {row.totals.halfDay}
                    </td>
                    <td className={`${styles.summaryCell} ${styles.summaryCellLeave}`}>
                      {row.totals.leave}
                    </td>
                    <td className={`${styles.summaryCell} ${styles.summaryCellOt}`}>
                      {formatOtHoursTotal(row.totals.overtimeMinutes)}h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.legend} aria-label="Status legend">
            <span>P Present</span>
            <span>P* Present (late)</span>
            <span>A Absent</span>
            <span>H Half Day</span>
            <span>L Leave</span>
            <span>Ho Holiday</span>
            <span className={styles.legendMuted}>— Not recorded</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
