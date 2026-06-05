import { describe, expect, it } from "vitest";

import { toProjectCardDto } from "./project-ui-dto";

describe("toProjectCardDto", () => {
  it("formats project list rows for the reference UI without exposing unsafe money math", () => {
    const dto = toProjectCardDto({
      id: "p1",
      code: "P2412",
      name: "鸣潮暑期招募",
      status: "recruiting",
      sensitivity: "normal",
      starts_at: "2026-06-03",
      ends_at: "2026-06-20",
      open_signup: false,
      allow_direct_invite: false,
      force_recording: false,
      force_system_timing: true,
      default_hourly_rate: 4500,
      default_settlement_method: "cpt",
      vendor_name: "厂商 A",
      product_name: "产品 A",
      agent_name: "代理商 A",
      supplier_name: "供应商 A",
      description: "真实项目说明",
      is_public_to_streamers: true,
      public_summary: "Streamer card summary",
      game_download_url: "https://download.example.com/game",
      created_by: "user-creator",
      owner_id: null,
      owner: null,
      creator: { full_name: "创建项目人" },
      published_at: "2026-06-01T10:00:00.000Z",
      created_at: "2026-06-01T09:00:00.000Z",
    });

    expect(dto).toMatchObject({
      id: "p1",
      code: "P2412",
      name: "鸣潮暑期招募",
      vendor: "厂商 A",
      product: "产品 A",
      agent: "代理商 A",
      supplier: "供应商 A",
      description: "真实项目说明",
      isPublicToStreamers: true,
      publicSummary: "Streamer card summary",
      gameDownloadUrl: "https://download.example.com/game",
      status: "recruiting",
      statusLabel: "招募中",
      hourlyRateLabel: "45.00 元/小时",
      timingLabel: "系统计时",
      publishedAtLabel: "2026-06-01",
      pricing: "CPT",
      leadOps: "创建项目人",
      ownerId: "user-creator",
      start: "2026-06-03",
      end: "2026-06-20",
      openSignup: false,
      allowDirectInvite: false,
      needScreening: false,
      needStartStop: true,
      streamers: { active: 0, candidate: 0, pendingReview: 0 },
      metrics: {
        plannedHours: 0,
        doneHours: 0,
        audience: 0,
        reportedPending: 0,
        anomalies: 0,
        receivable: 0,
        payable: 0,
        gross: 0,
        margin: 0,
      },
      risk: "low",
    });
    expect(dto).not.toHaveProperty("manufacturerReceivable");
  });
});
