import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  getPublicAdmissionShareBoard,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

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

const params = Promise.resolve({ token: "plain-token" });
const rpc = vi.fn();
const supabase = { client: "supabase", rpc };

describe("public admission share route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({
      data: [{ allowed: true, retry_after_seconds: 0, remaining: 59 }],
      error: null,
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
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
          vendorReview: null,
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
    expect(getPublicAdmissionShareBoard).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      token: "plain-token",
      accessCode: "2468",
    });
    expect(JSON.stringify(body)).not.toContain("tokenHash");
    expect(JSON.stringify(body)).not.toContain("storagePath");
  });

  it("maps expired shares to a service error response", async () => {
    vi.mocked(getPublicAdmissionShareBoard).mockRejectedValue(
      new Error("Share link is expired or revoked"),
    );

    const response = await GET(new Request("http://localhost/api"), {
      params,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Share link is expired or revoked",
    });
  });

  it("enforces the 60-per-minute token and IP limits before loading the board", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [{ allowed: true, retry_after_seconds: 0, remaining: 0 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ allowed: false, retry_after_seconds: 42, remaining: 0 }],
        error: null,
      });

    const response = await GET(
      new Request("http://localhost/api/public/admission-share/plain-token", {
        headers: { "x-forwarded-for": "203.0.113.10" },
      }),
      { params },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      "consume_admission_share_rate_limit",
      expect.objectContaining({ p_limit: 60, p_window_seconds: 60 }),
    );
    expect(getPublicAdmissionShareBoard).not.toHaveBeenCalled();
  });
});
