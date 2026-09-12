import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import React, { useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserContext } from "../../context/userContext";
import { signOut } from "../../lib/session";
import Sheet from "../ui/Sheet";
import VerifyBanner from "./VerifyBanner";

const NAV = [
  { key: "overview", label: "Overview", to: "/overview" },
  { key: "transactions", label: "Transactions", to: "/transactions" },
  { key: "import", label: "Import", to: "/import" },
  { key: "settings", label: "Settings", to: "/settings" },
];

/**
 * App shell: sidebar on desktop (icons + labels ≥ 640px), top bar on mobile,
 * user menu with Logout in the top-right (plan: Pass 1). Keyboard help on `?`.
 * No cards, no shadows: one flat surface with a hairline sidebar border.
 */
export default function AppShell({ active, children }) {
  const { user, organization, clearUser } = useContext(UserContext);
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (e.key === "?" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") setHelp((h) => !h);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const logout = async () => {
    await signOut();
    clearUser();
    navigate("/login");
  };

  return (
    <div className="min-h-dvh sm:grid sm:grid-cols-[13rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <nav aria-label="Primary" className="flex items-center justify-between border-b border-line bg-surface px-3 sm:flex-col sm:items-stretch sm:justify-start sm:border-b-0 sm:border-r sm:px-3 sm:py-5">
        <Link to="/overview" className="py-3 font-display text-xl text-text no-underline sm:mb-6 sm:py-0">
          LedgerIQ
        </Link>
        <ul className="flex gap-1 sm:flex-col">
          {NAV.map((item) => (
            <li key={item.key}>
              <Link
                to={item.to}
                aria-current={active === item.key ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-ui px-3 text-base no-underline ${active === item.key ? "bg-accent-soft font-medium text-accent-strong" : "text-text hover:bg-bg"}`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="sm:mt-auto">
          <Menu>
            <MenuButton className="flex min-h-11 max-w-[11rem] items-center gap-2 rounded-ui px-2 text-left hover:bg-bg">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong" aria-hidden="true">
                {(user?.fullName ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-sm font-medium">{user?.fullName ?? ""}</span>
                <span className="block truncate text-xs text-muted">{organization?.name ?? ""}</span>
              </span>
            </MenuButton>
            <MenuItems anchor="bottom end" className="z-50 mt-1 w-56 rounded-ui border border-line bg-surface p-1 focus:outline-none">
              <div className="px-3 py-2 text-sm text-muted">
                {user?.email}
                <br />
                {organization?.name} · {organization?.role?.toLowerCase()}
              </div>
              <MenuItem>
                <button type="button" onClick={() => setHelp(true)} className="flex min-h-11 w-full items-center rounded-ui px-3 text-left data-[focus]:bg-bg">
                  Keyboard shortcuts
                </button>
              </MenuItem>
              <MenuItem>
                <button type="button" onClick={logout} className="flex min-h-11 w-full items-center rounded-ui px-3 text-left data-[focus]:bg-bg">
                  Log out
                </button>
              </MenuItem>
            </MenuItems>
          </Menu>
        </div>
      </nav>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
        <VerifyBanner />
        {children}
      </main>
      <Sheet open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <dl className="grid grid-cols-[4rem_1fr] gap-y-2 text-base">
          {[
            ["n", "Add a transaction"],
            ["/", "Search the list"],
            ["j / k", "Move down / up"],
            ["c", "Categorize the focused row"],
            ["x", "Select the focused row"],
            ["Esc", "Close, clear selection"],
            ["?", "This help"],
          ].map(([k, v]) => (
            <React.Fragment key={k}>
              <dt>
                <kbd className="rounded-ui border border-line px-1.5 py-0.5 text-sm">{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </Sheet>
    </div>
  );
}
