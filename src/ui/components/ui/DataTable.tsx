import React from "react";

export function DataTable({
  headers,
  rows,
  loading = false,
  empty = "No rows",
}: {
  headers: React.ReactNode[];
  rows: React.ReactNode[][];
  loading?: boolean;
  empty?: string;
}) {
  const [activeRow, setActiveRow] = React.useState(0);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    setActiveRow((current) => {
      const next = Math.min(rows.length - 1, Math.max(0, current + delta));
      return next;
    });
  };
  return (
    <div className="ui-table-wrap" aria-busy={loading || undefined}>
      <table className="ui-table pos-table" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={headers.length} className="ui-table-empty">
                Loading...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="ui-table-empty">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                tabIndex={0}
                aria-selected={activeRow === rowIndex}
                onFocus={() => setActiveRow(rowIndex)}
              >
                {headers.map((_, colIndex) => (
                  <td key={colIndex}>{row[colIndex]}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
