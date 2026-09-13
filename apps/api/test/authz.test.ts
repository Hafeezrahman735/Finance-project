import request from "supertest";
import { describe, expect, it } from "vitest";
import { MembershipRole } from "../src/generated/prisma/enums.js";
import { routeTable } from "../src/routes.js";
import { roleAtLeast } from "../src/middleware/auth.js";
import { OffBriefModel } from "../src/services/ai/model.js";
import { FixtureProvider } from "../src/services/banking/feedProvider.js";
import { createSecrets } from "../src/lib/secrets.js";
import { CapturingEmailSink } from "../src/services/email/email.js";
import { auth, invite, makeApp, signup, testConfig, type Session } from "./helpers.js";
import { describePg, usePg } from "./pg.js";

const run = describePg() ? describe : describe.skip;

/**
 * Generated authz matrix (CEO review 6.1, eng review T6). For EVERY route in
 * the table:
 *   - no token                      → 401 (unless public)
 *   - each role below the minimum   → 403
 *   - each role at/above the minimum→ not 401/403
 *   - a member of another org       → 404 for id routes (never data, never 403)
 * A route that is added to routes.ts is automatically covered; one that is
 * not in the table cannot be reached at all.
 */
const ROLES = [MembershipRole.VIEWER, MembershipRole.ACCOUNTANT, MembershipRole.BOOKKEEPER, MembershipRole.ADMIN, MembershipRole.OWNER];

run("authz matrix", () => {
  const db = usePg();

  it("covers every route for every role", async () => {
    const app = makeApp(db());
    const routes = routeTable(db(), testConfig, { email: new CapturingEmailSink(), briefModel: new OffBriefModel(), feedProvider: new FixtureProvider(), secrets: createSecrets(testConfig) });
    expect(routes.length).toBeGreaterThan(10);

    const owner = await signup(app);
    const outsider = await signup(app);
    const members: Partial<Record<MembershipRole, Session>> = { [MembershipRole.OWNER]: owner };
    for (const role of ROLES) if (role !== MembershipRole.OWNER) members[role] = await invite(app, db(), owner, role);

    const failures: string[] = [];
    const check = (label: string, ok: boolean) => {
      if (!ok) failures.push(label);
    };

    for (const route of routes) {
      const path = `/api/v1${route.path.replace(":id", route.example ?? "00000000-0000-4000-8000-000000000000")}`;
      const send = (headers: Record<string, string> = {}) => request(app)[route.method](path).set(headers).send(sampleBody(route.method, route.path));

      // Unauthenticated
      const anon = await send();
      // Public routes must never demand a bearer token or a role. (/auth/refresh still 401s without its cookie; that is not a bearer check.)
      if (route.access === "public") check(`${route.method} ${route.path}: public route returned ${anon.status} ${anon.body?.error?.code ?? ""}`, anon.status !== 403 && anon.body?.error?.code !== "missing_token");
      else check(`${route.method} ${route.path}: no token gave ${anon.status}, expected 401`, anon.status === 401);
      if (route.access === "public" || route.access === "auth") continue;

      // Each role
      for (const role of ROLES) {
        const res = await send(auth(members[role]!));
        if (roleAtLeast(role, route.access)) {
          check(`${route.method} ${route.path} as ${role}: got ${res.status}, expected not 401/403`, res.status !== 401 && res.status !== 403);
        } else {
          check(`${route.method} ${route.path} as ${role}: got ${res.status}, expected 403`, res.status === 403 && res.body.error?.code === "insufficient_role");
        }
      }

      // Outsider with the owner's organization header: never data.
      const spoof = await send(auth(outsider.token, owner.organization.id));
      check(`${route.method} ${route.path} outsider spoofing org: got ${spoof.status}, expected 404`, spoof.status === 404);
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });
});

/** A body that passes validation for mutating routes so the check reaches the role guard. */
function sampleBody(method: string, path: string): Record<string, unknown> | undefined {
  if (method === "get" || method === "delete") return undefined;
  if (path === "/transactions") return { direction: "out", amountMinor: 100, date: "2026-09-01", memo: "matrix" };
  if (path === "/transactions/:id") return { version: 1, memo: "matrix" };
  if (path === "/organizations/current/features") return { moneyBrief: false };
  return {};
}
