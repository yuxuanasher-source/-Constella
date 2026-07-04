import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { learnRecordingIntelligenceCalibration } from "@/features/recordings/recording-intelligence-learning";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/recordings/recording-intelligence-learning", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/recordings/recording-intelligence-learning")
  >("@/features/recordings/recording-intelligence-learning");
  return {
    ...actual,
    learnRecordingIntelligenceCalibration: vi.fn(),
  };
});

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const supabase = {
  from: vi.fn(),
};
const runnerOrganizationId = "11111111-1111-4111-8111-111111111111";
const runnerUserId = "22222222-2222-4222-8222-222222222222";

function calibrationFixture() {
  return {
    version: 3,
    source: "learned" as const,
    sampleCounts: { streamerCount: 12 },
    uploadRateBps: 7500,
    goLiveRateBps: 8200,
    liveTestPassRateBps: 5100,
    qualityThresholds: {
      minEffectiveRatioBps: 7000,
      maxIdleRatioBps: 1500,
      minGameScreenRatioBps: 6000,
      minFaceVisibleRatioBps: 3000,
      minEffectiveSeconds: 1200,
    },
    scriptBenchmark: {
      conversionRatioBps: 1800,
      gameExplainRatioBps: 3500,
      interactionRatioBps: 3000,
      source: "default_high_roi" as const,
      sampleSize: 0,
    },
    capabilityWeights: {
      game_proficiency: 2600,
      script_fluency: 3100,
      interaction_activity: 2200,
      conversion_guidance: 2100,
    },
    bottlenecks: [
      {
        stage: "live_test" as const,
        label: "上播测试",
        actualBps: 5100,
        targetBps: 6000,
        severity: "low" as const,
        finding: "上播测试转化率 51.0%，低于目标 60.0%（样本 20）。",
        recommendation: "测试前先做模拟评审。",
      },
    ],
  };
}

describe("/api/internal/recording-intelligence/learn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RECORDING_AI_RUNNER_TOKEN", "runner-token");
    vi.stubEnv("RECORDING_AI_RUNNER_ORGANIZATION_ID", runnerOrganizationId);
    vi.stubEnv("RECORDING_AI_RUNNER_USER_ID", runnerUserId);
    vi.stubEnv("RECORDING_AI_RUNNER_USER_NAME", "Recording AI Runner");
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(learnRecordingIntelligenceCalibration).mockResolvedValue(
      calibrationFixture(),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects requests without the runner token", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-intelligence/learn", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(learnRecordingIntelligenceCalibration).not.toHaveBeenCalled();
  });

  it("rejects an invalid runner token", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-intelligence/learn", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
      }),
    );

    expect(response.status).toBe(401);
    expect(learnRecordingIntelligenceCalibration).not.toHaveBeenCalled();
  });

  it("learns a new calibration version for the runner organization", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/recording-intelligence/learn", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      calibration: expect.objectContaining({
        version: 3,
        liveTestPassRateBps: 5100,
        bottlenecks: [expect.objectContaining({ stage: "live_test" })],
      }),
    });
    expect(learnRecordingIntelligenceCalibration).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          organizationId: runnerOrganizationId,
          userId: runnerUserId,
          role: "ops_manager",
        }),
      }),
    );
  });

  it("fails closed when the runner org is not configured", async () => {
    vi.stubEnv("RECORDING_AI_RUNNER_ORGANIZATION_ID", "not-a-uuid");

    const response = await POST(
      new Request("http://localhost/api/internal/recording-intelligence/learn", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
      }),
    );

    expect(response.status).toBe(500);
    expect(learnRecordingIntelligenceCalibration).not.toHaveBeenCalled();
  });

  it("hides internal errors behind a stable error code", async () => {
    vi.mocked(learnRecordingIntelligenceCalibration).mockRejectedValue(
      new Error("connection to db failed at secret=abc"),
    );

    const response = await POST(
      new Request("http://localhost/api/internal/recording-intelligence/learn", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      errorCode: "learn_failed",
      errorMessage: "Recording intelligence calibration failed",
    });
  });
});
