import React from "react";

const styles = {
  primary: "bg-accent text-white hover:bg-accent-strong disabled:opacity-50",
  secondary: "bg-surface text-text border border-line hover:bg-bg disabled:opacity-50",
  ghost: "bg-transparent text-accent hover:bg-accent-soft disabled:opacity-50",
  danger: "bg-surface text-negative border border-line hover:bg-bg disabled:opacity-50",
};

/** 44px minimum target (plan: Pass 6), one accent for primary actions. */
export default function Button({ variant = "secondary", className = "", type = "button", ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-ui px-4 text-base font-medium transition-colors ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
