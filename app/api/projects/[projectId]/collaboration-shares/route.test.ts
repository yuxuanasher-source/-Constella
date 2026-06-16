import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import {
  createProjectCollaborationShare,
  listProjectCollaborationShares,
} from "@/features/collaborations/project-collaboration-service";
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
  createProjectCollaborationShare: vi.fn(),
  listProjectCollaborationShares: vi.fn(),
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

const auth = {
  userId: "user-owner",
  name: "Owner",
  role: "ops_manager" as const,
  organizationId: "org-owner",
};

const context = {
  supabase: { client: "supabase" },
  auth,
  audit: vi.fn(),
};

const params = Promise.resolve({ projectId: "project-1" });

describe("project collaboration shares route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(listProjectCollaborationShares).mockResolvedValue([
      {
        id: "share-1",
        ownerOrganizationId: "org-owner",
        projectId: "project-1",
        tokenHash: "hash-secret",
        status: "active",
        expiresAt: "2026-06-24T00:00:00.000Z",
        allowApplications: true,
        visibleFields: ["projectName"],
        createdBy: "user-owner",
      },
    ]);
    vi.mocked(createProjectCollaborationShare).mockResolvedValue({
      token: "raw-token",
      share: {
        id: "share-1",
        ownerOrganizationId: "org-owner",
        projectId: "project-1",
        tokenHash: "hash-secret",
        status: "active",
        expiresAt: "2026-06-24T00:00:00.000Z",
        allowApplications: true,
        visibleFields: ["projectName"],
        createdBy: "user-owner",
      },
    });
  });

  it("lists shares without token hashes", async () => {
    const response = await GET(new Request("http://localhost/api"), {
      params,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.shares).toEqual([
      expect.objectContaining({ id: "share-1", status: "active" }),
    ]);
    expect(JSON.stringify(body)).not.toContain("hash-secret");
  });

  it("creates a share and returns a one-time public URL", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/projects/project-1/collaboration-shares",
        {
          method: "POST",
          body: JSON.stringify({ allowApplications: true }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.shareUrl).toBe(
      "http://localhost/share/project-collaboration/raw-token",
    );
    expect(JSON.stringify(body)).not.toContain("hash-secret");
    expect(createProjectCollaborationShare).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        projectId: "project-1",
        input: expect.objectContaining({ allowApplications: true }),
      }),
    );
  });
});
