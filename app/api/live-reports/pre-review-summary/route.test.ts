import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
} from "@/features/live-operations/live-operations-route-utils";
import { listReportPreReviewSummaries } from "@/features/report-pre-review/report-pre-review-service";

vi.mock("@/features/live-operations/live-operations-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/live-operations/live-operations-route-utils")
  >("@/features/live-operations/live-operations-route-utils");

  return {
    ...actual,
    actorFromContext: vi.fn(),
    getLiveOperationsRouteContext: vi.fn(),
  };
});

vi.mock("@/features/report-pre-review/report-pre-review-service", () => ({
  listReportPreReviewSummaries: vi.fn(),
}));

const supabase = { client: "supabase" };
const actor = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
  streamerId: null,
};
const context = {
  supabase,
  auth: actor,
  repo: { repo: "live-operations" },
  audit: vi.fn(),
  notify: vi.fn(),
};

describe("/api/live-reports/pre-review-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(actorFromContext).mockResolvedValue(actor);
  });

  it("lists latest pre-review summaries for requested reports", async () => {
    vi.mocked(listReportPreReviewSummaries).mockResolvedValueOnce([
      {
        id: "pre-review-1",
        reportId: "report-1",
        decision: "manual_review",
        confidence: "medium",
        suggestedAction: "review",
        evidenceSummary: "summary",
        reviewNoteDraft: "note",
        reasons: [],
        failedGates: ["duration_divergence"],
        source: "deterministic",
        createdAt: "2026-06-29T01:00:00.000Z",
      },
    ]);

    const response = await GET(
      new Request(
        "http://localhost/api/live-reports/pre-review-summary?reportIds=report-1,report-2&limit=20",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      summaries: [
        {
          id: "pre-review-1",
          reportId: "report-1",
          decision: "manual_review",
          confidence: "medium",
          suggestedAction: "review",
          evidenceSummary: "summary",
          reviewNoteDraft: "note",
          reasons: [],
          failedGates: ["duration_divergence"],
          source: "deterministic",
          createdAt: "2026-06-29T01:00:00.000Z",
        },
      ],
    });
    expect(actorFromContext).toHaveBeenCalledWith(context);
    expect(listReportPreReviewSummaries).toHaveBeenCalledWith({
      client: supabase,
      actor,
      reportIds: ["report-1", "report-2"],
      limit: 20,
    });
  });

  it("maps service errors through jsonError", async () => {
    vi.mocked(listReportPreReviewSummaries).mockRejectedValueOnce(
      new Error("Current role cannot read report pre-review"),
    );

    const response = await GET(
      new Request("http://localhost/api/live-reports/pre-review-summary"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Current role cannot read report pre-review",
    });
  });
});
