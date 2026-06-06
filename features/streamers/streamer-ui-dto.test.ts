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
            projects: { default_hourly_rate: 5000 },
          },
          {
            status: "need_more",
            settlement_duration: 60,
            evidence_level: "yellow",
            viewers: 300,
            created_at: "2026-06-02T13:00:00.000Z",
            project_id: "project-live",
            projects: { default_hourly_rate: 5000 },
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
              default_hourly_rate: 5000,
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
    });
    expect(dto.matchScore).toBeGreaterThan(70);
    expect(dto.matchTrend).toHaveLength(6);
    expect(dto.matchTrend.at(-1)).toBe(dto.matchScore);
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
      screenPass: 0,
      projectFinish: 0,
      roi: 0,
      grossContrib: 0,
    });
    expect(dto.matchScore).toBe(0);
    expect(dto.matchTrend).toEqual([]);
    expect(dto.projects).toEqual([]);
  });
});

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
              default_hourly_rate: 8000,
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
              default_hourly_rate: 8000,
            },
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
  });
});
