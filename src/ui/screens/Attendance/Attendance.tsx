import React from "react";
import {
  copyAttendance,
  getConfigShifts,
  listAttendance,
  listStaff,
  upsertAttendanceRows,
  type AttendanceShiftConfig,
  type AttendanceDoc,
  type StaffDoc,
} from "../../../app/db/posRepository";
import { isFutureDateOnly, normalizeText, validationMessage } from "../../../shared/validation";
import type { AttendanceStatus } from "../../../shared/pos";
import { useToast } from "../../context/ToastContext";
import StatusBadge from "./components/StatusBadge";
import { useAttendanceShortcuts } from "./hooks/useAttendanceShortcuts";
import styles from "./Attendance.module.css";

type AttendanceRow = {
  id?: string;
  staffId: string;
  employee: string;
  role: string;
  shiftId: string;
  status: AttendanceStatus;
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

type IconButtonProps = {
  label: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
};

const STATUS_OPTIONS: Array<{ value: AttendanceStatus; label: string }> = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "half-day", label: "Half Day" },
  { value: "leave", label: "Leave" },
  { value: "holiday", label: "Holiday" },
  { value: "week-off", label: "Week Off" },
  { value: "late", label: "Late" },
];

const DEFAULT_SHIFT_OPTIONS: ShiftOption[] = [
  { value: "morning", label: "Morning", hours: 8 },
  { value: "evening", label: "Evening", hours: 8 },
  { value: "night", label: "Night", hours: 8 },
  { value: "half-day", label: "Half Day", hours: 4 },
];

function toDateInput(ts: number) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function minutesFromTime(value: string) {
  if (!value || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    return null;
  }
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

function shiftMinutes(shiftId: string, shiftHoursById?: Record<string, number>) {
  const key = String(shiftId || "").toLowerCase();
  const configuredHours = Number(shiftHoursById?.[key]);
  if (Number.isFinite(configuredHours) && configuredHours > 0) {
    return Math.trunc(configuredHours * 60);
  }
  if (key === "half-day") {
    return 4 * 60;
  }
  return 8 * 60;
}

function computeDurations(row: AttendanceRow, shiftHoursById?: Record<string, number>) {
  const inMinutes = minutesFromTime(row.checkInTime);
  const outMinutes = minutesFromTime(row.checkOutTime);
  if ((inMinutes === null) !== (outMinutes === null)) {
    return { workedMinutes: row.workedMinutes, overtimeMinutes: row.overtimeMinutes, invalid: true };
  }
  if (inMinutes === null || outMinutes === null) {
    return { workedMinutes: 0, overtimeMinutes: 0, invalid: false };
  }
  if (outMinutes < inMinutes) {
    return { workedMinutes: 0, overtimeMinutes: 0, invalid: true };
  }
  const rawWorked = outMinutes - inMinutes;
  if (row.breakMinutes > rawWorked) {
    return { workedMinutes: 0, overtimeMinutes: 0, invalid: true };
  }
  const workedMinutes = Math.max(0, rawWorked - row.breakMinutes);
  const autoOvertime = Math.max(0, workedMinutes - shiftMinutes(row.shiftId, shiftHoursById));
  return {
    workedMinutes,
    overtimeMinutes: row.manualOvertime ? Math.max(0, row.overtimeMinutes) : autoOvertime,
    invalid: false,
  };
}

function validateRow(date: string, row: AttendanceRow) {
  const errors: string[] = [];
  if (isFutureDateOnly(date)) {
    errors.push(validationMessage("attendance-date-future"));
  }
  if (row.status === "leave" && !normalizeText(row.remarks)) {
    errors.push(validationMessage("attendance-remarks-required-for-leave"));
  }
  const inMinutes = minutesFromTime(row.checkInTime);
  const outMinutes = minutesFromTime(row.checkOutTime);
  if ((inMinutes === null) !== (outMinutes === null)) {
    errors.push(validationMessage("attendance-time-invalid"));
  }
  if (inMinutes !== null && outMinutes !== null && outMinutes < inMinutes) {
    errors.push(validationMessage("attendance-checkout-before-checkin"));
  }
  if (row.breakMinutes < 0) {
    errors.push(validationMessage("attendance-break-invalid"));
  }
  if (inMinutes !== null && outMinutes !== null && row.breakMinutes > outMinutes - inMinutes) {
    errors.push(validationMessage("attendance-break-exceeds-worked"));
  }
  return errors;
}

function toShiftOptions(shifts: AttendanceShiftConfig[] | null | undefined): ShiftOption[] {
  if (!Array.isArray(shifts) || shifts.length === 0) {
    return DEFAULT_SHIFT_OPTIONS;
  }
  const mapped = shifts
    .map((entry) => ({
      value: String(entry.id || "").trim().toLowerCase(),
      label: String(entry.label || "").trim(),
      hours: Number(entry.hours),
    }))
    .filter((entry) => entry.value && entry.label && Number.isFinite(entry.hours) && entry.hours > 0);
  return mapped.length > 0 ? mapped : DEFAULT_SHIFT_OPTIONS;
}

function buildInitialRows(
  staff: StaffDoc[],
  records: AttendanceDoc[],
  shiftHoursById?: Record<string, number>,
) {
  const byStaff = new Map(records.map((record) => [record.staffId, record]));
  return staff.map((member) => {
    const record = byStaff.get(member.id);
    const row: AttendanceRow = {
      id: record?.id,
      staffId: member.id,
      employee: member.name,
      role: member.designation || "-",
      shiftId: record?.shiftId || "morning",
      status: record?.status || "absent",
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
    const auto = computeDurations({ ...row, manualOvertime: false }, shiftHoursById);
    const manualOvertime = row.overtimeMinutes !== auto.overtimeMinutes;
    const recomputed = computeDurations({ ...row, manualOvertime }, shiftHoursById);
    return {
      ...row,
      manualOvertime,
      workedMinutes: recomputed.workedMinutes,
      overtimeMinutes: manualOvertime ? row.overtimeMinutes : recomputed.overtimeMinutes,
    };
  });
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
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

function IconButton({ label, title, icon, onClick, disabled, active }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.iconButton} ${active ? styles.iconButtonActive : ""}`}
      onClick={onClick}
      title={title}
      aria-label={label}
      disabled={disabled}
    >
      {icon}
      <span className={styles.iconButtonLabel}>{label}</span>
    </button>
  );
}

function MiniIcon({ children }: { children: React.ReactNode }) {
  return <span className={styles.iconGlyph}>{children}</span>;
}

export default function Attendance() {
  const { showToast } = useToast();
  const [attendanceDate, setAttendanceDate] = React.useState(toDateInput(Date.now()));
  const [rows, setRows] = React.useState<AttendanceRow[]>([]);
  const [shiftOptions, setShiftOptions] = React.useState<ShiftOption[]>(DEFAULT_SHIFT_OPTIONS);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | AttendanceStatus>("all");
  const [shiftFilter, setShiftFilter] = React.useState<"all" | string>("all");
  const [editedOnly, setEditedOnly] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"table" | "cards">("table");
  const [headerSize, setHeaderSize] = React.useState(11);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const focusedRowRef = React.useRef(0);
  const rowFocusRefs = React.useRef<Array<HTMLSelectElement | null>>([]);

  const shiftHoursById = React.useMemo(
    () =>
      shiftOptions.reduce<Record<string, number>>((acc, option) => {
        acc[option.value] = Number(option.hours || 0);
        return acc;
      }, {}),
    [shiftOptions],
  );

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [staff, records, shifts] = await Promise.all([
        listStaff({ includeInactive: false }),
        listAttendance({ date: attendanceDate }),
        getConfigShifts(),
      ]);
      const resolvedShiftOptions = toShiftOptions(shifts);
      const resolvedShiftHoursById = resolvedShiftOptions.reduce<Record<string, number>>((acc, item) => {
        acc[item.value] = item.hours;
        return acc;
      }, {});
      setShiftOptions(resolvedShiftOptions);
      setRows(buildInitialRows(staff, records, resolvedShiftHoursById));
    } catch (loadError) {
      setError(validationMessage(loadError, "Could not load attendance."));
    } finally {
      setLoading(false);
    }
  }, [attendanceDate]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const setRowField = React.useCallback(
    (index: number, patch: Partial<AttendanceRow>) => {
      setRows((previous) =>
        previous.map((row, rowIndex) => {
          if (rowIndex !== index) {
            return row;
          }
          const next = { ...row, ...patch, dirty: true };
          if (patch.overtimeMinutes !== undefined) {
            next.manualOvertime = true;
          }
          const calc = computeDurations(next, shiftHoursById);
          if (!next.manualOvertime) {
            next.overtimeMinutes = calc.overtimeMinutes;
          }
          next.workedMinutes = calc.workedMinutes;
          next.errors = validateRow(attendanceDate, next);
          return next;
        }),
      );
    },
    [attendanceDate, shiftHoursById],
  );

  const filteredRows = React.useMemo(() => {
    const lowered = normalizeText(search).toLowerCase();
    return rows.filter((row) => {
      const statusOk = statusFilter === "all" || row.status === statusFilter;
      const shiftOk = shiftFilter === "all" || row.shiftId === shiftFilter;
      const dirtyOk = !editedOnly || row.dirty;
      const searchOk =
        !lowered ||
        row.employee.toLowerCase().includes(lowered) ||
        row.role.toLowerCase().includes(lowered);
      return statusOk && shiftOk && dirtyOk && searchOk;
    });
  }, [editedOnly, rows, search, shiftFilter, statusFilter]);

  const dirtyCount = rows.filter((row) => row.dirty).length;
  const hasActiveFilters = Boolean(search) || statusFilter !== "all" || shiftFilter !== "all" || editedOnly;
  const headerStyle = React.useMemo(
    () =>
      ({
        ["--attendance-table-header-font-size" as never]: `${headerSize}px`,
        ["--attendance-table-header-padding" as never]: `${Math.max(6, headerSize - 3)}px ${Math.max(8, headerSize)}px`,
      }) as React.CSSProperties,
    [headerSize],
  );

  const summary = React.useMemo(() => {
    const totalOvertime = rows.reduce((sum, row) => sum + Number(row.overtimeMinutes || 0), 0);
    return {
      present: rows.filter((row) => row.status === "present").length,
      absent: rows.filter((row) => row.status === "absent").length,
      late: rows.filter((row) => row.status === "late").length,
      leave: rows.filter((row) => row.status === "leave").length,
      holiday: rows.filter((row) => row.status === "holiday").length,
      weekOff: rows.filter((row) => row.status === "week-off").length,
      total: rows.length,
      overtimeHours: (totalOvertime / 60).toFixed(2),
    };
  }, [rows]);

  const markAll = React.useCallback(
    (status: AttendanceStatus) => {
      setRows((previous) =>
        previous.map((row) => {
          const next = { ...row, status, dirty: true };
          next.errors = validateRow(attendanceDate, next);
          return next;
        }),
      );
    },
    [attendanceDate],
  );

  const copyYesterday = React.useCallback(async () => {
    const now = new Date(`${attendanceDate}T00:00:00`);
    now.setDate(now.getDate() - 1);
    const sourceDate = toDateInput(now.getTime());
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
    const nextRows = rows.map((row) => ({ ...row, errors: validateRow(attendanceDate, row) }));
    setRows(nextRows);
    const firstError = nextRows.find((row) => row.errors.length > 0);
    if (firstError) {
      showToast(firstError.errors[0], "error");
      return;
    }
    setSaving(true);
    try {
      await upsertAttendanceRows({
        attendanceDate,
        rows: nextRows.map((row) => ({
          id: row.id,
          staffId: row.staffId,
          shiftId: row.shiftId,
          status: row.status,
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

  const getShiftLabel = React.useCallback(
    (shiftId: string) => shiftOptions.find((option) => option.value === shiftId)?.label || shiftId,
    [shiftOptions],
  );

  const clearFilters = React.useCallback(() => {
    setSearch("");
    setStatusFilter("all");
    setShiftFilter("all");
    setEditedOnly(false);
  }, []);

  const exportExcel = React.useCallback(() => {
    const header = [
      "Employee",
      "Role",
      "Shift",
      "Status",
      "Check In",
      "Check Out",
      "Break Minutes",
      "Worked Hours",
      "Overtime Hours",
      "Remarks",
    ];
    const lines = [header.join(",")];
    rows.forEach((row) => {
      lines.push(
        [
          row.employee,
          row.role,
          getShiftLabel(row.shiftId),
          row.status,
          row.checkInTime,
          row.checkOutTime,
          row.breakMinutes,
          (row.workedMinutes / 60).toFixed(2),
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
      .map(
        (row) =>
          `<tr>
            <td>${row.employee}</td>
            <td>${row.role}</td>
            <td>${getShiftLabel(row.shiftId)}</td>
            <td>${row.status}</td>
            <td>${row.checkInTime || "-"}</td>
            <td>${row.checkOutTime || "-"}</td>
            <td>${row.breakMinutes}</td>
            <td>${(row.workedMinutes / 60).toFixed(2)}</td>
            <td>${(row.overtimeMinutes / 60).toFixed(2)}</td>
            <td>${row.remarks || "-"}</td>
          </tr>`,
      )
      .join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
      h1 { margin: 0 0 6px; font-size: 20px; }
      p { margin: 0 0 12px; color: #6b7280; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #e5e7eb; padding: 6px; font-size: 11px; text-align: left; }
      th { background: #f9fafb; text-transform: uppercase; }
    </style></head><body>
      <h1>Attendance Report</h1>
      <p>Date: ${attendanceDate}</p>
      <table>
      <thead><tr>
        <th>Employee</th><th>Role</th><th>Shift</th><th>Status</th><th>Check In</th><th>Check Out</th>
        <th>Break</th><th>Worked Hours</th><th>Overtime Hours</th><th>Remarks</th>
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
      const safeIndex = Math.max(0, Math.min(index, filteredRows.length - 1));
      focusedRowRef.current = safeIndex;
      const element = rowFocusRefs.current[safeIndex];
      element?.focus();
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
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.headerRow}>
          <div>
            <h2 className="pos-ph-title">Attendance</h2>
            <p className="pos-ph-sub">Simplified daily roster with fast edits, filters, and exports.</p>
          </div>
          <div className={styles.headerActions}>
            {dirtyCount > 0 && <div className={styles.unsaved}>{dirtyCount} unsaved change(s)</div>}
            <button
              type="button"
              className="pos-btn pos-btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        <div className={styles.filterGrid}>
          <div>
            <label className="pos-label" htmlFor="attendance-date">
              Attendance Date
            </label>
            <input
              id="attendance-date"
              type="date"
              className={`pos-input ${styles.input}`}
              value={attendanceDate}
              max={toDateInput(Date.now())}
              onChange={(event) => setAttendanceDate(event.target.value)}
            />
          </div>
          <div>
            <label className="pos-label" htmlFor="attendance-shift-filter">
              Shift
            </label>
            <select
              id="attendance-shift-filter"
              className="pos-select"
              value={shiftFilter}
              onChange={(event) => setShiftFilter(event.target.value)}
            >
              <option value="all">All Shifts</option>
              {shiftOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="pos-label" htmlFor="attendance-search">
              Search Employee
            </label>
            <input
              id="attendance-search"
              className="pos-input"
              placeholder="Search by employee or role"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div>
            <label className="pos-label" htmlFor="attendance-status-filter">
              Status Filter
            </label>
            <select
              id="attendance-status-filter"
              className="pos-select"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value === "all" ? "all" : (event.target.value as AttendanceStatus),
                )
              }
            >
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="pos-label" htmlFor="attendance-edited-only">
              Scope
            </label>
            <label className={styles.checkboxRow} htmlFor="attendance-edited-only">
              <input
                id="attendance-edited-only"
                type="checkbox"
                checked={editedOnly}
                onChange={(event) => setEditedOnly(event.target.checked)}
              />
              Show only edited rows
            </label>
          </div>
        </div>

        <div className={styles.actions}>
          <div className={styles.actionGroup}>
            <IconButton
              label="Present"
              title="Mark all present"
              icon={<MiniIcon>✓</MiniIcon>}
              onClick={() => markAll("present")}
            />
            <IconButton
              label="Absent"
              title="Mark all absent"
              icon={<MiniIcon>⊘</MiniIcon>}
              onClick={() => markAll("absent")}
            />
            <IconButton
              label="Copy"
              title="Copy yesterday"
              icon={<MiniIcon>⟲</MiniIcon>}
              onClick={copyYesterday}
              disabled={saving}
            />
          </div>

          <div className={styles.actionGroup}>
            <IconButton
              label="Excel"
              title="Export Excel"
              icon={<MiniIcon>⇩</MiniIcon>}
              onClick={exportExcel}
            />
            <IconButton
              label="PDF"
              title="Export PDF"
              icon={<MiniIcon>▣</MiniIcon>}
              onClick={exportPdf}
            />
          </div>

          <div className={styles.actionGroup}>
            <IconButton
              label="Table"
              title="Table view"
              icon={<MiniIcon>▦</MiniIcon>}
              onClick={() => setViewMode("table")}
              active={viewMode === "table"}
            />
            <IconButton
              label="Cards"
              title="Card view"
              icon={<MiniIcon>▤</MiniIcon>}
              onClick={() => setViewMode("cards")}
              active={viewMode === "cards"}
            />
            {hasActiveFilters && (
              <IconButton
                label="Reset"
                title="Reset filters"
                icon={<MiniIcon>↺</MiniIcon>}
                onClick={clearFilters}
              />
            )}
          </div>

          <div className={styles.headerSizeControl}>
            <label className="pos-label" htmlFor="attendance-header-size">
              Table header size
            </label>
            <div className={styles.headerSizeRow}>
              <input
                id="attendance-header-size"
                type="range"
                min={9}
                max={16}
                step={1}
                value={headerSize}
                onChange={(event) => setHeaderSize(Number(event.target.value))}
                className={styles.headerSlider}
                aria-label="Adjust table header size"
              />
              <span className={styles.headerSizeValue}>{headerSize}px</span>
            </div>
          </div>
        </div>

        <div className={styles.shortcutHint} aria-label="Keyboard shortcuts summary">
          Shortcuts: Ctrl+S Save, Ctrl+P Present, Ctrl+A Absent, Alt+N/P Move Row
        </div>
      </div>

      <div className={styles.summaryGrid}>
        <SummaryCard label="Present" value={summary.present} />
        <SummaryCard label="Absent" value={summary.absent} />
        <SummaryCard label="Late" value={summary.late} />
        <SummaryCard label="Leave" value={summary.leave} />
        <SummaryCard label="Holiday" value={summary.holiday} />
        <SummaryCard label="Week Off" value={summary.weekOff} />
        <SummaryCard label="Total Staff" value={summary.total} />
        <SummaryCard label="Overtime Hours" value={summary.overtimeHours} />
      </div>

      {error && <div className="pos-field-error">{error}</div>}
      {!error && filteredRows.length === 0 && <div className={styles.empty}>No staff records found.</div>}

      {!error && filteredRows.length > 0 && (
        <>
          {viewMode === "table" && (
            <div className={styles.gridWrap} style={headerStyle}>
              <table className={styles.grid}>
                <thead>
                  <tr>
                    <th className={styles.stickyCol}>Employee</th>
                    <th>Role</th>
                    <th>Shift</th>
                    <th>Attendance Status</th>
                    <th>Check In</th>
                    <th>Check Out</th>
                    <th>Break Minutes</th>
                    <th>Worked Hours</th>
                    <th>Overtime</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, viewIndex) => {
                    const index = rows.findIndex((candidate) => candidate.staffId === row.staffId);
                    return (
                      <tr key={row.staffId} className={row.dirty ? styles.rowDirty : undefined}>
                        <td className={styles.stickyCol}>
                          <div style={{ fontWeight: 700 }}>{row.employee}</div>
                          <div style={{ marginTop: 5 }}>
                            <StatusBadge status={row.status} />
                          </div>
                        </td>
                        <td>{row.role}</td>
                        <td>
                          <select
                            className="pos-select"
                            value={row.shiftId}
                            onFocus={() => {
                              focusedRowRef.current = viewIndex;
                            }}
                            onChange={(event) => setRowField(index, { shiftId: event.target.value })}
                          >
                            {shiftOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            ref={(element) => {
                              rowFocusRefs.current[viewIndex] = element;
                            }}
                            className="pos-select"
                            value={row.status}
                            aria-label={`Attendance status for ${row.employee}`}
                            onFocus={() => {
                              focusedRowRef.current = viewIndex;
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                focusRowAt(viewIndex + 1);
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                (event.currentTarget as HTMLSelectElement).blur();
                              }
                            }}
                            onChange={(event) =>
                              setRowField(index, { status: event.target.value as AttendanceStatus })
                            }
                          >
                            {STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="time"
                            className="pos-input"
                            value={row.checkInTime}
                            onChange={(event) =>
                              setRowField(index, { checkInTime: event.target.value })
                            }
                            aria-label={`Check in time for ${row.employee}`}
                          />
                        </td>
                        <td>
                          <input
                            type="time"
                            className="pos-input"
                            value={row.checkOutTime}
                            onChange={(event) =>
                              setRowField(index, { checkOutTime: event.target.value })
                            }
                            aria-label={`Check out time for ${row.employee}`}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            className="pos-input"
                            value={row.breakMinutes}
                            onChange={(event) =>
                              setRowField(index, {
                                breakMinutes: Math.max(0, Number(event.target.value || 0)),
                              })
                            }
                            aria-label={`Break minutes for ${row.employee}`}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className="pos-input"
                            value={(row.workedMinutes / 60).toFixed(2)}
                            readOnly
                            aria-label={`Worked hours for ${row.employee}`}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            className="pos-input"
                            value={row.overtimeMinutes}
                            onChange={(event) =>
                              setRowField(index, {
                                overtimeMinutes: Math.max(
                                  0,
                                  Math.trunc(Number(event.target.value || 0)),
                                ),
                              })
                            }
                            aria-label={`Overtime minutes for ${row.employee}`}
                          />
                        </td>
                        <td>
                          <textarea
                            className="pos-input"
                            rows={1}
                            value={row.remarks}
                            onChange={(event) => setRowField(index, { remarks: event.target.value })}
                            aria-label={`Remarks for ${row.employee}`}
                          />
                          {row.errors.length > 0 && (
                            <div className={styles.rowError}>{row.errors[0]}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className={`${styles.mobileCards} ${viewMode === "cards" ? styles.mobileCardsVisible : ""}`}>
            {filteredRows.map((row) => {
              const index = rows.findIndex((candidate) => candidate.staffId === row.staffId);
              return (
                <article className={styles.mobileCard} key={`mobile-${row.staffId}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>{row.employee}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{row.role}</div>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className={styles.mobileRow}>
                    <label className="pos-label">Shift</label>
                    <select
                      className="pos-select"
                      value={row.shiftId}
                      onChange={(event) => setRowField(index, { shiftId: event.target.value })}
                    >
                      {shiftOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.mobileRow}>
                    <label className="pos-label">Status</label>
                    <select
                      className="pos-select"
                      value={row.status}
                      onChange={(event) =>
                        setRowField(index, { status: event.target.value as AttendanceStatus })
                      }
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.mobileRow}>
                    <label className="pos-label">Check In</label>
                    <input
                      type="time"
                      className="pos-input"
                      value={row.checkInTime}
                      onChange={(event) => setRowField(index, { checkInTime: event.target.value })}
                    />
                  </div>
                  <div className={styles.mobileRow}>
                    <label className="pos-label">Check Out</label>
                    <input
                      type="time"
                      className="pos-input"
                      value={row.checkOutTime}
                      onChange={(event) => setRowField(index, { checkOutTime: event.target.value })}
                    />
                  </div>
                  <div className={styles.mobileRow}>
                    <label className="pos-label">Break</label>
                    <input
                      type="number"
                      min={0}
                      className="pos-input"
                      value={row.breakMinutes}
                      onChange={(event) =>
                        setRowField(index, {
                          breakMinutes: Math.max(0, Number(event.target.value || 0)),
                        })
                      }
                    />
                  </div>
                  <div className={styles.mobileRow}>
                    <label className="pos-label">Worked Hours</label>
                    <input
                      type="text"
                      readOnly
                      className="pos-input"
                      value={(row.workedMinutes / 60).toFixed(2)}
                    />
                  </div>
                  <div className={styles.mobileRow}>
                    <label className="pos-label">Overtime</label>
                    <input
                      type="number"
                      min={0}
                      className="pos-input"
                      value={row.overtimeMinutes}
                      onChange={(event) =>
                        setRowField(index, {
                          overtimeMinutes: Math.max(
                            0,
                            Math.trunc(Number(event.target.value || 0)),
                          ),
                        })
                      }
                    />
                  </div>
                  <textarea
                    className="pos-input"
                    rows={2}
                    value={row.remarks}
                    placeholder="Remarks"
                    onChange={(event) => setRowField(index, { remarks: event.target.value })}
                  />
                  {row.errors.length > 0 && <div className={styles.rowError}>{row.errors[0]}</div>}
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryLabel}>{label}</div>
      <div className={styles.summaryValue}>{value}</div>
    </div>
  );
}
