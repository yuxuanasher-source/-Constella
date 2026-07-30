import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { reopenAdmissionShareBoard } from "@/features/applications/admission-share-board";
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
  reopenAdmissionShareBoard: vi.fn(),
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
const params = Promise.resolve({
  projectId: "project-1",
  shareBoardId: "share-1",
});

describe("reopen admission share-board route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(reopenAdmissionShareBoard).mockResolvedValue(undefined);
  });

  it("reopens one locked formal review with the operator reason", async () => {
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ reason: "甲方误选一条录屏" }),
      }),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(reopenAdmissionShareBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        projectId: "project-1",
        shareBoardId: "share-1",
        reason: "甲方误选一条录屏",
      }),
    );
  });

  it("rejects a missing reopen reason as a client error", async () => {
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      { params },
    );

    expect(response.status).toBe(400);
    expect(reopenAdmissionShareBoard).not.toHaveBeenCalled();
  });

  it("blocks non-MCN roles before lifecycle persistence", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...auth, role: "streamer" },
    } as never);

    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ reason: "甲方误选一条录屏" }),
      }),
      { params },
    );

    expect(response.status).toBe(403);
    expect(reopenAdmissionShareBoard).not.toHaveBeenCalled();
  });
});
