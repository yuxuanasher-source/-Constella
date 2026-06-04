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
      throw new Error("briefs route must remain read only");
    }),
  };
}

describe("AI briefs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns casting advice for MCN staff without database writes", async () => {
    const client = createReadOnlyClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);

    const response = await POST(
      new Request("http://localhost/api/ai/briefs", {
        method: "POST",
        body: JSON.stringify(createRequestBody()),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      matches: [{ streamerId: "streamer-a", score: 93 }],
      candidateAdvice: [
        {
          streamerId: "streamer-a",
          rank: 1,
          recommendation: "invite",
        },
      ],
      validation: { valid: true, errors: [] },
    });
    expect(body.agentOutput.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTool: "casting_advice",
          sourceId: "casting_advice:streamer-a:score",
        }),
      ]),
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns pricing tradeoff advice for MCN staff without database writes", async () => {
    const client = createReadOnlyClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);

    const response = await POST(
      new Request("http://localhost/api/ai/briefs", {
        method: "POST",
        body: JSON.stringify(createPricingRequestBody()),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      pricing: {
        expectedReceivableCents: 1200000,
        grossMarginCents: 300000,
        marginRateBps: 2500,
      },
      tradeoffAdvice: {
        decision: "approve_review",
        riskLevel: "low",
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

  it("blocks streamers from internal casting advice", async () => {
    const client = createReadOnlyClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/ai/briefs", {
        method: "POST",
        body: JSON.stringify(createRequestBody()),
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
      new Request("http://localhost/api/ai/briefs", {
        method: "POST",
        body: JSON.stringify(createRequestBody()),
      }),
    );

    expect(response.status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
  });
});

function createRequestBody() {
  return {
    project: {
      category: "moba",
      platform: "douyin",
      preferredStyles: ["high-energy", "teaching"],
      requiredMinutes: 900,
    },
    maxRecommendations: 1,
    candidates: [
      {
        id: "streamer-a",
        name: "Ava",
        categories: ["moba", "fps"],
        platforms: ["douyin"],
        styles: ["high-energy", "story"],
        completionRateBps: 9200,
        screeningPassRateBps: 8800,
        roiBps: 14000,
        grossMarginContributionCents: 180000,
        riskTags: [],
        availableMinutes: 1200,
        referenceProjects: [
          {
            id: "project-a",
            name: "Campaign Alpha",
            result: "completed",
          },
        ],
      },
    ],
  };
}

function createPricingRequestBody() {
  return {
    kind: "pricing",
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
