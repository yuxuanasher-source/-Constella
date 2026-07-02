import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  claimAndRunRecordingAiAnalyses,
  runRecordingAiAnalysisOnce,
} from "@/features/recordings/recording-ai-analysis";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/recordings/recording-ai-analysis", () => ({
  claimAndRunRecordingAiAnalyses: vi.fn(),
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
    vi.mocked(claimAndRunRecordingAiAnalyses).mockResolvedValue({
      analyses: [],
      failures: [],
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
    expect(claimAndRunRecordingAiAnalyses).not.toHaveBeenCalled();
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
    expect(claimAndRunRecordingAiAnalyses).not.toHaveBeenCalled();
  });

  it("rejects claim mode without a valid runner token", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    expect(claimAndRunRecordingAiAnalyses).not.toHaveBeenCalled();
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
    expect(claimAndRunRecordingAiAnalyses).not.toHaveBeenCalled();
  });

  it("rejects an explicit but invalid analysis id without falling back to claim mode", async () => {
    for (const analysisId of ["", "   ", 42]) {
      const response = await POST(
        new Request("http://localhost/api/internal/recording-ai/run", {
          method: "POST",
          headers: { authorization: "Bearer runner-token" },
          body: JSON.stringify({ analysisId }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Recording analysis id is required",
      });
    }
    expect(runRecordingAiAnalysisOnce).not.toHaveBeenCalled();
    expect(claimAndRunRecordingAiAnalyses).not.toHaveBeenCalled();
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

  it("claims and runs queued analyses when the body has no analysis id", async () => {
    vi.mocked(claimAndRunRecordingAiAnalyses).mockResolvedValue({
      analyses: [
        { id: "analysis-1", status: "succeeded", attempt: 1 },
        { id: "analysis-2", status: "queued", attempt: 2 },
      ],
      failures: [],
    });

    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      processed: 2,
      analyses: [
        { id: "analysis-1", status: "succeeded", attempt: 1 },
        { id: "analysis-2", status: "queued", attempt: 2 },
      ],
      failures: [],
    });
    expect(claimAndRunRecordingAiAnalyses).toHaveBeenCalledWith({
      client: supabase,
      actor: {
        userId: runnerUserId,
        name: "Recording AI Runner",
        role: "ops_manager",
        organizationId: runnerOrganizationId,
      },
      limit: 5,
    });
    expect(runRecordingAiAnalysisOnce).not.toHaveBeenCalled();
  });

  it("supports a raw empty request body in claim mode", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      processed: 0,
      analyses: [],
      failures: [],
    });
    expect(claimAndRunRecordingAiAnalyses).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });

  it("returns zero processed when there is nothing left to claim", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({ limit: 5 }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      processed: 0,
      analyses: [],
      failures: [],
    });
  });

  it("clamps the claim limit between 1 and 10", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({ limit: 99 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(claimAndRunRecordingAiAnalyses).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );

    await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({ limit: 0 }),
      }),
    );

    expect(claimAndRunRecordingAiAnalyses).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 1 }),
    );
  });

  it("returns a safe failure when claiming fails", async () => {
    vi.mocked(claimAndRunRecordingAiAnalyses).mockRejectedValue(
      new Error("claim failed for private/path.mp4 with secret=abc123"),
    );

    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      errorCode: "claim_failed",
      errorMessage: "Recording AI runner could not claim analyses",
    });
    expect(JSON.stringify(body)).not.toContain("private/path.mp4");
    expect(JSON.stringify(body)).not.toContain("secret=abc123");
  });

  it("sanitizes per-analysis failures in claim mode", async () => {
    vi.mocked(claimAndRunRecordingAiAnalyses).mockResolvedValue({
      analyses: [{ id: "analysis-1", status: "succeeded", attempt: 1 }],
      failures: [
        {
          analysisId: "analysis-9",
          errorSummary: "failed private/path.mp4 with secret=abc123",
        },
      ],
    });

    const response = await POST(
      new Request("http://localhost/api/internal/recording-ai/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      processed: 1,
      analyses: [{ id: "analysis-1", status: "succeeded", attempt: 1 }],
      failures: [
        {
          analysisId: "analysis-9",
          errorCode: "runner_failed",
          errorMessage: "failed [redacted] with secret=[redacted]",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("private/path.mp4");
    expect(JSON.stringify(body)).not.toContain("secret=abc123");
  });
});
