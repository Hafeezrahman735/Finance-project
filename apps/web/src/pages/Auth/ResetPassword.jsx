import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Button from "../../components/ui/Button";
import Field from "../../components/ui/Field";
import { auth, errorMessage } from "../../lib/api";
import AuthLayout from "./AuthLayout";

/** Landing page for the emailed link (/reset-password?token=…). A reset signs the user out everywhere. */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await auth.resetPassword(token, password);
      navigate("/login", { replace: true, state: { notice: "Password updated. Log in with the new one." } });
    } catch (err) {
      setError(errorMessage(err, "Could not reset the password"));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Choose a new password">
        <p className="text-base">
          This link is missing its token. <Link to="/forgot-password">Request a new one</Link>.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      footer={
        <>
          Link expired? <Link to="/forgot-password">Request a new one</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="New password" hint="At least 8 characters. You will be signed out of every other device.">
          <input type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-negative">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy} className="mt-2">
          {busy ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
