import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import { getLiveOperationsRouteContext } from "@/features/live-operations/live-operations-route-utils";
import {
  createStreamerRecordingLink,
  listStreamerRecordingLinks,
} from "@/features/recordings/streamer-recording-library";
import { submitProjectRecording } from "@/features/recordings/project-recording-delivery";

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
    readJsonBody: async (request: Request) =>
      (await request.json()) as Record<string, unknown>,
  };
});

vi.mock("@/features/recordings/streamer-recording-library", () => ({
  createStreamerRecordingLink: vi.fn(),
  listStreamerRecordingLinks: vi.fn(),
}));

vi.mock("@/features/recordings/project-recording-delivery", () => ({
  submitProjectRecording: vi.fn(),
}));

const context = {
  supabase: { client: "supabase" },
  auth: {
    userId: "user-streamer",
    email: "streamer@example.com",
    name: "Profile Streamer",
    organizationId: "org-1",
    organizationName: "Org One",
    role: "streamer" as const,
  },
};

describe("streamer recordings route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(getStreamerIdForUser).mockResolvedValue("streamer-1");
    vi.mocked(listStreamerRecordingLinks).mockResolvedValue([
      {
        id: "recording-link-1",
        product: "Game Alpha",
        category: "ARPG",
        link: "https://videos.example.com/game-alpha",
        month: "2026-06",
        status: "submitted",
        statusLabel: "待审核",
        submittedAt: "2026-06-03T10:00:00.000Z",
      },
    ]);
    vi.mocked(createStreamerRecordingLink).mockResolvedValue({
      id: "recording-link-2",
      product: "Game Beta",
      category: "SLG",
      link: "https://videos.example.com/game-beta",
      month: "2026-06",
      status: "submitted",
      statusLabel: "待审核",
      submittedAt: "2026-06-03T11:00:00.000Z",
    });
    vi.mocked(submitProjectRecording).mockResolvedValue({
      applicationId: "application-1",
      projectId: "project-1",
      recording: {
        id: "recording-1",
        applicationId: "application-1",
        version: 1,
        status: "submitted",
      },
      reviewStatusLabel: "审核中",
    });
  });

  it("lists the current streamer's recording URL table rows", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recordings: [
        expect.objectContaining({
          product: "Game Alpha",
          category: "ARPG",
          link: "https://videos.example.com/game-alpha",
          month: "2026-06",
        }),
      ],
    });
    expect(listStreamerRecordingLinks).toHaveBeenCalledWith(context.supabase, {
      organizationId: "org-1",
      streamerId: "streamer-1",
    });
  });

  it("creates a recording URL row for the current streamer", async () => {
    const response = await POST(
      new Request("http://localhost/api/streamer/recordings", {
        method: "POST",
        body: JSON.stringify({
          product: "Game Beta",
          category: "SLG",
          link: "https://videos.example.com/game-beta",
          month: "2026-06",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      recording: expect.objectContaining({
        product: "Game Beta",
        category: "SLG",
        link: "https://videos.example.com/game-beta",
      }),
    });
    expect(createStreamerRecordingLink).toHaveBeenCalledWith(context.supabase, {
      organizationId: "org-1",
      streamerId: "streamer-1",
      submittedBy: "user-streamer",
      product: "Game Beta",
      category: "SLG",
      link: "https://videos.example.com/game-beta",
      month: "2026-06",
    });
  });

  it("submits project recordings to the application review queue when projectId is present", async () => {
    const response = await POST(
      new Request("http://localhost/api/streamer/recordings", {
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          link: "https://videos.example.com/project-1",
          durationSeconds: 600,
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      projectRecording: expect.objectContaining({
        applicationId: "application-1",
        projectId: "project-1",
        reviewStatusLabel: "审核中",
      }),
    });
    expect(submitProjectRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          userId: "user-streamer",
          role: "streamer",
          organizationId: "org-1",
        }),
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          link: "https://videos.example.com/project-1",
          durationSeconds: 600,
        },
      }),
    );
    expect(createStreamerRecordingLink).not.toHaveBeenCalled();
  });

  it("rejects non-streamer users", async () => {
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue({
      ...context,
      auth: { ...context.auth, role: "ops_manager" },
    } as never);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(listStreamerRecordingLinks).not.toHaveBeenCalled();
  });
});
