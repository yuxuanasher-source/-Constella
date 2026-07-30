import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  getPublicAdmissionShareBoard,
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
  getPublicAdmissionShareBoard: vi.fn(),
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

describe("public admission share route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(
      "opaque-session-token",
    );
    vi.mocked(getPublicAdmissionShareBoard).mockResolvedValue({
      id: "share-1",
      title: "Vendor review",
      status: "active",
      expiresAt: "2026-06-14T00:00:00.000Z",
      allowVendorSubmit: true,
      project: { id: "project-1", code: "P-001", name: "Alpha" },
      items: [
        {
          applicationId: "app-1",
          recordingSubmissionId: "rec-1",
          recordingVersion: 2,
          recordingUrl: "https://video.example/rec-1",
          hasPrivateStorage: false,
          streamer: { id: "streamer-1", displayName: "Streamer One" },
          vendorReview: {
            decision: "backup",
            remark: "Can be backup.",
            reviewerName: "Vendor Reviewer",
            reviewerContact: "reviewer@example.com",
            submittedAt: "2026-06-07T00:00:00.000Z",
          },
        },
      ],
    } as never);
  });

  it("returns the public share snapshot without requiring auth", async () => {
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
    expect(getPublicAdmissionShareBoard).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      accessStore: { store: "access-store" },
      token: "plain-token",
      sessionToken: "opaque-session-token",
    });
    expect(JSON.stringify(body)).not.toContain("tokenHash");
    expect(JSON.stringify(body)).not.toContain("storagePath");
    expect(JSON.stringify(body)).not.toContain("reviewerName");
    expect(JSON.stringify(body)).not.toContain("reviewerContact");
  });

  it("maps expired shares to a service error response", async () => {
    vi.mocked(getPublicAdmissionShareBoard).mockRejectedValue(
      new Error("Share link is expired or revoked"),
    );

    const response = await GET(new Request("http://localhost/api"), {
      params,
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      code: "SHARE_EXPIRED",
      error: "分享链接已过期或已撤销。",
    });
  });

  it("does not pass an access code from the URL to the service", async () => {
    await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token?accessCode=must-not-leak",
      ),
      { params },
    );

    expect(getPublicAdmissionShareBoard).toHaveBeenCalledWith(
      expect.not.objectContaining({ accessCode: expect.anything() }),
    );
  });
});
