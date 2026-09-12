import React, { useContext, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { UserContext } from "../../context/userContext";
import { auth, errorMessage } from "../../lib/api";
import { session } from "../../lib/session";
import AuthLayout from "./AuthLayout";

// One request per token even when the effect runs twice (StrictMode, remount):
// the link is single-use, so a second call would report "already used".
const pending = new Map();
const verifyOnce = (token) => {
  if (!pending.has(token)) pending.set(token, auth.verifyEmail(token));
  return pending.get(token);
};

/** Landing page for the emailed link (/verify-email?token=…). Works whether or not the visitor is logged in. */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState(token ? "working" : "missing");
  const [error, setError] = useState(null);
  const { user, updateUser } = useContext(UserContext);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    verifyOnce(token)
      .then((data) => {
        if (!mounted) return;
        if (user && user.id === data.user.id) updateUser(data.user);
        setState("done");
      })
      .catch((err) => {
        if (!mounted) return;
        setError(errorMessage(err, "Could not verify this link"));
        setState("failed");
      });
    return () => {
      mounted = false;
    };
    // Verify once per token; the user object is only used to refresh context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const next = session.getToken() ? "/overview" : "/login";
  const nextLabel = next === "/overview" ? "Back to LedgerIQ" : "Log in";

  return (
    <AuthLayout title="Confirm your email">
      {state === "working" && <p role="status">Checking your link…</p>}
      {state === "done" && (
        <p role="status" className="text-base">
          Your email is confirmed. <Link to={next}>{nextLabel}</Link>
        </p>
      )}
      {state === "missing" && (
        <p className="text-base">
          This link is missing its token. Open the link from the email. <Link to={next}>{nextLabel}</Link>
        </p>
      )}
      {state === "failed" && (
        <p role="alert" className="text-negative">
          {error} <Link to={next}>{nextLabel}</Link>
        </p>
      )}
    </AuthLayout>
  );
}
