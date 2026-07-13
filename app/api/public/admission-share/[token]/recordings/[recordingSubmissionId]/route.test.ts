import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  getPublicAdmissionRecordingPlaybackSource,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/applications/admission-share-board", () => ({
  SupabaseAdmissionShareBoardRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "share-repo" };
    }),
  getPublicAdmissionRecordingPlaybackSource: vi.fn(),
}));

vi.mock("@/features/storage/private-upload", () => ({
  createSignedDownloadUrl: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getPrivateStorageBucket: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const params = Promise.resolve({
  token: "plain-token",
  recordingSubmissionId: "rec-2",
});
const supabase = { client: "supabase", storage: {} };

describe("public admission recording playback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(getPrivateStorageBucket).mockReturnValue("jy-private");
    vi.mocked(createSignedDownloadUrl).mockResolvedValue({
      signedUrl: "https://download.example/private-rec-2.mp4",
    } as never);
  });

  it("redirects private uploaded recordings to a signed playback URL after share gating", async () => {
    vi.mocked(getPublicAdmissionRecordingPlaybackSource).mockResolvedValue({
      recordingUrl: null,
      storagePath: "private/path/rec-2.mp4",
    });

    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/recordings/rec-2?accessCode=2468",
      ),
      { params },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://download.example/private-rec-2.mp4",
    );
    expect(SupabaseAdmissionShareBoardRepository).toHaveBeenCalledWith(
      supabase,
    );
    expect(getPublicAdmissionRecordingPlaybackSource).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      token: "plain-token",
      accessCode: "2468",
      recordingSubmissionId: "rec-2",
    });
    expect(createSignedDownloadUrl).toHaveBeenCalledWith({
      client: supabase,
      bucket: "jy-private",
      path: "private/path/rec-2.mp4",
      expiresInSeconds: 3600,
    });
  });

  it("redirects public external recordings without signing storage", async () => {
    vi.mocked(getPublicAdmissionRecordingPlaybackSource).mockResolvedValue({
      recordingUrl: "https://video.example/rec-1.mp4",
      storagePath: null,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/recordings/rec-1",
      ),
      {
        params: Promise.resolve({
          token: "plain-token",
          recordingSubmissionId: "rec-1",
        }),
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://video.example/rec-1.mp4",
    );
    expect(createSignedDownloadUrl).not.toHaveBeenCalled();
  });
});
