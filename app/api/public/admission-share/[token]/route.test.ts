import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  getPublicAdmissionShareBoardContextWithSession,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import {
  readAdmissionShareAccessSession,
  setAdmissionShareAccessSession,
} from "@/lib/http/admission-share-access-session";

const { listReviewDrafts } = vi.hoisted(() => ({
  listReviewDrafts: vi.fn(),
}));

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
          return { repo: "share-repo", listReviewDrafts };
        }),
      getPublicAdmissionShareBoardContextWithSession: vi.fn(),
    };
  },
);

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/features/applications/admission-share-access-store", () => ({
  SupabaseAdmissionShareAccessStore: vi.fn().mockImplementation(function () {
    return { store: "access-store" };
  }),
}));

vi.mock("@/lib/http/admission-share-access-session", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/http/admission-share-access-session")
    >();
  return {
    ...actual,
    readAdmissionShareAccessSession: vi.fn(),
  };
});

const params = Promise.resolve({ token: "plain-token" });
const supabase = { client: "supabase" };
let publicContext: Awaited<
  ReturnType<typeof getPublicAdmissionShareBoardContextWithSession>
>;

describe("public admission share route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listReviewDrafts.mockResolvedValue([
      {
        recordingSubmissionId: "rec-1",
        recordingVersion: 2,
        decision: "backup",
        remark: "Can be backup.",
        reasonCodes: [],
        revision: 1,
        updatedAt: "2026-06-07T00:00:00.000Z",
      },
    ]);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(
      "opaque-session-token",
    );
    publicContext = {
      organizationId: "org-1",
      allowVendorSubmit: true,
      session: {
        sessionToken: "opaque-session-token",
        created: false,
      },
      board: {
        id: "share-1",
        title: "Vendor review",
        purpose: "品牌方首轮选人",
        mode: "formal_review",
        status: "active",
        reviewState: "submitted_locked",
        roundNumber: 1,
        expiresAt: "2026-06-14T00:00:00.000Z",
        canSubmit: false,
        allowExternalFallback: true,
        project: {
          id: "project-1",
          code: "P-001",
          name: "Alpha",
          vendor: "Vendor",
          product: "Game",
        },
        progress: { completed: 1, total: 1 },
        latestSubmission: {
          revision: 1,
          submittedAt: "2026-06-07T00:00:00.000Z",
          summary: {
            selected: 0,
            backup: 1,
            rejected: 0,
            needsChanges: 0,
          },
        },
        items: [
          {
            applicationId: "app-1",
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            playbackUrl:
              "/api/public/admission-share/plain-token/recordings/rec-1",
            externalUrl: "https://video.example/rec-1",
            sourceHealth: "external_only",
            hasPrivateStorage: false,
            streamer: {
              id: "streamer-1",
              displayName: "Streamer One",
              accountLabel: "",
            },
            finalReview: {
              decision: "backup",
              remark: "Can be backup.",
              reasonCodes: [],
              submittedAt: "2026-06-07T00:00:00.000Z",
            },
          },
        ],
      },
    };
    vi.mocked(getPublicAdmissionShareBoardContextWithSession).mockResolvedValue(
      publicContext,
    );
  });

  it("returns the public share snapshot through one combined hydrate without requiring auth", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token?accessCode=2468",
      ),
      { params },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.shareBoard).toEqual(
      expect.objectContaining({
        id: "share-1",
        project: expect.objectContaining({ id: "project-1" }),
      }),
    );
    expect(SupabaseAdmissionShareBoardRepository).toHaveBeenCalledWith(
      supabase,
    );
    expect(SupabaseAdmissionShareAccessStore).toHaveBeenCalledWith(supabase);
    expect(
      getPublicAdmissionShareBoardContextWithSession,
    ).toHaveBeenCalledTimes(1);
    expect(getPublicAdmissionShareBoardContextWithSession).toHaveBeenCalledWith(
      {
        repo: expect.objectContaining({ repo: "share-repo" }),
        accessStore: { store: "access-store" },
        token: "plain-token",
        sessionToken: "opaque-session-token",
      },
    );
    expect(body.shareBoard).toEqual(
      expect.objectContaining({
        mode: "formal_review",
        canSubmit: false,
        progress: { completed: 1, total: 1 },
      }),
    );
    for (const forbidden of [
      "organizationId",
      "tokenHash",
      "storagePath",
      "applicationStatus",
      "recordingStatus",
      "reviewerName",
      "reviewerContact",
    ]) {
      expect(JSON.stringify(body)).not.toContain(forbidden);
    }
  });

  it("maps expired shares to a service error response", async () => {
    vi.mocked(getPublicAdmissionShareBoardContextWithSession).mockRejectedValue(
      new Error("Share link is expired"),
    );

    const response = await GET(new Request("http://localhost/api"), {
      params,
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      code: "SHARE_EXPIRED",
      error: "分享链接已过期。",
    });
  });

  it("does not pass an access code from the URL to the service", async () => {
    await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token?accessCode=must-not-leak",
      ),
      { params },
    );

    expect(getPublicAdmissionShareBoardContextWithSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ accessCode: expect.anything() }),
    );
  });

  it("creates an HttpOnly session for a passwordless formal review without exposing it in JSON", async () => {
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(null);
    vi.mocked(
      getPublicAdmissionShareBoardContextWithSession,
    ).mockResolvedValueOnce({
      ...publicContext,
      session: {
        sessionToken: "new-opaque-session",
        expiresAt: "2026-06-14T00:00:00.000Z",
        created: true,
      },
    });

    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token?accessCode=must-not-be-read",
      ),
      { params },
    );
    const body = await response.json();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(getPublicAdmissionShareBoardContextWithSession).toHaveBeenCalledWith(
      {
        repo: expect.objectContaining({ repo: "share-repo" }),
        accessStore: { store: "access-store" },
        token: "plain-token",
        sessionToken: undefined,
      },
    );
    expect(cookie).toContain("new-opaque-session");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(JSON.stringify(body)).not.toContain("new-opaque-session");
    expect(setAdmissionShareAccessSession).toBeTypeOf("function");
  });

  it("does not create a session for a passwordless preview", async () => {
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(null);
    vi.mocked(
      getPublicAdmissionShareBoardContextWithSession,
    ).mockResolvedValueOnce({
      ...publicContext,
      session: null,
    });

    const response = await GET(
      new Request("http://localhost/api/public/admission-share/plain-token"),
      { params },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(getPublicAdmissionShareBoardContextWithSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: undefined }),
    );
  });

  it("includes formal review drafts in the combined hydrate response", async () => {
    const response = await GET(
      new Request("http://localhost/api/public/admission-share/plain-token"),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        reviewDrafts: [
          expect.objectContaining({
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            decision: "backup",
            revision: 1,
          }),
        ],
      }),
    );
    expect(listReviewDrafts).toHaveBeenCalledOnce();
    expect(listReviewDrafts).toHaveBeenCalledWith("share-1");
  });

  it("does not include review drafts when vendor submissions are disabled", async () => {
    vi.mocked(
      getPublicAdmissionShareBoardContextWithSession,
    ).mockResolvedValueOnce({
      ...publicContext,
      allowVendorSubmit: false,
    } as never);

    const response = await GET(
      new Request("http://localhost/api/public/admission-share/plain-token"),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ reviewDrafts: [] }),
    );
    expect(listReviewDrafts).not.toHaveBeenCalled();
  });
});
