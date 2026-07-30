import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authenticateAdmissionShareAccess,
  loadAdmissionShareBoard,
  loadAdmissionShareDrafts,
  PublicAdmissionShareApiError,
  reportAdmissionSharePlaybackIssue,
  saveAdmissionShareDraft,
  submitAdmissionShareReview,
} from "./admission-share-api";

const boardResponse = {
  shareBoard: {
    id: "share-1",
    mode: "formal_review",
    items: [],
  },
  vendorCheckpoints: [],
};

describe("admission share public API", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads the board and drafts through relative same-origin JSON routes", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson(boardResponse))
      .mockResolvedValueOnce(
        okJson({
          drafts: [
            {
              recordingSubmissionId: "recording-1",
              recordingVersion: 2,
              decision: "backup",
              remark: "",
              reasonCodes: [],
              revision: 3,
              updatedAt: "2026-07-30T08:30:00.000Z",
            },
          ],
        }),
      );

    await expect(loadAdmissionShareBoard("public token")).resolves.toEqual(
      boardResponse,
    );
    await expect(
      loadAdmissionShareDrafts("public token"),
    ).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/public/admission-share/public%20token",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/public/admission-share/public%20token/drafts",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("accessCode=");
  });

  it("removes unsafe external URLs from an otherwise trusted board response", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        ...boardResponse,
        shareBoard: {
          ...boardResponse.shareBoard,
          items: [
            { externalUrl: "javascript:alert(1)" },
            { externalUrl: "data:text/html,unsafe" },
            { externalUrl: "/relative/video.mp4" },
            { externalUrl: "https://video.example/safe.mp4" },
          ],
        },
      }),
    );

    const response = await loadAdmissionShareBoard("public-token");

    expect(response.shareBoard.items.map((item) => item.externalUrl)).toEqual([
      null,
      null,
      null,
      "https://video.example/safe.mp4",
    ]);
  });

  it("saves a CAS draft with only the public draft fields", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        recordingSubmissionId: "recording-1",
        recordingVersion: 2,
        decision: "needs_changes",
        remark: "请补充卖点",
        reasonCodes: ["product_fit"],
        revision: 4,
        updatedAt: "2026-07-30T08:31:00.000Z",
      }),
    );

    await expect(
      saveAdmissionShareDraft("public-token", "recording/1", {
        expectedRevision: 3,
        decision: "needs_changes",
        remark: "请补充卖点",
        reasonCodes: ["product_fit"],
      }),
    ).resolves.toEqual({
      decision: "needs_changes",
      remark: "请补充卖点",
      reasonCodes: ["product_fit"],
      revision: 4,
      updatedAt: "2026-07-30T08:31:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/admission-share/public-token/drafts/recording%2F1",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        body: JSON.stringify({
          expectedRevision: 3,
          decision: "needs_changes",
          remark: "请补充卖点",
          reasonCodes: ["product_fit"],
        }),
      }),
    );
  });

  it("submits only projectRemark and reports sanitized playback details", async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({
          submissionRevision: 2,
          submittedCount: 2,
          syncedCount: 2,
          skippedCount: 0,
        }),
      )
      .mockResolvedValueOnce(okJson({ issueId: "issue-1" }, 201));

    await submitAdmissionShareReview("public-token", {
      projectRemark: "首轮复核完成",
    });
    await reportAdmissionSharePlaybackIssue("public-token", "recording-1", {
      sourceType: "original",
      errorCode: "MEDIA_LOAD_FAILED",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/public/admission-share/public-token/reviews",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ projectRemark: "首轮复核完成" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/public/admission-share/public-token/recordings/recording-1/issues",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          sourceType: "original",
          errorCode: "MEDIA_LOAD_FAILED",
        }),
      }),
    );
  });

  it("exchanges access codes in a JSON body without adding query secrets", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ authenticated: true }));

    await authenticateAdmissionShareAccess("public-token", " 246810 ");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/admission-share/public-token/access",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ accessCode: "246810" }),
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("accessCode=");
  });

  it("maps every non-OK response to the shared typed error", async () => {
    fetchMock.mockResolvedValueOnce(
      errorJson(
        {
          code: "DRAFT_CONFLICT",
          error: "其他复核人刚刚更新了结果，请刷新后查看最新内容。",
          retryAfterSeconds: 8,
        },
        409,
      ),
    );

    const error = await loadAdmissionShareDrafts("public-token").catch(
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(PublicAdmissionShareApiError);
    expect(error).toMatchObject({
      code: "DRAFT_CONFLICT",
      status: 409,
      retryAfterSeconds: 8,
    });
  });
});

function okJson(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: async () => body,
  } as Response;
}

function errorJson(body: unknown, status: number) {
  return {
    ok: false,
    status,
    json: async () => body,
  } as Response;
}
