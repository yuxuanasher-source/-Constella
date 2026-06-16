import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import {
  getPublicProjectCollaboration,
  submitProjectCollaborationApplication,
} from "@/features/collaborations/project-collaboration-service";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

vi.mock("@/features/collaborations/project-collaboration-service", () => ({
  SupabaseProjectCollaborationRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "collaboration-repo" };
    }),
  getPublicProjectCollaboration: vi.fn(),
  submitProjectCollaborationApplication: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

const auth = {
  userId: "user-partner",
  email: "partner@example.com",
  name: "Partner",
  role: "ops_manager" as const,
  organizationId: "org-partner",
  organizationName: "Partner Org",
};

const params = Promise.resolve({ token: "raw-token" });

describe("public project collaboration route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      client: "admin",
    } as never);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "server",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(getPublicProjectCollaboration).mockResolvedValue({
      available: true,
      share: {
        id: "share-1",
        status: "active",
        expiresAt: "2026-06-24T00:00:00.000Z",
        allowApplications: true,
      },
      project: {
        id: "project-1",
        name: "Owner project",
        code: "COLLAB",
        ownerOrganizationName: "Owner Org",
        collaborationSummary: "Partner MCNs can contribute.",
        collaborationTerms: {},
      },
    });
    vi.mocked(submitProjectCollaborationApplication).mockResolvedValue({
      id: "application-1",
      status: "submitted",
      shareId: "share-1",
      projectId: "project-1",
      ownerOrganizationId: "org-owner",
      applicantOrganizationId: "org-partner",
      requestedRevenueShareBps: 1000,
      ownerCounterRevenueShareBps: null,
      finalRevenueShareBps: null,
      applicantNote: "",
      ownerReviewNote: "",
      rejectionReason: "",
      submittedBy: "user-partner",
      reviewedBy: null,
      reviewedAt: null,
      applicantConfirmedBy: null,
      applicantConfirmedAt: null,
    });
  });

  it("reads a public collaboration snapshot", async () => {
    const response = await GET(new Request("http://localhost/api"), {
      params,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      collaboration: expect.objectContaining({ available: true }),
    });
    expect(getPublicProjectCollaboration).toHaveBeenCalledWith(
      expect.objectContaining({ token: "raw-token" }),
    );
  });

  it("submits a logged-in partner application", async () => {
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({
          requestedRevenueShareBps: 1000,
          applicantNote: "We can join.",
        }),
      }),
      { params },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      application: expect.objectContaining({ id: "application-1" }),
    });
    expect(submitProjectCollaborationApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        token: "raw-token",
        input: {
          requestedRevenueShareBps: 1000,
          applicantNote: "We can join.",
        },
      }),
    );
  });

  it("fails closed when the public application service cannot use the admin client", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({
          requestedRevenueShareBps: 1000,
          applicantNote: "We can join.",
        }),
      }),
      { params },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Public collaboration service is unavailable",
    });
    expect(submitProjectCollaborationApplication).not.toHaveBeenCalled();
  });
});
