import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  submitVendorAdmissionReviews,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

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

const params = Promise.resolve({ token: "plain-token" });
const supabase = { client: "supabase" };

describe("public admission share review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(submitVendorAdmissionReviews).mockResolvedValue({
      submittedCount: 2,
      syncedCount: 1,
      skippedCount: 1,
    });
  });

  it("submits vendor reviews through the server-side token lookup", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/reviews?accessCode=2468",
        {
          method: "POST",
          body: JSON.stringify({
            reviewerName: "Vendor Reviewer",
            reviewerContact: "reviewer@example.com",
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
      submittedCount: 2,
      syncedCount: 1,
      skippedCount: 1,
    });
    expect(SupabaseAdmissionShareBoardRepository).toHaveBeenCalledWith(
      supabase,
    );
    expect(submitVendorAdmissionReviews).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      token: "plain-token",
      accessCode: "2468",
      recordEvaluation: expect.any(Function),
      input: expect.objectContaining({
        reviewerName: "Vendor Reviewer",
        reviewerContact: "reviewer@example.com",
        items: [
          expect.objectContaining({
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            decision: "selected",
          }),
          expect.objectContaining({
            recordingSubmissionId: "rec-2",
            recordingVersion: 1,
            decision: "backup",
          }),
        ],
      }),
    });
  });

  it("rejects stale recording versions from the service", async () => {
    vi.mocked(submitVendorAdmissionReviews).mockRejectedValue(
      new Error("Recording version is stale"),
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
      error: "Recording version is stale",
    });
  });
});
