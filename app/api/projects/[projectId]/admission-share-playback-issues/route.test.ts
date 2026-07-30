import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { listAdmissionSharePlaybackIssues } from "@/features/applications/admission-share-board";
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
      listAdmissionSharePlaybackIssues: vi.fn(),
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
    role: "ops_manager",
    organizationId: "org-1",
  },
} as unknown as AdmissionRouteContext;

const projectRouteParams = {
  params: Promise.resolve({ projectId: "project-1" }),
};

describe("admission share playback issues route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context);
    vi.mocked(listAdmissionSharePlaybackIssues).mockResolvedValue([
      {
        id: "issue-1",
        shareBoardId: "share-1",
        recordingSubmissionId: "recording-1",
        recordingVersion: 1,
        streamerDisplayName: "主播甲",
        sourceType: "original",
        errorCode: "MEDIA_DECODE_FAILED",
        status: "open",
        reportedAt: "2026-07-30T09:00:00.000Z",
        resolvedAt: null,
      },
    ]);
  });

  it("lists only sanitized open issues for the requested MCN project", async () => {
    const response = await GET(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-playback-issues?status=open",
      ),
      projectRouteParams,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.issues).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("storagePath");
    expect(JSON.stringify(body)).not.toContain("userAgent");
    expect(JSON.stringify(body)).not.toContain("token");
    expect(listAdmissionSharePlaybackIssues).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      actor: {
        userId: "user-ops",
        role: "ops_manager",
        organizationId: "org-1",
      },
      organizationId: "org-1",
      projectId: "project-1",
      status: "open",
    });
  });

  it("rejects non-MCN roles and invalid status before reading issues", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValueOnce({
      ...context,
      auth: { ...context.auth, role: "streamer" },
    } as AdmissionRouteContext);
    const forbidden = await GET(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-playback-issues?status=open",
      ),
      projectRouteParams,
    );
    expect(forbidden.status).toBe(403);

    vi.mocked(getAdmissionRouteContext).mockResolvedValueOnce(context);
    const invalid = await GET(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-playback-issues?status=all",
      ),
      projectRouteParams,
    );
    expect(invalid.status).toBe(400);
    expect(listAdmissionSharePlaybackIssues).not.toHaveBeenCalled();
  });

  it("uses the real route error serializer for a sanitized list database failure", async () => {
    vi.mocked(listAdmissionSharePlaybackIssues).mockRejectedValueOnce(
      Object.assign(new Error("Playback issue database request failed"), {
        code: "PLAYBACK_ISSUE_DATABASE_ERROR",
        statusCode: 500,
      }),
    );

    const response = await GET(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-playback-issues?status=open",
      ),
      projectRouteParams,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "PLAYBACK_ISSUE_DATABASE_ERROR",
      error: "Playback issue database request failed",
    });
  });
});
