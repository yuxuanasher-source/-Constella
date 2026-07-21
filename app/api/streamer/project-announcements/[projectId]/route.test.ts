import { beforeEach, describe, expect, it, vi } from "vitest";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import { getLiveOperationsRouteContext } from "@/features/live-operations/live-operations-route-utils";
import { getStreamerProjectAnnouncement } from "@/features/recordings/project-announcements";

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
  getStreamerProjectAnnouncement: vi.fn(),
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

describe("streamer project announcement detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(getStreamerIdForUser).mockResolvedValue("streamer-1");
    vi.mocked(getStreamerProjectAnnouncement).mockResolvedValue({
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
      recordingGuide: recordingGuideFixture(),
      reviewStatusLabel: "待投递",
      canSubmitRecording: true,
    });
  });

  it("returns a current-organization public project detail for the streamer", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      project: expect.objectContaining({
        id: "project-1",
        publicSummary: "Streamer-facing summary",
        gameDownloadUrl: "https://download.example.com/game-a",
      }),
    });
    expect(getStreamerProjectAnnouncement).toHaveBeenCalledWith(
      context.supabase,
      {
        organizationId: "org-1",
        streamerId: "streamer-1",
        projectId: "project-1",
      },
    );
  });

  it("returns 404 when the project is not visible to this streamer", async () => {
    vi.mocked(getStreamerProjectAnnouncement).mockResolvedValueOnce(null);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "hidden-project" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Project announcement not found",
    });
  });
});

function recordingGuideFixture() {
  return {
    gameName: "Game A",
    gameVersion: "",
    serverRegion: "",
    promotionGoal: "",
    targetAudience: "",
    requiredContent: ["Streamer-facing summary"],
    requiredTalkingPoints: [],
    forbiddenContent: ["虚假宣传", "攻击竞品"],
    commercialActions: [],
    technicalStandard: { forceRecording: true, minDurationMinutes: 10 },
    templateText: "开场说明本场目标。",
    exampleUrl: null,
  };
}
