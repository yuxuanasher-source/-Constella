import { describe, expect, it, vi } from "vitest";

import {
  getRecordingIntelligenceReport,
  recordingIntelligenceReviewBoundary,
  runRecordingIntelligence,
} from "./recording-intelligence";

type TableRows = Record<string, Array<Record<string, unknown>>>;

function createIntelligenceClient({
  asset,
  rows = {},
}: {
  asset?: Record<string, unknown> | null;
  rows?: TableRows;
}) {
  const inserts: Record<string, Array<Record<string, unknown>>> = {};

  const recordInsert = (table: string, payload: unknown) => {
    const items = Array.isArray(payload)
      ? (payload as Array<Record<string, unknown>>)
      : [payload as Record<string, unknown>];
    inserts[table] = [...(inserts[table] ?? []), ...items];
  };

  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    self.eq = vi.fn(() => self);
    self.gte = vi.fn(() => self);
    self.order = vi.fn(() => self);
    self.limit = vi.fn(async () => ({
      data: rows[table] ?? [],
      error: null,
    }));
    self.maybeSingle = vi.fn(async () => ({
      data: asset ?? null,
      error: null,
    }));
    return self;
  };

  const client = {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => chain(table)),
      insert: vi.fn(async (payload: unknown) => {
        recordInsert(table, payload);
        return { error: null };
      }),
    })),
  };

  return { client, inserts };
}

const actor = {
  userId: "user-ops",
  name: "Ops Manager",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

const assetRow = {
  id: "asset-1",
  organization_id: "org-1",
  streamer_id: "streamer-1",
  project_id: "project-1",
  title: "周五晚黄金档",
  duration_seconds: 3600,
  review_status: "reviewing",
};

function transcriptFixture() {
  return [
    { atSeconds: 30, text: "欢迎宝子们进直播间" },
    { atSeconds: 90, text: "点关注领新人福利" },
    { atSeconds: 150, text: "这个技能循环先讲一遍" },
    { atSeconds: 600, text: "想上分的去外围找我" },
    { atSeconds: 1200, text: "弹幕扣个 1" },
  ];
}

describe("runRecordingIntelligence", () => {
  it("runs all four engines, persists results and notifies high-risk alerts", async () => {
    const { client, inserts } = createIntelligenceClient({
      asset: assetRow,
      rows: {
        recording_assets: [{ id: "upload-1" }, { id: "upload-2" }],
        live_tasks: [
          { id: "task-1", system_duration: 3600 },
          { id: "task-2", system_duration: 0 },
        ],
        recording_submissions: [
          { id: "sub-1", status: "approved" },
          { id: "sub-2", status: "rejected" },
        ],
        recording_intelligence_calibrations: [],
        notifications: [],
      },
    });

    const report = await runRecordingIntelligence({
      client: client as never,
      actor,
      assetId: "asset-1",
      input: { transcript: transcriptFixture() },
      now: () => new Date("2026-07-03T12:00:00.000Z"),
    });

    // 高危敏感词 => 合规判定为违规，且发出一条高风险通知。
    expect(report.riskAlerts).toEqual([
      expect.objectContaining({
        category: "sensitive_word",
        severity: "high",
        term: "外围",
      }),
    ]);
    expect(report.quality.complianceVerdict).toBe("violation");
    expect(report.alertNotificationsSent).toBe(1);
    expect(report.reviewBoundary).toBe(recordingIntelligenceReviewBoundary);
    expect(report.calibrationVersion).toBe(0);

    // 能力报告使用了主播 90 天履约历史（2 上传、1/2 开播、1/2 测试通过）。
    expect(report.capability?.historyStats).toEqual({
      uploadCount: 2,
      goLiveRateBps: 5000,
      liveTestPassRateBps: 5000,
    });
    expect(report.capability?.dimensions).toHaveLength(4);

    expect(inserts.recording_quality_metrics).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        asset_id: "asset-1",
        signal_source: "derived",
        compliance_verdict: "violation",
      }),
    ]);
    expect(inserts.recording_script_insights).toEqual([
      expect.objectContaining({
        total_lines: 5,
        transcript_source: "uploaded",
      }),
    ]);
    expect(inserts.recording_risk_alerts).toEqual([
      expect.objectContaining({ term: "外围", severity: "high" }),
    ]);
    expect(inserts.streamer_capability_reports).toEqual([
      expect.objectContaining({ streamer_id: "streamer-1" }),
    ]);
    expect(inserts.notifications).toEqual([
      expect.objectContaining({
        notification_type: "high_risk",
        is_high_risk: true,
        object_id: "asset-1",
      }),
    ]);
    expect(inserts.ai_invocations).toEqual([
      expect.objectContaining({
        scene: "recording.intelligence_report",
        object_id: "asset-1",
        provider_name: "deterministic",
      }),
    ]);
  });

  it("uses uploaded frame signals when provided", async () => {
    const { client, inserts } = createIntelligenceClient({
      asset: assetRow,
      rows: {},
    });

    const report = await runRecordingIntelligence({
      client: client as never,
      actor,
      assetId: "asset-1",
      input: {
        signals: {
          durationSeconds: 3600,
          sampleIntervalSeconds: 60,
          frames: Array.from({ length: 60 }, (_, index) => ({
            atSeconds: index * 60,
            isGameScreen: true,
            isFaceVisible: true,
            isIdle: index >= 48, // 结尾 12 分钟挂机
          })),
          source: "uploaded",
        },
      },
    });

    expect(report.quality.signalSource).toBe("uploaded");
    expect(report.quality.idleSeconds).toBe(720);
    expect(report.quality.effectivenessVerdict).toBe("below_standard");
    expect(inserts.recording_quality_metrics?.[0]).toMatchObject({
      signal_source: "uploaded",
      idle_seconds: 720,
    });
  });

  it("skips the capability report for assets without a streamer", async () => {
    const { client, inserts } = createIntelligenceClient({
      asset: { ...assetRow, streamer_id: null },
      rows: {},
    });

    const report = await runRecordingIntelligence({
      client: client as never,
      actor,
      assetId: "asset-1",
    });

    expect(report.capability).toBeNull();
    expect(inserts.streamer_capability_reports).toBeUndefined();
  });

  it("rejects assets from another organization", async () => {
    const { client } = createIntelligenceClient({
      asset: { ...assetRow, organization_id: "org-2" },
    });

    await expect(
      runRecordingIntelligence({
        client: client as never,
        actor,
        assetId: "asset-1",
      }),
    ).rejects.toThrow("outside current organization");
  });

  it("rejects roles without run permission", async () => {
    const { client } = createIntelligenceClient({ asset: assetRow });

    await expect(
      runRecordingIntelligence({
        client: client as never,
        actor: { ...actor, role: "streamer" },
        assetId: "asset-1",
      }),
    ).rejects.toThrow("Only MCN staff");
  });

  it("throws when the asset does not exist", async () => {
    const { client } = createIntelligenceClient({ asset: null });

    await expect(
      runRecordingIntelligence({
        client: client as never,
        actor,
        assetId: "asset-missing",
      }),
    ).rejects.toThrow("Recording asset not found");
  });
});

describe("getRecordingIntelligenceReport", () => {
  it("assembles the latest snapshot from persisted rows", async () => {
    const { client } = createIntelligenceClient({
      rows: {
        recording_quality_metrics: [
          {
            duration_seconds: 3600,
            effective_seconds: 3300,
            idle_seconds: 300,
            game_screen_ratio_bps: 8800,
            face_visible_ratio_bps: 7000,
            effective_ratio_bps: 9100,
            effectiveness_verdict: "effective",
            compliance_verdict: "pass",
            findings: ["有效时长、画面占比与露脸占比均达标。"],
            signal_source: "uploaded",
            calibration_version: 2,
            created_at: "2026-07-03T12:00:00.000Z",
          },
        ],
        recording_script_insights: [
          {
            total_lines: 40,
            category_stats: [{ category: "conversion", ratioBps: 2000 }],
            benchmark: { source: "org_calibrated" },
            benchmark_gaps: [],
            suggestions: [],
            transcript_source: "uploaded",
            calibration_version: 2,
            created_at: "2026-07-03T12:00:00.000Z",
          },
        ],
        recording_risk_alerts: [
          {
            id: "alert-1",
            category: "sensitive_word",
            severity: "high",
            term: "外围",
            at_seconds: 600,
            message: "话术命中敏感词「外围」，请复核该时间点上下文。",
            evidence: { matchedTerm: "外围" },
            status: "open",
            created_at: "2026-07-03T12:00:00.000Z",
          },
        ],
        streamer_capability_reports: [
          {
            streamer_id: "streamer-1",
            dimensions: [{ key: "game_proficiency", score: 88 }],
            overall_score: 84,
            grade: "A",
            growth_advice: ["保持"],
            history_stats: { uploadCount: 4 },
            calibration_version: 2,
            created_at: "2026-07-03T12:00:00.000Z",
          },
        ],
      },
    });

    const snapshot = await getRecordingIntelligenceReport({
      client: client as never,
      actor,
      assetId: "asset-1",
    });

    expect(snapshot.quality).toMatchObject({
      effectiveSeconds: 3300,
      effectivenessVerdict: "effective",
      calibrationVersion: 2,
    });
    expect(snapshot.script).toMatchObject({
      totalLines: 40,
      transcriptSource: "uploaded",
    });
    expect(snapshot.riskAlerts).toEqual([
      expect.objectContaining({ id: "alert-1", atSeconds: 600 }),
    ]);
    expect(snapshot.capability).toMatchObject({
      streamerId: "streamer-1",
      grade: "A",
      overallScore: 84,
    });
    expect(snapshot.reviewBoundary).toBe(recordingIntelligenceReviewBoundary);
  });

  it("returns an empty snapshot when nothing was analyzed yet", async () => {
    const { client } = createIntelligenceClient({ rows: {} });

    const snapshot = await getRecordingIntelligenceReport({
      client: client as never,
      actor,
      assetId: "asset-1",
    });

    expect(snapshot).toEqual({
      assetId: "asset-1",
      quality: null,
      script: null,
      riskAlerts: [],
      capability: null,
      reviewBoundary: recordingIntelligenceReviewBoundary,
    });
  });
});
