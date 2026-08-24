import React from "react";

export function Select({
  label,
  error,
  id,
  children,
  className = "",
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string | null;
}) {
  const generated = React.useId();
  const selectId = id || generated;
  const errorId = `${selectId}-error`;
  return (
    <div className="ui-field">
      {label ? (
        <label className="ui-label" htmlFor={selectId}>
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        className={`ui-select ${error ? "ui-select-error" : ""} ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <div id={errorId} className="ui-field-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
