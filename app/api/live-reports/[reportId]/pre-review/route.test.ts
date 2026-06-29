import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
} from "@/features/live-operations/live-operations-route-utils";
import { generateReportPreReview } from "@/features/report-pre-review/report-pre-review-service";

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
  generateReportPreReview: vi.fn(),
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

function postPreReview() {
  return POST(
    new Request("http://localhost/api/live-reports/report-1/pre-review", {
      method: "POST",
    }),
    {
      params: Promise.resolve({ reportId: "report-1" }),
    },
  );
}

describe("/api/live-reports/[reportId]/pre-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(actorFromContext).mockResolvedValue(actor);
  });

  it("generates a report pre-review for the current actor", async () => {
    vi.mocked(generateReportPreReview).mockResolvedValueOnce({
      preReviewId: "pre-review-1",
      result: {
        reportId: "report-1",
        decision: "quick_pass_candidate",
        confidence: "high",
        evidenceSummary: "ok",
        suggestedAction: "approve",
        reviewNoteDraft: "approve",
        reasons: ["green_system_evidence"],
        failedGates: [],
        source: "deterministic",
        invocationId: "invocation-1",
      },
    });

    const response = await postPreReview();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preReview: {
        id: "pre-review-1",
        reportId: "report-1",
        decision: "quick_pass_candidate",
        confidence: "high",
        evidenceSummary: "ok",
        suggestedAction: "approve",
        reviewNoteDraft: "approve",
        reasons: ["green_system_evidence"],
        failedGates: [],
        source: "deterministic",
        invocationId: "invocation-1",
      },
    });
    expect(actorFromContext).toHaveBeenCalledWith(context);
    expect(generateReportPreReview).toHaveBeenCalledWith({
      client: supabase,
      actor,
      reportId: "report-1",
      audit: expect.any(Function),
    });
  });

  it("maps service errors through jsonError", async () => {
    vi.mocked(generateReportPreReview).mockRejectedValueOnce(
      new Error("Current role cannot generate report pre-review"),
    );

    const response = await postPreReview();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Current role cannot generate report pre-review",
    });
  });
});
