import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { confirmRecordingAiProfileInsight } from "@/features/recordings/recording-profile-insights";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/recordings/recording-profile-insights", () => ({
  confirmRecordingAiProfileInsight: vi.fn(),
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

describe("recording asset profile insight route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(confirmRecordingAiProfileInsight).mockResolvedValue({
      id: "insight-1",
      streamerId: "streamer-1",
      sourceRef: "recording_ai_analyses:analysis-1",
      title: "录屏 AI 观察 · 项目录屏 v3",
      summary: "建议补充互动亮点后再通过。",
      strengths: [],
      risks: [],
      recommendations: [],
      tags: ["recording_ai"],
      confirmedAt: "2026-07-02T09:00:00.000Z",
      createdAt: "2026-07-02T09:00:00.000Z",
    });
  });

  it("confirms recording AI analysis into streamer profile insight for ops staff", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/recording-assets/asset-1/profile-insight",
        { method: "POST" },
      ),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      insight: expect.objectContaining({
        id: "insight-1",
        streamerId: "streamer-1",
      }),
    });
    expect(confirmRecordingAiProfileInsight).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: auth,
      assetId: "asset-1",
    });
  });

  it("blocks non-operations staff from confirming profile insights", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "finance",
    });

    const response = await POST(
      new Request(
        "http://localhost/api/recording-assets/asset-1/profile-insight",
        { method: "POST" },
      ),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(403);
    expect(confirmRecordingAiProfileInsight).not.toHaveBeenCalled();
  });
});
