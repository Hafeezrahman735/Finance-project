import React, { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../../components/ui/Button";
import Field from "../../components/ui/Field";
import { auth, errorMessage } from "../../lib/api";
import AuthLayout from "./AuthLayout";

/** Always ends in the same sentence whether or not the email exists (no enumeration). */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter the email you signed up with.");
      return;
    }
    setBusy(true);
    try {
      await auth.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, "Could not send the reset link"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      footer={
        <>
          Remembered it? <Link to="/login">Log in</Link>
        </>
      }
    >
      {sent ? (
        <p role="status" className="text-base">
          If <strong>{email.trim()}</strong> has an account, a reset link is on its way. It works for one hour.
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="text-muted">Enter your email and we will send a link to choose a new password.</p>
          <Field label="Email">
            <input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="text-negative">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy} className="mt-2">
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
