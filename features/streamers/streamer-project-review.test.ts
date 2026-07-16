import { describe, expect, it } from "vitest";

import { buildStreamerProjectReviewProfile } from "./streamer-project-review";

describe("buildStreamerProjectReviewProfile", () => {
  it("builds a schedule-driven streamer project review profile", () => {
    const profile = buildStreamerProjectReviewProfile({
      streamer: { id: "streamer-1", displayName: "阿星" },
      project: { id: "project-1", name: "传奇复古", productType: "legend" },
      tasks: [
        {
          id: "task-1",
          plannedStartAt: "2026-07-01T10:00:00.000Z",
          plannedEndAt: "2026-07-01T12:00:00.000Z",
          status: "completed",
          systemDuration: 120,
        },
        {
          id: "task-2",
          plannedStartAt: "2026-07-03T10:00:00.000Z",
          plannedEndAt: "2026-07-03T12:00:00.000Z",
          status: "completed",
          systemDuration: 110,
        },
        {
          id: "task-3",
          plannedStartAt: "2026-07-05T10:00:00.000Z",
          plannedEndAt: "2026-07-05T12:00:00.000Z",
          status: "cancelled",
          systemDuration: 0,
        },
      ],
      reports: [
        {
          id: "report-1",
          taskId: "task-1",
          status: "approved",
          settlementDuration: 120,
          viewers: 2400,
          pcu: 320,
          acu: 90,
          evidenceLevel: "green",
          riskFlags: [],
        },
        {
          id: "report-2",
          taskId: "task-2",
          status: "pending_review",
          settlementDuration: 110,
          viewers: 1800,
          pcu: 260,
          acu: 70,
          evidenceLevel: "yellow",
          riskFlags: ["duration_divergence"],
        },
      ],
      recordings: [
        {
          id: "rec-1",
          status: "approved",
          adopted: true,
          rejectionReasons: [],
          durationSeconds: 1800,
        },
        {
          id: "rec-2",
          status: "rejected",
          adopted: false,
          rejectionReasons: ["画面不清", "讲解节奏差"],
          durationSeconds: 900,
        },
      ],
      externalReferences: [
        {
          id: "market-legend-1",
          title: "传奇复古类直播间强调长线留存和节奏稳定",
          sourceName: "行业观察",
          sourceUrl: "https://example.com/legend-live",
          retrievedAt: "2026-07-16T10:00:00.000Z",
          summary: "同类产品通常关注平均在线、讲解节奏和录屏可复用性。",
          productType: "legend",
        },
      ],
    });

    expect(profile.participation.naturalDays).toBe(5);
    expect(profile.participation.effectiveLiveDays).toBe(2);
    expect(profile.participation.scheduleCompletionRateBps).toBe(6667);
    expect(profile.liveMetrics.totalViewers).toBe(4200);
    expect(profile.liveMetrics.averagePcu).toBe(290);
    expect(profile.liveMetrics.averageAcu).toBe(80);
    expect(profile.recordings.adoptionRateBps).toBe(5000);
    expect(profile.recordings.topRejectionReasons[0]).toEqual({
      reason: "画面不清",
      count: 1,
    });
    expect(profile.reviewDraft).toMatchObject({
      summary: "阿星在传奇复古项目已形成 2 个有效直播日，排班完成率 66.67%，录屏采用率 50.00%。",
      participation: expect.stringContaining("自然参与 5 天"),
      livePerformance: expect.stringContaining("累计场观 4200"),
      recordingPerformance: expect.stringContaining("主要驳回原因：画面不清、讲解节奏差"),
      productFit: expect.stringContaining("legend"),
      externalReference: {
        status: "provided",
        summary: "已接入 1 条外部参考，仅作为同类产品/同行表现参照。",
        references: [
          {
            id: "market-legend-1",
            title: "传奇复古类直播间强调长线留存和节奏稳定",
            sourceName: "行业观察",
            sourceUrl: "https://example.com/legend-live",
            retrievedAt: "2026-07-16T10:00:00.000Z",
          },
        ],
      },
      majorIssues: [
        expect.objectContaining({
          title: "录屏质量需要复盘",
          sourceIds: ["rec-2"],
        }),
      ],
      opportunities: expect.arrayContaining([
        expect.objectContaining({
          title: "围绕主要驳回原因优化录屏脚本和画面检查",
        }),
      ]),
      actionItems: expect.arrayContaining([
        expect.objectContaining({
          requiresHumanApproval: true,
        }),
      ]),
      dataGaps: [],
    });
    expect(profile.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTool: "streamer_project_profile",
          sourceId: "task-1",
        }),
      ]),
    );
    expect(profile.facts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "market-legend-1",
        }),
      ]),
    );
  });

  it("returns explicit caveats when schedule, report, or recording data is missing", () => {
    const profile = buildStreamerProjectReviewProfile({
      streamer: { id: "streamer-1", displayName: "阿星" },
      project: { id: "project-1", name: "传奇复古", productType: "legend" },
      tasks: [],
      reports: [],
      recordings: [],
    });

    expect(profile.participation.naturalDays).toBe(0);
    expect(profile.participation.effectiveLiveDays).toBe(0);
    expect(profile.reviewDraft.dataGaps).toEqual(
      expect.arrayContaining([
        "缺少该主播在此项目的排班记录。",
        "缺少该主播在此项目的报数记录。",
        "缺少该主播在此项目的录屏记录。",
      ]),
    );
    expect(profile.caveats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ summary: "缺少该主播在此项目的排班记录。" }),
        expect.objectContaining({ summary: "缺少该主播在此项目的报数记录。" }),
        expect.objectContaining({ summary: "缺少该主播在此项目的录屏记录。" }),
      ]),
    );
  });
});
