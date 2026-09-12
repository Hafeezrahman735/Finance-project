import React, { useContext, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Button from "../../components/ui/Button";
import Field from "../../components/ui/Field";
import { UserContext } from "../../context/userContext";
import { auth, errorMessage } from "../../lib/api";
import { session } from "../../lib/session";
import AuthLayout from "./AuthLayout";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { updateUser } = useContext(UserContext);
  const navigate = useNavigate();
  const notice = useLocation().state?.notice;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    setBusy(true);
    try {
      const data = await auth.login({ email: email.trim(), password });
      session.setToken(data.token);
      updateUser(data);
      navigate("/overview");
    } catch (err) {
      setError(errorMessage(err, "Could not log in"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Log in"
      footer={
        <>
          New here? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {notice && (
          <p role="status" className="text-base">
            {notice}
          </p>
        )}
        <Field label="Email">
          <input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <p className="text-sm">
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
        {error && (
          <p role="alert" className="text-negative">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy} className="mt-2">
          {busy ? "Logging in…" : "Log in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
