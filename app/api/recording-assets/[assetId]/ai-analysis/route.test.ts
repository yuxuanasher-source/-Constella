import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { requestRecordingAiAnalysis } from "@/features/recordings/recording-ai-analysis";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/recordings/recording-ai-analysis", () => ({
  requestRecordingAiAnalysis: vi.fn(),
}));

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

describe("recording asset AI analysis route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(requestRecordingAiAnalysis).mockResolvedValue({
      id: "analysis-1",
      assetId: "asset-1",
      status: "queued",
      statusLabel: "排队中",
      providerName: null,
      summary: "",
      scorecard: {},
      dimensions: [],
      riskFlags: [],
      recommendations: [],
      segments: [],
      errorSummary: null,
      aiInvocationId: "invocation-1",
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-01T10:00:00.000Z",
      completedAt: null,
    });
  });

  it("queues a recording AI analysis for MCN staff", async () => {
    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      analysis: expect.objectContaining({
        id: "analysis-1",
        status: "queued",
      }),
    });
    expect(requestRecordingAiAnalysis).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: auth,
      assetId: "asset-1",
    });
  });

  it("blocks streamers from starting internal analysis", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(403);
    expect(requestRecordingAiAnalysis).not.toHaveBeenCalled();
  });
});
