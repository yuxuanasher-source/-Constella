import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { reviewProjectCollaborationApplication } from "@/features/collaborations/project-collaboration-service";
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
  reviewProjectCollaborationApplication: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: vi.fn(),
  getAdmissionRouteContext: vi.fn(),
  readJsonBody: async (request: Request) => request.json(),
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

describe("project collaboration application review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth,
      audit: vi.fn(),
    } as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(reviewProjectCollaborationApplication).mockResolvedValue({
      application: { id: "application-1", status: "owner_countered" },
      agreement: null,
    } as never);
  });

  it("reviews a collaboration application with a counter offer", async () => {
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({
          action: "counter",
          ownerCounterRevenueShareBps: 900,
          ownerReviewNote: "Counter at 9%.",
        }),
      }),
      {
        params: Promise.resolve({
          projectId: "project-1",
          applicationId: "application-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      application: expect.objectContaining({ id: "application-1" }),
      agreement: null,
    });
    expect(reviewProjectCollaborationApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        projectId: "project-1",
        applicationId: "application-1",
        input: {
          action: "counter",
          ownerCounterRevenueShareBps: 900,
          ownerReviewNote: "Counter at 9%.",
        },
      }),
    );
  });
});
