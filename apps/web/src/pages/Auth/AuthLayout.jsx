import React from "react";

/** One column, no hero, no card: the form is the page (design hard rules). */
export default function AuthLayout({ title, children, footer }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="mb-8 font-display text-2xl">LedgerIQ</p>
      <h1 className="mb-6 text-title">{title}</h1>
      {children}
      {footer && <p className="mt-8 text-muted">{footer}</p>}
    </main>
  );
}
