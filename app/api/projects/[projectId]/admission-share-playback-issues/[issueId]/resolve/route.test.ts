import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  resolveAdmissionSharePlaybackIssue,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import {
  getAdmissionRouteContext,
  type AdmissionRouteContext,
} from "@/features/applications/application-route-utils";

vi.mock("@/features/applications/admission-share-board", () => ({
  SupabaseAdmissionShareBoardRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "share-repo" };
    }),
  resolveAdmissionSharePlaybackIssue: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: (context: AdmissionRouteContext) => ({
    userId: context.auth.userId,
    name: context.auth.name,
    role: context.auth.role,
    organizationId: context.auth.organizationId,
  }),
  getAdmissionRouteContext: vi.fn(),
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

const context = {
  supabase: { client: "authenticated" },
  auth: {
    userId: "user-ops",
    name: "运营甲",
    role: "ops_manager",
    organizationId: "org-1",
  },
  audit: vi.fn(),
} as unknown as AdmissionRouteContext;
const resolveRouteParams = {
  params: Promise.resolve({ projectId: "project-1", issueId: "issue-1" }),
};

describe("resolve admission share playback issue route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context);
    vi.mocked(resolveAdmissionSharePlaybackIssue).mockResolvedValue(undefined);
  });

  it("resolves one issue with MCN organization and project evidence", async () => {
    const response = await POST(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-playback-issues/issue-1/resolve",
        { method: "POST" },
      ),
      resolveRouteParams,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(resolveAdmissionSharePlaybackIssue).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      audit: expect.any(Function),
      actor: {
        userId: "user-ops",
        name: "运营甲",
        role: "ops_manager",
        organizationId: "org-1",
      },
      organizationId: "org-1",
      projectId: "project-1",
      issueId: "issue-1",
    });
  });

  it("blocks non-MCN roles before constructing issue persistence", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...context.auth, role: "streamer" },
    } as AdmissionRouteContext);

    const response = await POST(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-playback-issues/issue-1/resolve",
        { method: "POST" },
      ),
      resolveRouteParams,
    );

    expect(response.status).toBe(403);
    expect(SupabaseAdmissionShareBoardRepository).not.toHaveBeenCalled();
    expect(resolveAdmissionSharePlaybackIssue).not.toHaveBeenCalled();
  });
});
