import React from "react";
import {
  createSalaryAdvance,
  listSalaryAdvances,
  listStaff,
  voidSalaryAdvance,
  type StaffDoc,
} from "../../../app/db/posRepository";
import type { SalaryAdvanceDto } from "../../../shared/pos";
import { parsePositiveMoney, validationMessage } from "../../../shared/validation";
import { useToast } from "../../context/ToastContext";
import { Button } from "../../components/ui/Button";
import { Stat } from "../../components/ui/Stat";
import { DataTable } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { filterStaffBySearch } from "../People/peopleUtils";
import "../Expenses/Expenses.module.css";

type RangePreset = "thisMonth" | "lastMonth" | "custom";

type AdvanceRow = SalaryAdvanceDto & {
  balanceAfter?: number | null;
};

type SalaryAdvancesProps = {
  embedded?: boolean;
  registerRecordAdvance?: (open: () => void) => void;
  initialStaffId?: string | null;
};

function sod(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function eod(d: Date) {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

function getPresetRange(preset: Exclude<RangePreset, "custom">): { from: number; to: number } {
  const now = new Date();
  if (preset === "lastMonth") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: sod(from).getTime(), to: eod(to).getTime() };
  }
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: sod(from).getTime(), to: eod(now).getTime() };
}

function toInputDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeLabel(preset: RangePreset): string {
  if (preset === "lastMonth") return "Last month";
  if (preset === "custom") return "Selected range";
  return "This month";
}

function staffIdFromHash(): string | null {
  const hash = window.location.hash || "";
  const q = hash.indexOf("?");
  if (q === -1) return null;
  const params = new URLSearchParams(hash.slice(q + 1));
  return params.get("staff") || params.get("staffId");
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN")}`;
}

function attachRunningBalances(
  rows: SalaryAdvanceDto[],
  staffById: Map<string, StaffDoc>,
): AdvanceRow[] {
  const totalsByStaff = new Map<string, number>();
  return rows.map((row) => {
    const prior = totalsByStaff.get(row.staffId) || 0;
    const nextTotal = prior + Number(row.amount || 0);
    totalsByStaff.set(row.staffId, nextTotal);
    const salary = staffById.get(row.staffId)?.salary;
    const balanceAfter =
      salary === null || salary === undefined ? null : Math.max(0, Number(salary) - nextTotal);
    return { ...row, balanceAfter };
  });
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "custom", label: "Custom" },
];

export default function SalaryAdvances({
  embedded = false,
  registerRecordAdvance,
  initialStaffId = null,
}: SalaryAdvancesProps) {
  const toast = useToast();
  const initRange = getPresetRange("thisMonth");
  const [loading, setLoading] = React.useState(true);
  const [staff, setStaff] = React.useState<StaffDoc[]>([]);
  const [advances, setAdvances] = React.useState<AdvanceRow[]>([]);
  const [addOpen, setAddOpen] = React.useState(false);
  const [preset, setPreset] = React.useState<RangePreset>("thisMonth");
  const [fromTs, setFromTs] = React.useState(initRange.from);
  const [toTs, setToTs] = React.useState(initRange.to);
  const [search, setSearch] = React.useState("");
  const [staffFilter, setStaffFilter] = React.useState<string>(() => initialStaffId || staffIdFromHash() || "all");
  const [form, setForm] = React.useState({
    staffId: "",
    amount: "",
    advanceDate: toInputDate(Date.now()),
    note: "",
  });
  const [monthSummaryTotal, setMonthSummaryTotal] = React.useState(0);

  React.useEffect(() => {
    registerRecordAdvance?.(() => setAddOpen(true));
  }, [registerRecordAdvance]);

  React.useEffect(() => {
    const onHash = () => {
      const id = staffIdFromHash();
      if (id) setStaffFilter(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [members, rows] = await Promise.all([
        listStaff({ status: "active" }),
        listSalaryAdvances({
          from: fromTs,
          to: toTs,
          staffId: staffFilter === "all" ? undefined : staffFilter,
          limit: 500,
        }),
      ]);
      setStaff(members);
      const staffById = new Map(members.map((member) => [member.id, member]));
      setAdvances(attachRunningBalances(rows as SalaryAdvanceDto[], staffById));
      setForm((current) =>
        current.staffId || !members[0]
          ? current
          : { ...current, staffId: staffFilter !== "all" ? staffFilter : members[0].id },
      );
    } catch (error: unknown) {
      toast.showToast(validationMessage(error, "Could not load salary advances"), "error");
    } finally {
      setLoading(false);
    }
  }, [fromTs, toTs, staffFilter, toast]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!addOpen || !form.staffId) {
      setMonthSummaryTotal(0);
      return;
    }
    const range = getPresetRange("thisMonth");
    let cancelled = false;
    void listSalaryAdvances({
      from: range.from,
      to: range.to,
      staffId: form.staffId,
      limit: 500,
    })
      .then((rows) => {
        if (cancelled) return;
        const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        setMonthSummaryTotal(total);
      })
      .catch(() => {
        if (!cancelled) setMonthSummaryTotal(0);
      });
    return () => {
      cancelled = true;
    };
  }, [addOpen, form.staffId]);

  const filteredStaff = filterStaffBySearch(staff, search);
  const visibleAdvances = React.useMemo(() => {
    if (!search.trim()) return advances;
    const allowed = new Set(filteredStaff.map((member) => member.id));
    return advances.filter((row) => allowed.has(row.staffId));
  }, [advances, filteredStaff, search]);

  const periodTotal = visibleAdvances.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const employeeCount = new Set(visibleAdvances.map((row) => row.staffId)).size;

  const selectedStaff = staff.find((member) => member.id === form.staffId) || null;
  const pendingFormAmount = parsePositiveMoney(form.amount) || 0;
  const salaryAfterAdvances =
    selectedStaff?.salary === null || selectedStaff?.salary === undefined
      ? null
      : Math.max(0, Number(selectedStaff.salary) - monthSummaryTotal - pendingFormAmount);

  const submit = async () => {
    const amount = parsePositiveMoney(form.amount);
    if (!form.staffId || amount === null) return;
    const date = new Date(form.advanceDate);
    date.setHours(12, 0, 0, 0);
    if (isNaN(date.getTime())) {
      toast.showToast(validationMessage("salary-advance-date-invalid"), "error");
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
      toast.showToast("Salary advance recorded", "success");
      await refresh();
    } catch (error: unknown) {
      toast.showToast(validationMessage(error, "Could not save salary advance"), "error");
    }
  };

  const content = (
    <>
      <div className="exp-toolbar">
        <div className="exp-preset-row">
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`exp-preset-btn${preset === key ? " active" : ""}`}
              aria-pressed={preset === key}
              onClick={() => {
                setPreset(key);
                if (key !== "custom") {
                  const range = getPresetRange(key);
                  setFromTs(range.from);
                  setToTs(range.to);
                }
              }}
            >
              {label}
            </button>
          ))}
          {preset === "custom" && (
            <>
              <input
                type="date"
                className="exp-date-input"
                value={toInputDate(fromTs)}
                max={toInputDate(toTs)}
                onChange={(e) => {
                  const d = new Date(e.target.value);
                  d.setHours(0, 0, 0, 0);
                  if (!isNaN(d.getTime())) setFromTs(d.getTime());
                }}
              />
              <span className="exp-date-sep">–</span>
              <input
                type="date"
                className="exp-date-input"
                value={toInputDate(toTs)}
                min={toInputDate(fromTs)}
                max={toInputDate(Date.now())}
                onChange={(e) => {
                  const d = new Date(e.target.value);
                  d.setHours(23, 59, 59, 999);
                  if (!isNaN(d.getTime())) setToTs(d.getTime());
                }}
              />
            </>
          )}
        </div>
        <div className="exp-filter">
          <Select
            label="Employee"
            labelHidden
            aria-label="Employee"
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
          >
            <option value="all">All employees</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="exp-filter">
          <Input
            label="Search"
            labelHidden
            aria-label="Search employee"
            placeholder="Search employee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="exp-kpi-grid">
        <Stat
          label={rangeLabel(preset)}
          value={formatMoney(periodTotal)}
          primary
        />
        <Stat
          label="Employees"
          value={employeeCount === 0 ? "0" : String(employeeCount)}
        />
        <Stat label="Entries" value={String(visibleAdvances.length)} />
      </div>

      {loading ? (
        <div className="pos-empty">Loading salary advances…</div>
      ) : visibleAdvances.length === 0 ? (
        <EmptyState
          title={
            advances.length === 0
              ? `No salary advances ${rangeLabel(preset).toLowerCase()}`
              : "No matching salary advances"
          }
          text="Record cash advances taken by staff against their monthly salary."
          actionLabel="Record Advance"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <DataTable
          headers={["Employee", "Date", "Amount", "Note", "Salary after advances", ""]}
          rows={visibleAdvances.map((row) => [
            row.staffName || "—",
            new Date(row.advanceDate).toLocaleDateString("en-IN"),
            formatMoney(row.amount),
            row.note || "—",
            formatMoney(row.balanceAfter),
            <Button
              key={row.id}
              variant="danger-ghost"
              size="sm"
              onClick={async () => {
                try {
                  await voidSalaryAdvance(row.id);
                  toast.showToast("Salary advance voided", "success");
                  await refresh();
                } catch (error: unknown) {
                  toast.showToast(validationMessage(error, "Could not void salary advance"), "error");
                }
              }}
            >
              Void
            </Button>,
          ])}
        />
      )}

      <Modal open={addOpen} title="Record Salary Advance" onClose={() => setAddOpen(false)}>
        <div className="ui-form-stack">
          <Select
            label="Employee"
            value={form.staffId}
            onChange={(e) => setForm((current) => ({ ...current, staffId: e.target.value }))}
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
            onChange={(e) => setForm((current) => ({ ...current, advanceDate: e.target.value }))}
          />
          <Input
            label="Amount (₹)"
            type="number"
            min={0}
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value }))}
          />
          <Input
            label="Note"
            value={form.note}
            onChange={(e) => setForm((current) => ({ ...current, note: e.target.value }))}
            placeholder="Optional"
          />
          {selectedStaff && (
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "var(--pos-r-md)",
                border: "1px solid var(--pos-line)",
                background: "var(--pos-surface-sunken)",
                fontSize: 13,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--pos-tx-muted)" }}>Monthly salary</span>
                <strong>{formatMoney(selectedStaff.salary ?? null)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--pos-tx-muted)" }}>Advances this month</span>
                <strong>
                  {formatMoney(monthSummaryTotal + pendingFormAmount)}
                </strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--pos-tx-muted)" }}>Salary after advances</span>
                <strong>{formatMoney(salaryAfterAdvances)}</strong>
              </div>
            </div>
          )}
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
    </>
  );

  if (embedded) {
    return content;
  }

  return <div className="pos-page">{content}</div>;
}
