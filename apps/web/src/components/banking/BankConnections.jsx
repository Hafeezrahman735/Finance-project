import React, { useContext, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { UserContext } from "../../context/userContext";
import { bankConnections as api, errorMessage } from "../../lib/api";
import Button from "../ui/Button";

const PLAID_LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

/** Load Plaid Link's script once; resolves with window.Plaid. */
function loadPlaid() {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${PLAID_LINK_SCRIPT}"]`);
    const script = existing ?? Object.assign(document.createElement("script"), { src: PLAID_LINK_SCRIPT, async: true });
    script.addEventListener("load", () => resolve(window.Plaid));
    script.addEventListener("error", () => reject(new Error("Could not load Plaid Link")));
    if (!existing) document.head.appendChild(script);
  });
}

/** Opens Link (or, for the fixture bank, resolves immediately) and returns { publicToken, institutionName, institutionId }. */
async function runLink({ linkToken, provider }) {
  if (provider === "fixture") return { publicToken: "fixture-public-token", institutionName: "Fixture Bank" };
  const Plaid = await loadPlaid();
  return new Promise((resolve, reject) => {
    const handler = Plaid.create({
      token: linkToken,
      onSuccess: (publicToken, metadata) => resolve({ publicToken, institutionName: metadata?.institution?.name, institutionId: metadata?.institution?.institution_id }),
      onExit: (err) => (err ? reject(new Error(err.display_message || err.error_message || "Bank connection cancelled")) : reject(new Error("cancelled"))),
    });
    handler.open();
  });
}

function relative(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * Bank feeds (plan 1.4b). One flat list: institution, its accounts, last sync,
 * and a "Sync now" button; a NEEDS_REAUTH row shows a Reconnect action. The
 * "Connect a bank" button runs Plaid Link (sandbox credentials user_good /
 * pass_good) or, with the fixture provider, connects the built-in bank.
 */
export default function BankConnections({ onChange, compact = false }) {
  const { organization } = useContext(UserContext);
  const [provider, setProvider] = useState(null);
  const [connections, setConnections] = useState(null);
  const [busy, setBusy] = useState(null);
  const canEdit = ["BOOKKEEPER", "ADMIN", "OWNER"].includes(organization?.role);
  const canRemove = ["ADMIN", "OWNER"].includes(organization?.role);

  const load = () => Promise.all([api.provider(), api.list()]).then(([p, c]) => {
    setProvider(p);
    setConnections(c);
  });

  useEffect(() => {
    load().catch((err) => toast.error(errorMessage(err)));
  }, []);

  const connect = async () => {
    setBusy("connect");
    try {
      const token = await api.linkToken();
      const linked = await runLink(token);
      const { connection, sync } = await api.connect(linked);
      toast.success(`${connection.institutionName} connected: ${sync.added} transactions in`);
      await load();
      onChange?.();
    } catch (err) {
      if (err?.message !== "cancelled") toast.error(errorMessage(err, "Could not connect the bank"));
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async (c) => {
    setBusy(c.id);
    try {
      const r = await api.sync(c.id);
      toast.success(r.status === "NEEDS_REAUTH" ? `${c.institutionName} needs you to log in again` : `${c.institutionName}: ${r.added} new, ${r.modified} updated, ${r.removed} removed`);
      await load();
      onChange?.();
    } catch (err) {
      toast.error(errorMessage(err, "Sync failed"));
    } finally {
      setBusy(null);
    }
  };

  const reconnect = async (c) => {
    setBusy(c.id);
    try {
      const token = await api.linkToken(c.id);
      await runLink(token);
      const r = await api.reconnected(c.id);
      toast.success(`${c.institutionName} reconnected: ${r.added} new`);
      await load();
      onChange?.();
    } catch (err) {
      if (err?.message !== "cancelled") toast.error(errorMessage(err, "Could not reconnect"));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (c) => {
    if (!window.confirm(`Disconnect ${c.institutionName}? Its transactions stay in your books; new ones stop arriving.`)) return;
    setBusy(c.id);
    try {
      await api.remove(c.id);
      toast.success(`${c.institutionName} disconnected`);
      await load();
      onChange?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {connections && connections.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {connections.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="min-w-0">
                  <span className="block font-medium">{c.institutionName}</span>
                  <span className="tnum block text-sm text-muted">
                    {c.accounts.map((a) => a.name.replace(`${c.institutionName} `, "")).join(" · ")} · {c.transactionCount} transactions · synced {relative(c.lastSyncedAt)}
                  </span>
                  {c.status === "NEEDS_REAUTH" && (
                    <span role="status" className="block text-sm text-negative">
                      {c.institutionName} wants you to log in again before it will share new transactions.
                    </span>
                  )}
                  {c.lastError && c.status !== "NEEDS_REAUTH" && <span className="block text-sm text-negative">Last sync failed: {c.lastError}</span>}
                </span>
                {canEdit && (
                  <span className="flex flex-wrap gap-2">
                    {c.status === "NEEDS_REAUTH" ? (
                      <Button variant="primary" onClick={() => reconnect(c)} disabled={busy === c.id}>
                        {busy === c.id ? "Reconnecting…" : "Reconnect"}
                      </Button>
                    ) : (
                      <Button onClick={() => syncNow(c)} disabled={busy === c.id}>
                        {busy === c.id ? "Syncing…" : "Sync now"}
                      </Button>
                    )}
                    {canRemove && !compact && (
                      <Button variant="danger" onClick={() => disconnect(c)} disabled={busy === c.id}>
                        Disconnect
                      </Button>
                    )}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {connections && connections.length === 0 && !compact && <p className="text-muted">No bank connected yet.</p>}
      {canEdit && provider && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant={compact ? "ghost" : "secondary"} onClick={connect} disabled={busy === "connect"}>
            {busy === "connect" ? "Connecting…" : "Connect a bank (beta)"}
          </Button>
          <span className="text-sm text-muted">
            {provider.name === "fixture" ? "Offline fixture bank: no real bank, deterministic sample data." : provider.env === "sandbox" ? "Plaid sandbox: use user_good / pass_good at any bank." : "Plaid"}
          </span>
        </div>
      )}
    </div>
  );
}
