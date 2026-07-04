import { describe, expect, it, vi } from "vitest";

import {
  buildRecordingIntelligenceCalibration,
  buildStreamerHistoryStats,
  defaultRecordingIntelligenceCalibration,
  learnRecordingIntelligenceCalibration,
  loadActiveRecordingIntelligenceCalibration,
  type OrganizationFunnelHistory,
} from "./recording-intelligence-learning";
import { defaultScriptBenchmark } from "./recording-script-analysis";
import { defaultCapabilityWeights } from "./streamer-capability-scoring";

function historyFixture(
  overrides: Partial<OrganizationFunnelHistory> = {},
): OrganizationFunnelHistory {
  return {
    windowDays: 90,
    streamerCount: 20,
    uploadCount: 40,
    uploadStreamerCount: 18,
    liveTestCount: 20,
    liveTestPassCount: 15,
    scheduledTaskCount: 30,
    startedTaskCount: 27,
    ...overrides,
  };
}

describe("buildRecordingIntelligenceCalibration", () => {
  it("computes funnel rates and reports no bottleneck for a healthy org", () => {
    const calibration = buildRecordingIntelligenceCalibration({
      history: historyFixture(),
    });

    expect(calibration).toMatchObject({
      version: 1,
      source: "learned",
      uploadRateBps: 9000,
      liveTestPassRateBps: 7500,
      goLiveRateBps: 9000,
      bottlenecks: [],
    });
    expect(calibration.capabilityWeights).toEqual(defaultCapabilityWeights);
    expect(calibration.scriptBenchmark).toEqual(defaultScriptBenchmark);
  });

  it("locates the live-test bottleneck and shifts weights toward script fluency", () => {
    const calibration = buildRecordingIntelligenceCalibration({
      history: historyFixture({
        liveTestCount: 20,
        liveTestPassCount: 5, // 25% 通过率，目标 60%
      }),
    });

    expect(calibration.bottlenecks).toEqual([
      expect.objectContaining({
        stage: "live_test",
        severity: "high",
        actualBps: 2500,
        targetBps: 6000,
      }),
    ]);
    expect(calibration.capabilityWeights.script_fluency).toBeGreaterThan(
      calibration.capabilityWeights.conversion_guidance,
    );
    const weightSum = Object.values(calibration.capabilityWeights).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(weightSum).toBe(10000);
  });

  it("locates upload and go-live bottlenecks with actionable recommendations", () => {
    const calibration = buildRecordingIntelligenceCalibration({
      history: historyFixture({
        streamerCount: 20,
        uploadStreamerCount: 8, // 40% 上传率，目标 80%
        scheduledTaskCount: 30,
        startedTaskCount: 18, // 60% 上播率，目标 85%
      }),
    });

    const stages = calibration.bottlenecks.map((item) => item.stage);
    expect(stages).toEqual(["upload", "go_live"]);
    for (const bottleneck of calibration.bottlenecks) {
      expect(bottleneck.finding).toContain("低于目标");
      expect(bottleneck.recommendation.length).toBeGreaterThan(0);
    }
  });

  it("skips bottleneck verdicts when the stage sample is too small", () => {
    const calibration = buildRecordingIntelligenceCalibration({
      history: historyFixture({
        liveTestCount: 2,
        liveTestPassCount: 0,
      }),
    });

    expect(
      calibration.bottlenecks.some((item) => item.stage === "live_test"),
    ).toBe(false);
  });

  it("calibrates the script benchmark from top cohort samples and bumps the version", () => {
    const calibration = buildRecordingIntelligenceCalibration({
      history: historyFixture(),
      topCohortScriptSamples: [
        {
          conversionRatioBps: 2400,
          gameExplainRatioBps: 4000,
          interactionRatioBps: 2600,
        },
        {
          conversionRatioBps: 2000,
          gameExplainRatioBps: 3600,
          interactionRatioBps: 3200,
        },
        {
          conversionRatioBps: 2200,
          gameExplainRatioBps: 3800,
          interactionRatioBps: 2900,
        },
      ],
      previous: { version: 4 },
    });

    expect(calibration.version).toBe(5);
    expect(calibration.scriptBenchmark).toEqual({
      conversionRatioBps: 2200,
      gameExplainRatioBps: 3800,
      interactionRatioBps: 2900,
      source: "org_calibrated",
      sampleSize: 3,
    });
  });

  it("keeps the default benchmark under three samples", () => {
    const calibration = buildRecordingIntelligenceCalibration({
      history: historyFixture(),
      topCohortScriptSamples: [
        {
          conversionRatioBps: 5000,
          gameExplainRatioBps: 3000,
          interactionRatioBps: 2000,
        },
      ],
    });

    expect(calibration.scriptBenchmark).toEqual(defaultScriptBenchmark);
  });
});

describe("buildStreamerHistoryStats", () => {
  it("computes per-streamer rates", () => {
    expect(
      buildStreamerHistoryStats({
        uploadCount: 6,
        scheduledTaskCount: 10,
        startedTaskCount: 8,
        liveTestCount: 4,
        liveTestPassCount: 3,
      }),
    ).toEqual({
      uploadCount: 6,
      goLiveRateBps: 8000,
      liveTestPassRateBps: 7500,
    });
  });

  it("does not punish streamers without scheduled tasks or tests", () => {
    expect(
      buildStreamerHistoryStats({
        uploadCount: 1,
        scheduledTaskCount: 0,
        startedTaskCount: 0,
        liveTestCount: 0,
        liveTestPassCount: 0,
      }),
    ).toEqual({
      uploadCount: 1,
      goLiveRateBps: 10000,
      liveTestPassRateBps: 10000,
    });
  });
});

type TableRows = Record<string, Array<Record<string, unknown>>>;

function createLearningClient(rows: TableRows) {
  const inserts: Record<string, Array<Record<string, unknown>>> = {};

  const listResult = (table: string) => ({
    data: rows[table] ?? [],
    error: null,
  });

  const chain = (table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        gte: vi.fn(() => ({
          limit: vi.fn(async () => listResult(table)),
        })),
        order: vi.fn(() => ({
          limit: vi.fn(async () => listResult(table)),
        })),
        limit: vi.fn(async () => listResult(table)),
      })),
    })),
    insert: vi.fn((payload: Record<string, unknown>) => {
      inserts[table] = [...(inserts[table] ?? []), payload];
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              id: "calibration-row-1",
              created_at: "2026-07-03T10:00:00.000Z",
              version: payload.version,
              source: payload.source,
              sample_counts: payload.sample_counts,
              upload_rate_bps: payload.upload_rate_bps,
              go_live_rate_bps: payload.go_live_rate_bps,
              live_test_pass_rate_bps: payload.live_test_pass_rate_bps,
              quality_thresholds: payload.quality_thresholds,
              script_benchmark: payload.script_benchmark,
              capability_weights: payload.capability_weights,
              bottlenecks: payload.bottlenecks,
            },
            error: null,
          })),
        })),
      };
    }),
  });

  return {
    client: { from: vi.fn((table: string) => chain(table)) },
    inserts,
  };
}

const actor = {
  userId: "user-ops",
  name: "Ops Manager",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

describe("learnRecordingIntelligenceCalibration", () => {
  it("reads org history, persists a versioned calibration and audits it", async () => {
    const { client, inserts } = createLearningClient({
      streamers: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }],
      recording_assets: [
        { id: "a1", streamer_id: "s1" },
        { id: "a2", streamer_id: "s1" },
        { id: "a3", streamer_id: "s2" },
      ],
      recording_submissions: [
        { id: "r1", status: "approved" },
        { id: "r2", status: "rejected" },
        { id: "r3", status: "approved" },
        { id: "r4", status: "submitted" },
      ],
      live_tasks: [
        { id: "t1", system_duration: 3600 },
        { id: "t2", system_duration: 0 },
        { id: "t3", system_duration: 5400 },
      ],
      streamer_capability_reports: [],
      recording_script_insights: [],
      recording_intelligence_calibrations: [],
    });

    const calibration = await learnRecordingIntelligenceCalibration({
      client: client as never,
      actor,
      now: () => new Date("2026-07-03T10:00:00.000Z"),
    });

    expect(calibration).toMatchObject({
      version: 1,
      source: "learned",
      uploadRateBps: 5000, // 4 个主播 2 个有上传
      liveTestPassRateBps: 5000, // 4 次测试 2 次通过
      goLiveRateBps: 6667, // 3 个任务 2 个实际开播
    });
    expect(calibration.bottlenecks.map((item) => item.stage)).toEqual([
      "upload",
      "live_test",
      "go_live",
    ]);

    expect(inserts.recording_intelligence_calibrations).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        version: 1,
        created_by: "user-ops",
      }),
    ]);
    expect(inserts.audit_logs).toEqual([
      expect.objectContaining({
        module: "recording_intelligence",
        object_type: "recording_intelligence_calibration",
      }),
    ]);
  });

  it("increments the version when a previous calibration exists", async () => {
    const { client } = createLearningClient({
      streamers: [{ id: "s1" }],
      recording_assets: [],
      recording_submissions: [],
      live_tasks: [],
      streamer_capability_reports: [],
      recording_script_insights: [],
      recording_intelligence_calibrations: [
        {
          id: "calibration-0",
          version: 7,
          source: "learned",
          sample_counts: {},
          upload_rate_bps: 5000,
          go_live_rate_bps: 5000,
          live_test_pass_rate_bps: 5000,
          quality_thresholds: {},
          script_benchmark: {},
          capability_weights: {},
          bottlenecks: [],
          created_at: "2026-06-01T00:00:00.000Z",
        },
      ],
    });

    const calibration = await learnRecordingIntelligenceCalibration({
      client: client as never,
      actor,
    });

    expect(calibration.version).toBe(8);
  });
});

describe("loadActiveRecordingIntelligenceCalibration", () => {
  it("falls back to the default calibration when none was learned", async () => {
    const { client } = createLearningClient({
      recording_intelligence_calibrations: [],
    });

    const calibration = await loadActiveRecordingIntelligenceCalibration({
      client: client as never,
      organizationId: "org-1",
    });

    expect(calibration).toEqual(defaultRecordingIntelligenceCalibration());
  });

  it("maps a persisted row back into a calibration", async () => {
    const { client } = createLearningClient({
      recording_intelligence_calibrations: [
        {
          id: "calibration-1",
          version: 3,
          source: "learned",
          sample_counts: { streamerCount: 10 },
          upload_rate_bps: 8200,
          go_live_rate_bps: 8800,
          live_test_pass_rate_bps: 7100,
          quality_thresholds: { minEffectiveRatioBps: 7500 },
          script_benchmark: {
            conversionRatioBps: 2100,
            gameExplainRatioBps: 3700,
            interactionRatioBps: 2800,
            source: "org_calibrated",
            sampleSize: 6,
          },
          capability_weights: {
            game_proficiency: 2600,
            script_fluency: 3200,
            interaction_activity: 2100,
            conversion_guidance: 2100,
          },
          bottlenecks: [
            {
              stage: "live_test",
              label: "上播测试",
              actualBps: 4200,
              targetBps: 6000,
              severity: "medium",
              finding: "上播测试转化率 42.0%，低于目标 60.0%（样本 12）。",
              recommendation: "测试前先做模拟评审。",
            },
          ],
          created_at: "2026-07-01T00:00:00.000Z",
        },
      ],
    });

    const calibration = await loadActiveRecordingIntelligenceCalibration({
      client: client as never,
      organizationId: "org-1",
    });

    expect(calibration.version).toBe(3);
    expect(calibration.qualityThresholds.minEffectiveRatioBps).toBe(7500);
    expect(calibration.qualityThresholds.minEffectiveSeconds).toBe(1200);
    expect(calibration.scriptBenchmark.source).toBe("org_calibrated");
    expect(calibration.bottlenecks).toHaveLength(1);
    expect(calibration.capabilityWeights.script_fluency).toBe(3200);
  });
});
