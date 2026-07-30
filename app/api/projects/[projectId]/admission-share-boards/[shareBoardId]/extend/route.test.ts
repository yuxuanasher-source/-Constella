import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { extendAdmissionShareBoard } from "@/features/applications/admission-share-board";
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
  extendAdmissionShareBoard: vi.fn(),
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

describe("extend admission share-board route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(extendAdmissionShareBoard).mockResolvedValue(undefined);
  });

  it("extends one scoped share board for MCN staff", async () => {
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ expiresAt: "2026-08-10T00:00:00.000Z" }),
      }),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(extendAdmissionShareBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        projectId: "project-1",
        shareBoardId: "share-1",
        expiresAt: "2026-08-10T00:00:00.000Z",
      }),
    );
  });

  it("maps lifecycle conflicts to their stable 4xx status", async () => {
    vi.mocked(extendAdmissionShareBoard).mockRejectedValue(
      Object.assign(new Error("Share board is not active"), {
        statusCode: 409,
      }),
    );

    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ expiresAt: "2026-08-10T00:00:00.000Z" }),
      }),
      { params },
    );

    expect(response.status).toBe(409);
  });

  it("blocks non-MCN roles before lifecycle persistence", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...auth, role: "streamer" },
    } as never);

    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ expiresAt: "2026-08-10T00:00:00.000Z" }),
      }),
      { params },
    );

    expect(response.status).toBe(403);
    expect(extendAdmissionShareBoard).not.toHaveBeenCalled();
  });
});
