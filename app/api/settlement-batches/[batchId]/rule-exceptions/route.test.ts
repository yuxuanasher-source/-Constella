import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSettlementRouteContext,
  RouteError,
} from "@/features/settlements/settlement-route-utils";
import { listSettlementRuleExceptions } from "@/features/settlements/custom-rule-exception-service";

import { GET } from "./route";

vi.mock("@/features/settlements/settlement-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settlements/settlement-route-utils")
  >("@/features/settlements/settlement-route-utils");
  return { ...actual, getSettlementRouteContext: vi.fn() };
});

vi.mock("@/features/settlements/custom-rule-exception-service", () => ({
  listSettlementRuleExceptions: vi.fn(),
}));

const supabase = {};
const repo = {};

describe("settlement batch rule exception list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase,
      repo,
      audit: vi.fn(),
      notify: vi.fn(),
      auth: {
        userId: "user-ops",
        name: "Ops",
        role: "operator_business",
        organizationId: "org-1",
      },
    } as never);
    vi.mocked(listSettlementRuleExceptions).mockResolvedValue([
      { id: "exception-1", status: "review_required" },
    ] as never);
  });

  it("lists rule exceptions for an authenticated staff viewer", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ batchId: "batch-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      exceptions: [{ id: "exception-1", status: "review_required" }],
    });
    expect(listSettlementRuleExceptions).toHaveBeenCalledWith(
      expect.objectContaining({
        repo,
        batchId: "batch-1",
        actor: expect.objectContaining({
          role: "operator_business",
          organizationId: "org-1",
        }),
      }),
    );
  });

  it("returns safe auth errors for streamer denial", async () => {
    vi.mocked(listSettlementRuleExceptions).mockRejectedValueOnce(
      new Error("Only MCN staff can view settlement rule exceptions"),
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ batchId: "batch-1" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only MCN staff can view settlement rule exceptions",
    });
  });

  it("returns 401 when the viewer is unauthenticated", async () => {
    vi.mocked(getSettlementRouteContext).mockRejectedValueOnce(
      new RouteError("Unauthorized", 401),
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ batchId: "batch-1" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(listSettlementRuleExceptions).not.toHaveBeenCalled();
  });
});
