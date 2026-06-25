import { describe, expect, it } from "vitest";

import { buildSettlementBatchDraft, buildRetrospectiveDraft } from "./drafts";
import type { AiDraftListItem } from "./draft-repository";
import {
  draftHeadline,
  draftStatusLabel,
  draftTypeLabel,
  formatYuan,
  readRetrospectiveDraft,
  readSettlementDraft,
} from "./draft-view";

function listItem(over: Partial<AiDraftListItem>): AiDraftListItem {
  return {
    id: "d1",
    draftType: "settlement_batch",
    targetStateMachine: "settlement",
    targetState: "confirmed",
    status: "pending",
    payload: {},
    createdAt: "2026-06-25T00:00:00Z",
    ...over,
  };
}

describe("draft-view labels & money", () => {
  it("maps type/status labels with passthrough fallback", () => {
    expect(draftTypeLabel("settlement_batch")).toBe("结算批次");
    expect(draftTypeLabel("retrospective")).toBe("经营复盘");
    expect(draftTypeLabel("unknown_kind")).toBe("unknown_kind");
    expect(draftStatusLabel("pending")).toBe("待确认");
    expect(draftStatusLabel("confirmed")).toBe("已确认");
    expect(draftStatusLabel("weird")).toBe("weird");
  });

  it("formats cents to yuan with two decimals", () => {
    expect(formatYuan(10000)).toBe("¥100.00");
    expect(formatYuan(123456)).toBe("¥1,234.56");
    expect(formatYuan(null)).toBe("¥0.00");
    expect(formatYuan(undefined)).toBe("¥0.00");
  });
});

describe("readSettlementDraft", () => {
  it("reads groups & totals from a real builder envelope", () => {
    const envelope = buildSettlementBatchDraft(
      [
        { projectId: "p1", projectName: "项目甲", evidenceLevel: "green", timeSource: "system", expectedAmount: 10000 },
        { projectId: "p1", projectName: "项目甲", evidenceLevel: "yellow", timeSource: "system", expectedAmount: 5000 },
        { projectId: "p2", projectName: "项目乙", evidenceLevel: "green", timeSource: "system", expectedAmount: 8000 },
      ],
      { periodStart: "2026-06-01", periodEnd: "2026-06-30", batchType: "payable" },
    );
    const view = readSettlementDraft(envelope.payload);
    expect(view.groups).toHaveLength(2);
    expect(view.totals.itemCount).toBe(3);
    expect(view.totals.payableCents).toBe(23000);
    expect(view.totals.cptEligibleCount).toBe(2);
    expect(view.totals.weakEvidenceCount).toBe(1);
    expect(view.totals.weakEvidenceCents).toBe(5000);
  });

  it("is defensive against missing fields", () => {
    const view = readSettlementDraft({});
    expect(view.groups).toEqual([]);
    expect(view.totals.payableCents).toBe(0);
  });
});

describe("draftHeadline", () => {
  it("summarizes a settlement-batch draft from structured totals", () => {
    const envelope = buildSettlementBatchDraft(
      [
        { projectId: "p1", projectName: "项目甲", evidenceLevel: "green", timeSource: "system", expectedAmount: 10000 },
        { projectId: "p2", projectName: "项目乙", evidenceLevel: "green", timeSource: "system", expectedAmount: 8000 },
      ],
      { periodStart: "2026-06-01", periodEnd: "2026-06-30", batchType: "payable" },
    );
    const headline = draftHeadline(listItem({ payload: envelope.payload }));
    expect(headline).toContain("2 个项目");
    expect(headline).toContain("应付");
    expect(headline).toContain("¥180.00");
  });

  it("summarizes a retrospective draft", () => {
    const envelope = buildRetrospectiveDraft({
      periodLabel: "2026-06",
      metrics: [
        { label: "毛利", value: "12000", sourceRef: "report:1" },
        { label: "毛利率", value: "32%", sourceRef: "report:1" },
      ],
    });
    const headline = draftHeadline(
      listItem({ draftType: "retrospective", payload: envelope.payload }),
    );
    expect(headline).toContain("2026-06");
    expect(headline).toContain("2 项指标");
  });
});

describe("readRetrospectiveDraft", () => {
  it("reads metrics & sections", () => {
    const envelope = buildRetrospectiveDraft({
      periodLabel: "2026-06",
      metrics: [{ label: "毛利", value: "12000", unit: "元", sourceRef: "report:1" }],
    });
    const view = readRetrospectiveDraft(envelope.payload);
    expect(view.periodLabel).toBe("2026-06");
    expect(view.metrics[0].sourceRef).toBe("report:1");
    expect(view.sections.length).toBeGreaterThan(0);
  });
});
