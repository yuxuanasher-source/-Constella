import { describe, expect, it } from "vitest";

import type { AuthContext } from "@/lib/auth/context";

import { XINGYAO_READ_SCOPES } from "./contracts";
import { resolveHermesReadScopes } from "./read-scopes";

const auth: AuthContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.test",
  name: "Test Owner",
  organizationId: "22222222-2222-4222-8222-222222222222",
  organizationName: "Test Organization",
  role: "owner",
};

describe("resolveHermesReadScopes", () => {
  it.each(["owner", "ops_manager", "operator_business", "streamer"] as const)(
    "grants %s all eight role-aware read scopes",
    (role) => {
      const scopes = resolveHermesReadScopes({ ...auth, role });

      expect(scopes).toEqual(XINGYAO_READ_SCOPES);
      expect(Object.isFrozen(scopes)).toBe(true);
    },
  );

  it("limits finance to context, projects, knowledge, and settlements", () => {
    expect(resolveHermesReadScopes({ ...auth, role: "finance" })).toEqual([
      "context.read",
      "projects.search",
      "projects.summary",
      "knowledge.search",
      "settlements.summary",
    ]);
  });

  it("fails closed for an unknown role or incomplete AuthContext", () => {
    expect(
      resolveHermesReadScopes({
        ...auth,
        role: "administrator",
      } as unknown as AuthContext),
    ).toEqual([]);
    expect(
      resolveHermesReadScopes({ role: "owner" } as unknown as AuthContext),
    ).toEqual([]);
  });
});
