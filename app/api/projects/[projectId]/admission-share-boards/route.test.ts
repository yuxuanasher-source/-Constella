import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import {
  AdmissionShareFormalRoundConflictError,
  AdmissionShareSelectionError,
  createAdmissionShareBoard,
  getInternalAdmissionShareBoardDetail,
  listInternalAdmissionShareBoardTasks,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareCandidateRepository } from "@/features/applications/admission-share-candidates";
import {
  actorFromContext,
  getAdmissionRouteContext,
} from "@/features/applications/application-route-utils";
import {
  AdmissionShareProjectStatusError,
  assertCanCreateAdmissionShareForProject,
} from "@/features/applications/admission-share-policy";
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
  getInternalAdmissionShareBoardDetail: vi.fn(),
  listInternalAdmissionShareBoardTasks: vi.fn(),
  toAdmissionShareIdentityPresentation: vi.fn().mockReturnValue({
    brand: {
      logoText: "星河",
      brandName: "星河直播",
      brandTagline: "专业直播运营",
      primaryColor: "#165DFF",
    },
    contactCard: null,
  }),
  AdmissionShareSelectionError: class AdmissionShareSelectionError extends Error {
    readonly name = "AdmissionShareSelectionError";

    constructor(public readonly items: unknown[]) {
      super("Admission share selection changed");
    }
  },
  AdmissionShareFormalRoundConflictError: class AdmissionShareFormalRoundConflictError extends Error {
    readonly name = "AdmissionShareFormalRoundConflictError";

    constructor() {
      super("Admission share formal round already open");
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

vi.mock("@/features/applications/admission-share-policy", () => ({
  assertCanCreateAdmissionShareForProject: vi.fn(),
  AdmissionShareProjectStatusError: class AdmissionShareProjectStatusError extends Error {
    readonly code = "ADMISSION_SHARE_PROJECT_STATUS_BLOCKED";

    constructor(
      message: string,
      public readonly statusCode: 404 | 409,
    ) {
      super(message);
    }
  },
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
        : error instanceof Error
          ? 400
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

const internalPresentation = {
  id: "share-1",
  title: "Vendor review",
  purpose: "",
  mode: "formal_review" as const,
  status: "active" as const,
  reviewState: "not_started" as const,
  roundNumber: 1,
  expiresAt: "2026-06-14T00:00:00.000Z",
  project: {
    id: "project-1",
    code: "P-001",
    name: "Launch project",
    vendor: "Vendor",
    product: "Product",
  },
  brand: {
    logoText: "STAR",
    brandName: "Star Live",
    brandTagline: "Professional live operations",
    primaryColor: "#165DFF",
  },
  contactCard: {
    displayName: "Lin",
    title: "Account lead",
    phone: "13800000000",
  },
  progress: { completed: 1, total: 2 },
  latestSubmission: {
    revision: 2,
    submittedAt: "2026-07-30T09:00:00.000Z",
    summary: { selected: 1, backup: 0, rejected: 0, needsChanges: 1 },
  },
  items: [
    {
      applicationId: "app-1",
      recordingSubmissionId: "recording-v2",
      recordingVersion: 2,
      sourceHealth: "original_ready" as const,
      streamer: {
        id: "streamer-1",
        displayName: "Streamer One",
        accountLabel: "dy_1",
      },
      finalReview: null,
    },
    {
      applicationId: "app-2",
      recordingSubmissionId: "recording-v3",
      recordingVersion: 3,
      sourceHealth: "external_only" as const,
      streamer: {
        id: "streamer-2",
        displayName: "Streamer Two",
        accountLabel: "dy_2",
      },
      finalReview: {
        decision: "needs_changes" as const,
        remark: "Adjust the opening",
        reasonCodes: ["opening"],
        submittedAt: "2026-07-30T09:00:00.000Z",
      },
    },
  ],
  brandVersion: 4,
  contactCardId: "9d4ba455-c58a-4e31-a3e8-c42a760ea54c",
  sourceDiagnostics: [
    {
      recordingSubmissionId: "recording-v2",
      applicationStatus: "recording_reviewing" as const,
      recordingStatus: "submitted" as const,
      hasPrivateStorage: true,
      externalUrl: null,
    },
    {
      recordingSubmissionId: "recording-v3",
      applicationStatus: "recording_reviewing" as const,
      recordingStatus: "submitted" as const,
      hasPrivateStorage: false,
      externalUrl: "https://video.example/recording-v3",
    },
  ],
};

describe("project admission share-board route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      client: "admin",
    } as never);
    vi.mocked(listInternalAdmissionShareBoardTasks).mockResolvedValue({
      shareBoards: [
        {
          id: "share-1",
          title: "Vendor review",
          purpose: "",
          mode: "formal_review",
          status: "active",
          expiresAt: "2026-06-14T00:00:00.000Z",
          reviewState: "not_started",
          roundNumber: 1,
          itemCount: 10,
          draftCompletedCount: 4,
          lastViewedAt: "2026-07-30T08:00:00.000Z",
          lastDraftAt: "2026-07-30T08:20:00.000Z",
          lastSubmittedAt: null,
          lockedAt: null,
          createdBy: "user-ops",
          createdAt: "2026-07-30T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    vi.mocked(getInternalAdmissionShareBoardDetail).mockResolvedValue({
      id: "share-1",
      title: "Vendor review",
      purpose: "",
      mode: "formal_review",
      status: "active",
      expiresAt: "2026-06-14T00:00:00.000Z",
      reviewState: "not_started",
      roundNumber: 1,
      itemCount: 10,
      draftCompletedCount: 4,
      lastViewedAt: "2026-07-30T08:00:00.000Z",
      lastDraftAt: "2026-07-30T08:20:00.000Z",
      lastSubmittedAt: null,
      lockedAt: null,
      createdBy: "user-ops",
      createdAt: "2026-07-30T00:00:00.000Z",
      presentation: internalPresentation,
    });
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
        brandSnapshot: {
          schemaVersion: 1,
          version: 4,
          logoText: "星河",
          logoStoragePath: "org-1/brand-logos/private.webp",
          brandName: "星河直播",
          brandTagline: "专业直播运营",
          primaryColor: "#165DFF",
          publishedAt: "2026-07-29T00:00:00.000Z",
        },
        brandVersion: 4,
        contactCardId: null,
        contactCardSnapshot: null,
        createdBy: "user-ops",
        createdAt: "2026-07-30T00:00:00.000Z",
      },
      presentation: internalPresentation,
    });
  });

  it("lists whitelisted task summaries without presentations, items, or secrets", async () => {
    const response = await GET(new Request("http://localhost/api"), {
      params,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nextCursor).toBeNull();
    expect(body.shareBoards).toEqual([
      {
        id: "share-1",
        title: "Vendor review",
        purpose: "",
        mode: "formal_review",
        status: "active",
        reviewState: "not_started",
        roundNumber: 1,
        expiresAt: "2026-06-14T00:00:00.000Z",
        itemCount: 10,
        draftCompletedCount: 4,
        lastViewedAt: "2026-07-30T08:00:00.000Z",
        lastDraftAt: "2026-07-30T08:20:00.000Z",
        lastSubmittedAt: null,
        lockedAt: null,
        createdBy: "user-ops",
        createdAt: "2026-07-30T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("presentation");
    expect(JSON.stringify(body)).not.toContain('"items"');
    expect(JSON.stringify(body)).not.toContain("hash");
    expect(JSON.stringify(body)).not.toContain("organizationId");
    expect(JSON.stringify(body)).not.toContain("projectId");
    expect(JSON.stringify(body)).not.toContain("allowVendorSubmit");
    expect(JSON.stringify(body)).not.toContain("allowExternalFallback");
    expect(JSON.stringify(body)).not.toContain("storage");
    expect(JSON.stringify(body)).not.toContain("storagePath");
    expect(JSON.stringify(body)).not.toContain("logoStoragePath");
    expect(JSON.stringify(body)).not.toContain("tokenHash");
    expect(JSON.stringify(body)).not.toContain("reviewer");
  });

  it("loads one explicitly requested board detail without private DTO fields", async () => {
    const boardId = "00000000-0000-4000-8000-000000000001";
    const response = await GET(
      new Request(`http://localhost/api?boardId=${boardId}`),
      { params },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.shareBoard.presentation).toEqual(internalPresentation);
    expect(getInternalAdmissionShareBoardDetail).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      actor: auth,
      projectId: "project-1",
      shareBoardId: boardId,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(
      /tokenHash|accessCodeHash|storagePath|logoStoragePath/u,
    );
    expect(listInternalAdmissionShareBoardTasks).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-project or missing", 404],
    ["unauthorized", 403],
  ])(
    "returns %s detail errors without falling back to the list",
    async (_case, status) => {
      vi.mocked(getInternalAdmissionShareBoardDetail).mockRejectedValueOnce(
        Object.assign(new Error("detail unavailable"), { statusCode: status }),
      );

      const response = await GET(
        new Request(
          "http://localhost/api?boardId=00000000-0000-4000-8000-000000000001",
        ),
        { params },
      );

      expect(response.status).toBe(status);
      expect(listInternalAdmissionShareBoardTasks).not.toHaveBeenCalled();
    },
  );

  it("passes a bounded keyset cursor to the internal first-screen listing", async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: "2026-07-30T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000001",
      }),
    ).toString("base64url");
    vi.mocked(listInternalAdmissionShareBoardTasks).mockResolvedValue({
      shareBoards: [],
      nextCursor: "next-page",
    });

    const response = await GET(
      new Request(`http://localhost/api?limit=2&cursor=${cursor}`),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      shareBoards: [],
      nextCursor: "next-page",
    });
    expect(listInternalAdmissionShareBoardTasks).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      actor: auth,
      projectId: "project-1",
      cursor,
      limit: 2,
    });
  });

  it("rejects an explicitly empty cursor instead of treating it as missing", async () => {
    const response = await GET(new Request("http://localhost/api?cursor="), {
      params,
    });

    expect(response.status).toBe(400);
    expect(listInternalAdmissionShareBoardTasks).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range internal share page size", async () => {
    const response = await GET(new Request("http://localhost/api?limit=51"), {
      params,
    });

    expect(response.status).toBe(400);
    expect(listInternalAdmissionShareBoardTasks).not.toHaveBeenCalled();
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
            contactCardId: "9d4ba455-c58a-4e31-a3e8-c42a760ea54c",
            brandSnapshot: {
              logoStoragePath: "other-org/brand-logos/forged.webp",
            },
            contactCardSnapshot: { displayName: "伪造联系人" },
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
    expect(body.shareBoard).toMatchObject({
      brandVersion: 4,
      contactCardId: null,
      brand: {
        logoText: "星河",
        brandName: "星河直播",
        brandTagline: "专业直播运营",
        primaryColor: "#165DFF",
      },
      contactCard: null,
      presentation: internalPresentation,
    });
    expect(JSON.stringify(body)).not.toContain("hash");
    expect(JSON.stringify(body)).not.toContain("private.webp");
    expect(JSON.stringify(body)).not.toContain("brandSnapshot");
    expect(JSON.stringify(body)).not.toContain("contactCardSnapshot");
    expect(SupabaseAdmissionShareBoardRepository).toHaveBeenCalledWith(
      context.supabase,
    );
    expect(assertCanCreateAdmissionShareForProject).toHaveBeenCalledWith(
      context.supabase,
      {
        organizationId: "org-1",
        projectId: "project-1",
      },
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
          contactCardId: "9d4ba455-c58a-4e31-a3e8-c42a760ea54c",
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
    const serviceInput = vi.mocked(createAdmissionShareBoard).mock.calls[0]?.[0]
      ?.input;
    expect(serviceInput).not.toHaveProperty("brandSnapshot");
    expect(serviceInput).not.toHaveProperty("contactCardSnapshot");
    expect(JSON.stringify(serviceInput)).not.toContain(
      "other-org/brand-logos/forged.webp",
    );
  });

  it("accepts an explicit null contact-card selection", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/projects/project-1/admission-share-boards",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "preview",
            contactCardId: null,
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
    expect(createAdmissionShareBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ contactCardId: null }),
      }),
    );
  });

  it("rejects a non-UUID contact-card id before share persistence", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/projects/project-1/admission-share-boards",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "preview",
            contactCardId: "not-a-uuid",
            brandSnapshot: { logoStoragePath: "private/forged.webp" },
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "contactCardId must be a UUID or null",
    });
    expect(createAdmissionShareBoard).not.toHaveBeenCalled();
  });

  it("uses the reverse-proxy public origin instead of an internal configured port", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://public.example:3000";
    try {
      const response = await POST(
        new Request(
          "http://127.0.0.1:3000/api/projects/project-1/admission-share-boards",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-host": "public.example",
              "x-forwarded-proto": "http",
            },
            body: JSON.stringify({
              mode: "preview",
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
      await expect(response.json()).resolves.toMatchObject({
        shareUrl: "http://public.example/share/admission/plain-token",
      });
    } finally {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  });

  it("returns itemized RPC-race selection conflicts as 409", async () => {
    vi.mocked(createAdmissionShareBoard).mockRejectedValue(
      new AdmissionShareSelectionError([
        {
          applicationId: "app-1",
          recordingSubmissionId: "recording-v2",
          recordingVersion: 2,
          sortOrder: 0,
          status: "blocked",
          sourceHealth: "blocked",
          reasonCode: "SOURCE_UNAVAILABLE",
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
          reasonCode: "SOURCE_UNAVAILABLE",
        }),
      ],
    });
  });

  it("returns a stable 409 for an open formal-round conflict", async () => {
    vi.mocked(createAdmissionShareBoard).mockRejectedValue(
      new AdmissionShareFormalRoundConflictError(),
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
      code: "SHARE_FORMAL_ROUND_CONFLICT",
      error: "当前已有进行中的正式复核，请先完成、撤销或等待过期。",
    });
  });

  it("returns 400 when service rejects a share shorter than one day", async () => {
    vi.mocked(createAdmissionShareBoard).mockRejectedValue(
      new Error("Share expiry must be at least 1 day"),
    );

    const response = await POST(
      new Request(
        "http://localhost/api/projects/project-1/admission-share-boards",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "preview",
            expiresAt: "2026-07-30T12:00:00.000Z",
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Share expiry must be at least 1 day",
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
    expect(assertCanCreateAdmissionShareForProject).not.toHaveBeenCalled();
    expect(createAdmissionShareBoard).not.toHaveBeenCalled();
  });

  it("blocks create before candidate access after the project lifecycle closes", async () => {
    vi.mocked(assertCanCreateAdmissionShareForProject).mockRejectedValueOnce(
      new AdmissionShareProjectStatusError(
        "Project status does not allow new shares",
        409,
      ),
    );

    const response = await POST(
      new Request(
        "http://localhost/api/projects/project-1/admission-share-boards",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "preview",
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
    await expect(response.json()).resolves.toMatchObject({
      code: "ADMISSION_SHARE_PROJECT_STATUS_BLOCKED",
    });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(createAdmissionShareBoard).not.toHaveBeenCalled();
  });

  it("returns the stable lifecycle conflict when the database guard wins a create race", async () => {
    vi.mocked(createAdmissionShareBoard).mockRejectedValueOnce(
      new AdmissionShareProjectStatusError(
        "Project status changed before share creation",
        409,
      ),
    );

    const response = await POST(
      new Request(
        "http://localhost/api/projects/project-1/admission-share-boards",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "preview",
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
      code: "ADMISSION_SHARE_PROJECT_STATUS_BLOCKED",
      error: "Project status changed before share creation",
    });
    expect(assertCanCreateAdmissionShareForProject).toHaveBeenCalled();
    expect(createAdmissionShareBoard).toHaveBeenCalled();
  });
});
