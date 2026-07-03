import { beforeEach, describe, expect, it, vi } from "vitest";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import { getLiveOperationsRouteContext } from "@/features/live-operations/live-operations-route-utils";
import { listStreamerProjectAnnouncements } from "@/features/recordings/project-announcements";

vi.mock("@/features/live-operations/live-operations-repository", () => ({
  getStreamerIdForUser: vi.fn(),
}));

vi.mock("@/features/live-operations/live-operations-route-utils", () => {
  class RouteError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  }

  return {
    getLiveOperationsRouteContext: vi.fn(),
    RouteError,
    jsonError: (error: unknown) => {
      const status =
        error instanceof RouteError
          ? error.statusCode
          : error instanceof Error
            ? 400
            : 500;
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      return Response.json({ error: message }, { status });
    },
  };
});

vi.mock("@/features/recordings/project-announcements", () => ({
  listStreamerProjectAnnouncements: vi.fn(),
}));

const context = {
  supabase: { client: "supabase" },
  auth: {
    userId: "user-streamer",
    email: "streamer@example.com",
    name: "Streamer",
    organizationId: "org-1",
    organizationName: "Org One",
    role: "streamer" as const,
  },
};

describe("streamer project announcements route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(getStreamerIdForUser).mockResolvedValue("streamer-1");
    vi.mocked(listStreamerProjectAnnouncements).mockResolvedValue([
      {
        id: "project-1",
        code: "PUB-1",
        name: "Public Project",
        status: "recruiting",
        vendor: "Vendor A",
        product: "Game A",
        publicSummary: "Streamer-facing summary",
        gameDownloadUrl: "https://download.example.com/game-a",
        openSignup: true,
        forceRecording: true,
        applicationId: null,
        applicationStatus: null,
        latestRecordingStatus: null,
        latestRecordingVersion: null,
        decisionReason: null,
        rejectionReasons: [],
        recordingFeedback: null,
        reviewStatusLabel: "待投递",
        canSubmitRecording: true,
      },
    ]);
  });

  it("returns current organization public project announcements for the streamer", async () => {
    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      announcements: [
        expect.objectContaining({
          id: "project-1",
          publicSummary: "Streamer-facing summary",
        }),
      ],
    });
    expect(listStreamerProjectAnnouncements).toHaveBeenCalledWith(
      context.supabase,
      {
        organizationId: "org-1",
        streamerId: "streamer-1",
      },
    );
  });

  it("rejects non-streamer users", async () => {
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue({
      ...context,
      auth: { ...context.auth, role: "ops_manager" },
    } as never);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(403);
    expect(listStreamerProjectAnnouncements).not.toHaveBeenCalled();
  });
});
