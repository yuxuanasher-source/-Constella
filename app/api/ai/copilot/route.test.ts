import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

function createReadOnlyClient() {
  return {
    from: vi.fn(() => {
      throw new Error("copilot route must remain read only");
    }),
  };
}

describe("AI copilot route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a routed copilot result for MCN staff without database writes", async () => {
    const client = createReadOnlyClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);

    const response = await POST(
      new Request("http://localhost/api/ai/copilot", {
        method: "POST",
        body: JSON.stringify({
          intent: "pricing_tradeoff",
          payload: createPricingPayload(),
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      intent: "pricing_tradeoff",
      copilotSummary: {
        status: "ready_for_review",
        requiresHumanApproval: true,
        persistence: "read_only",
      },
      routedResult: {
        tradeoffAdvice: {
          decision: "approve_review",
        },
      },
      validation: { valid: true, errors: [] },
    });
    expect(body.agentOutput.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTool: "pricing_tradeoff",
          sourceId: "pricing_tradeoff:marginRateBps",
        }),
      ]),
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("blocks streamers from M10 copilot", async () => {
    const client = createReadOnlyClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/ai/copilot", {
        method: "POST",
        body: JSON.stringify({
          intent: "pricing_tradeoff",
          payload: createPricingPayload(),
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const client = createReadOnlyClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ai/copilot", {
        method: "POST",
        body: JSON.stringify({
          intent: "pricing_tradeoff",
          payload: createPricingPayload(),
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
  });
});

function createPricingPayload() {
  return {
    vendorSettlementMethod: "cpt",
    streamerCount: 5,
    estimatedMinutesPerStreamer: 1200,
    vendorHourlyRateCents: 12000,
    streamerHourlyCostCents: 7000,
    supplierCostCents: 200000,
    platformFeeBps: 0,
    manualAdjustmentCents: 0,
    targetMarginBps: 2000,
  };
}
