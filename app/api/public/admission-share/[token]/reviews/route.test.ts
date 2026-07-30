import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  submitVendorAdmissionReviews,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";

vi.mock("@/features/applications/admission-share-board", () => ({
  SupabaseAdmissionShareBoardRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "share-repo" };
    }),
  submitVendorAdmissionReviews: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/features/applications/admission-share-access-store", () => ({
  SupabaseAdmissionShareAccessStore: vi.fn().mockImplementation(function () {
    return { store: "access-store" };
  }),
}));

vi.mock("@/lib/http/admission-share-access-session", () => ({
  readAdmissionShareAccessSession: vi.fn(),
}));

const params = Promise.resolve({ token: "plain-token" });
const supabase = { client: "supabase" };

describe("public admission share review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(
      "opaque-session-token",
    );
    vi.mocked(submitVendorAdmissionReviews).mockResolvedValue({
      submissionRevision: 1,
      submittedCount: 2,
      syncedCount: 1,
      skippedCount: 1,
      items: [
        {
          vendorReviewId: "vendor-review-1",
          applicationId: "application-1",
          recordingSubmissionId: "recording-1",
          recordingVersion: 2,
          decision: "rejected",
          remark: "内部评价备注",
          reasonCodes: ["script_fit"],
          syncStatus: "synced",
          syncError: null,
        },
      ],
    });
  });

  it("submits only the project remark through the server-side token lookup", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/reviews?accessCode=2468",
        {
          method: "POST",
          body: JSON.stringify({
            reviewerName: "Vendor Reviewer",
            reviewerContact: "reviewer@example.com",
            projectRemark: " 首轮复核完成 ",
            items: [
              {
                recordingSubmissionId: "rec-1",
                recordingVersion: 2,
                decision: "selected",
                remark: "Good fit.",
              },
              {
                recordingSubmissionId: "rec-2",
                recordingVersion: 1,
                decision: "backup",
              },
            ],
          }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      submissionRevision: 1,
      submittedCount: 2,
      syncedCount: 1,
      skippedCount: 1,
    });
    expect(SupabaseAdmissionShareBoardRepository).toHaveBeenCalledWith(
      supabase,
    );
    expect(SupabaseAdmissionShareAccessStore).toHaveBeenCalledWith(supabase);
    expect(submitVendorAdmissionReviews).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      accessStore: { store: "access-store" },
      token: "plain-token",
      sessionToken: "opaque-session-token",
      recordEvaluation: expect.any(Function),
      input: { projectRemark: "首轮复核完成" },
    });
  });

  it("returns stable incomplete-review errors from the atomic service", async () => {
    vi.mocked(submitVendorAdmissionReviews).mockRejectedValue(
      Object.assign(new Error("Review is incomplete"), {
        code: "REVIEW_INCOMPLETE",
        statusCode: 400,
      }),
    );

    const response = await POST(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/reviews",
        {
          method: "POST",
          body: JSON.stringify({
            items: [
              {
                recordingSubmissionId: "rec-1",
                recordingVersion: 1,
                decision: "selected",
              },
            ],
          }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "REVIEW_INCOMPLETE",
      error: "复核尚未完成，请补全所有录屏结论和必填备注。",
    });
  });
});
