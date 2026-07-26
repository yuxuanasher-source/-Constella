import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { loadCastingCandidates } from "@/features/streamers/casting-candidate-loader";
import { loadProjectReviewInput } from "@/features/war-room/project-review-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/features/war-room/project-review-loader", () => ({
  loadProjectReviewInput: vi.fn(),
}));

vi.mock("@/features/streamers/casting-candidate-loader", () => ({
  loadCastingCandidates: vi.fn(),
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

  it("resolves project_review facts through the server-side loader", async () => {
    const client = createReadOnlyClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(loadProjectReviewInput).mockResolvedValue({
      input: createLoadedReviewInput(),
      dataGaps: ["project_category"],
    });

    const response = await POST(
      new Request("http://localhost/api/ai/copilot", {
        method: "POST",
        body: JSON.stringify({
          intent: "project_review",
          payload: { projectId: PROJECT_ID, targetMarginBps: 3000 },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(loadProjectReviewInput).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        organizationId: "org-1",
        projectId: PROJECT_ID,
        targetMarginBps: 3000,
      }),
    );
    expect(body.intent).toBe("project_review");
    expect(body.dataGaps).toEqual(["project_category"]);
    expect(body.agentOutput.caveats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "项目品类信息暂无真实数据来源,按未知处理",
        }),
      ]),
    );
    expect(body.validation).toEqual({ valid: true, errors: [] });
  });

  it("resolves casting candidates through the server-side loader", async () => {
    const client = createReadOnlyClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(loadCastingCandidates).mockResolvedValue({
      candidates: [
        {
          id: "streamer-a",
          name: "Ava",
          categories: ["moba"],
          platforms: ["douyin"],
          styles: ["high-energy"],
          completionRateBps: 9200,
          screeningPassRateBps: 8800,
          roiBps: 14000,
          grossMarginContributionCents: 180000,
          riskTags: [],
          availableMinutes: 1200,
          referenceProjects: [],
        },
      ],
      dataGaps: [],
    });

    const response = await POST(
      new Request("http://localhost/api/ai/copilot", {
        method: "POST",
        body: JSON.stringify({
          intent: "casting_advice",
          payload: {
            matching: {
              category: "moba",
              platform: "douyin",
              preferredStyles: ["high-energy"],
              requiredMinutes: 900,
            },
            maxRecommendations: 1,
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(loadCastingCandidates).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        organizationId: "org-1",
        requiredMinutes: 900,
      }),
    );
    expect(body.intent).toBe("casting_advice");
    expect(body.dataGaps).toEqual([]);
    expect(body.validation).toEqual({ valid: true, errors: [] });
  });

  it("rejects a legacy payload that carries client-supplied facts", async () => {
    const client = createReadOnlyClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);

    const response = await POST(
      new Request("http://localhost/api/ai/copilot", {
        method: "POST",
        body: JSON.stringify({
          intent: "project_review",
          payload: {
            project: { id: "project-api", name: "Campaign Alpha" },
            finance: { receivableCents: 1200000 },
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(loadProjectReviewInput).not.toHaveBeenCalled();
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

const PROJECT_ID = "8f7a1f7e-3f30-4a26-9d61-0d5f6f6e2a11";

function createLoadedReviewInput() {
  return {
    project: {
      id: PROJECT_ID,
      name: "Campaign Alpha",
      category: "unknown",
      platform: "unknown",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-07",
    },
    finance: {
      receivableCents: 1200000,
      payableCents: 600000,
      supplierCostCents: 100000,
      adjustmentCents: 0,
      manualRevenueCents: 80000,
    },
    streamers: [
      {
        id: "streamer-a",
        name: "Ava",
        durationMinutes: 1200,
        totalViews: 120000,
        completionRateBps: 9500,
        roiBps: 0,
        grossMarginContributionCents: 320000,
        anomalyCount: 0,
        disputeCount: 0,
      },
    ],
    suppliers: [],
    evidenceSummary: { green: 8, yellow: 1, red: 0, unknown: 0 },
    targetMarginBps: 3000,
  };
}

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
