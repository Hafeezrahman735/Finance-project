import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import React from "react";

/**
 * One container for every overlay: a centered dialog on desktop, a bottom
 * sheet under 640px (plan: Design specification, Pass 6). Headless UI gives
 * focus trapping, Esc, and aria wiring. The only place a shadow is allowed
 * besides focus rings is this sheet's top edge on mobile, expressed as a
 * border to keep the no-shadow rule simple.
 */
export default function Sheet({ open, onClose, title, children, wide = false }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-text/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-4">
        <DialogPanel
          className={`w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} max-h-[92dvh] overflow-y-auto rounded-t-sheet border border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-ui`}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <DialogTitle className="font-sans text-lg font-semibold">{title}</DialogTitle>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-ui text-muted hover:bg-bg">
              ×
            </button>
          </div>
          {children}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
