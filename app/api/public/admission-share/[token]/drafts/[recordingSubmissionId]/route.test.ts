import { beforeEach, describe, expect, it, vi } from "vitest";

import { PUT } from "./route";

import {
  PublicAdmissionShareError,
  savePublicAdmissionReviewDraft,
} from "@/features/applications/admission-share-board";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";

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
      savePublicAdmissionReviewDraft: vi.fn(),
    };
  },
);

vi.mock("@/features/applications/admission-share-access-store", () => ({
  SupabaseAdmissionShareAccessStore: vi.fn().mockImplementation(function () {
    return { store: "access-store" };
  }),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/http/admission-share-access-session", () => ({
  readAdmissionShareAccessSession: vi.fn(),
}));

const params = Promise.resolve({
  token: "plain-token",
  recordingSubmissionId: "rec-1",
});
const supabase = { client: "service-role" };

describe("public admission share draft save route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(
      "opaque-session-token",
    );
    vi.mocked(savePublicAdmissionReviewDraft).mockResolvedValue({
      recordingSubmissionId: "rec-1",
      recordingVersion: 2,
      decision: "needs_changes",
      remark: "开场需要更快进入卖点",
      reasonCodes: ["script_fit"],
      revision: 3,
      updatedAt: "2026-07-30T08:30:00.000Z",
      organizationId: "must-not-leak",
      shareBoardId: "must-not-leak",
    } as never);
  });

  it("saves only the whitelisted body through the server-side repository", async () => {
    const response = await PUT(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/drafts/rec-1?accessCode=must-not-be-read",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 2,
            decision: "needs_changes",
            remark: "开场需要更快进入卖点",
            reasonCodes: ["script_fit"],
            shareBoardId: "other-board",
            organizationId: "other-org",
          }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recordingSubmissionId: "rec-1",
      recordingVersion: 2,
      decision: "needs_changes",
      remark: "开场需要更快进入卖点",
      reasonCodes: ["script_fit"],
      revision: 3,
      updatedAt: "2026-07-30T08:30:00.000Z",
    });
    expect(savePublicAdmissionReviewDraft).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      accessStore: { store: "access-store" },
      token: "plain-token",
      sessionToken: "opaque-session-token",
      recordingSubmissionId: "rec-1",
      input: {
        expectedRevision: 2,
        decision: "needs_changes",
        remark: "开场需要更快进入卖点",
        reasonCodes: ["script_fit"],
      },
    });
  });

  it("fails closed when the service-role client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await PUT(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/drafts/rec-1",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 0,
            decision: "pending",
            remark: "",
            reasonCodes: [],
          }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SHARE_SERVICE_UNAVAILABLE",
    });
    expect(savePublicAdmissionReviewDraft).not.toHaveBeenCalled();
  });

  it("rejects a passwordless formal draft save when the HttpOnly session cookie is missing", async () => {
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(null);
    vi.mocked(savePublicAdmissionReviewDraft).mockRejectedValue(
      new PublicAdmissionShareError(
        "ACCESS_CODE_REQUIRED",
        "A valid access session is required",
        401,
      ),
    );

    const response = await PUT(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/drafts/rec-1?accessCode=must-not-be-read",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: 0,
            decision: "pending",
            remark: "",
            reasonCodes: [],
          }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(401);
    expect(savePublicAdmissionReviewDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "plain-token",
        sessionToken: undefined,
        recordingSubmissionId: "rec-1",
      }),
    );
    expect(savePublicAdmissionReviewDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ accessCode: expect.anything() }),
    );
  });
});
