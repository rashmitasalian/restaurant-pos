import React from "react";

let fieldId = 0;

export function Input({
  label,
  error,
  id,
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string | null;
}) {
  const generated = React.useId ? React.useId() : `pos-input-${++fieldId}`;
  const inputId = id || generated;
  const errorId = `${inputId}-error`;
  return (
    <div className="ui-field">
      {label ? (
        <label className="ui-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={`ui-input ${error ? "ui-input-error" : ""} ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error ? (
        <div id={errorId} className="ui-field-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
