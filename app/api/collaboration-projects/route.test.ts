import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  listPartnerCollaborationApplications,
  listPartnerCollaborationProjects,
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
  listPartnerCollaborationApplications: vi.fn(),
  listPartnerCollaborationProjects: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: vi.fn(),
  getAdmissionRouteContext: vi.fn(),
  jsonError: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
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

describe("collaboration projects route", () => {
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
    vi.mocked(listPartnerCollaborationProjects).mockResolvedValue([
      {
        agreement: {
          id: "agreement-1",
          status: "active",
          revenueShareBps: 900,
          settlementBasis: "project_revenue",
        },
        project: {
          id: "project-1",
          name: "Owner project",
          code: "COLLAB",
          ownerOrganizationName: "Owner Org",
          collaborationSummary: "Partner MCNs can contribute.",
        },
      },
    ]);
    vi.mocked(listPartnerCollaborationApplications).mockResolvedValue([
      {
        application: {
          id: "application-1",
          shareId: "share-1",
          projectId: "project-2",
          ownerOrganizationId: "org-owner",
          applicantOrganizationId: "org-partner",
          status: "owner_countered",
          requestedRevenueShareBps: 1200,
          ownerCounterRevenueShareBps: 900,
          finalRevenueShareBps: null,
          applicantNote: "",
          ownerReviewNote: "",
          rejectionReason: "",
          submittedBy: "user-partner",
          reviewedBy: "user-owner",
          reviewedAt: "2026-06-10T00:00:00.000Z",
          applicantConfirmedBy: null,
          applicantConfirmedAt: null,
        },
        project: {
          id: "project-2",
          name: "Counter project",
          code: "COUNTER",
          ownerOrganizationName: "Owner Org",
          collaborationSummary: "Needs confirmation.",
          collaborationTerms: {},
        },
      },
    ]);
  });

  it("lists partner-visible collaboration projects", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      projects: [
        {
          agreement: {
            id: "agreement-1",
            status: "active",
            revenueShareBps: 900,
            settlementBasis: "project_revenue",
          },
          project: {
            id: "project-1",
            name: "Owner project",
            code: "COLLAB",
            ownerOrganizationName: "Owner Org",
            collaborationSummary: "Partner MCNs can contribute.",
          },
        },
      ],
      applications: [
        {
          application: expect.objectContaining({
            id: "application-1",
            status: "owner_countered",
            requestedRevenueShareBps: 1200,
            ownerCounterRevenueShareBps: 900,
          }),
          project: expect.objectContaining({
            id: "project-2",
            name: "Counter project",
            code: "COUNTER",
            ownerOrganizationName: "Owner Org",
            collaborationSummary: "Needs confirmation.",
          }),
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("privateMargin");
    expect(JSON.stringify(body)).not.toContain("tokenHash");
    expect(listPartnerCollaborationProjects).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: { repo: "collaboration-repo" },
        actor: auth,
      }),
    );
    expect(listPartnerCollaborationApplications).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: { repo: "collaboration-repo" },
        actor: auth,
      }),
    );
    expect(SupabaseProjectCollaborationRepository).toHaveBeenCalledWith({
      client: "admin-supabase",
    });
  });
});
