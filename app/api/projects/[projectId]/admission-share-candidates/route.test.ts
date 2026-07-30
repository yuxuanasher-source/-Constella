import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { listAdmissionShareCandidates } from "@/features/applications/admission-share-candidates";
import { getAdmissionRouteContext } from "@/features/applications/application-route-utils";

vi.mock("@/features/applications/admission-share-candidates", () => ({
  SupabaseAdmissionShareCandidateRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "candidate-repo" };
    }),
  listAdmissionShareCandidates: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  getAdmissionRouteContext: vi.fn(),
  jsonError: (error: unknown) => {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status },
    );
  },
  RouteError: class RouteError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  },
}));

const context = {
  supabase: { client: "supabase" },
  auth: {
    userId: "user-ops",
    name: "Ops",
    role: "ops_manager" as const,
    organizationId: "org-1",
  },
};

const routeParams = {
  params: Promise.resolve({ projectId: "project-1" }),
};

describe("admission share candidates route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
    vi.mocked(listAdmissionShareCandidates).mockResolvedValue([
      {
        applicationId: "app-1",
        recordingSubmissionId: "recording-v1",
        recordingVersion: 1,
        isLatestVersion: true,
        streamer: {
          id: "streamer-1",
          displayName: "主播甲",
          accountLabel: "dy_1",
        },
        mcnReviewDecision: "approved",
        mcnReviewedAt: "2026-07-30T08:00:00.000Z",
        sourceHealth: "original_ready",
        hasPrivateStorage: true,
        externalUrl: null,
        isShareable: true,
        blockReason: null,
        currentVendorDecision: "pending",
        lastSharedAt: null,
      },
    ]);
  });

  it("returns the safe candidate DTO to MCN staff", async () => {
    const response = await GET(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-candidates",
      ),
      routeParams,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.candidates).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("storagePath");
    expect(listAdmissionShareCandidates).toHaveBeenCalledWith(
      { repo: "candidate-repo" },
      {
        projectId: "project-1",
        organizationId: "org-1",
      },
    );
  });

  it("blocks streamers before querying candidates", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...context.auth, role: "streamer" },
    } as never);

    const response = await GET(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-candidates",
      ),
      routeParams,
    );

    expect(response.status).toBe(403);
    expect(listAdmissionShareCandidates).not.toHaveBeenCalled();
  });
});
