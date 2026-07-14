import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSettlementRouteContext,
  isUuid,
  jsonError,
  requiredUuid,
  RouteError,
} from "./settlement-route-utils";

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

const { createSupabaseServerClient } = await import("@/lib/db/supabase-server");
const { getAuthContext } = await import("@/lib/auth/context");

const VALID_UUID = "2ba8b258-b9f6-4ac2-bd3e-b55f686ac608";

describe("isUuid / requiredUuid", () => {
  it("accepts a valid uuid", () => {
    expect(isUuid(VALID_UUID)).toBe(true);
    expect(requiredUuid({ projectId: VALID_UUID }, "projectId")).toBe(
      VALID_UUID,
    );
  });

  it("rejects a non-uuid value with a 400 before it reaches the database", () => {
    expect(isUuid("测试")).toBe(false);
    expect(() => requiredUuid({ projectId: "测试" }, "projectId")).toThrow(
      RouteError,
    );
    try {
      requiredUuid({ projectId: "测试" }, "projectId");
    } catch (error) {
      expect((error as RouteError).statusCode).toBe(400);
      expect((error as RouteError).message).toContain("projectId");
    }
  });

  it("rejects a missing value", () => {
    expect(() => requiredUuid({}, "projectId")).toThrow("projectId is required");
  });
});

describe("jsonError", () => {
  async function body(response: Response) {
    return (await response.json()) as { error: string };
  }

  it("uses the status carried by a RouteError", async () => {
    const response = jsonError(new RouteError("nope", 403));
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe("nope");
  });

  it("maps a PostgrestError invalid-text (22P02) to 400 with its message", async () => {
    const response = jsonError({
      code: "22P02",
      message: 'invalid input syntax for type uuid: "测试"',
      details: null,
      hint: null,
    });
    expect(response.status).toBe(400);
    expect((await body(response)).error).toContain("invalid input syntax");
  });

  it("maps an integrity violation (23505) to 400", async () => {
    const response = jsonError({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });
    expect(response.status).toBe(400);
  });

  it("hides other database faults behind a generic 500", async () => {
    const response = jsonError({ code: "XX000", message: "internal boom" });
    expect(response.status).toBe(500);
    expect((await body(response)).error).toBe("Database error");
  });

  it("falls back to a generic 500 for unknown non-error values", async () => {
    const response = jsonError("weird");
    expect(response.status).toBe(500);
    expect((await body(response)).error).toBe("Unexpected error");
  });
});

describe("getSettlementRouteContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a settlement transition gate with the authenticated Supabase client", async () => {
    const supabase = {};
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-finance",
      name: "Finance",
      role: "finance",
      organizationId: "org-1",
    } as never);

    const context = await getSettlementRouteContext();

    expect(context.gate).toEqual({
      assertNoOpenRuleExceptions: expect.any(Function),
      evaluateReconciliation: expect.any(Function),
    });
    expect(context.supabase).toBe(supabase);
  });
});
