import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import { getLiveOperationsRouteContext } from "@/features/live-operations/live-operations-route-utils";
import { getStreamerProfileRow } from "@/features/streamers/streamer-queries";
import { toStreamerDesktopProfileDto } from "@/features/streamers/streamer-ui-dto";

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
            ? 500
            : 500;
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      return Response.json({ error: message }, { status });
    },
  };
});

vi.mock("@/features/streamers/streamer-queries", () => ({
  getStreamerProfileRow: vi.fn(),
}));

vi.mock("@/features/streamers/streamer-ui-dto", () => ({
  toStreamerDesktopProfileDto: vi.fn(),
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

describe("streamer profile route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(getStreamerIdForUser).mockResolvedValue("streamer-1");
    vi.mocked(getStreamerProfileRow).mockResolvedValue({
      id: "streamer-1",
      display_name: "Profile Streamer",
    } as never);
    vi.mocked(toStreamerDesktopProfileDto).mockReturnValue({
      id: "streamer-1",
      alias: "Profile Streamer",
      org: "Org One",
    } as never);
  });

  it("returns the current streamer's real profile dto", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profile: {
        id: "streamer-1",
        alias: "Profile Streamer",
        org: "Org One",
      },
    });
    expect(getStreamerIdForUser).toHaveBeenCalledWith(
      context.supabase,
      "user-streamer",
      "org-1",
    );
    expect(getStreamerProfileRow).toHaveBeenCalledWith(
      context.supabase,
      "streamer-1",
    );
    expect(toStreamerDesktopProfileDto).toHaveBeenCalledWith(
      expect.objectContaining({ id: "streamer-1" }),
      { organizationName: "Org One" },
    );
  });

  it("rejects non-streamer users", async () => {
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue({
      ...context,
      auth: { ...context.auth, role: "ops_manager" },
    } as never);

    const response = await GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only streamers can view streamer profile",
    });
    expect(getStreamerIdForUser).not.toHaveBeenCalled();
  });
});
