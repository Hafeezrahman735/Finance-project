import React, { useId } from "react";

/**
 * Labelled input. The label is always visible (never placeholder-as-label:
 * design hard rule), errors are announced, and the control is 44px tall.
 */
export default function Field({ label, hint, error, children, className = "" }) {
  const id = useId();
  const child = React.Children.only(children);
  const control = React.cloneElement(child, {
    id: child.props.id ?? id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
    className: `min-h-11 w-full rounded-ui border border-line bg-surface px-3 text-base text-text placeholder:text-muted focus:border-accent ${child.props.className ?? ""}`,
  });
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={control.props.id} className="text-sm font-medium text-text">
        {label}
      </label>
      {control}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
