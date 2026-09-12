import React, { useContext, useState } from "react";
import toast from "react-hot-toast";
import { UserContext } from "../../context/userContext";
import { auth, errorMessage } from "../../lib/api";

/** One flat line at the top of the page until the email is confirmed; a text button re-sends the link. */
export default function VerifyBanner() {
  const { user } = useContext(UserContext);
  const [busy, setBusy] = useState(false);
  if (!user || user.emailVerifiedAt) return null;

  const resend = async () => {
    setBusy(true);
    try {
      await auth.resendVerification();
      toast.success(`Verification email sent to ${user.email}`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not send the email"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line pb-3 text-sm text-muted">
      <span>
        Confirm <strong className="text-text">{user.email}</strong> to keep your account recoverable.
      </span>
      <button type="button" onClick={resend} disabled={busy} className="min-h-11 text-accent underline disabled:opacity-50">
        {busy ? "Sending…" : "Resend the email"}
      </button>
    </div>
  );
}
