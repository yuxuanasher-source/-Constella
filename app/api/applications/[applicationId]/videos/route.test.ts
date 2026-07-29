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
      uploadedBy: "user-streamer",
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
    await expect(response.json()).resolves.toEqual({
      recording: expect.objectContaining({
        id: "recording-1",
        uploadedBy: "user-streamer",
      }),
    });
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

  it.each(["owner", "ops_manager", "operator_business"] as const)(
    "passes the %s actor through for an operator proxy upload",
    async (role) => {
      const staffAuth = {
        userId: `user-${role}`,
        name: role,
        role,
        organizationId: "org-1",
      };
      vi.mocked(getAdmissionRouteContext).mockResolvedValue({
        supabase: { client: "supabase" },
        auth: staffAuth,
        repo: { repo: "applications" },
        audit: vi.fn(),
        notify: vi.fn(),
      } as never);

      const response = await POST(
        jsonRequest({
          externalUrl: "https://videos.example.com/operator-proxy",
        }),
        { params: Promise.resolve({ applicationId: "app-1" }) },
      );

      expect(response.status).toBe(201);
      expect(getStreamerIdForUser).not.toHaveBeenCalled();
      expect(submitRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: expect.objectContaining({
            ...staffAuth,
            streamerId: null,
          }),
          input: expect.objectContaining({
            applicationId: "app-1",
            externalUrl: "https://videos.example.com/operator-proxy",
          }),
        }),
      );
    },
  );

  it("returns forbidden when finance attempts a proxy upload", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth: {
        userId: "user-finance",
        name: "Finance",
        role: "finance",
        organizationId: "org-1",
      },
      repo: { repo: "applications" },
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    vi.mocked(submitRecording).mockRejectedValue(
      new Error("Current role cannot submit screening recordings"),
    );

    const response = await POST(
      jsonRequest({
        externalUrl: "https://videos.example.com/finance-proxy",
      }),
      { params: Promise.resolve({ applicationId: "app-1" }) },
    );

    expect(response.status).toBe(403);
    expect(getStreamerIdForUser).not.toHaveBeenCalled();
    expect(submitRecording).toHaveBeenCalled();
  });

  it("surfaces the service cross-organization rejection", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth: {
        userId: "user-ops",
        name: "Operator",
        role: "operator_business",
        organizationId: "org-2",
      },
      repo: { repo: "applications" },
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    vi.mocked(submitRecording).mockRejectedValue(
      new Error("Cross-organization access is not allowed"),
    );

    const response = await POST(
      jsonRequest({
        externalUrl: "https://videos.example.com/cross-org-proxy",
      }),
      { params: Promise.resolve({ applicationId: "app-1" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Cross-organization access is not allowed",
    });
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

  it("rejects a storage path outside the current organization before submitting", async () => {
    const response = await POST(
      jsonRequest({
        storagePath: "org-2/recordings/project-1/demo.mp4",
        externalUrl: "https://videos.example.com/submission",
      }),
      { params: Promise.resolve({ applicationId: "app-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid recording storage path",
    });
    expect(submitRecording).not.toHaveBeenCalled();
  });
});
