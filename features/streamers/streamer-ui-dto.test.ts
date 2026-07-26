import { describe, expect, it } from "vitest";

import {
  toStreamerCardDto,
  toStreamerDesktopProfileDto,
} from "./streamer-ui-dto";

describe("toStreamerCardDto", () => {
  it("formats streamer rows for the reference UI without exposing settlement margin", () => {
    const dto = toStreamerCardDto({
      id: "s1",
      display_name: "小鹿",
      real_name: "鹿鸣",
      gender: "女",
      source_type: "signed",
      cooperation_status: "active",
      categories: ["二游", "赛事"],
      platforms: ["抖音"],
      styles: ["高能整活"],
      default_settlement_method: "cpt",
      risk_level: "medium",
      clean_report_count: 8,
      created_at: "2026-06-01T00:00:00.000Z",
    });

    expect(dto).toMatchObject({
      id: "s1",
      alias: "小鹿",
      real: "鹿鸣",
      gender: "女",
      source: "签约",
      supplier: "未绑定",
      games: ["二游", "赛事"],
      platforms: ["抖音"],
      style: "高能整活",
      cooperation: "active",
      risk: "medium",
      defaultRule: "CPT",
      createdAtLabel: "2026-06-01",
    });
    expect(dto).not.toHaveProperty("grossMargin");
    expect(dto).not.toHaveProperty("manufacturerReceivable");
  });

  it("derives performance metrics from backend task, report, and project rows", () => {
    const dto = toStreamerCardDto(
      {
        id: "s-live",
        display_name: "Live Streamer",
        real_name: "North",
        gender: "unknown",
        source_type: "external",
        cooperation_status: "active",
        categories: ["MMO"],
        platforms: ["Video"],
        styles: ["Traffic Push"],
        default_settlement_method: "cpt",
        risk_level: "low",
        clean_report_count: 0,
        created_at: "2026-06-01T00:00:00.000Z",
        recording_submissions: [
          { status: "approved", submitted_at: "2026-06-01T08:00:00.000Z" },
          { status: "rejected", submitted_at: "2026-06-02T08:00:00.000Z" },
        ],
        live_tasks: [
          {
            status: "completed",
            planned_duration: 120,
            system_duration: 118,
            planned_start_at: "2026-06-01T10:00:00.000Z",
            project_id: "project-live",
          },
          {
            status: "report_approved",
            planned_duration: 180,
            system_duration: 170,
            planned_start_at: "2026-06-02T10:00:00.000Z",
            project_id: "project-live",
          },
          {
            status: "cancelled",
            planned_duration: 60,
            system_duration: 0,
            planned_start_at: "2026-06-03T10:00:00.000Z",
            project_id: "project-live",
          },
        ],
        live_reports: [
          {
            status: "approved",
            settlement_duration: 120,
            evidence_level: "green",
            viewers: 2400,
            created_at: "2026-06-01T13:00:00.000Z",
            project_id: "project-live",
            projects: { default_hourly_rate: 50 },
          },
          {
            status: "need_more",
            settlement_duration: 60,
            evidence_level: "yellow",
            viewers: 300,
            created_at: "2026-06-02T13:00:00.000Z",
            project_id: "project-live",
            projects: { default_hourly_rate: 50 },
          },
        ],
        project_streamers: [
          {
            status: "joined",
            project_id: "project-live",
            projects: {
              id: "project-live",
              code: "PL",
              name: "Live Project",
              status: "active",
              default_hourly_rate: 50,
            },
          },
        ],
      },
      { now: "2026-06-04T00:00:00.000Z" },
    );

    expect(dto.metrics).toEqual({
      screenPass: 50,
      projectFinish: 100,
      roi: 0.9,
      grossContrib: 150,
      vendorPassRateBps: null,
      rejectionReasonHistogram: {},
      evaluatedCount: 0,
      mcnFirstPassRateBps: null,
      mcnFirstEvaluatedCount: 0,
    });
    expect(dto.matchScore).toBeGreaterThan(70);
    expect(dto.matchTrend).toEqual([
      null,
      null,
      null,
      null,
      null,
      dto.matchScore,
    ]);
    expect(dto.projects).toEqual([
      expect.objectContaining({
        id: "project-live",
        name: "Live Project",
        settlementHours: 3,
        grossContrib: 150,
      }),
    ]);
  });

  it("does not fabricate performance metrics when a streamer has no operating history", () => {
    const dto = toStreamerCardDto({
      id: "s-empty",
      display_name: "Empty Streamer",
      real_name: null,
      gender: null,
      source_type: "external",
      cooperation_status: "not_started",
      categories: [],
      platforms: [],
      styles: [],
      default_settlement_method: "cpt",
      risk_level: "low",
      clean_report_count: 12,
      created_at: "2026-06-01T00:00:00.000Z",
    });

    expect(dto.hasPerformanceData).toBe(false);
    expect(dto.metrics).toEqual({
      screenPass: null,
      projectFinish: null,
      roi: null,
      grossContrib: null,
      vendorPassRateBps: null,
      rejectionReasonHistogram: {},
      evaluatedCount: 0,
      mcnFirstPassRateBps: null,
      mcnFirstEvaluatedCount: 0,
    });
    expect(dto.matchScore).toBeNull();
    expect(dto.matchTrend).toEqual([]);
    expect(dto.projects).toEqual([]);
  });

  it("formats default settlement labels with cpt cps and base salary details", () => {
    expect(
      toStreamerCardDto({
        id: "s-cpt",
        display_name: "CPT Streamer",
        real_name: null,
        gender: null,
        source_type: "external",
        cooperation_status: "active",
        categories: [],
        platforms: [],
        styles: [],
        default_settlement_method: "cpt",
        default_price: 80,
        default_base_salary: 0,
        default_cps_rate_bps: 0,
        risk_level: "low",
        clean_report_count: 0,
        created_at: "2026-06-01T00:00:00.000Z",
      }).defaultRule,
    ).toBe("CPT ¥80/h");

    const cpsDto = toStreamerCardDto({
      id: "s-cps",
      display_name: "CPS Streamer",
      real_name: null,
      gender: null,
      source_type: "external",
      cooperation_status: "active",
      categories: [],
      platforms: [],
      styles: [],
      default_settlement_method: "cps",
      default_price: 0,
      default_base_salary: 0,
      default_cps_rate_bps: 1500,
      risk_level: "low",
      clean_report_count: 0,
      created_at: "2026-06-01T00:00:00.000Z",
    });
    expect(cpsDto.defaultRule).toBe("CPS 15%");
    expect(cpsDto.settlement).toMatchObject({
      method: "cps",
      cptHourlyRate: 0,
      baseSalary: 0,
      cpsRateBps: 1500,
      label: "CPS 15%",
    });
  });

  it("maps the vendor admission aggregate into card metrics without changing units", () => {
    const dto = toStreamerCardDto({
      id: "s-admission",
      display_name: "Admission Streamer",
      real_name: null,
      gender: null,
      source_type: "external",
      cooperation_status: "active",
      categories: [],
      platforms: [],
      styles: [],
      default_settlement_method: "cpt",
      risk_level: "low",
      clean_report_count: 0,
      created_at: "2026-07-26T00:00:00.000Z",
      admission_stats: {
        vendorPassRateBps: 6667,
        rejectionReasonHistogram: {
          compliance: 2,
          audio_quality: 1,
        },
        evaluatedCount: 3,
        mcnFirstPassRateBps: 5000,
        mcnFirstEvaluatedCount: 4,
      },
    });

    expect(dto.hasPerformanceData).toBe(true);
    expect(dto.metrics).toMatchObject({
      vendorPassRateBps: 6667,
      rejectionReasonHistogram: {
        compliance: 2,
        audio_quality: 1,
      },
      evaluatedCount: 3,
      mcnFirstPassRateBps: 5000,
      mcnFirstEvaluatedCount: 4,
    });
  });

  it("does not substitute report approval for a missing recording pass rate", () => {
    const dto = toStreamerCardDto(
      {
        id: "s-report-only",
        display_name: "Report Only",
        real_name: null,
        gender: null,
        source_type: "external",
        cooperation_status: "active",
        categories: [],
        platforms: [],
        styles: [],
        default_settlement_method: "cpt",
        risk_level: "low",
        clean_report_count: 0,
        created_at: "2026-06-01T00:00:00.000Z",
        recording_submissions: [],
        live_tasks: [],
        live_reports: [
          {
            status: "approved",
            settlement_duration: 120,
            evidence_level: "green",
            viewers: 2000,
            created_at: "2026-06-03T00:00:00.000Z",
            project_id: "project-1",
            projects: { default_hourly_rate: 50 },
          },
        ],
      },
      { now: "2026-06-04T00:00:00.000Z" },
    );

    expect(dto.metrics).toMatchObject({
      screenPass: null,
      projectFinish: null,
      roi: 1,
      grossContrib: 100,
    });
    expect(dto.matchScore).toBe(16);
    expect(dto.matchTrend).toEqual([null, null, null, null, null, 16]);
  });

  it("scores task-only history from the observed completion dimension", () => {
    const dto = toStreamerCardDto(
      {
        id: "s-task-only",
        display_name: "Task Only",
        real_name: null,
        gender: null,
        source_type: "external",
        cooperation_status: "active",
        categories: [],
        platforms: [],
        styles: [],
        default_settlement_method: "cpt",
        risk_level: "low",
        clean_report_count: 0,
        created_at: "2026-06-01T00:00:00.000Z",
        recording_submissions: [],
        live_tasks: [
          {
            status: "completed",
            planned_duration: 120,
            system_duration: 120,
            planned_start_at: "2026-06-03T00:00:00.000Z",
            project_id: "project-1",
          },
        ],
        live_reports: [],
      },
      { now: "2026-06-04T00:00:00.000Z" },
    );

    expect(dto.metrics).toMatchObject({
      screenPass: null,
      projectFinish: 100,
      roi: null,
      grossContrib: null,
    });
    expect(dto.matchScore).toBe(45);
    expect(dto.matchTrend).toEqual([null, null, null, null, null, 45]);
  });

  it("keeps match score unavailable when raw history has no observable score dimension", () => {
    const dto = toStreamerCardDto(
      {
        id: "s-unscored-report",
        display_name: "Unscored Report",
        real_name: null,
        gender: null,
        source_type: "external",
        cooperation_status: "active",
        categories: [],
        platforms: [],
        styles: [],
        default_settlement_method: "cpt",
        risk_level: "low",
        clean_report_count: 0,
        created_at: "2026-06-01T00:00:00.000Z",
        recording_submissions: [],
        live_tasks: [],
        live_reports: [
          {
            status: "approved",
            settlement_duration: 0,
            evidence_level: "green",
            viewers: 0,
            created_at: "2026-06-03T00:00:00.000Z",
            project_id: "project-1",
            projects: { default_hourly_rate: 50 },
          },
        ],
      },
      { now: "2026-06-04T00:00:00.000Z" },
    );

    expect(dto.hasPerformanceData).toBe(true);
    expect(dto.metrics).toMatchObject({
      screenPass: null,
      projectFinish: null,
      roi: null,
      grossContrib: 0,
    });
    expect(dto.matchScore).toBeNull();
    expect(dto.matchTrend).toEqual([null, null, null, null, null, null]);
  });

  it("keeps zero-viewer ROI as an observed zero when duration is complete", () => {
    const dto = toStreamerCardDto(
      reportMetricRow({
        settlement_duration: 120,
        viewers: 0,
        projects: { default_hourly_rate: 50 },
      }),
      { now: "2026-06-04T00:00:00.000Z" },
    );

    expect(dto.metrics).toMatchObject({ roi: 0, grossContrib: 100 });
    expect(dto.matchScore).toBe(3);
    expect(dto.projects[0]).toMatchObject({
      settlementHours: 2,
      grossContrib: 100,
    });
  });

  it("keeps ROI unavailable when viewers are missing", () => {
    const dto = toStreamerCardDto(
      reportMetricRow({
        settlement_duration: 120,
        viewers: null,
        projects: { default_hourly_rate: 50 },
      }),
      { now: "2026-06-04T00:00:00.000Z" },
    );

    expect(dto.metrics).toMatchObject({ roi: null, grossContrib: 100 });
    expect(dto.matchScore).toBeNull();
    expect(dto.projects[0]).toMatchObject({
      settlementHours: 2,
      grossContrib: 100,
    });
  });

  it("keeps ROI, duration, and contribution unavailable when duration is missing", () => {
    const dto = toStreamerCardDto(
      reportMetricRow({
        settlement_duration: null,
        viewers: 1000,
        projects: { default_hourly_rate: 50 },
      }),
      { now: "2026-06-04T00:00:00.000Z" },
    );

    expect(dto.metrics).toMatchObject({ roi: null, grossContrib: null });
    expect(dto.projects[0]).toMatchObject({
      settlementHours: null,
      grossContrib: null,
    });
  });

  it("keeps contribution unavailable when the hourly rate is missing", () => {
    const dto = toStreamerCardDto(
      reportMetricRow({
        settlement_duration: 120,
        viewers: 1000,
        projects: { default_hourly_rate: null },
      }),
      { now: "2026-06-04T00:00:00.000Z" },
    );

    expect(dto.metrics).toMatchObject({ roi: 0.5, grossContrib: null });
    expect(dto.projects[0]).toMatchObject({
      settlementHours: 2,
      grossContrib: null,
    });
  });
});

function reportMetricRow(
  report: Pick<
    NonNullable<
      Parameters<typeof toStreamerCardDto>[0]["live_reports"]
    >[number],
    "settlement_duration" | "viewers" | "projects"
  >,
): Parameters<typeof toStreamerCardDto>[0] {
  return {
    id: "s-report-metric",
    display_name: "Report Metric",
    real_name: null,
    gender: null,
    source_type: "external",
    cooperation_status: "active",
    categories: [],
    platforms: [],
    styles: [],
    default_settlement_method: "cpt",
    risk_level: "low",
    clean_report_count: 0,
    created_at: "2026-06-01T00:00:00.000Z",
    recording_submissions: [],
    live_tasks: [],
    live_reports: [
      {
        status: "approved",
        evidence_level: "green",
        created_at: "2026-06-03T00:00:00.000Z",
        project_id: "project-1",
        ...report,
      },
    ],
    project_streamers: [
      {
        status: "joined",
        project_id: "project-1",
        projects: {
          id: "project-1",
          code: "P1",
          name: "Project 1",
          status: "active",
          default_hourly_rate:
            Array.isArray(report.projects) || !report.projects
              ? null
              : report.projects.default_hourly_rate,
        },
      },
    ],
  };
}

describe("toStreamerDesktopProfileDto", () => {
  it("derives the streamer desktop profile from business rows", () => {
    const dto = toStreamerDesktopProfileDto(
      {
        id: "streamer-profile-1",
        display_name: "Profile Streamer",
        real_name: "Real Name",
        gender: "female",
        source_type: "signed",
        cooperation_status: "active",
        categories: ["RPG", "Strategy"],
        platforms: ["TikTok"],
        styles: ["High energy"],
        skills: ["Boss rush"],
        availability: { slots: ["Weekdays 19-24"] },
        equipment: { devices: ["4K camera"] },
        default_settlement_method: "base_salary_cpt",
        default_price: 80,
        default_base_salary: 6000,
        default_cps_rate_bps: 1500,
        risk_level: "low",
        clean_report_count: 2,
        created_at: "2026-06-01T00:00:00.000Z",
        streamer_accounts: [
          {
            id: "account-1",
            platform: "TikTok",
            account_handle: "@profile",
            follower_count: 12345,
            is_primary: true,
            verified_at: "2026-06-02T00:00:00.000Z",
          },
        ],
        recording_submissions: [
          { status: "approved", submitted_at: "2026-06-01T08:00:00.000Z" },
          {
            status: "pending_review",
            submitted_at: "2026-06-02T08:00:00.000Z",
          },
        ],
        live_reports: [
          {
            status: "approved",
            settlement_duration: 120,
            evidence_level: "green",
            viewers: 3000,
            created_at: "2026-06-01T12:00:00.000Z",
            project_id: "project-a",
          },
          {
            status: "approved",
            settlement_duration: 90,
            evidence_level: "green",
            viewers: 2000,
            created_at: "2026-06-02T12:00:00.000Z",
            project_id: "project-b",
          },
        ],
        project_streamers: [
          {
            status: "joined",
            project_id: "project-a",
            projects: {
              id: "project-a",
              code: "PA",
              name: "Project A",
              status: "active",
              default_hourly_rate: 80,
            },
          },
          {
            status: "joined",
            project_id: "project-b",
            projects: {
              id: "project-b",
              code: "PB",
              name: "Project B",
              status: "active",
              default_hourly_rate: 80,
            },
          },
        ],
        streamer_profile_insights: [
          {
            id: "insight-new",
            title: "录屏 AI 观察 · 开场强",
            summary: "前三十秒能快速抛出福利点并带动评论区回应。",
            strengths: ["开场钩子强", "评论区承接快"],
            risks: ["口播节奏略快"],
            recommendations: ["下次复盘重点观察福利点承接"],
            tags: ["recording_ai", "互动"],
            source_ref: "recording_ai_analyses:analysis-new",
            confirmed_at: "2026-06-03T12:00:00.000Z",
          },
          {
            id: "insight-old",
            title: "录屏 AI 观察 · 旧洞察",
            summary: "旧录屏观察。",
            strengths: [],
            risks: [],
            recommendations: [],
            tags: [],
            source_ref: "recording_ai_analyses:analysis-old",
            confirmed_at: "2026-06-01T12:00:00.000Z",
          },
        ],
      },
      { organizationName: "Org One" },
    );

    expect(dto).toMatchObject({
      id: "streamer-profile-1",
      alias: "Profile Streamer",
      real: "Real Name",
      gender: "female",
      org: "Org One",
      signedAt: "2026-06-01",
      stats: {
        projectCount: 2,
        recordingCount: 2,
        totalLiveHours: 3.5,
      },
    });
    expect(dto.platforms).toEqual([
      expect.objectContaining({
        id: "account-1",
        platform: "TikTok",
        account: "@profile",
        followers: 12345,
        primary: true,
        verified: true,
      }),
    ]);
    expect(dto.tags).toMatchObject({
      categories: ["RPG", "Strategy"],
      styles: ["High energy"],
      skills: ["Boss rush"],
      availability: ["Weekdays 19-24"],
      equipment: ["4K camera"],
    });
    expect(dto.settlement.rule).toContain("6000");
    expect(dto.settlement.rule).toContain("80");
    expect(dto.settlement.baseSalary).toContain("6000");
    expect(dto.settlement.cpt).toContain("80");
    expect(dto.settlement.cpsShare).toContain("15%");
    expect(dto.aiInsights[0]).toMatchObject({
      id: "insight-new",
      title: "录屏 AI 观察 · 开场强",
      summary: "前三十秒能快速抛出福利点并带动评论区回应。",
      strengths: ["开场钩子强", "评论区承接快"],
      risks: ["口播节奏略快"],
      recommendations: ["下次复盘重点观察福利点承接"],
      sourceRef: "recording_ai_analyses:analysis-new",
      confirmedAtLabel: "2026-06-03",
    });
  });

  it("maps not_started cooperation status to a user-facing profile label", () => {
    const dto = toStreamerDesktopProfileDto({
      id: "streamer-profile-2",
      display_name: "Profile Streamer",
      real_name: null,
      gender: null,
      source_type: "external",
      cooperation_status: "not_started",
      categories: [],
      platforms: [],
      styles: [],
      default_settlement_method: "cpt",
      risk_level: "low",
      clean_report_count: 0,
      created_at: "2026-06-01T00:00:00.000Z",
    });

    expect(dto.level).toBe("\u5f85\u914d\u7f6e");
  });
});
