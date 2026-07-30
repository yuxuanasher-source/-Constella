import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { getAdmissionShareCandidatePlayback } from "@/features/applications/admission-share-candidates";
import { getAdmissionRouteContext } from "@/features/applications/application-route-utils";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";

vi.mock("@/features/applications/admission-share-candidates", () => ({
  SupabaseAdmissionShareCandidateRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "candidate-repo" };
    }),
  getAdmissionShareCandidatePlayback: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  getAdmissionRouteContext: vi.fn(),
  jsonError: (error: unknown) => {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status },
    );
  },
  RouteError: class RouteError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/features/storage/private-upload", () => ({
  createSignedDownloadUrl: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getPrivateStorageBucket: () => "jy-private",
}));

const context = {
  supabase: { client: "supabase" },
  auth: {
    userId: "user-ops",
    name: "Ops",
    role: "ops_manager" as const,
    organizationId: "org-1",
  },
};

const request = new Request(
  "https://app.example/api/projects/project-1/admission-share-candidates/recording-v1/playback",
);
const routeParams = {
  params: Promise.resolve({
    projectId: "project-1",
    recordingSubmissionId: "recording-v1",
  }),
};

describe("admission share candidate playback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
  });

  it("redirects MCN staff to a fresh signed original URL", async () => {
    vi.mocked(getAdmissionShareCandidatePlayback).mockResolvedValue({
      sourceType: "original",
      storagePath: "org-1/recordings/project-1/original.mp4",
    });
    vi.mocked(createSignedDownloadUrl).mockResolvedValue({
      signedUrl: "https://signed.example/original.mp4",
    });

    const response = await GET(request, routeParams);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://signed.example/original.mp4",
    );
    expect(createSignedDownloadUrl).toHaveBeenCalledWith({
      client: context.supabase,
      bucket: "jy-private",
      path: "org-1/recordings/project-1/original.mp4",
      expiresInSeconds: 3600,
    });
  });

  it("falls back to a safe external URL when no original exists", async () => {
    vi.mocked(getAdmissionShareCandidatePlayback).mockResolvedValue({
      sourceType: "external",
      url: "https://video.example/watch/1",
    });

    const response = await GET(request, routeParams);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://video.example/watch/1",
    );
    expect(createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("rejects a recording from another project", async () => {
    vi.mocked(getAdmissionShareCandidatePlayback).mockRejectedValue(
      Object.assign(new Error("Recording not found"), { statusCode: 404 }),
    );

    expect((await GET(request, routeParams)).status).toBe(404);
  });

  it("blocks streamers before resolving a playback source", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...context.auth, role: "streamer" },
    } as never);

    expect((await GET(request, routeParams)).status).toBe(403);
    expect(getAdmissionShareCandidatePlayback).not.toHaveBeenCalled();
  });
});
