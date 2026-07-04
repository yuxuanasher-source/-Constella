import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  releaseInlineKickSlot,
  tryAcquireInlineKickSlot,
} from "@/features/ai/inline-kick-gate";

import {
  RECORDING_AI_INLINE_KICK_GATE,
  kickRecordingAiAnalysisInProcess,
} from "./recording-ai-instant-run";

const { resolveIdentity, runOnce, createPipeline } = vi.hoisted(() => ({
  resolveIdentity: vi.fn(),
  runOnce: vi.fn(),
  createPipeline: vi.fn(() => null),
}));

vi.mock("./recording-ai-runner-identity", () => ({
  resolveRecordingAiRunnerIdentity: resolveIdentity,
}));
vi.mock("./recording-ai-analysis", () => ({
  runRecordingAiAnalysisOnce: runOnce,
}));
vi.mock("./recording-ai-pipeline", () => ({
  createRecordingAiAnalysisPipeline: createPipeline,
}));

const identityOk = {
  ok: true as const,
  client: {} as never,
  actor: {
    userId: "11111111-1111-4111-8111-111111111111",
    name: "Recording AI Runner",
    role: "ops_manager" as const,
    organizationId: "22222222-2222-4222-8222-222222222222",
  },
};

describe("kickRecordingAiAnalysisInProcess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RECORDING_AI_INLINE_KICK_LIMIT;
  });

  it("runs the analysis immediately when identity resolves", async () => {
    resolveIdentity.mockReturnValue(identityOk);
    runOnce.mockResolvedValue({ id: "analysis-1" });

    await kickRecordingAiAnalysisInProcess({ analysisId: "analysis-1" });

    expect(runOnce).toHaveBeenCalledWith(
      expect.objectContaining({ analysisId: "analysis-1" }),
    );
  });

  it("silently skips when the runner identity is not configured", async () => {
    resolveIdentity.mockReturnValue({
      ok: false,
      reason: "runner_not_configured",
    });

    await expect(
      kickRecordingAiAnalysisInProcess({ analysisId: "analysis-1" }),
    ).resolves.toBeUndefined();
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("skips without running when the concurrency gate is full", async () => {
    resolveIdentity.mockReturnValue(identityOk);
    // 默认上限 1：先占住唯一名额，kick 应直接放弃并留给 cron。
    expect(tryAcquireInlineKickSlot(RECORDING_AI_INLINE_KICK_GATE, 1)).toBe(
      true,
    );
    try {
      await kickRecordingAiAnalysisInProcess({ analysisId: "analysis-1" });
      expect(runOnce).not.toHaveBeenCalled();
    } finally {
      releaseInlineKickSlot(RECORDING_AI_INLINE_KICK_GATE);
    }
  });

  it("swallows the claim-race error without logging it as a failure", async () => {
    resolveIdentity.mockReturnValue(identityOk);
    runOnce.mockRejectedValue(
      new Error("Recording AI analysis is not queued: claimed by another runner"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        kickRecordingAiAnalysisInProcess({ analysisId: "analysis-1" }),
      ).resolves.toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs other failures and releases the slot for later kicks", async () => {
    resolveIdentity.mockReturnValue(identityOk);
    runOnce.mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await kickRecordingAiAnalysisInProcess({ analysisId: "analysis-1" });
      expect(errorSpy).toHaveBeenCalled();

      // 闸门已释放：下一次 kick 正常执行。
      runOnce.mockResolvedValue({ id: "analysis-2" });
      await kickRecordingAiAnalysisInProcess({ analysisId: "analysis-2" });
      expect(runOnce).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("honours RECORDING_AI_INLINE_KICK_LIMIT=0 as fully disabled", async () => {
    resolveIdentity.mockReturnValue(identityOk);
    process.env.RECORDING_AI_INLINE_KICK_LIMIT = "0";

    await kickRecordingAiAnalysisInProcess({ analysisId: "analysis-1" });

    expect(runOnce).not.toHaveBeenCalled();
  });
});
