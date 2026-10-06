import React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal, StickyNote } from "lucide-react";
import {
  copyAttendance,
  getConfigHolidays,
  getConfigShifts,
  listAttendance,
  listStaff,
  upsertAttendanceRows,
  type AttendanceShiftConfig,
  type AttendanceDoc,
  type StaffDoc,
} from "../../../app/db/posRepository";
import { isHolidayDate, isWeeklyOffDay } from "../../../shared/attendanceSchedule";
import { csvCell } from "../../../shared/csv";
import { normalizeText, todayDateOnly, validationMessage } from "../../../shared/validation";
import { TEXT_LIMITS } from "../../../shared/textLimits";
import type { AttendanceStatus } from "../../../shared/pos";
import { useToast } from "../../context/ToastContext";
import { Button } from "../../components/ui/Button";
import { PortalMenu, PortalMenuItem } from "../../components/ui/PortalMenu";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAttendanceShortcuts } from "./hooks/useAttendanceShortcuts";
import styles from "./Attendance.module.css";
import menuStyles from "./components/CellMenu.module.css";
import { formatOvertimeHours } from "../People/peopleUtils";
import {
  formatAttendanceDate,
  shiftAttendanceDate,
  attendanceStatusLabel,
  statusTone,
} from "./attendanceDisplay";
import CellMenu from "./components/CellMenu";
import { NoteEditor, OvertimeEditor } from "./components/AttendanceEditors";
import {
  attendanceFieldHint,
  canMarkLate,
  canRecordOvertime,
  canSetShift,
  isWorkingAttendanceStatus,
} from "./attendanceRules";
type AttendanceRow = {
  id?: string;
  staffId: string;
  employee: string;
  role: string;
  shiftId: string;
  status: AttendanceStatus | null;
  isLate: boolean;
  scheduledOff: boolean;
  checkInTime: string;
  checkOutTime: string;
  breakMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  manualOvertime: boolean;
  remarks: string;
  dirty: boolean;
  errors: string[];
};

type ShiftOption = {
  value: string;
  label: string;
  hours: number;
};

const STATUS_DOT_CLASS: Record<string, string> = {
  present: menuStyles.statusDotPresent,
  absent: menuStyles.statusDotAbsent,
  halfDay: menuStyles.statusDotHalfDay,
  leave: menuStyles.statusDotLeave,
  holiday: menuStyles.statusDotHoliday,
  empty: menuStyles.statusDotEmpty,
};

function StatusDisplay({
  status,
  isLate = false,
}: {
  status: AttendanceStatus | null;
  isLate?: boolean;
}) {
  if (!status) {
    return (
      <>
        <span className={`${menuStyles.statusDot} ${STATUS_DOT_CLASS.empty}`} aria-hidden />
        <span title="Not recorded">—</span>
      </>
    );
  }
  const tone = statusTone(status);
  return (
    <>
      <span className={`${menuStyles.statusDot} ${STATUS_DOT_CLASS[tone] || ""}`} aria-hidden />
      {attendanceStatusLabel(status, isLate)}
    </>
  );
}

const STATUS_OPTIONS: Array<{ value: AttendanceStatus; label: string }> = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "half-day", label: "Half Day" },
  { value: "leave", label: "Leave" },
  { value: "holiday", label: "Holiday" },
];

const DEFAULT_SHIFT_OPTIONS: ShiftOption[] = [
  { value: "morning", label: "Morning", hours: 8 },
  { value: "evening", label: "Evening", hours: 8 },
  { value: "night", label: "Night", hours: 8 },
];

function toDateInput(ts: number) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function yesterdayDateOnly(fromDate: string) {
  const [year, month, day] = fromDate.split("-").map((part) => Number(part));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return toDateInput(date.getTime());
}

function validateRow(row: AttendanceRow) {
  const errors: string[] = [];
  if (row.dirty && !row.status) {
    errors.push("Choose a status before saving.");
  }
  if (row.status === "leave" && !normalizeText(row.remarks)) {
    errors.push(validationMessage("attendance-remarks-required-for-leave"));
  }
  if (row.overtimeMinutes < 0) {
    errors.push("Overtime cannot be negative.");
  }
  return errors;
}

function toShiftOptions(shifts: AttendanceShiftConfig[] | null | undefined): ShiftOption[] {
  if (!Array.isArray(shifts) || shifts.length === 0) {
    return DEFAULT_SHIFT_OPTIONS;
  }
  const mapped = shifts
    .map((entry) => ({
      value: String(entry.id || "")
        .trim()
        .toLowerCase(),
      label: String(entry.label || "").trim(),
      hours: Number(entry.hours),
    }))
    .filter(
      (entry) =>
        entry.value &&
        entry.label &&
        entry.value !== "half-day" &&
        entry.value !== "half" &&
        Number.isFinite(entry.hours) &&
        entry.hours > 0,
    );
  return mapped.length > 0 ? mapped : DEFAULT_SHIFT_OPTIONS;
}

function buildInitialRows(staff: StaffDoc[], records: AttendanceDoc[], attendanceDate: string) {
  const byStaff = new Map(records.map((record) => [record.staffId, record]));
  return staff.map((member) => {
    const record = byStaff.get(member.id);
    const row: AttendanceRow = {
      id: record?.id,
      staffId: member.id,
      employee: member.name,
      role: normalizeText(member.designation),
      shiftId: record?.shiftId || member.defaultShiftId || "morning",
      status: record?.status ?? null,
      isLate: Boolean(record?.isLate),
      scheduledOff: isWeeklyOffDay(member.weeklyOffDays, attendanceDate),
      checkInTime: record?.checkInTime || "",
      checkOutTime: record?.checkOutTime || "",
      breakMinutes: Number(record?.breakMinutes || 0),
      workedMinutes: Number(record?.workedMinutes || 0),
      overtimeMinutes: Number(record?.overtimeMinutes || 0),
      manualOvertime: false,
      remarks: record?.remarks || "",
      dirty: false,
      errors: [],
    };
    const manualOvertime = Number(record?.overtimeMinutes || 0) > 0;
    return {
      ...row,
      manualOvertime,
      overtimeMinutes: Number(record?.overtimeMinutes || 0),
    };
  });
}

function downloadTextFile(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function Attendance({ embedded = false }: { embedded?: boolean }) {
  const { showToast } = useToast();
  const [attendanceDate, setAttendanceDate] = React.useState(todayDateOnly());
  const [rows, setRows] = React.useState<AttendanceRow[]>([]);
  const [shiftOptions, setShiftOptions] = React.useState<ShiftOption[]>(DEFAULT_SHIFT_OPTIONS);
  const [search, setSearch] = React.useState("");
  const [shiftFilter, setShiftFilter] = React.useState<"all" | string>("all");
  const [editedOnly, setEditedOnly] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [otEditor, setOtEditor] = React.useState<{ index: number; employee: string } | null>(null);
  const [noteEditor, setNoteEditor] = React.useState<{ index: number; employee: string } | null>(
    null,
  );
  const [holidays, setHolidays] = React.useState<string[]>([]);
  const dateInputRef = React.useRef<HTMLInputElement>(null);
  const moreButtonRef = React.useRef<HTMLButtonElement>(null);
  const focusedRowRef = React.useRef(0);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [staff, records, shifts, holidayDates] = await Promise.all([
        listStaff({ includeInactive: false }),
        listAttendance({ date: attendanceDate }),
        getConfigShifts(),
        getConfigHolidays(),
      ]);
      const resolvedShiftOptions = toShiftOptions(shifts);
      setShiftOptions(resolvedShiftOptions);
      setHolidays(holidayDates);
      setRows(buildInitialRows(staff, records, attendanceDate));
    } catch (loadError) {
      const message = validationMessage(loadError, "Could not load attendance.");
      try {
        const staff = await listStaff({ includeInactive: false });
        if (staff.length > 0) {
          const shifts = await getConfigShifts();
          const resolvedShiftOptions = toShiftOptions(shifts);
          setShiftOptions(resolvedShiftOptions);
          setRows(buildInitialRows(staff, [], attendanceDate));
        }
      } catch {
        // keep original error
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [attendanceDate]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const setRowField = React.useCallback((index: number, patch: Partial<AttendanceRow>) => {
    setRows((previous) =>
      previous.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }
        const next = { ...row, ...patch, dirty: true };
        if (patch.status !== undefined) {
          if (!isWorkingAttendanceStatus(patch.status)) {
            next.isLate = false;
            next.overtimeMinutes = 0;
            next.manualOvertime = false;
          }
        }
        if (patch.overtimeMinutes !== undefined) {
          next.manualOvertime = true;
        }
        next.errors = validateRow(next);
        return next;
      }),
    );
  }, []);

  const filteredRows = React.useMemo(() => {
    const lowered = normalizeText(search).toLowerCase();
    return rows.filter((row) => {
      const shiftOk = shiftFilter === "all" || row.shiftId === shiftFilter;
      const dirtyOk = !editedOnly || row.dirty;
      const searchOk =
        !lowered ||
        row.employee.toLowerCase().includes(lowered) ||
        row.role.toLowerCase().includes(lowered);
      return shiftOk && dirtyOk && searchOk;
    });
  }, [editedOnly, rows, search, shiftFilter]);

  const changeDate = React.useCallback((nextDate: string) => {
    if (nextDate > todayDateOnly()) {
      return;
    }
    setAttendanceDate(nextDate);
  }, []);

  const stepDate = React.useCallback(
    (delta: number) => {
      changeDate(shiftAttendanceDate(attendanceDate, delta));
    },
    [attendanceDate, changeDate],
  );
  const dirtyCount = rows.filter((row) => row.dirty).length;
  const hasUnsaved = dirtyCount > 0;
  const hasActiveFilters = Boolean(search) || shiftFilter !== "all" || editedOnly;

  const isRestaurantHoliday = isHolidayDate(holidays, attendanceDate);

  const summary = React.useMemo(() => {
    const recorded = rows.filter((row) => row.status);
    const totalOvertime = recorded.reduce((sum, row) => sum + Number(row.overtimeMinutes || 0), 0);
    return {
      present: recorded.filter((row) => row.status === "present").length,
      absent: recorded.filter((row) => row.status === "absent").length,
      late: recorded.filter((row) => row.isLate).length,
      leave: recorded.filter((row) => row.status === "leave").length,
      halfDay: recorded.filter((row) => row.status === "half-day").length,
      holiday: recorded.filter((row) => row.status === "holiday").length,
      unrecorded: rows.filter((row) => !row.status).length,
      scheduledOff: rows.filter((row) => row.scheduledOff && !row.status).length,
      total: rows.length,
      overtimeHours: (totalOvertime / 60).toFixed(2),
    };
  }, [rows]);

  const markAll = React.useCallback((status: AttendanceStatus, includeScheduledOff = false) => {
    setRows((previous) =>
      previous.map((row) => {
        if (row.scheduledOff && !includeScheduledOff) {
          return row;
        }
        const next = {
          ...row,
          status,
          dirty: true,
          isLate: status === "present" || status === "half-day" ? row.isLate : false,
        };
        next.errors = validateRow(next);
        return next;
      }),
    );
  }, []);

  const copyYesterday = React.useCallback(async () => {
    const sourceDate = yesterdayDateOnly(attendanceDate);
    setSaving(true);
    try {
      await copyAttendance(sourceDate, attendanceDate);
      await loadData();
      showToast("Copied yesterday attendance.", "success");
    } catch (copyError) {
      showToast(validationMessage(copyError, "Could not copy yesterday attendance."), "error");
    } finally {
      setSaving(false);
    }
  }, [attendanceDate, loadData, showToast]);

  const save = React.useCallback(async () => {
    const nextRows = rows.map((row) => ({ ...row, errors: validateRow(row) }));
    setRows(nextRows);
    const firstError = nextRows.find((row) => row.errors.length > 0);
    if (firstError) {
      showToast(firstError.errors[0], "error");
      return;
    }
    setSaving(true);
    try {
      const dirtyRows = nextRows.filter((row) => row.dirty && row.status);
      if (dirtyRows.length === 0) {
        showToast("No changes to save.", "info");
        return;
      }
      await upsertAttendanceRows({
        attendanceDate,
        rows: dirtyRows.map((row) => ({
          id: row.id,
          staffId: row.staffId,
          shiftId: row.shiftId,
          status: row.status!,
          isLate: row.isLate,
          checkInTime: row.checkInTime || null,
          checkOutTime: row.checkOutTime || null,
          breakMinutes: row.breakMinutes,
          overtimeMinutes: row.overtimeMinutes,
          remarks: normalizeText(row.remarks) || null,
        })),
      });
      await loadData();
      showToast("Attendance saved successfully.", "success");
    } catch (saveError) {
      showToast(validationMessage(saveError, "Could not save attendance."), "error");
    } finally {
      setSaving(false);
    }
  }, [attendanceDate, loadData, rows, showToast]);

  const discardChanges = React.useCallback(async () => {
    await loadData();
    showToast("Unsaved changes discarded.", "info");
  }, [loadData, showToast]);

  const getShiftLabel = React.useCallback(
    (shiftId: string) => shiftOptions.find((option) => option.value === shiftId)?.label || shiftId,
    [shiftOptions],
  );

  const clearFilters = React.useCallback(() => {
    setSearch("");
    setShiftFilter("all");
    setEditedOnly(false);
  }, []);

  const exportExcel = React.useCallback(() => {
    const header = ["Employee", "Role", "Shift", "Status", "Late", "Overtime Hours", "Note"];
    const lines = [header.join(",")];
    rows.forEach((row) => {
      if (!row.status) {
        return;
      }
      lines.push(
        [
          row.employee,
          row.role,
          getShiftLabel(row.shiftId),
          row.status,
          row.isLate ? "Yes" : "No",
          (row.overtimeMinutes / 60).toFixed(2),
          row.remarks,
        ]
          .map(csvCell)
          .join(","),
      );
    });
    downloadTextFile(
      `attendance-${attendanceDate}.csv`,
      lines.join("\r\n"),
      "text/csv;charset=utf-8;",
    );
    showToast("Attendance exported to Excel-compatible CSV.", "success");
  }, [attendanceDate, getShiftLabel, rows, showToast]);

  const exportPdf = React.useCallback(async () => {
    const bodyRows = rows
      .filter((row) => row.status)
      .map(
        (row) =>
          `<tr>
            <td>${row.employee}</td>
            <td>${row.role}</td>
            <td>${getShiftLabel(row.shiftId)}</td>
            <td>${row.status}</td>
            <td>${row.isLate ? "Yes" : "No"}</td>
            <td>${(row.overtimeMinutes / 60).toFixed(2)}</td>
            <td>${row.remarks || "-"}</td>
          </tr>`,
      )
      .join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
      body { font-family: Arial, sans-serif; padding: 24px; color: var(--pos-tx); }
      h1 { margin: 0 0 6px; font-size: 20px; }
      p { margin: 0 0 12px; color: var(--pos-tx-sub); }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid var(--pos-line); padding: 6px; font-size: 11px; text-align: left; }
      th { background: var(--pos-surface-hover); text-transform: uppercase; }
    </style></head><body>
      <h1>Attendance Report</h1>
      <p>Date: ${attendanceDate}</p>
      <table>
      <thead><tr>
        <th>Employee</th><th>Role</th><th>Shift</th><th>Status</th><th>Late</th><th>OT Hours</th><th>Note</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody></table>
    </body></html>`;
    try {
      const result = await window.pos?.exportReportPdf?.(html, `attendance-${attendanceDate}.pdf`);
      if (!result?.ok) {
        throw new Error(result?.error || "pdf-export-failed");
      }
      showToast("Attendance exported to PDF.", "success");
    } catch (pdfError) {
      showToast(validationMessage(pdfError, "Could not export PDF."), "error");
    }
  }, [attendanceDate, getShiftLabel, rows, showToast]);

  const focusRowAt = React.useCallback(
    (index: number) => {
      focusedRowRef.current = Math.max(0, Math.min(index, filteredRows.length - 1));
    },
    [filteredRows.length],
  );

  useAttendanceShortcuts({
    onSave: save,
    onMarkAllPresent: () => markAll("present"),
    onMarkAllAbsent: () => markAll("absent"),
    onNextRow: () => focusRowAt(focusedRowRef.current + 1),
    onPreviousRow: () => focusRowAt(focusedRowRef.current - 1),
  });

  if (loading) {
    return (
      <div className={styles.root}>
        <Skeleton rows={3} label="Loading attendance..." />
      </div>
    );
  }

  return (
    <div className={embedded ? styles.rootEmbedded : styles.root}>
      <div className={styles.stickyChrome}>
        <div className={styles.toolbar}>
          <div className={styles.contextBar}>
            <div className={styles.contextPrimary}>
              <div className={styles.dateNav}>
                <button
                  type="button"
                  className={styles.dateNavBtn}
                  onClick={() => stepDate(-1)}
                  aria-label="Previous day"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  className={styles.dateDisplay}
                  onClick={() =>
                    dateInputRef.current?.showPicker?.() ?? dateInputRef.current?.click()
                  }
                >
                  {formatAttendanceDate(attendanceDate)}
                </button>
                <button
                  type="button"
                  className={styles.dateNavBtn}
                  onClick={() => stepDate(1)}
                  disabled={attendanceDate >= todayDateOnly()}
                  aria-label="Next day"
                >
                  <ChevronRight size={18} />
                </button>
                <input
                  ref={dateInputRef}
                  type="date"
                  className={styles.hiddenDateInput}
                  value={attendanceDate}
                  max={todayDateOnly()}
                  onChange={(event) => changeDate(event.target.value)}
                  tabIndex={-1}
                  aria-hidden
                />
              </div>
              <div className={styles.filterGroup}>
                <select
                  id="attendance-shift-filter"
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
                  id="attendance-search"
                  className={`pos-input ${styles.searchInput}`}
                  placeholder="Search employee..."
                  maxLength={TEXT_LIMITS.search}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
          </div>

          {isRestaurantHoliday ? (
            <div className={styles.holidayBanner} role="status">
              Restaurant holiday — mark staff as Holiday or skip unscheduled workers.
            </div>
          ) : null}

          <div className={styles.statusStrip}>
            <div className={styles.summaryStats} aria-label="Attendance summary">
              <span className={styles.stat}>
                <strong>{summary.present}</strong> Present
              </span>
              <span className={styles.stat}>
                <strong>{summary.absent}</strong> Absent
              </span>
              <span className={styles.stat}>
                <strong>{summary.halfDay}</strong> Half Day
              </span>
              <span className={styles.stat}>
                <strong>{summary.leave}</strong> Leave
              </span>
              <span className={styles.stat}>
                <strong>{summary.late}</strong> Late
              </span>
              <span className={styles.stat}>
                <strong>{summary.unrecorded}</strong> Not set
              </span>
              <span className={styles.stat}>
                <strong>{summary.overtimeHours}h</strong> OT
              </span>
            </div>

            <div className={styles.stripActions}>
              <button type="button" className={styles.stripBtn} onClick={() => markAll("present")}>
                Mark all present
              </button>
              <button type="button" className={styles.stripBtn} onClick={() => markAll("absent")}>
                Mark all absent
              </button>
              {isRestaurantHoliday ? (
                <button
                  type="button"
                  className={styles.stripBtn}
                  onClick={() => markAll("holiday", true)}
                >
                  Mark all holiday
                </button>
              ) : null}

              <button
                ref={moreButtonRef}
                type="button"
                className={styles.iconMenuBtn}
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => {
                  setMoreOpen((open) => !open);
                }}
              >
                <MoreHorizontal size={18} />
              </button>
              <PortalMenu
                open={moreOpen}
                anchorRef={moreButtonRef}
                align="right"
                onClose={() => setMoreOpen(false)}
              >
                <PortalMenuItem
                  disabled={saving}
                  onClick={() => {
                    void copyYesterday();
                    setMoreOpen(false);
                  }}
                >
                  Copy yesterday
                </PortalMenuItem>
                <PortalMenuItem
                  onClick={() => {
                    exportExcel();
                    setMoreOpen(false);
                  }}
                >
                  Export CSV
                </PortalMenuItem>
                <PortalMenuItem
                  onClick={() => {
                    void exportPdf();
                    setMoreOpen(false);
                  }}
                >
                  Export PDF
                </PortalMenuItem>
                <PortalMenuItem
                  onClick={() => {
                    setEditedOnly((value) => !value);
                    setMoreOpen(false);
                  }}
                >
                  {editedOnly ? "Show all rows" : "Show edited only"}
                </PortalMenuItem>
                {hasActiveFilters ? (
                  <PortalMenuItem
                    onClick={() => {
                      clearFilters();
                      setMoreOpen(false);
                    }}
                  >
                    Reset filters
                  </PortalMenuItem>
                ) : null}
              </PortalMenu>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className={styles.errorPanel} role="alert">
          <div>
            <strong>Could not load attendance</strong>
            <p>{error}</p>
          </div>
          <Button type="button" onClick={() => void loadData()} variant="secondary">
            Retry
          </Button>
        </div>
      )}

      {!error && filteredRows.length === 0 && (
        <div className={styles.empty}>
          {rows.length === 0
            ? "No active staff yet. Add staff in Roster before marking attendance."
            : "No employees match the current filters."}
        </div>
      )}

      {!error && filteredRows.length > 0 && (
        <div className={styles.gridWrap}>
          <table className={styles.grid}>
            <colgroup>
              <col className={styles.colEmployee} />
              <col className={styles.colShift} />
              <col className={styles.colStatus} />
              <col className={styles.colLate} />
              <col className={styles.colOt} />
              <col className={styles.colNote} />
            </colgroup>
            <thead>
              <tr>
                <th className={styles.colEmployee}>Employee</th>
                <th className={styles.colShift}>Shift</th>
                <th className={styles.colStatus}>Status</th>
                <th className={styles.colLate}>Late</th>
                <th className={styles.colOt}>OT</th>
                <th className={styles.colNote}>Note</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, viewIndex) => {
                const index = rows.findIndex((candidate) => candidate.staffId === row.staffId);
                const tone = statusTone(row.status);
                const lateEnabled = canMarkLate(row.status);
                const otEnabled = canRecordOvertime(row.status);
                const shiftEnabled = canSetShift(row.status);
                return (
                  <tr
                    key={row.staffId}
                    className={`${row.dirty ? styles.rowDirty : ""} ${row.scheduledOff ? styles.rowScheduledOff : ""}`.trim()}
                  >
                    <td className={styles.colEmployee}>
                      <div className={styles.employeeName}>{row.employee}</div>
                      {row.role ? <div className={styles.employeeRole}>{row.role}</div> : null}
                      {row.scheduledOff ? (
                        <div className={styles.scheduledOffBadge}>Scheduled off</div>
                      ) : null}
                      {row.errors.length > 0 ? (
                        <div className={styles.rowError}>{row.errors[0]}</div>
                      ) : null}
                    </td>
                    <td className={styles.colShift}>
                      <CellMenu
                        label={getShiftLabel(row.shiftId)}
                        ariaLabel={`Shift for ${row.employee}`}
                        disabled={!shiftEnabled}
                        disabledTitle={attendanceFieldHint("shift", row.status)}
                        options={shiftOptions.map((option) => ({
                          value: option.value,
                          label: option.label,
                          selected: option.value === row.shiftId,
                        }))}
                        onSelect={(shiftId) => {
                          focusedRowRef.current = viewIndex;
                          setRowField(index, { shiftId });
                        }}
                      />
                    </td>
                    <td className={styles.colStatus}>
                      <CellMenu
                        label={<StatusDisplay status={row.status} isLate={row.isLate} />}
                        ariaLabel={`Status for ${row.employee}`}
                        tone={tone}
                        options={STATUS_OPTIONS.map((option) => ({
                          value: option.value,
                          label: option.label,
                          selected: option.value === row.status,
                        }))}
                        onSelect={(status) => {
                          focusedRowRef.current = viewIndex;
                          setRowField(index, { status: status as AttendanceStatus });
                        }}
                      />
                    </td>
                    <td className={styles.colLate}>
                      <button
                        type="button"
                        className={`${styles.lateToggle} ${row.isLate ? styles.lateToggleOn : ""}`}
                        disabled={!lateEnabled}
                        onClick={() => {
                          focusedRowRef.current = viewIndex;
                          setRowField(index, { isLate: !row.isLate });
                        }}
                        aria-label={`Late for ${row.employee}`}
                        aria-pressed={row.isLate}
                        title={
                          lateEnabled ? "Mark as late" : attendanceFieldHint("late", row.status)
                        }
                      >
                        Late
                      </button>
                    </td>
                    <td className={styles.colOt}>
                      <button
                        type="button"
                        className={`${styles.quietCellBtn} ${!otEnabled ? styles.quietCellBtnDisabled : ""}`}
                        disabled={!otEnabled}
                        onClick={() => {
                          if (!otEnabled) {
                            return;
                          }
                          focusedRowRef.current = viewIndex;
                          setOtEditor({ index, employee: row.employee });
                        }}
                        aria-label={`Overtime for ${row.employee}`}
                        title={otEnabled ? "Edit overtime" : attendanceFieldHint("ot", row.status)}
                      >
                        {formatOvertimeHours(row.overtimeMinutes)}
                      </button>
                    </td>
                    <td className={styles.colNote}>
                      <button
                        type="button"
                        className={`${styles.noteBtn} ${row.remarks ? styles.noteBtnFilled : ""}`}
                        onClick={() => {
                          focusedRowRef.current = viewIndex;
                          setNoteEditor({ index, employee: row.employee });
                        }}
                        aria-label={`Note for ${row.employee}`}
                        title={row.remarks || "Add note"}
                      >
                        <StickyNote size={16} />
                        {row.remarks ? (
                          <span className={styles.notePreview}>{row.remarks}</span>
                        ) : null}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={`${styles.saveBar} ${hasUnsaved ? styles.saveBarActive : ""}`}>
        {hasUnsaved ? (
          <span className={styles.unsavedIndicator}>
            <span className={styles.unsavedDot} aria-hidden />
            {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
          </span>
        ) : (
          <span className={styles.savedHint}>No changes</span>
        )}
        <div className={styles.saveBarActions}>
          {hasUnsaved ? (
            <Button variant="ghost" onClick={() => void discardChanges()} disabled={saving}>
              Discard
            </Button>
          ) : null}
          <Button
            variant={hasUnsaved ? "primary" : "secondary"}
            onClick={save}
            disabled={saving || !hasUnsaved}
            title="Save changes (Ctrl+S)"
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <OvertimeEditor
        open={otEditor !== null}
        employee={otEditor?.employee || ""}
        minutes={otEditor ? rows[otEditor.index]?.overtimeMinutes || 0 : 0}
        onClose={() => setOtEditor(null)}
        onSave={(minutes) => {
          if (otEditor) {
            setRowField(otEditor.index, { overtimeMinutes: minutes });
          }
        }}
      />

      <NoteEditor
        open={noteEditor !== null}
        employee={noteEditor?.employee || ""}
        note={noteEditor ? rows[noteEditor.index]?.remarks || "" : ""}
        required={noteEditor ? rows[noteEditor.index]?.status === "leave" : false}
        onClose={() => setNoteEditor(null)}
        onSave={(remarks) => {
          if (noteEditor) {
            setRowField(noteEditor.index, { remarks });
          }
        }}
      />
    </div>
  );
}
