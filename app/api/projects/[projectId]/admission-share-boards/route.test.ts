import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import {
  createAdmissionShareBoard,
  listAdmissionShareBoards,
} from "@/features/applications/admission-share-board";
import {
  actorFromContext,
  getAdmissionRouteContext,
} from "@/features/applications/application-route-utils";

vi.mock("@/features/applications/admission-share-board", () => ({
  SupabaseAdmissionShareBoardRepository: vi
    .fn()
    .mockImplementation(function () {
      return {
        repo: "share-repo",
      };
    }),
  createAdmissionShareBoard: vi.fn(),
  listAdmissionShareBoards: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: vi.fn(),
  getAdmissionRouteContext: vi.fn(),
  readJsonBody: async (request: Request) => request.json(),
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

const auth = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

const context = {
  supabase: { client: "supabase" },
  auth,
  audit: vi.fn(),
};

const params = Promise.resolve({ projectId: "project-1" });

describe("project admission share-board route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(listAdmissionShareBoards).mockResolvedValue([
      {
        id: "share-1",
        organizationId: "org-1",
        projectId: "project-1",
        title: "Vendor review",
        tokenHash: "hash",
        accessCodeHash: null,
        status: "active",
        expiresAt: "2026-06-14T00:00:00.000Z",
        allowVendorSubmit: true,
        createdBy: "user-ops",
      },
    ]);
    vi.mocked(createAdmissionShareBoard).mockResolvedValue({
      token: "plain-token",
      shareBoard: {
        id: "share-1",
        organizationId: "org-1",
        projectId: "project-1",
        title: "Vendor review",
        tokenHash: "hash",
        accessCodeHash: null,
        status: "active",
        expiresAt: "2026-06-14T00:00:00.000Z",
        allowVendorSubmit: true,
        createdBy: "user-ops",
      },
    });
  });

  it("lists share boards without token hashes", async () => {
    const response = await GET(new Request("http://localhost/api"), {
      params,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.shareBoards).toEqual([
      expect.objectContaining({ id: "share-1", title: "Vendor review" }),
    ]);
    expect(JSON.stringify(body)).not.toContain("hash");
  });

  it("creates a share board and returns one-time share url", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/projects/project-1/admission-share-boards",
        {
          method: "POST",
          body: JSON.stringify({
            title: "Vendor review",
            applicationIds: ["app-1"],
          }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.shareUrl).toBe("http://localhost/share/admission/plain-token");
    expect(JSON.stringify(body)).not.toContain("hash");
    expect(createAdmissionShareBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        projectId: "project-1",
        input: expect.objectContaining({ title: "Vendor review" }),
      }),
    );
  });

  it("blocks streamers from creating share boards", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...auth, role: "streamer" },
    } as never);

    const response = await POST(
      new Request(
        "http://localhost/api/projects/project-1/admission-share-boards",
        {
          method: "POST",
          body: JSON.stringify({ title: "Vendor review" }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(403);
    expect(createAdmissionShareBoard).not.toHaveBeenCalled();
  });
});
