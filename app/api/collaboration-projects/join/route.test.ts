import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  submitProjectCollaborationInviteApplication,
  SupabaseProjectCollaborationRepository,
} from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/collaborations/project-collaboration-service", () => ({
  SupabaseProjectCollaborationRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "collaboration-repo" };
    }),
  submitProjectCollaborationInviteApplication: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: vi.fn(),
  getAdmissionRouteContext: vi.fn(),
  readJsonBody: async (request: Request) => request.json(),
  jsonError: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      {
        status:
          error && typeof error === "object" && "statusCode" in error
            ? Number(error.statusCode)
            : 500,
      },
    ),
  RouteError: class RouteError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const auth = {
  userId: "user-partner",
  name: "Partner",
  role: "ops_manager" as const,
  organizationId: "org-partner",
};

describe("collaboration project join route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth,
      audit: vi.fn(),
    } as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      client: "admin-supabase",
    } as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(submitProjectCollaborationInviteApplication).mockResolvedValue({
      application: {
        id: "application-1",
        projectId: "project-1",
        status: "submitted",
      },
      project: {
        id: "project-1",
        name: "Owner project",
        code: "COLLAB",
        ownerOrganizationName: "Owner Org",
        collaborationSummary: "Partner MCNs can contribute.",
      },
      pendingOwnerReview: true,
    } as never);
  });

  it("submits a pasted invitation link application for owner review", async () => {
    const response = await POST(
      new Request("http://localhost/api/collaboration-projects/join", {
        method: "POST",
        body: JSON.stringify({
          inviteLink:
            "http://localhost:3000/share/project-collaboration/raw-token",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      application: expect.objectContaining({
        id: "application-1",
        status: "submitted",
      }),
      project: expect.objectContaining({ id: "project-1" }),
      pendingOwnerReview: true,
    });
    expect(submitProjectCollaborationInviteApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: { repo: "collaboration-repo" },
        actor: auth,
        input: {
          inviteLink:
            "http://localhost:3000/share/project-collaboration/raw-token",
          requestedRevenueShareBps: 0,
          applicantNote: "",
        },
      }),
    );
    expect(SupabaseProjectCollaborationRepository).toHaveBeenCalledWith({
      client: "admin-supabase",
    });
  });
});
