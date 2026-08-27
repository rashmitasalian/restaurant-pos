import React from "react";

export type DataTableColumn = {
  key?: string;
  header: React.ReactNode;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  /** When sorting, read this value from the row's sortValues map */
  sortKey?: string;
};

export type DataTableProps = {
  /** Simple mode (backward compatible) */
  headers?: React.ReactNode[];
  rows?: React.ReactNode[][];
  /** Column mode — preferred for new screens */
  columns?: DataTableColumn[];
  /** Parallel to rows: sortValues[rowIndex][sortKey] */
  sortValues?: Array<Record<string, string | number | null | undefined>>;
  loading?: boolean;
  empty?: string;
  dense?: boolean;
  onRowClick?: (rowIndex: number) => void;
  /** Optional row selection */
  selectable?: boolean;
  selectedIndexes?: number[];
  onSelectionChange?: (indexes: number[]) => void;
  className?: string;
};

export function DataTable({
  headers,
  rows = [],
  columns,
  sortValues,
  loading = false,
  empty = "No rows",
  dense = false,
  onRowClick,
  selectable = false,
  selectedIndexes,
  onSelectionChange,
  className = "",
}: DataTableProps) {
  const cols: DataTableColumn[] =
    columns ||
    (headers || []).map((header, index) => ({
      key: String(index),
      header,
    }));

  const [activeRow, setActiveRow] = React.useState(0);
  const [sortCol, setSortCol] = React.useState<number | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");

  const selected = new Set(selectedIndexes || []);

  const displayOrder = React.useMemo(() => {
    const indexes = rows.map((_, i) => i);
    if (sortCol == null || !sortValues) return indexes;
    const col = cols[sortCol];
    const key = col?.sortKey || col?.key || String(sortCol);
    return indexes.sort((a, b) => {
      const av = sortValues[a]?.[key];
      const bv = sortValues[b]?.[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir, sortValues, cols]);

  const toggleSort = (index: number) => {
    const col = cols[index];
    if (!col?.sortable) return;
    if (sortCol === index) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(index);
      setSortDir("asc");
    }
  };

  const toggleAll = () => {
    if (!onSelectionChange) return;
    if (selected.size === rows.length) onSelectionChange([]);
    else onSelectionChange(rows.map((_, i) => i));
  };

  const toggleOne = (rowIndex: number) => {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (next.has(rowIndex)) next.delete(rowIndex);
    else next.add(rowIndex);
    onSelectionChange(Array.from(next).sort((a, b) => a - b));
  };

  const colCount = cols.length + (selectable ? 1 : 0);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") {
      return;
    }
    if (event.key === "Enter" && onRowClick && rows.length > 0) {
      event.preventDefault();
      onRowClick(displayOrder[activeRow] ?? activeRow);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    setActiveRow((current) => Math.min(rows.length - 1, Math.max(0, current + delta)));
  };

  return (
    <div
      className={`ui-table-wrap ${dense ? "ui-table-dense" : ""} ${className}`.trim()}
      aria-busy={loading || undefined}
    >
      <table className="ui-table pos-table" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {selectable ? (
              <th scope="col" className="ui-table-check">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={toggleAll}
                  aria-label="Select all rows"
                />
              </th>
            ) : null}
            {cols.map((col, index) => (
              <th
                key={col.key || index}
                scope="col"
                className={col.align === "right" ? "ui-table-num" : undefined}
                aria-sort={
                  col.sortable && sortCol === index
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
              >
                {col.sortable ? (
                  <button
                    type="button"
                    className="ui-table-sort"
                    onClick={() => toggleSort(index)}
                  >
                    {col.header}
                    {sortCol === index ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colCount} className="ui-table-empty">
                Loading...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="ui-table-empty">
                {empty}
              </td>
            </tr>
          ) : (
            displayOrder.map((rowIndex, visualIndex) => {
              const row = rows[rowIndex];
              const clickable = Boolean(onRowClick);
              return (
                <tr
                  key={rowIndex}
                  tabIndex={0}
                  aria-selected={activeRow === visualIndex}
                  data-selected={selected.has(rowIndex) || undefined}
                  className={clickable ? "ui-table-row-click" : undefined}
                  onFocus={() => setActiveRow(visualIndex)}
                  onClick={
                    clickable
                      ? (e) => {
                          const target = e.target as HTMLElement;
                          if (target.closest("button, a, input, select, textarea, label")) return;
                          onRowClick?.(rowIndex);
                        }
                      : undefined
                  }
                >
                  {selectable ? (
                    <td className="ui-table-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(rowIndex)}
                        onChange={() => toggleOne(rowIndex)}
                        aria-label={`Select row ${rowIndex + 1}`}
                      />
                    </td>
                  ) : null}
                  {cols.map((col, colIndex) => (
                    <td
                      key={col.key || colIndex}
                      className={col.align === "right" ? "ui-table-num pos-tabular" : undefined}
                    >
                      {row[colIndex]}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
