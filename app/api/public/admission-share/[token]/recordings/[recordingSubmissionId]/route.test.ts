import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  getPublicAdmissionRecordingPlaybackSource,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import { getPrivateStorageBucket } from "@/lib/config/env";
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
      getPublicAdmissionRecordingPlaybackSource: vi.fn(),
    };
  },
);

vi.mock("@/features/storage/private-upload", () => ({
  createSignedDownloadUrl: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getPrivateStorageBucket: vi.fn(),
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

const params = Promise.resolve({
  token: "plain-token",
  recordingSubmissionId: "rec-2",
});
const supabase = { client: "supabase", storage: {} };

describe("public admission recording playback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(
      "opaque-session-token",
    );
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
    expect(SupabaseAdmissionShareAccessStore).toHaveBeenCalledWith(supabase);
    expect(getPublicAdmissionRecordingPlaybackSource).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      accessStore: { store: "access-store" },
      token: "plain-token",
      sessionToken: "opaque-session-token",
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

  it("returns the dedicated stable error when a shared recording has no playback source", async () => {
    vi.mocked(getPublicAdmissionRecordingPlaybackSource).mockResolvedValue({
      recordingUrl: null,
      storagePath: null,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/recordings/rec-2",
      ),
      { params },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "RECORDING_SOURCE_UNAVAILABLE",
      error: "录屏来源暂时不可用，请重试或打开备用视频。",
    });
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe"])(
    "refuses to redirect an unsafe external recording URL: %s",
    async (recordingUrl) => {
      vi.mocked(getPublicAdmissionRecordingPlaybackSource).mockResolvedValue({
        recordingUrl,
        storagePath: null,
      });

      const response = await GET(
        new Request(
          "http://localhost/api/public/admission-share/plain-token/recordings/rec-2",
        ),
        { params },
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      await expect(response.json()).resolves.toMatchObject({
        code: "RECORDING_SOURCE_UNAVAILABLE",
      });
    },
  );

  it("refuses to redirect an unsafe signed storage URL", async () => {
    vi.mocked(getPublicAdmissionRecordingPlaybackSource).mockResolvedValue({
      recordingUrl: null,
      storagePath: "private/path/rec-2.mp4",
    });
    vi.mocked(createSignedDownloadUrl).mockResolvedValue({
      signedUrl: "data:text/html,unsafe",
    } as never);

    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/recordings/rec-2",
      ),
      { params },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
