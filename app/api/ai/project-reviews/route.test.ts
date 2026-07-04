import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

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

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

const PROJECT_ID = "8f7a1f7e-3f30-4a26-9d61-0d5f6f6e2a11";

function loadedReviewInput() {
  return {
    input: {
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
    },
    dataGaps: ["project_category", "streamer_roi"],
  };
}

describe("AI project review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(loadProjectReviewInput).mockResolvedValue(loadedReviewInput());
  });

  it("loads review facts server-side and returns grounded output", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/project-reviews", {
        method: "POST",
        body: JSON.stringify({
          projectId: PROJECT_ID,
          targetMarginBps: 3000,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    // organizationId 只能来自认证上下文,绝不来自请求体。
    expect(loadProjectReviewInput).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        projectId: PROJECT_ID,
        targetMarginBps: 3000,
      }),
    );

    expect(body).toMatchObject({
      report: {
        projectId: PROJECT_ID,
        marginRateBps: 4167,
        shouldContinue: true,
      },
      agentOutput: {
        recommendations: expect.arrayContaining([
          expect.objectContaining({
            requiresHumanApproval: true,
          }),
        ]),
      },
      validation: { valid: true, errors: [] },
      dataGaps: ["project_category", "streamer_roi"],
    });
    // 数据缺口必须作为 caveats 呈现。
    expect(body.agentOutput.caveats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "项目品类信息暂无真实数据来源,按未知处理",
          unverifiedExternalFactor: true,
        }),
      ]),
    );
    const narrative = [
      ...body.agentOutput.findings.map(
        (finding: { summary: string }) => finding.summary,
      ),
      ...body.agentOutput.recommendations.map(
        (recommendation: { proposal: string }) => recommendation.proposal,
      ),
    ].join(" ");
    expect(narrative).not.toMatch(/\d/);
  });

  it("rejects the legacy client-supplied fact payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/project-reviews", {
        method: "POST",
        body: JSON.stringify({
          project: { id: "project-api", name: "Campaign Alpha" },
          finance: { receivableCents: 1200000 },
          evidenceSummary: { green: 8, yellow: 1, red: 0, unknown: 0 },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(loadProjectReviewInput).not.toHaveBeenCalled();
  });

  it("returns 404 when the project is not visible in the organization", async () => {
    vi.mocked(loadProjectReviewInput).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ai/project-reviews", {
        method: "POST",
        body: JSON.stringify({ projectId: PROJECT_ID }),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("blocks streamers from internal project review economics", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/ai/project-reviews", {
        method: "POST",
        body: JSON.stringify({ projectId: PROJECT_ID }),
      }),
    );

    expect(response.status).toBe(403);
    expect(loadProjectReviewInput).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ai/project-reviews", {
        method: "POST",
        body: JSON.stringify({ projectId: PROJECT_ID }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
