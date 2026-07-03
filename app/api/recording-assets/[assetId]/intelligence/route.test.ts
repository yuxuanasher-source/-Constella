import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import {
  getRecordingIntelligenceReport,
  recordingIntelligenceReviewBoundary,
  runRecordingIntelligence,
} from "@/features/recordings/recording-intelligence";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/recordings/recording-intelligence", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/recordings/recording-intelligence")
  >("@/features/recordings/recording-intelligence");
  return {
    ...actual,
    getRecordingIntelligenceReport: vi.fn(),
    runRecordingIntelligence: vi.fn(),
  };
});

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@example.com",
  name: "Ops",
  organizationId: "org-1",
  organizationName: "Org",
  role: "ops_manager" as const,
};

describe("recording asset intelligence route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("runs the intelligence analysis for MCN staff", async () => {
    vi.mocked(runRecordingIntelligence).mockResolvedValue({
      assetId: "asset-1",
      calibrationVersion: 2,
    } as never);

    const response = await POST(
      new Request(
        "http://localhost/api/recording-assets/asset-1/intelligence",
        {
          method: "POST",
          body: JSON.stringify({
            transcript: [{ atSeconds: 10, text: "点关注" }],
          }),
        },
      ),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      report: expect.objectContaining({ assetId: "asset-1" }),
    });
    expect(runRecordingIntelligence).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        assetId: "asset-1",
        input: expect.objectContaining({
          transcript: [{ atSeconds: 10, text: "点关注" }],
        }),
      }),
    );
  });

  it("blocks streamers from running the analysis", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request(
        "http://localhost/api/recording-assets/asset-1/intelligence",
        { method: "POST" },
      ),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(403);
    expect(runRecordingIntelligence).not.toHaveBeenCalled();
  });

  it("maps service permission errors to 403", async () => {
    vi.mocked(runRecordingIntelligence).mockRejectedValue(
      new Error("Only MCN staff can run recording intelligence analysis"),
    );

    const response = await POST(
      new Request(
        "http://localhost/api/recording-assets/asset-1/intelligence",
        { method: "POST" },
      ),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(403);
  });

  it("returns the latest snapshot on GET", async () => {
    vi.mocked(getRecordingIntelligenceReport).mockResolvedValue({
      assetId: "asset-1",
      quality: null,
      script: null,
      riskAlerts: [],
      capability: null,
      reviewBoundary: recordingIntelligenceReviewBoundary,
    });

    const response = await GET(
      new Request("http://localhost/api/recording-assets/asset-1/intelligence"),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      snapshot: expect.objectContaining({ assetId: "asset-1" }),
    });
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/recording-assets/asset-1/intelligence"),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(401);
    expect(getRecordingIntelligenceReport).not.toHaveBeenCalled();
  });
});
