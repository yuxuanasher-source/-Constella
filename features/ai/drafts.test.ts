import { describe, expect, it } from "vitest";

import {
  buildSuggestedActionTodoDraft,
  buildRetrospectiveDraft,
  buildSettlementBatchDraft,
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
