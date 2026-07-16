import { describe, expect, it } from "vitest";

import {
  buildSuggestedActionTodoDraft,
  buildRetrospectiveDraft,
  buildSettlementBatchDraft,
  buildStreamerProjectReviewDraft,
  draftConfirmationRequirement,
  isCptEligible,
  type SettlementPoolItem,
} from "./drafts";

describe("isCptEligible (mirrors rule engine: green + system only)", () => {
  it("only green + system counts toward CPT", () => {
    expect(isCptEligible({ evidenceLevel: "green", timeSource: "system" })).toBe(true);
    expect(isCptEligible({ evidenceLevel: "green", timeSource: "screenshot" })).toBe(false);
    expect(isCptEligible({ evidenceLevel: "yellow", timeSource: "system" })).toBe(false);
    expect(isCptEligible({ evidenceLevel: "red", timeSource: "claimed" })).toBe(false);
  });
});

describe("buildSettlementBatchDraft", () => {
  const items: SettlementPoolItem[] = [
    { projectId: "p1", projectName: "项目甲", evidenceLevel: "green", timeSource: "system", payableCents: 10000, receivableCents: 26000 },
    { projectId: "p1", projectName: "项目甲", evidenceLevel: "yellow", timeSource: "system", payableCents: 5000, receivableCents: 13000 },
    { projectId: "p2", projectName: "项目乙", evidenceLevel: "red", timeSource: "claimed", payableCents: 3000, receivableCents: 8000 },
  ];

  it("starts as a pending draft and never auto-applies", () => {
    const draft = buildSettlementBatchDraft(items, { batchType: "payable" });
    expect(draft.status).toBe("pending");
    expect(draft.draftType).toBe("settlement_batch");
    expect(draft.targetStateMachine).toBe("settlement");
    expect(draft.targetState).toBe("confirmed");
  });

  it("groups by project and separates payable/receivable", () => {
    const draft = buildSettlementBatchDraft(items, {});
    const groups = draft.payload.groups as Array<Record<string, number | string>>;
    const jia = groups.find((g) => g.projectName === "项目甲")!;
    expect(jia.payableCents).toBe(15000);
    expect(jia.receivableCents).toBe(39000);
  });

  it("only counts green+system toward CPT, the rest as weak evidence", () => {
    const draft = buildSettlementBatchDraft(items, {});
    const totals = draft.payload.totals as Record<string, number>;
    expect(totals.cptEligibleCount).toBe(1);
    expect(totals.weakEvidenceCount).toBe(2);
    expect(totals.weakEvidenceCents).toBe(8000); // 5000 (yellow) + 3000 (red)
  });

  it("confirming a settlement batch is an L4 human action — AI only drafts", () => {
    const draft = buildSettlementBatchDraft(items, {});
    const decision = draftConfirmationRequirement(draft);
    expect(decision.decision).toBe("draft_only");
    expect(decision.tier).toBe("L4_FORBIDDEN");
  });
});

describe("buildRetrospectiveDraft", () => {
  it("keeps every number sourced and leaves narrative as prompts (no fabrication)", () => {
    const draft = buildRetrospectiveDraft({
      periodLabel: "2026-06",
      metrics: [
        { label: "厂家应收", value: "128.4", unit: "万", sourceRef: "query:settlement_pool#2026-06" },
        { label: "毛利率", value: "31.2", unit: "%", sourceRef: "query:margin#2026-06" },
      ],
      references: [{ index: 1, title: "复盘 SOP", sourceRef: "SOP/复盘 v1", docId: "doc-9" }],
    });
    expect(draft.status).toBe("pending");
    const metrics = draft.payload.metrics as Array<Record<string, string>>;
    expect(metrics.every((m) => Boolean(m.sourceRef))).toBe(true);
    const sections = draft.payload.sections as Array<{ prompt: string }>;
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((s) => s.prompt.length > 0)).toBe(true);
  });
});

describe("buildSuggestedActionTodoDraft", () => {
  it("turns a copilot suggested action into a pending todo draft", () => {
    const draft = buildSuggestedActionTodoDraft({
      actionId: "p-low-margin:margin-review",
      projectId: "p-low-margin",
      projectName: "Nova Launch",
      priority: "high",
      title: "Review margin and cost assumptions",
      rationale: "The project has margin signals that need a human review.",
      evidence: [
        {
          sourceTool: "role_home_dashboard",
          sourceId: "panel:projectRanking:rank:p-low-margin",
        },
      ],
      target: { route: "project", id: "p-low-margin" },
      requiresHumanApproval: true,
    });

    expect(draft).toMatchObject({
      draftType: "suggested_action_todo",
      status: "pending",
      targetStateMachine: "operations_todo",
      targetState: "created",
    });
    expect(draft.payload).toMatchObject({
      sourceActionId: "p-low-margin:margin-review",
      projectId: "p-low-margin",
      projectName: "Nova Launch",
      priority: "high",
      title: "Review margin and cost assumptions",
      route: "project",
      targetId: "p-low-margin",
    });
    expect(draft.payload.evidence).toEqual([
      {
        sourceTool: "role_home_dashboard",
        sourceId: "panel:projectRanking:rank:p-low-margin",
      },
    ]);
  });
});

describe("buildStreamerProjectReviewDraft", () => {
  it("wraps a streamer project review profile as a pending human-confirmed draft", () => {
    const draft = buildStreamerProjectReviewDraft({
      profile: {
        streamer: { id: "streamer-1", displayName: "阿星" },
        project: { id: "project-1", name: "传奇复古", productType: "legend" },
        participation: {
          naturalDays: 5,
          effectiveLiveDays: 2,
          scheduledTaskCount: 3,
          completedTaskCount: 2,
          scheduleCompletionRateBps: 6667,
          totalSystemDuration: 230,
          totalSettlementDuration: 230,
          firstScheduledAt: "2026-07-01T10:00:00.000Z",
          lastScheduledAt: "2026-07-05T12:00:00.000Z",
        },
        liveMetrics: {
          reportCount: 2,
          approvedReportCount: 1,
          totalViewers: 4200,
          averageViewers: 2100,
          averagePcu: 290,
          averageAcu: 80,
          evidenceLevels: { green: 1, yellow: 1 },
          riskFlags: { duration_divergence: 1 },
        },
        recordings: {
          submittedCount: 2,
          approvedCount: 1,
          rejectedCount: 1,
          adoptedCount: 1,
          passRateBps: 5000,
          adoptionRateBps: 5000,
          rejectionRateBps: 5000,
          topRejectionReasons: [{ reason: "画面不清", count: 1 }],
        },
        facts: [
          {
            statement: "排班 task-1 状态为 completed。",
            sourceTool: "streamer_project_profile",
            sourceId: "task-1",
          },
        ],
        findings: [
          {
            summary: "该主播在项目内已有 2 个有效直播日。",
            evidence: [
              { sourceTool: "streamer_project_profile", sourceId: "report-1" },
            ],
          },
        ],
        caveats: [],
        recommendations: [
          {
            proposal: "安排运营针对主要录屏驳回原因进行一次主播复盘。",
            requiresHumanApproval: true,
          },
        ],
        reviewDraft: {
          summary: "阿星在传奇复古项目已形成 2 个有效直播日。",
          participation: "自然参与 5 天。",
          livePerformance: "累计场观 4200。",
          recordingPerformance: "录屏采用率 50.00%。",
          productFit: "当前项目产品类型为 legend。",
          externalReference: {
            status: "provided",
            summary: "已接入 1 条外部参考，仅作为同类产品/同行表现参照。",
            references: [
              {
                id: "knowledge:doc-1:chunk-1",
                title: "传奇复古同类项目复盘",
                sourceName: "知识库",
                sourceUrl: null,
                retrievedAt: "2026-07-16T10:00:00.000Z",
              },
            ],
          },
          marketReferenceRequest: {
            status: "satisfied",
            purpose: "补充同类产品表现、同行打法和平台趋势，仅用于复盘参考。",
            sourceIds: ["knowledge:doc-1:chunk-1"],
            guardrails: [
              "外部参考不能覆盖内部排班、报数、录屏和结算事实。",
            ],
          },
          majorIssues: [],
          opportunities: [],
          actionItems: [
            {
              proposal: "安排运营针对主要录屏驳回原因进行一次主播复盘。",
              requiresHumanApproval: true,
            },
          ],
          dataGaps: [],
        },
      },
    });

    expect(draft).toMatchObject({
      draftType: "streamer_project_review",
      status: "pending",
      targetStateMachine: "streamer_project_review",
      targetState: "published",
      payload: {
        streamerId: "streamer-1",
        projectId: "project-1",
        summary: "阿星在传奇复古项目已形成 2 个有效直播日。",
        reviewDraft: expect.objectContaining({
          livePerformance: "累计场观 4200。",
        }),
        references: [
          {
            id: "knowledge:doc-1:chunk-1",
            title: "传奇复古同类项目复盘",
            sourceName: "知识库",
            sourceUrl: null,
            retrievedAt: "2026-07-16T10:00:00.000Z",
          },
        ],
      },
    });
    expect(draft.note).toContain("需人工确认");
    expect(draftConfirmationRequirement(draft).decision).toBe("draft_only");
  });
});
