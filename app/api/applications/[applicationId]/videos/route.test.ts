import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { getStreamerIdForUser } from "@/features/applications/application-repository";
import { submitRecording } from "@/features/applications/application-service";
import { getAdmissionRouteContext } from "@/features/applications/application-route-utils";

vi.mock("@/features/applications/application-repository", () => ({
  getStreamerIdForUser: vi.fn(),
  SupabaseApplicationRepository: vi.fn(),
}));

vi.mock("@/features/applications/application-service", () => ({
  submitRecording: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/applications/application-route-utils")
  >("@/features/applications/application-route-utils");

  return {
    ...actual,
    getAdmissionRouteContext: vi.fn(),
  };
});

const auth = {
  userId: "user-streamer",
  name: "Streamer",
  role: "streamer" as const,
  organizationId: "org-1",
};

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/applications/app-1/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/applications/[applicationId]/videos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth,
      repo: { repo: "applications" },
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    vi.mocked(getStreamerIdForUser).mockResolvedValue("streamer-1");
    vi.mocked(submitRecording).mockResolvedValue({
      id: "recording-1",
      applicationId: "app-1",
      version: 1,
      status: "recording_reviewing",
    } as never);
  });

  it("submits a recording payload for the application", async () => {
    const response = await POST(
      jsonRequest({
        externalUrl: "https://videos.example.com/submission",
        durationSeconds: 600,
      }),
      { params: Promise.resolve({ applicationId: "app-1" }) },
    );

    expect(response.status).toBe(201);
    expect(getStreamerIdForUser).toHaveBeenCalledWith(
      { client: "supabase" },
      "user-streamer",
      "org-1",
    );
    expect(submitRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          ...auth,
          streamerId: "streamer-1",
        }),
        input: {
          applicationId: "app-1",
          storagePath: undefined,
          externalUrl: "https://videos.example.com/submission",
          durationSeconds: 600,
        },
      }),
    );
  });

  it("rejects negative recording durations at the request boundary", async () => {
    const response = await POST(
      jsonRequest({
        externalUrl: "https://videos.example.com/submission",
        durationSeconds: -1,
      }),
      { params: Promise.resolve({ applicationId: "app-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
    });
    expect(submitRecording).not.toHaveBeenCalled();
  });
});
