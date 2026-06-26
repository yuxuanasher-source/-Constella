import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { listProjectCollaborationApplications } from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
} from "@/features/applications/application-route-utils";

vi.mock("@/features/collaborations/project-collaboration-service", () => ({
  SupabaseProjectCollaborationRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "collaboration-repo" };
    }),
  listProjectCollaborationApplications: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: vi.fn(),
  getAdmissionRouteContext: vi.fn(),
  jsonError: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    ),
}));

const auth = {
  userId: "user-owner",
  name: "Owner",
  role: "ops_manager" as const,
  organizationId: "org-owner",
};

describe("project collaboration applications route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth,
      audit: vi.fn(),
    } as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(listProjectCollaborationApplications).mockResolvedValue([
      {
        id: "application-1",
        shareId: "share-1",
        projectId: "project-1",
        ownerOrganizationId: "org-owner",
        applicantOrganizationId: "org-partner",
        requestedRevenueShareBps: 1000,
        ownerCounterRevenueShareBps: null,
        finalRevenueShareBps: null,
        status: "submitted",
        applicantNote: "We can join.",
        ownerReviewNote: "",
        rejectionReason: "",
        submittedBy: "user-partner",
        reviewedBy: null,
        reviewedAt: null,
        applicantConfirmedBy: null,
        applicantConfirmedAt: null,
      },
    ]);
  });

  it("lists owner-visible collaboration applications", async () => {
    const response = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      applications: [expect.objectContaining({ id: "application-1" })],
    });
    expect(listProjectCollaborationApplications).toHaveBeenCalledWith(
      expect.objectContaining({ actor: auth, projectId: "project-1" }),
    );
  });
});
