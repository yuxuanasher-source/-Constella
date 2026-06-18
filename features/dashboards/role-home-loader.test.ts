import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listOpsLiveReportQueue,
  listOpsLiveTaskQueue,
} from "@/features/live-operations/live-operations-queries";
import { listNotificationCenterItems } from "@/features/notifications/notification-center-queries";
import {
  listProjects,
  type ProjectListItem,
} from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
import {
  listOpsSettlementBatches,
  listOpsSettlementPool,
} from "@/features/settlements/settlement-queries";

import { buildRoleHomeDashboard } from "./role-home";
import { loadRoleHomeDashboard } from "./role-home-loader";

vi.mock("@/features/projects/project-queries", () => ({
  listProjects: vi.fn(),
}));

vi.mock("@/features/live-operations/live-operations-queries", () => ({
  listOpsLiveTaskQueue: vi.fn(),
  listOpsLiveReportQueue: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-queries", () => ({
  listOpsSettlementPool: vi.fn(),
  listOpsSettlementBatches: vi.fn(),
}));

vi.mock("@/features/notifications/notification-center-queries", () => ({
  listNotificationCenterItems: vi.fn(),
}));

vi.mock("./role-home", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./role-home")>();

  return {
    ...actual,
    buildRoleHomeDashboard: vi.fn(actual.buildRoleHomeDashboard),
  };
});

describe("loadRoleHomeDashboard", () => {
  const supabase = {};
  const auth = {
    userId: "user-1",
    email: "owner@example.test",
    name: "Owner",
    organizationId: "org-1",
    organizationName: "Org",
    role: "owner" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(listOpsLiveTaskQueue).mockResolvedValue([]);
    vi.mocked(listOpsLiveReportQueue).mockResolvedValue([]);
    vi.mocked(listOpsSettlementPool).mockResolvedValue([]);
    vi.mocked(listOpsSettlementBatches).mockResolvedValue([]);
    vi.mocked(listNotificationCenterItems).mockResolvedValue([]);
  });

  it("loads dashboard source data scoped to the authenticated organization", async () => {
    const projectRows = [projectRow({ id: "project-1", name: "Alpha" })];
    vi.mocked(listProjects).mockResolvedValue(projectRows as never);

    const dashboard = await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth,
      now: "2026-06-16T09:30:00.000Z",
    });

    expect(dashboard.profile.role).toBe("owner");
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "activeProjects", value: 1 }),
      ]),
    );
    expect(dashboard.queue[0]).toMatchObject({ title: "Alpha" });
    expect(listProjects).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
    });
    expect(listOpsLiveTaskQueue).toHaveBeenCalledWith(supabase, "org-1");
    expect(listOpsLiveReportQueue).toHaveBeenCalledWith(supabase, "org-1");
    expect(listOpsSettlementPool).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
      projectId: null,
      batchType: "payable",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    expect(listOpsSettlementBatches).toHaveBeenCalledWith(supabase, "org-1");
    expect(listNotificationCenterItems).toHaveBeenCalledWith(
      supabase,
      {
        userId: "user-1",
        role: "owner",
        organizationId: "org-1",
      },
      { limit: 20 },
    );
  });

  it("uses Shanghai-local month boundaries for settlement periods", async () => {
    await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth,
      now: "2026-05-31T18:00:00.000Z",
    });

    expect(listOpsSettlementPool).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    );
  });

  it("counts approved report financials by Shanghai-local submitted date", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      projectRow({
        id: "project-1",
        name: "Alpha",
        default_hourly_rate: 8000,
      }),
    ] as never);
    vi.mocked(listOpsLiveReportQueue).mockResolvedValue([
      {
        id: "report-local-june",
        taskId: "task-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        status: "approved",
        taskTitle: "Local June live",
        projectName: "Alpha",
        streamerName: "Streamer A",
        settlementDuration: 60,
        timeSource: "system",
        evidenceLevel: "green",
        viewers: 100,
        systemDuration: null,
        screenshotDuration: null,
        divergencePct: null,
        riskFlags: [],
        submittedAt: "2026-05-31T18:30:00.000Z",
      },
      {
        id: "report-local-may",
        taskId: "task-2",
        projectId: "project-1",
        streamerId: "streamer-2",
        status: "approved",
        taskTitle: "Local May live",
        projectName: "Alpha",
        streamerName: "Streamer B",
        settlementDuration: 600,
        timeSource: "system",
        evidenceLevel: "green",
        viewers: 100,
        systemDuration: null,
        screenshotDuration: null,
        divergencePct: null,
        riskFlags: [],
        submittedAt: "2026-05-31T15:30:00.000Z",
      },
    ]);

    const dashboard = await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth,
      now: "2026-05-31T18:00:00.000Z",
    });

    expect(
      vi.mocked(buildRoleHomeDashboard).mock.calls[0]?.[0].source.projects,
    ).toEqual([
      expect.objectContaining({
        id: "project-1",
        metrics: expect.objectContaining({
          receivable: 80,
        }),
      }),
    ]);
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "vendorReceivable", value: 80 }),
      ]),
    );
  });

  it("enriches zeroed project card placeholders with live dashboard facts", async () => {
    const projectRows = [
      projectRow({
        id: "project-1",
        name: "Alpha",
        default_hourly_rate: 8000,
      }),
    ];
    expect(toProjectCardDtos(projectRows)[0]?.metrics).toMatchObject({
      plannedHours: 0,
      doneHours: 0,
      receivable: 0,
      payable: 0,
      gross: 0,
    });
    expect(toProjectCardDtos(projectRows)[0]?.streamers).toMatchObject({
      active: 0,
      pendingReview: 0,
    });

    vi.mocked(listProjects).mockResolvedValue(projectRows as never);
    vi.mocked(listOpsLiveTaskQueue).mockResolvedValue([
      {
        id: "task-1",
        title: "Morning live",
        status: "completed",
        taskType: "project",
        projectId: "project-1",
        projectName: "Alpha",
        streamerId: "streamer-1",
        streamerName: "Streamer A",
        plannedStartAt: "2026-06-16T08:00:00.000Z",
        plannedEndAt: "2026-06-16T10:00:00.000Z",
        plannedDuration: 120,
        systemDuration: 90,
      },
      {
        id: "task-2",
        title: "Evening live",
        status: "abnormal",
        taskType: "project",
        projectId: "project-1",
        projectName: "Alpha",
        streamerId: "streamer-2",
        streamerName: "Streamer B",
        plannedStartAt: "2026-06-16T12:00:00.000Z",
        plannedEndAt: "2026-06-16T13:00:00.000Z",
        plannedDuration: 60,
        systemDuration: 0,
      },
    ]);
    vi.mocked(listOpsLiveReportQueue).mockResolvedValue([
      {
        id: "report-1",
        taskId: "task-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        status: "pending_review",
        taskTitle: "Morning live",
        projectName: "Alpha",
        streamerName: "Streamer A",
        settlementDuration: 120,
        timeSource: "system",
        evidenceLevel: "green",
        viewers: 300,
        systemDuration: null,
        screenshotDuration: null,
        divergencePct: null,
        riskFlags: [],
        submittedAt: "2026-06-16T10:00:00.000Z",
      },
      {
        id: "report-2",
        taskId: "task-2",
        projectId: "project-1",
        streamerId: "streamer-2",
        status: "approved",
        taskTitle: "Evening live",
        projectName: "Alpha",
        streamerName: "Streamer B",
        settlementDuration: 60,
        timeSource: "system",
        evidenceLevel: "green",
        viewers: 200,
        systemDuration: null,
        screenshotDuration: null,
        divergencePct: null,
        riskFlags: [],
        submittedAt: "2026-06-16T13:00:00.000Z",
      },
      {
        id: "report-rejected",
        taskId: "task-2",
        projectId: "project-1",
        streamerId: "streamer-2",
        status: "rejected",
        taskTitle: "Evening live",
        projectName: "Alpha",
        streamerName: "Streamer B",
        settlementDuration: 180,
        timeSource: "system",
        evidenceLevel: "green",
        viewers: 0,
        systemDuration: null,
        screenshotDuration: null,
        divergencePct: null,
        riskFlags: [],
        submittedAt: "2026-06-16T14:00:00.000Z",
      },
      {
        id: "report-need-more",
        taskId: "task-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        status: "need_more",
        taskTitle: "Morning live",
        projectName: "Alpha",
        streamerName: "Streamer A",
        settlementDuration: 240,
        timeSource: "system",
        evidenceLevel: "green",
        viewers: 0,
        systemDuration: null,
        screenshotDuration: null,
        divergencePct: null,
        riskFlags: [],
        submittedAt: "2026-06-16T15:00:00.000Z",
      },
      {
        id: "report-approved-prior-month",
        taskId: "task-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        status: "approved",
        taskTitle: "Morning live",
        projectName: "Alpha",
        streamerName: "Streamer A",
        settlementDuration: 600,
        timeSource: "system",
        evidenceLevel: "green",
        viewers: 0,
        systemDuration: null,
        screenshotDuration: null,
        divergencePct: null,
        riskFlags: [],
        submittedAt: "2026-05-31T15:00:00.000Z",
      },
    ]);
    vi.mocked(listOpsSettlementPool).mockResolvedValue([
      {
        id: "pool-1",
        projectId: "project-1",
        projectName: "Alpha",
        streamerName: "Streamer A",
        settlementDuration: 60,
        timeSource: "system",
        evidenceLevel: "green",
        settlementMethod: "cpt",
        cpsRateBps: 0,
        expectedAmount: 60,
        approvedAt: "2026-06-16T10:30:00.000Z",
      },
    ]);
    vi.mocked(listOpsSettlementBatches).mockResolvedValue([
      {
        id: "batch-1",
        projectId: "project-1",
        batchType: "payable",
        status: "draft",
        projectName: "Alpha",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        computedAmount: 20,
        manualAmount: 0,
        adjustmentAmount: 0,
        totalAmount: 20,
        evidenceSummary: {},
        itemCount: 1,
        createdBy: "user-1",
        updatedAt: "2026-06-16T14:00:00.000Z",
      },
      {
        id: "batch-prior-month",
        projectId: "project-1",
        batchType: "payable",
        status: "generated",
        projectName: "Alpha",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        computedAmount: 100,
        manualAmount: 0,
        adjustmentAmount: 0,
        totalAmount: 100,
        evidenceSummary: {},
        itemCount: 1,
        createdBy: "user-1",
        updatedAt: "2026-06-16T14:00:00.000Z",
      },
      {
        id: "batch-voided",
        projectId: "project-1",
        batchType: "payable",
        status: "voided",
        projectName: "Alpha",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        computedAmount: 300,
        manualAmount: 0,
        adjustmentAmount: 0,
        totalAmount: 300,
        evidenceSummary: {},
        itemCount: 1,
        createdBy: "user-1",
        updatedAt: "2026-06-16T14:00:00.000Z",
      },
    ]);

    const dashboard = await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth,
      now: "2026-06-16T09:30:00.000Z",
    });

    expect(
      vi.mocked(buildRoleHomeDashboard).mock.calls[0]?.[0].source.projects,
    ).toEqual([
      expect.objectContaining({
        id: "project-1",
        name: "Alpha",
        metrics: expect.objectContaining({
          plannedHours: 3,
          doneHours: 1.5,
          audience: 500,
          reportedPending: 1,
          anomalies: 1,
          receivable: 80,
          payable: 80,
          gross: 0,
          margin: 0,
        }),
        streamers: expect.objectContaining({
          active: 2,
          candidate: 0,
          pendingReview: 1,
        }),
      }),
    ]);
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "vendorReceivable", value: 80 }),
        expect.objectContaining({ key: "estimatedGross", value: 0 }),
        expect.objectContaining({ key: "grossMarginRate", value: 0 }),
      ]),
    );
  });

  it("scopes operator business dashboards to projects owned by the current user", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      projectRow({
        id: "project-mine",
        name: "Mine",
        created_by: "operator-a",
        owner_id: "owner-a",
        ops_manager_id: "ops-a",
      }),
      projectRow({
        id: "project-theirs",
        name: "Theirs",
        created_by: "operator-b",
        owner_id: "owner-b",
        ops_manager_id: "ops-b",
      }),
    ] as never);
    vi.mocked(listOpsLiveTaskQueue).mockResolvedValue([
      {
        id: "task-mine",
        title: "Mine live",
        status: "pending_live",
        taskType: "project",
        projectId: "project-mine",
        projectName: "Mine",
        streamerId: "streamer-1",
        streamerName: "Streamer A",
        plannedStartAt: "2026-06-16T08:00:00.000Z",
        plannedEndAt: "2026-06-16T10:00:00.000Z",
        plannedDuration: 120,
        systemDuration: 0,
      },
      {
        id: "task-theirs",
        title: "Theirs live",
        status: "pending_live",
        taskType: "project",
        projectId: "project-theirs",
        projectName: "Theirs",
        streamerId: "streamer-2",
        streamerName: "Streamer B",
        plannedStartAt: "2026-06-16T08:00:00.000Z",
        plannedEndAt: "2026-06-16T10:00:00.000Z",
        plannedDuration: 120,
        systemDuration: 0,
      },
    ]);
    vi.mocked(listOpsLiveReportQueue).mockResolvedValue([
      {
        id: "report-mine",
        taskId: "task-mine",
        projectId: "project-mine",
        streamerId: "streamer-1",
        status: "pending_review",
        taskTitle: "Mine live",
        projectName: "Mine",
        streamerName: "Streamer A",
        settlementDuration: 120,
        timeSource: "system",
        evidenceLevel: "green",
        viewers: 100,
        systemDuration: null,
        screenshotDuration: null,
        divergencePct: null,
        riskFlags: [],
        submittedAt: "2026-06-16T10:00:00.000Z",
      },
      {
        id: "report-theirs",
        taskId: "task-theirs",
        projectId: "project-theirs",
        streamerId: "streamer-2",
        status: "pending_review",
        taskTitle: "Theirs live",
        projectName: "Theirs",
        streamerName: "Streamer B",
        settlementDuration: 120,
        timeSource: "system",
        evidenceLevel: "green",
        viewers: 100,
        systemDuration: null,
        screenshotDuration: null,
        divergencePct: null,
        riskFlags: [],
        submittedAt: "2026-06-16T10:00:00.000Z",
      },
    ]);

    const dashboard = await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth: {
        ...auth,
        userId: "operator-a",
        role: "operator_business",
      },
      now: "2026-06-16T09:30:00.000Z",
    });

    const source = vi.mocked(buildRoleHomeDashboard).mock.calls[0]?.[0].source;
    expect(source?.projects.map((project) => project.id)).toEqual([
      "project-mine",
    ]);
    expect(source?.tasks.map((task) => task.id)).toEqual(["task-mine"]);
    expect(source?.reports.map((report) => report.id)).toEqual(["report-mine"]);
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "myTodayTasks", value: 1 }),
        expect.objectContaining({ key: "pendingReports", value: 1 }),
      ]),
    );
    expect(JSON.stringify(dashboard)).toContain("Mine");
    expect(JSON.stringify(dashboard)).not.toContain("Theirs");
  });

  it("scopes operator settlement pool rows by project id when project names repeat", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      projectRow({
        id: "project-mine",
        name: "Shared Launch",
        created_by: "operator-a",
        owner_id: "owner-a",
        ops_manager_id: "ops-a",
      }),
      projectRow({
        id: "project-theirs",
        name: "Shared Launch",
        created_by: "operator-b",
        owner_id: "owner-b",
        ops_manager_id: "ops-b",
      }),
    ] as never);
    vi.mocked(listOpsSettlementPool).mockResolvedValue([
      {
        id: "pool-mine",
        projectId: "project-mine",
        projectName: "Shared Launch",
        streamerName: "Streamer A",
        settlementDuration: 60,
        timeSource: "system",
        evidenceLevel: "green",
        settlementMethod: "cpt",
        cpsRateBps: 0,
        expectedAmount: 100,
        approvedAt: "2026-06-16T10:00:00.000Z",
      },
      {
        id: "pool-theirs",
        projectId: "project-theirs",
        projectName: "Shared Launch",
        streamerName: "Streamer B",
        settlementDuration: 60,
        timeSource: "system",
        evidenceLevel: "green",
        settlementMethod: "cpt",
        cpsRateBps: 0,
        expectedAmount: 200,
        approvedAt: "2026-06-16T10:00:00.000Z",
      },
    ] as never);

    await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth: {
        ...auth,
        userId: "operator-a",
        role: "operator_business",
      },
      now: "2026-06-16T09:30:00.000Z",
    });

    const source = vi.mocked(buildRoleHomeDashboard).mock.calls[0]?.[0].source;
    expect(source?.settlementPool.map((item) => item.id)).toEqual([
      "pool-mine",
    ]);
    expect(source?.projects).toEqual([
      expect.objectContaining({
        id: "project-mine",
        metrics: expect.objectContaining({
          payable: 100,
        }),
      }),
    ]);
  });

  it("marks active ops projects with no streamer activity as streamer gap projects", async () => {
    const projectRows = [
      projectRow({
        id: "project-gap",
        name: "Needs Streamer",
        status: "active",
      }),
      projectRow({
        id: "project-staffed",
        name: "Staffed",
        status: "active",
      }),
    ];
    expect(toProjectCardDtos(projectRows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "project-gap",
          streamers: expect.objectContaining({ candidate: 0 }),
        }),
      ]),
    );
    vi.mocked(listProjects).mockResolvedValue(projectRows as never);
    vi.mocked(listOpsLiveTaskQueue).mockResolvedValue([
      {
        id: "task-staffed",
        title: "Staffed live",
        status: "pending_live",
        taskType: "project",
        projectId: "project-staffed",
        projectName: "Staffed",
        streamerId: "streamer-1",
        streamerName: "Streamer A",
        plannedStartAt: "2026-06-16T08:00:00.000Z",
        plannedEndAt: "2026-06-16T10:00:00.000Z",
        plannedDuration: 120,
        systemDuration: 0,
      },
    ]);

    const dashboard = await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth: {
        ...auth,
        role: "ops_manager",
      },
      now: "2026-06-16T09:30:00.000Z",
    });

    expect(
      vi.mocked(buildRoleHomeDashboard).mock.calls[0]?.[0].source.projects,
    ).toEqual([
      expect.objectContaining({
        id: "project-gap",
        streamers: expect.objectContaining({ active: 0, candidate: 1 }),
      }),
      expect.objectContaining({
        id: "project-staffed",
        streamers: expect.objectContaining({ active: 1, candidate: 0 }),
      }),
    ]);
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "streamerGapProjects", value: 1 }),
      ]),
    );
  });

  it("maps report timing sources into dashboard report sources", async () => {
    const reportBase = {
      taskId: "task-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: "pending_review" as const,
      taskTitle: "Task",
      projectName: "Alpha",
      streamerName: "Streamer A",
      settlementDuration: 60,
      evidenceLevel: null,
      viewers: 100,
      systemDuration: null,
      screenshotDuration: null,
      divergencePct: null,
      riskFlags: [],
      submittedAt: "2026-06-16T09:00:00.000Z",
    };

    vi.mocked(listOpsLiveReportQueue).mockResolvedValue([
      {
        ...reportBase,
        id: "report-system",
        timeSource: "system",
      },
      {
        ...reportBase,
        id: "report-screenshot",
        timeSource: "screenshot",
      },
      {
        ...reportBase,
        id: "report-claimed",
        timeSource: "claimed",
      },
      {
        ...reportBase,
        id: "report-null-source",
        timeSource: null,
      },
      {
        ...reportBase,
        id: "report-missing-source",
      } as never,
    ]);

    await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth,
      now: "2026-06-16T09:30:00.000Z",
    });

    expect(
      vi.mocked(buildRoleHomeDashboard).mock.calls[0]?.[0].source.reports,
    ).toEqual([
      expect.objectContaining({
        id: "report-system",
        source: "system",
      }),
      expect.objectContaining({
        id: "report-screenshot",
        source: "OCR",
      }),
      expect.objectContaining({
        id: "report-claimed",
        source: "manual",
      }),
      expect.objectContaining({
        id: "report-null-source",
        source: "unknown",
      }),
      expect.objectContaining({
        id: "report-missing-source",
        source: "unknown",
      }),
    ]);
  });

  it("rejects streamer accounts because this loader is staff-only", async () => {
    await expect(
      loadRoleHomeDashboard({
        supabase: supabase as never,
        auth: { ...auth, role: "streamer" },
        now: "2026-06-16T09:30:00.000Z",
      }),
    ).rejects.toThrow(/Only MCN staff/);
  });
});

function projectRow(overrides: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id: "project-1",
    code: "P-1",
    name: "Alpha",
    status: "active",
    sensitivity: "low",
    starts_at: null,
    ends_at: null,
    open_signup: true,
    allow_direct_invite: true,
    force_recording: false,
    force_system_timing: true,
    default_hourly_rate: 8000,
    default_settlement_method: "cpt",
    vendor_name: "Vendor",
    product_name: "Product",
    agent_name: "Agent",
    supplier_name: "Supplier",
    description: "",
    is_public_to_streamers: false,
    public_summary: "",
    game_download_url: null,
    is_open_to_mcn_collaboration: false,
    mcn_collaboration_summary: "",
    mcn_collaboration_terms: {},
    created_by: "creator-1",
    owner_id: "owner-1",
    ops_manager_id: "ops-1",
    creator: { full_name: "Creator" },
    owner: { full_name: "Owner" },
    opsManager: { full_name: "Ops" },
    settlement_batches: [],
    live_reports: [],
    published_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}
