import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the network at the axios adapter level so the interceptors in
// utils/axiosinstance.js and lib/session.js run for real.
const calls = [];
let handler = () => ({ status: 200, data: {} });
vi.mock("axios", async () => {
  const actual = await vi.importActual("axios");
  const adapter = async (config) => {
    calls.push({ url: config.url, auth: config.headers?.Authorization });
    const r = handler(config);
    if (r.status >= 400) {
      const err = new actual.AxiosError(`Request failed with status code ${r.status}`, "ERR_BAD_REQUEST", config, null, { status: r.status, data: r.data, headers: {}, config });
      throw err;
    }
    return { status: r.status, data: r.data, headers: {}, config, statusText: "OK" };
  };
  const create = (opts) => actual.default.create({ ...opts, adapter });
  return { ...actual, default: { ...actual.default, create }, create };
});

import UserProvider from "../src/context/UserProvider";
import { auth } from "../src/lib/api";
import { session } from "../src/lib/session";
import ForgotPassword from "../src/pages/Auth/ForgotPassword";
import ResetPassword from "../src/pages/Auth/ResetPassword";
import VerifyEmail from "../src/pages/Auth/VerifyEmail";

beforeEach(() => {
  calls.length = 0;
  session.setToken("stale-token");
});
afterEach(() => session.clear());

describe("access-token refresh", () => {
  it("on 401 token_expired it refreshes once through the cookie and retries with the new token", async () => {
    handler = (config) => {
      if (config.url.endsWith("/auth/refresh")) return { status: 200, data: { token: "fresh-token", user: { id: "u1" } } };
      if (config.headers?.Authorization === "Bearer fresh-token") return { status: 200, data: { user: { id: "u1", email: "a@b.c" }, organization: { id: "o1" } } };
      return { status: 401, data: { message: "Session expired", error: { type: "authentication_error", code: "token_expired" } } };
    };
    const me = await auth.me();
    expect(me.user.email).toBe("a@b.c");
    expect(session.getToken()).toBe("fresh-token");
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/auth/me", "/api/v1/auth/refresh", "/api/v1/auth/me"]);
  });

  it("shares one in-flight refresh between concurrent requests", async () => {
    let refreshes = 0;
    handler = (config) => {
      if (config.url.endsWith("/auth/refresh")) {
        refreshes += 1;
        return { status: 200, data: { token: "fresh-token", user: { id: "u1" } } };
      }
      if (config.headers?.Authorization === "Bearer fresh-token") return { status: 200, data: { data: [] } };
      return { status: 401, data: { error: { code: "token_expired" } } };
    };
    await Promise.all([auth.me(), auth.me(), auth.me()]);
    expect(refreshes).toBe(1);
  });

  it("clears the token and gives up when the refresh itself fails", async () => {
    handler = (config) => {
      if (config.url.endsWith("/auth/refresh")) return { status: 401, data: { error: { code: "refresh_revoked" } } };
      return { status: 401, data: { error: { code: "token_expired" } } };
    };
    await expect(auth.me()).rejects.toBeTruthy();
    expect(session.getToken()).toBeNull();
  });
});

function renderAt(path) {
  return render(
    <UserProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </MemoryRouter>
    </UserProvider>,
  );
}

describe("recovery pages", () => {
  it("forgot password always shows the same neutral confirmation", async () => {
    handler = () => ({ status: 200, data: { message: "ok" } });
    renderAt("/forgot-password");
    await userEvent.type(screen.getByLabelText("Email"), "who@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/has an account, a reset link is on its way/);
  }, 15000);

  it("reset password validates locally, posts the token, and lands on login with a notice", async () => {
    handler = (config) => ({ status: 200, data: { message: "ok", got: JSON.parse(config.data) } });
    renderAt("/reset-password?token=abcdefghijklmnopqrstuvwxyz");
    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 8/);
    await userEvent.clear(screen.getByLabelText("New password"));
    await userEvent.type(screen.getByLabelText("New password"), "new-horse-battery");
    await userEvent.clear(screen.getByLabelText("Confirm new password"));
    await userEvent.type(screen.getByLabelText("Confirm new password"), "new-horse-battery");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() => expect(screen.getByText("login page")).toBeInTheDocument());
    expect(calls.at(-1).url).toBe("/api/v1/auth/reset-password");
  }, 15000);

  it("verify email reports success and a used link", async () => {
    handler = () => ({ status: 200, data: { user: { id: "u1", emailVerifiedAt: "2026-09-12T00:00:00.000Z" } } });
    renderAt("/verify-email?token=abcdefghijklmnopqrstuvwxyz");
    expect(await screen.findByText(/Your email is confirmed/)).toBeInTheDocument();
    handler = () => ({ status: 400, data: { message: "This link was already used. Request a new one.", error: { code: "invalid_param", param: "token" } } });
    renderAt("/verify-email?token=zyxwvutsrqponmlkjihgfedcba");
    expect(await screen.findByRole("alert")).toHaveTextContent(/already used/);
  });
});
