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

vi.mock(
  "@/features/applications/admission-share-board",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/applications/admission-share-board")
      >();
    return {
      ...actual,
      SupabaseAdmissionShareBoardRepository: vi
        .fn()
        .mockImplementation(function () {
          return { repo: "share-repo" };
        }),
      resolveAdmissionSharePlaybackIssue: vi.fn(),
    };
  },
);

vi.mock(
  "@/features/applications/application-route-utils",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/applications/application-route-utils")
      >();
    return {
      ...actual,
      getAdmissionRouteContext: vi.fn(),
    };
  },
);

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

  it.each([
    ["PLAYBACK_ISSUE_FORBIDDEN", "Playback issue access is forbidden", 403],
    ["PLAYBACK_ISSUE_NOT_FOUND", "Playback issue was not found", 404],
  ])(
    "uses the real route error serializer for %s",
    async (code, message, status) => {
      vi.mocked(resolveAdmissionSharePlaybackIssue).mockRejectedValueOnce(
        Object.assign(new Error(message), { code, statusCode: status }),
      );

      const response = await POST(
        new Request(
          "https://app.example/api/projects/project-1/admission-share-playback-issues/issue-1/resolve",
          { method: "POST" },
        ),
        resolveRouteParams,
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        code,
        error: message,
      });
    },
  );
});
