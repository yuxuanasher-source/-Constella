import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  recordPublicAdmissionPlaybackIssue,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
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
      recordPublicAdmissionPlaybackIssue: vi.fn(),
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

const issueUrl =
  "https://app.example/api/public/admission-share/plain-token/recordings/recording-1/issues";
const routeParams = {
  params: Promise.resolve({
    token: "plain-token",
    recordingSubmissionId: "recording-1",
  }),
};
const supabase = { client: "service-role" };

describe("public admission recording issue route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(
      "opaque-session-token",
    );
    vi.mocked(recordPublicAdmissionPlaybackIssue).mockResolvedValue({
      issueId: "issue-1",
    });
  });

  it("records a sanitized issue for one shared recording", async () => {
    const response = await POST(
      new Request(issueUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 secret-tail",
          "X-Forwarded-For": "203.0.113.42",
        },
        body: JSON.stringify({
          sourceType: "original",
          errorCode: "MEDIA_DECODE_FAILED",
        }),
      }),
      routeParams,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ issueId: "issue-1" });
    expect(SupabaseAdmissionShareBoardRepository).toHaveBeenCalledWith(
      supabase,
    );
    expect(SupabaseAdmissionShareAccessStore).toHaveBeenCalledWith(supabase);
    expect(recordPublicAdmissionPlaybackIssue).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      accessStore: { store: "access-store" },
      token: "plain-token",
      sessionToken: "opaque-session-token",
      recordingSubmissionId: "recording-1",
      sourceType: "original",
      errorCode: "MEDIA_DECODE_FAILED",
      userAgentFamily: "Chrome",
    });
    const persistedInput = JSON.stringify(
      vi.mocked(recordPublicAdmissionPlaybackIssue).mock.calls[0]?.[0],
    );
    expect(persistedInput).not.toContain("203.0.113.42");
    expect(persistedInput).not.toContain("secret-tail");
    expect(persistedInput).not.toContain("storagePath");
    expect(persistedInput).not.toContain("accessCode");
  });

  it.each([
    [{ sourceType: "original", errorCode: "CUSTOM", storagePath: "secret" }],
    [{ sourceType: "javascript", errorCode: "MEDIA_LOAD_FAILED" }],
  ])("rejects non-whitelisted issue input before the service", async (body) => {
    const response = await POST(
      new Request(issueUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      routeParams,
    );

    expect(response.status).toBe(400);
    expect(recordPublicAdmissionPlaybackIssue).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before reading it", async () => {
    const response = await POST(
      new Request(issueUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "4097",
        },
        body: "{}",
      }),
      routeParams,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
    });
    expect(recordPublicAdmissionPlaybackIssue).not.toHaveBeenCalled();
  });

  it("cancels and rejects an oversized chunked body without Content-Length", async () => {
    const cancel = vi.fn();
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3_000));
        controller.enqueue(new Uint8Array(1_097));
        closeTimer = setTimeout(() => controller.close(), 10);
      },
      cancel(reason) {
        if (closeTimer) clearTimeout(closeTimer);
        cancel(reason);
      },
    });
    const response = await POST(
      new Request(issueUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      routeParams,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
    });
    expect(cancel).toHaveBeenCalled();
    expect(recordPublicAdmissionPlaybackIssue).not.toHaveBeenCalled();
  });

  it("returns a stable 400 for invalid JSON", async () => {
    const response = await POST(
      new Request(issueUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      routeParams,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_JSON_BODY",
    });
    expect(recordPublicAdmissionPlaybackIssue).not.toHaveBeenCalled();
  });
});
