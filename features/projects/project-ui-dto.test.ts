import { describe, expect, it } from "vitest";

import {
  toCollaborationApplicationProjectCardDto,
  toCollaborationProjectCardDto,
  toProjectCardDto,
} from "./project-ui-dto";

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
      default_hourly_rate: 45,
      default_settlement_method: "cpt",
      vendor_name: "厂商 A",
      product_name: "产品 A",
      agent_name: "代理商 A",
      supplier_name: "供应商 A",
      description: "真实项目说明",
      is_public_to_streamers: true,
      public_summary: "Streamer card summary",
      game_download_url: "https://download.example.com/game",
      is_open_to_mcn_collaboration: true,
      mcn_collaboration_summary: "Partner MCNs can contribute.",
      mcn_collaboration_terms: { revenueShareHint: "8-12%" },
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
      isOpenToMcnCollaboration: true,
      mcnCollaborationSummary: "Partner MCNs can contribute.",
      mcnCollaborationTerms: { revenueShareHint: "8-12%" },
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

  it("marks a project with settlement batches as settling for the ops list", () => {
    const dto = toProjectCardDto(
      baseProjectRow({
        status: "recruiting",
        settlement_batches: [{ id: "batch-1", status: "generated" }],
      }),
    );

    expect(dto).toMatchObject({
      status: "settling",
      statusLabel: "\u7ed3\u7b97\u4e2d",
    });
  });

  it("renders an 80-yuan database hourly rate without a cent conversion", () => {
    expect(
      toProjectCardDto(baseProjectRow({ default_hourly_rate: 80 }))
        .hourlyRateLabel,
    ).toBe("80.00 元/小时");
  });

  it("marks an approved unbatched settlement-pool report as settling", () => {
    const dto = toProjectCardDto(
      baseProjectRow({
        status: "active",
        live_reports: [
          {
            id: "report-1",
            status: "approved",
            enter_settlement_pool: true,
            settled_batch_item_id: null,
          },
        ],
      }),
    );

    expect(dto).toMatchObject({
      status: "settling",
      statusLabel: "\u7ed3\u7b97\u4e2d",
    });
  });

  it("labels current database project statuses and leaves removed statuses as raw fallbacks", () => {
    expect(
      toProjectCardDto(baseProjectRow({ status: "pending_start" })),
    ).toMatchObject({
      status: "pending_start",
      statusLabel: "待开始",
    });
    expect(
      toProjectCardDto(baseProjectRow({ status: "archived" })),
    ).toMatchObject({
      status: "archived",
      statusLabel: "已归档",
    });
    expect(
      toProjectCardDto(baseProjectRow({ status: "closed" })),
    ).toMatchObject({
      status: "closed",
      statusLabel: "closed",
    });
  });

  it("maps partner collaboration projects with collaboration attribution", () => {
    const dto = toCollaborationProjectCardDto({
      agreement: {
        id: "agreement-1",
        status: "active",
        revenueShareBps: 900,
        settlementBasis: "project_revenue",
      },
      project: {
        id: "project-1",
        name: "Owner project",
        code: "COLLAB",
        ownerOrganizationName: "Owner Org",
        collaborationSummary: "Partner MCNs can contribute.",
      },
    });

    expect(dto).toMatchObject({
      id: "project-1",
      collaborationRole: "partner",
      collaborationAgreementId: "agreement-1",
      collaborationId: "agreement-1",
    });
  });

  it("maps partner collaboration applications waiting for confirmation", () => {
    const dto = toCollaborationApplicationProjectCardDto({
      application: {
        id: "application-1",
        status: "owner_countered",
        requestedRevenueShareBps: 1200,
        ownerCounterRevenueShareBps: 900,
      },
      project: {
        id: "project-1",
        name: "Owner project",
        code: "COLLAB",
        ownerOrganizationName: "Owner Org",
        collaborationSummary: "Partner MCNs can contribute.",
      },
    });

    expect(dto).toMatchObject({
      id: "project-1",
      collaborationRole: "partner",
      collaborationApplicationId: "application-1",
      collaborationApplicationStatus: "owner_countered",
      ownerCounterRevenueShareBps: 900,
    });
  });
});

function baseProjectRow(overrides = {}) {
  return {
    id: "p1",
    code: "P2412",
    name: "Project A",
    status: "recruiting",
    sensitivity: "normal",
    starts_at: "2026-06-03",
    ends_at: "2026-06-20",
    open_signup: false,
    allow_direct_invite: false,
    force_recording: false,
    force_system_timing: true,
    default_hourly_rate: 45,
    default_settlement_method: "cpt",
    vendor_name: "Vendor A",
    product_name: "Product A",
    agent_name: "Agent A",
    supplier_name: "Supplier A",
    description: "Project description",
    is_public_to_streamers: true,
    public_summary: "Streamer card summary",
    game_download_url: "https://download.example.com/game",
    is_open_to_mcn_collaboration: false,
    mcn_collaboration_summary: "",
    mcn_collaboration_terms: {},
    created_by: "user-creator",
    owner_id: null,
    owner: null,
    creator: { full_name: "Creator" },
    published_at: "2026-06-01T10:00:00.000Z",
    created_at: "2026-06-01T09:00:00.000Z",
    ...overrides,
  };
}
