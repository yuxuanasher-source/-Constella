import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { revokeAdmissionShareBoard } from "@/features/applications/admission-share-board";
import {
  actorFromContext,
  getAdmissionRouteContext,
} from "@/features/applications/application-route-utils";

vi.mock("@/features/applications/admission-share-board", () => ({
  SupabaseAdmissionShareBoardRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "share-repo" };
    }),
  revokeAdmissionShareBoard: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: vi.fn(),
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

const params = Promise.resolve({
  projectId: "project-1",
  shareBoardId: "share-1",
});

describe("revoke admission share-board route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(revokeAdmissionShareBoard).mockResolvedValue(undefined);
  });

  it("revokes a share board for MCN staff", async () => {
    const response = await POST(new Request("http://localhost/api"), {
      params,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(revokeAdmissionShareBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        audit: expect.any(Function),
        projectId: "project-1",
        shareBoardId: "share-1",
      }),
    );
  });

  it("blocks streamers", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...auth, role: "streamer" },
    } as never);

    const response = await POST(new Request("http://localhost/api"), {
      params,
    });

    expect(response.status).toBe(403);
    expect(revokeAdmissionShareBoard).not.toHaveBeenCalled();
  });
});
