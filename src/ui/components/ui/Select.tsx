import React from "react";

export function Select({
  label,
  labelHidden = false,
  error,
  id,
  children,
  className = "",
  "aria-label": ariaLabelProp,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  labelHidden?: boolean;
  error?: string | null;
}) {
  const generated = React.useId();
  const selectId = id || generated;
  const errorId = `${selectId}-error`;
  const ariaLabel = ariaLabelProp || (labelHidden && label ? label : undefined);
  return (
    <div className={`ui-field${labelHidden ? " ui-field-compact" : ""}`}>
      {label && !labelHidden ? (
        <label className="ui-label" htmlFor={selectId}>
          {label}
        </label>
      ) : null}
      {label && labelHidden ? (
        <label className="ui-label-sr" htmlFor={selectId}>
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        className={`ui-select ${error ? "ui-select-error" : ""} ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-label={ariaLabel}
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
