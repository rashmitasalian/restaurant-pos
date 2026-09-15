import React from "react";

let fieldId = 0;

export function Input({
  label,
  labelHidden = false,
  error,
  id,
  className = "",
  "aria-label": ariaLabelProp,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  /** Keep accessible name but hide the visible label (table/dense rows). */
  labelHidden?: boolean;
  error?: string | null;
}) {
  const generated = React.useId ? React.useId() : `pos-input-${++fieldId}`;
  const inputId = id || generated;
  const errorId = `${inputId}-error`;
  const ariaLabel = ariaLabelProp || (labelHidden && label ? label : undefined);
  return (
    <div className={`ui-field${labelHidden ? " ui-field-compact" : ""}`}>
      {label && !labelHidden ? (
        <label className="ui-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      {label && labelHidden ? (
        <label className="ui-label-sr" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={`ui-input ${error ? "ui-input-error" : ""} ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-label={ariaLabel}
        {...rest}
      />
      <div id={errorId} className="ui-field-error" aria-live="polite">
        {error || null}
      </div>
    </div>
  );
}
