import React, { useContext, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../../components/ui/Button";
import Field from "../../components/ui/Field";
import { UserContext } from "../../context/userContext";
import { auth, errorMessage } from "../../lib/api";
import { session } from "../../lib/session";
import AuthLayout from "./AuthLayout";

/** One screen, four fields, straight to the Overview (plan: Pass 2, Signup). */
export default function SignUp() {
  const [form, setForm] = useState({ fullName: "", email: "", password: "", organizationName: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { updateUser } = useContext(UserContext);
  const navigate = useNavigate();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.fullName.trim()) next.fullName = "Your name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    if (form.password.length < 8) next.password = "Use at least 8 characters.";
    setErrors(next);
    setError(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const data = await auth.register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        ...(form.organizationName.trim() ? { organizationName: form.organizationName.trim() } : {}),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      session.setToken(data.token);
      updateUser(data);
      navigate("/overview");
    } catch (err) {
      setError(errorMessage(err, "Could not create the account"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have one? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Your name" error={errors.fullName}>
          <input autoComplete="name" autoFocus value={form.fullName} onChange={set("fullName")} />
        </Field>
        <Field label="Business name" hint="You can change this later.">
          <input autoComplete="organization" value={form.organizationName} onChange={set("organizationName")} placeholder={form.fullName.trim() ? `${form.fullName.trim()}'s books` : ""} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input type="email" autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" hint="At least 8 characters." error={errors.password}>
          <input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        {error && (
          <p role="alert" className="text-negative">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy} className="mt-2">
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
