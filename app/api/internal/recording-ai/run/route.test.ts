import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { runRecordingAiAnalysisOnce } from "@/features/recordings/recording-ai-analysis";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/recordings/recording-ai-analysis", () => ({
  runRecordingAiAnalysisOnce: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const supabase = {
  from: vi.fn(),
};
const runnerOrganizationId = "11111111-1111-4111-8111-111111111111";
const runnerUserId = "22222222-2222-4222-8222-222222222222";

describe("/api/internal/recording-ai/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RECORDING_AI_RUNNER_TOKEN", "runner-token");
    vi.stubEnv("RECORDING_AI_RUNNER_ORGANIZATION_ID", runnerOrganizationId);
    vi.stubEnv("RECORDING_AI_RUNNER_USER_ID", runnerUserId);
    vi.stubEnv("RECORDING_AI_RUNNER_USER_NAME", "Recording AI Runner");
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(runRecordingAiAnalysisOnce).mockResolvedValue({
      id: "analysis-1",
      assetId: "asset-1",
      status: "succeeded",
      statusLabel: "已完成",
      providerName: "deterministic",
      summary: "已完成录屏分析",
      scorecard: {},
      dimensions: [],
      riskFlags: [],
      recommendations: [],
      segments: [],
      errorSummary: null,
      aiInvocationId: "invocation-1",
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-01T10:05:00.000Z",
      completedAt: "2026-07-01T10:05:00.000Z",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects missing runner token without running analysis", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        body: JSON.stringify({ analysisId: "analysis-1" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(runRecordingAiAnalysisOnce).not.toHaveBeenCalled();
  });

  it("rejects invalid runner token without running analysis", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
        body: JSON.stringify({ analysisId: "analysis-1" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(runRecordingAiAnalysisOnce).not.toHaveBeenCalled();
  });

  it("requires configured runner identity", async () => {
    vi.stubEnv("RECORDING_AI_RUNNER_ORGANIZATION_ID", "");

    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({ analysisId: "analysis-1" }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Recording AI runner organization and user are not configured",
    });
    expect(runRecordingAiAnalysisOnce).not.toHaveBeenCalled();
  });

  it("requires an analysis id", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Recording analysis id is required",
    });
    expect(runRecordingAiAnalysisOnce).not.toHaveBeenCalled();
  });

  it("runs one queued recording analysis with the configured system actor", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({ analysisId: "analysis-1" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      analysis: {
        id: "analysis-1",
        assetId: "asset-1",
        status: "succeeded",
        statusLabel: "已完成",
        providerName: "deterministic",
        summary: "已完成录屏分析",
        scorecard: {},
        dimensions: [],
        riskFlags: [],
        recommendations: [],
        segments: [],
        errorSummary: null,
        aiInvocationId: "invocation-1",
        createdAt: "2026-07-01T10:00:00.000Z",
        updatedAt: "2026-07-01T10:05:00.000Z",
        completedAt: "2026-07-01T10:05:00.000Z",
      },
    });
    expect(runRecordingAiAnalysisOnce).toHaveBeenCalledWith({
      client: supabase,
      actor: {
        userId: runnerUserId,
        name: "Recording AI Runner",
        role: "ops_manager",
        organizationId: runnerOrganizationId,
      },
      analysisId: "analysis-1",
    });
  });

  it("sanitizes runner failures and never leaks paths or secrets", async () => {
    vi.mocked(runRecordingAiAnalysisOnce).mockRejectedValue(
      new Error("failed private/path.mp4 with secret=abc123"),
    );

    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({ analysisId: "analysis-1" }),
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      errorCode: "runner_failed",
      errorMessage: "failed [redacted] with secret=[redacted]",
    });
    expect(JSON.stringify(body)).not.toContain("private/path.mp4");
    expect(JSON.stringify(body)).not.toContain("secret=abc123");
  });
});
