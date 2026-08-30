import React from "react";
import {
  listExpenseCategories,
  listExpenses,
  createExpense,
  voidExpense,
} from "../../../app/db/posRepository";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { Stat } from "../../components/ui/Stat";
import { DataTable } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { ManageShell } from "../Manager/ManageShell";
import { validationMessage } from "../../../shared/validation";
import "./Expenses.module.css";

type ExpenseRow = {
  id: string;
  categoryId?: string;
  categoryName?: string | null;
  amount: number;
  expenseDate: number;
  description?: string | null;
  paymentMethod?: string | null;
};

type CategoryRow = { id: string; name: string; isSystem: boolean };

type RangePreset = "thisMonth" | "lastMonth" | "custom";

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
  if (preset === "lastMonth") {
    return "Last month";
  }
  if (preset === "custom") {
    return "Selected range";
  }
  return "This month";
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "custom", label: "Custom" },
];

export default function Expenses() {
  const initRange = getPresetRange("thisMonth");
  const [loading, setLoading] = React.useState(true);
  const [expenses, setExpenses] = React.useState<ExpenseRow[]>([]);
  const [categories, setCategories] = React.useState<CategoryRow[]>([]);
  const [status, setStatus] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [preset, setPreset] = React.useState<RangePreset>("thisMonth");
  const [fromTs, setFromTs] = React.useState(initRange.from);
  const [toTs, setToTs] = React.useState(initRange.to);
  const [categoryFilter, setCategoryFilter] = React.useState("all");
  const [form, setForm] = React.useState({
    categoryId: "",
    amount: "",
    description: "",
    paymentMethod: "cash",
  });
  const [voidTarget, setVoidTarget] = React.useState<ExpenseRow | null>(null);
  const [voiding, setVoiding] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [cats, rows] = await Promise.all([
        listExpenseCategories(),
        listExpenses({ from: fromTs, to: toTs, limit: 200 }),
      ]);
      const mappedCats: CategoryRow[] = cats.map((c: any) => ({
        id: c.id,
        name: c.name,
        isSystem: Boolean(c.isSystem),
      }));
      setCategories(mappedCats);
      setExpenses(rows as ExpenseRow[]);
      setForm((f) => (f.categoryId || !mappedCats[0] ? f : { ...f, categoryId: mappedCats[0].id }));
    } catch (error: any) {
      setStatus(validationMessage(error, "Could not load expenses"));
    } finally {
      setLoading(false);
    }
  }, [fromTs, toTs]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const periodTotal = expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const categoryMap = new Map<string, number>();
  for (const row of expenses) {
    const name = row.categoryName || "Uncategorized";
    categoryMap.set(name, (categoryMap.get(name) || 0) + Number(row.amount || 0));
  }
  const categoryBreakdown = [...categoryMap.entries()]
    .map(([name, amount]) => ({
      name,
      amount,
      pct: periodTotal > 0 ? Math.round((amount / periodTotal) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

  const filteredExpenses =
    categoryFilter === "all"
      ? expenses
      : expenses.filter((row) => row.categoryId === categoryFilter);

  const submit = async () => {
    try {
      await createExpense({
        categoryId: form.categoryId,
        amount: Number(form.amount),
        description: form.description || null,
        paymentMethod: form.paymentMethod,
      });
      setAddOpen(false);
      setForm((f) => ({ ...f, amount: "", description: "" }));
      setStatus("Expense recorded");
      await refresh();
    } catch (error: any) {
      setStatus(validationMessage(error, "Could not save expense"));
    }
  };

  const confirmVoidExpense = async () => {
    if (!voidTarget || voiding) return;
    setVoiding(true);
    try {
      await voidExpense(voidTarget.id);
      setVoidTarget(null);
      setStatus("Expense voided");
      await refresh();
    } catch (error: any) {
      setStatus(validationMessage(error, "Could not void expense"));
    } finally {
      setVoiding(false);
    }
  };

  const voidExpenseLabel = voidTarget
    ? voidTarget.description?.trim() || voidTarget.categoryName || "this expense"
    : "";

  return (
    <ManageShell
      title="Expenses"
      description="Operating costs outside grocery procurement."
      width="operational"
      primaryAction={
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          Add Expense
        </Button>
      }
    >
      {status && <div className="pos-sect-title exp-status">{status}</div>}

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
                  const r = getPresetRange(key);
                  setFromTs(r.from);
                  setToTs(r.to);
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
                  if (!isNaN(d.getTime())) {
                    setFromTs(d.getTime());
                  }
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
                  if (!isNaN(d.getTime())) {
                    setToTs(d.getTime());
                  }
                }}
              />
            </>
          )}
        </div>
        <div className="exp-filter">
          <Select
            label="Category"
            labelHidden
            aria-label="Category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="exp-kpi-grid">
        <Stat
          label={rangeLabel(preset)}
          value={`₹${periodTotal.toLocaleString("en-IN")}`}
          primary
        />
        <Stat label="Entries" value={String(filteredExpenses.length)} />
      </div>

      {!loading && categoryBreakdown.length > 0 && (
        <div className="exp-panel">
          <div className="exp-panel-title">Breakdown</div>
          <div className="exp-breakdown">
            {categoryBreakdown.map((row) => (
              <div key={row.name} className="exp-breakdown-row">
                <span className="exp-breakdown-name">{row.name}</span>
                <span className="exp-breakdown-amt">
                  ₹{row.amount.toLocaleString("en-IN")}
                </span>
                <span className="exp-breakdown-pct">{row.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="pos-empty">Loading expenses…</div>
      ) : filteredExpenses.length === 0 ? (
        <EmptyState
          title={expenses.length === 0 ? `No expenses ${rangeLabel(preset).toLowerCase()}` : "No expenses in this category"}
          text="Record rent, electricity, staff, and other operating costs here."
          actionLabel="Add Expense"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <DataTable
          headers={["Date", "Category", "Description", "Amount", ""]}
          rows={filteredExpenses.map((row) => [
            new Date(row.expenseDate).toLocaleDateString("en-IN"),
            row.categoryName || "—",
            row.description || "—",
            `₹${Number(row.amount).toLocaleString("en-IN")}`,
            <Button
              key={row.id}
              variant="danger-ghost"
              size="sm"
              onClick={() => setVoidTarget(row)}
            >
              Void
            </Button>,
          ])}
        />
      )}

      <ConfirmModal
        open={Boolean(voidTarget)}
        title="Void expense?"
        onClose={() => setVoidTarget(null)}
        onConfirm={confirmVoidExpense}
        confirmLabel="Void expense"
        loading={voiding}
      >
        {voidTarget ? (
          <p style={{ margin: 0 }}>
            This will void <strong>{voidExpenseLabel}</strong> (
            <strong>₹{Number(voidTarget.amount).toLocaleString("en-IN")}</strong>).
          </p>
        ) : null}
      </ConfirmModal>

      <Modal open={addOpen} title="Add Expense" onClose={() => setAddOpen(false)}>
        <div className="ui-form-stack">
          <Select
            label="Category"
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            label="Amount (₹)"
            type="number"
            min={0}
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <Select
            label="Payment method"
            value={form.paymentMethod}
            onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
          >
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="other">Other</option>
          </Select>
          <div className="ui-form-actions">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={!form.categoryId || !form.amount}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </ManageShell>
  );
}
