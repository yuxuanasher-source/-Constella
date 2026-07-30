import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import {
  AdmissionShareSelectionError,
  createAdmissionShareBoard,
  listAdmissionShareBoards,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareCandidateRepository } from "@/features/applications/admission-share-candidates";
import {
  actorFromContext,
  getAdmissionRouteContext,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

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
  AdmissionShareSelectionError: class AdmissionShareSelectionError extends Error {
    readonly name = "AdmissionShareSelectionError";

    constructor(public readonly items: unknown[]) {
      super("Admission share selection changed");
    }
  },
}));

vi.mock("@/features/applications/admission-share-candidates", () => ({
  SupabaseAdmissionShareCandidateRepository: vi
    .fn()
    .mockImplementation(function () {
      return {
        repo: "candidate-repo",
      };
    }),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
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
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      client: "admin",
    } as never);
    vi.mocked(listAdmissionShareBoards).mockResolvedValue([
      {
        id: "share-1",
        organizationId: "org-1",
        projectId: "project-1",
        title: "Vendor review",
        purpose: "",
        mode: "formal_review",
        tokenHash: "hash",
        accessCodeHash: null,
        status: "active",
        expiresAt: "2026-06-14T00:00:00.000Z",
        allowVendorSubmit: true,
        allowExternalFallback: true,
        reviewState: "not_started",
        roundNumber: 1,
        createdBy: "user-ops",
      },
    ]);
    vi.mocked(createAdmissionShareBoard).mockResolvedValue({
      token: "plain-token",
      accessCode: "24681024",
      shareBoard: {
        id: "share-1",
        organizationId: "org-1",
        projectId: "project-1",
        title: "Vendor review",
        purpose: "",
        mode: "formal_review",
        tokenHash: "hash",
        accessCodeHash: null,
        status: "active",
        expiresAt: "2026-06-14T00:00:00.000Z",
        allowVendorSubmit: true,
        allowExternalFallback: true,
        reviewState: "not_started",
        roundNumber: 1,
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
            mode: "preview",
            title: "客户预览",
            purpose: "确认画面",
            expiresAt: "2026-08-06T00:00:00.000Z",
            requireAccessCode: false,
            allowExternalFallback: true,
            items: [
              {
                applicationId: "app-1",
                recordingSubmissionId: "recording-v2",
                recordingVersion: 2,
                sortOrder: 0,
              },
            ],
          }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.shareUrl).toBe("http://localhost/share/admission/plain-token");
    expect(body.accessCode).toBe("24681024");
    expect(JSON.stringify(body)).not.toContain("hash");
    expect(SupabaseAdmissionShareBoardRepository).toHaveBeenCalledWith(
      context.supabase,
    );
    expect(SupabaseAdmissionShareCandidateRepository).toHaveBeenCalledWith({
      client: "admin",
    });
    expect(createAdmissionShareBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        repo: { repo: "share-repo" },
        candidateRepo: { repo: "candidate-repo" },
        projectId: "project-1",
        input: {
          mode: "preview",
          title: "客户预览",
          purpose: "确认画面",
          expiresAt: "2026-08-06T00:00:00.000Z",
          requireAccessCode: false,
          accessCode: undefined,
          allowExternalFallback: true,
          items: [
            {
              applicationId: "app-1",
              recordingSubmissionId: "recording-v2",
              recordingVersion: 2,
              sortOrder: 0,
            },
          ],
        },
      }),
    );
  });

  it("returns itemized selection conflicts as 409", async () => {
    vi.mocked(createAdmissionShareBoard).mockRejectedValue(
      new AdmissionShareSelectionError([
        {
          applicationId: "app-1",
          recordingSubmissionId: "recording-v2",
          recordingVersion: 2,
          sortOrder: 0,
          status: "blocked",
          sourceHealth: "blocked",
          reasonCode: "SELECTION_STALE",
        },
      ]),
    );

    const response = await POST(
      new Request(
        "http://localhost/api/projects/project-1/admission-share-boards",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "formal_review",
            items: [
              {
                applicationId: "app-1",
                recordingSubmissionId: "recording-v2",
                recordingVersion: 2,
                sortOrder: 0,
              },
            ],
          }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "SHARE_SELECTION_CHANGED",
      error: "部分录屏状态已变化，请移除异常项后重试。",
      items: [
        expect.objectContaining({
          recordingSubmissionId: "recording-v2",
          reasonCode: "SELECTION_STALE",
        }),
      ],
    });
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
