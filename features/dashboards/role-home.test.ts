import { describe, expect, it } from "vitest";

import { buildRoleHomeDashboard, type DashboardSourceData } from "./role-home";

const source: DashboardSourceData = {
  now: "2026-06-16T09:30:00.000Z",
  projects: [
    {
      id: "project-1",
      name: "Alpha",
      status: "active",
      leadOps: "Alice",
      metrics: {
        plannedHours: 100,
        doneHours: 40,
        receivable: 100000,
        payable: 70000,
        gross: 30000,
        margin: 30,
        reportedPending: 2,
        anomalies: 1,
        audience: 12000,
      },
      streamers: { active: 3, candidate: 1, pendingReview: 2 },
      risk: "high",
    },
  ],
  tasks: [
    {
      id: "task-1",
      project: "project-1",
      projectName: "Alpha",
      streamerName: "Streamer A",
      status: "pending_live",
      plannedStartAt: "2026-06-16T08:00:00.000Z",
      plannedEndAt: "2026-06-16T10:00:00.000Z",
      anomaly: true,
    },
  ],
  reports: [
    {
      id: "report-1",
      project: "Alpha",
      streamer: "Streamer A",
      status: "pending_review",
      source: "OCR",
      duration: 120,
      audience: 1000,
    },
  ],
  settlementPool: [
    {
      id: "pool-1",
      projectName: "Alpha",
      streamerName: "Streamer A",
      expectedAmount: 8000,
      evidenceLevel: "yellow",
      timeSource: "screenshot",
    },
  ],
  batches: [
    {
      id: "batch-1",
      status: "reopened",
      projectName: "Alpha",
      totalAmount: 8000,
      itemCount: 1,
    },
  ],
  notifications: [
    {
      id: "notice-1",
      title: "Settlement batch reopened",
      type: "high_risk",
      status: "unread",
      isHighRisk: true,
      objectType: "settlement_batch",
      objectId: "batch-1",
      createdAt: "2026-06-16T09:00:00.000Z",
    },
  ],
  auditEntries: [],
};

describe("role home dashboard", () => {
  it("projects owner metrics into an executive dashboard", () => {
    const dashboard = buildRoleHomeDashboard({
      role: "owner",
      userId: "user-owner",
      organizationId: "org-1",
      source,
    });

    expect(dashboard.profile).toMatchObject({
      role: "owner",
      title: "经营总览看板",
    });
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "activeProjects", value: 1 }),
        expect.objectContaining({ key: "grossMarginRate", value: 30 }),
        expect.objectContaining({ key: "highRiskItems", value: 1 }),
      ]),
    );
    expect(dashboard.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "lowMarginProjects" }),
      ]),
    );
  });

  it("projects finance metrics without exposing owner-only project margin rows", () => {
    const dashboard = buildRoleHomeDashboard({
      role: "finance",
      userId: "user-finance",
      organizationId: "org-1",
      source,
    });

    expect(dashboard.profile.title).toBe("结算安全看板");
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "settlementPoolAmount", value: 8000 }),
        expect.objectContaining({ key: "weakEvidenceAmount", value: 8000 }),
      ]),
    );
    expect(JSON.stringify(dashboard)).not.toContain("gross");
    expect(JSON.stringify(dashboard)).not.toContain("marginRate");
  });

  it("projects operator metrics as a personal action queue", () => {
    const dashboard = buildRoleHomeDashboard({
      role: "operator_business",
      userId: "user-operator",
      organizationId: "org-1",
      source,
    });

    expect(dashboard.profile.title).toBe("我的今日待办");
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "myTodayTasks", value: 1 }),
        expect.objectContaining({ key: "pendingReports", value: 1 }),
      ]),
    );
    expect(JSON.stringify(dashboard)).not.toContain("100000");
    expect(JSON.stringify(dashboard)).not.toContain("30000");
  });

  it("returns explicit empty states for an empty source", () => {
    const dashboard = buildRoleHomeDashboard({
      role: "ops_manager",
      userId: "user-ops",
      organizationId: "org-1",
      source: {
        now: "2026-06-16T09:30:00.000Z",
        projects: [],
        tasks: [],
        reports: [],
        settlementPool: [],
        batches: [],
        notifications: [],
        auditEntries: [],
      },
    });

    expect(dashboard.profile.title).toBe("项目推进看板");
    expect(dashboard.emptyState).toMatchObject({
      title: "暂无需要处理的项目经营数据",
    });
  });
});
