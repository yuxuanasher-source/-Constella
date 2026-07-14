import { describe, expect, it } from "vitest";

import {
  toStreamerEarningsSummary,
  toStreamerPayableItem,
  type StreamerPayableSafeRow,
} from "./streamer-settlement-queries";

const rows: StreamerPayableSafeRow[] = [
  {
    id: "item-1",
    project_name: "Launch Week",
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    computed_amount: 160,
    manual_amount: 0,
    adjustment_amount: 0,
    payable_amount: 160,
    evidence_level: "green",
    evidence_snapshot: {
      settlementDuration: 120,
      timeSource: "system",
    },
    created_at: "2026-05-20T12:00:00.000Z",
  },
  {
    id: "item-2",
    project_name: "Launch Week",
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    computed_amount: 0,
    manual_amount: 300,
    adjustment_amount: -20,
    payable_amount: 280,
    evidence_level: "red",
    evidence_snapshot: {
      source: "manual",
      itemType: "cpa",
      reason: "Imported CPA",
    },
    created_at: "2026-05-21T12:00:00.000Z",
  },
  {
    id: "item-3",
    project_name: "April Project",
    period_start: "2026-04-01",
    period_end: "2026-04-30",
    computed_amount: 500,
    manual_amount: 0,
    adjustment_amount: 0,
    payable_amount: 500,
    evidence_level: "green",
    evidence_snapshot: {
      settlementDuration: 300,
      timeSource: "system",
    },
    created_at: "2026-04-20T12:00:00.000Z",
  },
];

describe("streamer settlement safe DTO", () => {
  it("maps payable safe rows without exposing receivable profit or cost fields", () => {
    const item = toStreamerPayableItem(rows[0]);

    expect(item).toEqual({
      id: "item-1",
      projectName: "Launch Week",
      month: "2026-05",
      amount: 160,
      computedAmount: 160,
      manualAmount: 0,
      adjustmentAmount: 0,
      hours: 2,
      evidence: "green · system",
      source: "live_report",
      createdAt: "2026-05-20T12:00:00.000Z",
    });
    expect(JSON.stringify(item)).not.toContain("receivable");
    expect(JSON.stringify(item)).not.toContain("gross");
    expect(JSON.stringify(item)).not.toContain("cost");
  });

  it("exposes only personal payable explanation fields from a noisy custom-rule snapshot", () => {
    const item = toStreamerPayableItem({
      id: "item-safe-rule",
      project_name: "Launch Week",
      period_start: "2026-05-01",
      period_end: "2026-05-31",
      computed_amount: 1040,
      manual_amount: 0,
      adjustment_amount: 0,
      payable_amount: 1040,
      evidence_level: "yellow",
      evidence_snapshot: {
        settlementDuration: 240,
        timeSource: "system",
        reviewerComments: "内部复核备注",
        groupRoster: ["other-streamer"],
        ruleEngine: {
          formula: "money_result({ final: internal_margin() })",
          compiledAst: { kind: "call" },
          receivableRules: { vendor: "hidden" },
          marginCents: 90000,
          taxCents: 6000,
          externalCostCents: 12000,
          otherStreamers: ["other-streamer"],
          groupRoster: ["other-streamer"],
          reviewerComments: "内部规则评审意见",
          internalRiskThresholds: { marginFloorBps: 2000 },
          personalComponentsCents: {
            baseSalary: 80000,
            cptPay: 24000,
            final: 104000,
          },
          namedOutputsCents: {
            "rule-version-payable-123456:baseSalary": 80000,
            "rule-version-payable-123456:margin": 90000,
            "internal-layer:unknownPayoutBasis": 12345,
            marginCents: 90000,
            taxCents: 6000,
            externalCostCents: 12000,
          },
          sourceReportIds: ["report-safe-1"],
          explanationZh: "内部说明不应直出。",
        },
      },
      created_at: "2026-05-20T12:00:00.000Z",
    });

    expect(item.explanation).toEqual({
      finalAmount: 1040,
      finalAmountCents: 104000,
      components: [
        { key: "baseSalary", label: "底薪", amount: 800, amountCents: 80000 },
        { key: "cptPay", label: "有效时长", amount: 240, amountCents: 24000 },
        { key: "final", label: "最终金额", amount: 1040, amountCents: 104000 },
      ],
      evidenceFacts: {
        hours: 4,
        evidenceLevel: "yellow",
        timeSource: "system",
        sourceReportCount: 1,
      },
      explanationZh:
        "本次 Launch Week 结算包含底薪 ¥800、有效时长 ¥240、最终金额 ¥1,040，最终应付 ¥1,040；有效时长 4.0 小时，时间来源 system。",
    });

    const serialized = JSON.stringify(item);
    expect(serialized).not.toMatch(
      /formula|compiledAst|receivableRules|margin|unknownPayoutBasis|rule-version-payable|internal-layer|tax|externalCost|other-streamer|groupRoster|reviewerComments|internalRiskThresholds|内部规则评审意见|内部复核备注/i,
    );
  });

  it("does not derive personal components from generic project-period named outputs", () => {
    const item = toStreamerPayableItem({
      id: "item-project-period-outputs",
      project_name: "Aggregate Project",
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      computed_amount: 800,
      manual_amount: 0,
      adjustment_amount: 0,
      payable_amount: 800,
      evidence_level: "yellow",
      evidence_snapshot: {
        settlementDuration: 120,
        timeSource: "system",
        ruleEngine: {
          grain: "project_period",
          namedOutputsCents: {
            "550e8400-e29b-41d4-a716-446655440000:baseSalary": 80000,
            "550e8400-e29b-41d4-a716-446655440000:cptPay": 20000,
            "550e8400-e29b-41d4-a716-446655440000:final": 100000,
          },
          componentOutputsCents: {
            baseSalary: 80000,
          },
          sourceReportIds: ["report-a", "report-b"],
        },
      },
      created_at: "2026-06-20T12:00:00.000Z",
    });

    expect(item.explanation?.components).toEqual([]);
    expect(item.explanation?.explanationZh).toBe(
      "本次 Aggregate Project 结算包含个人结算项，最终应付 ¥800；有效时长 2.0 小时，时间来源 system。",
    );
    expect(JSON.stringify(item)).not.toMatch(
      /550e8400|baseSalary|cptPay|最终金额/,
    );
  });

  it("does not expose raw unknown personal component keys even from explicit personal snapshots", () => {
    const item = toStreamerPayableItem({
      id: "item-personal-components",
      project_name: "Personal Project",
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      computed_amount: 500,
      manual_amount: 0,
      adjustment_amount: 0,
      payable_amount: 500,
      evidence_level: "green",
      evidence_snapshot: {
        settlementDuration: 60,
        timeSource: "system",
        ruleEngine: {
          personalComponentsCents: {
            "rule-version-personal:baseSalary": 30000,
            "rule-version-personal:secretMultiplier": 99999,
            cptPay: 20000,
          },
          sourceReportIds: ["report-personal-1"],
        },
      },
      created_at: "2026-06-20T12:00:00.000Z",
    });

    expect(item.explanation?.components).toEqual([
      { key: "baseSalary", label: "底薪", amount: 300, amountCents: 30000 },
      { key: "cptPay", label: "有效时长", amount: 200, amountCents: 20000 },
    ]);
    expect(JSON.stringify(item)).not.toMatch(
      /rule-version-personal|secretMultiplier/i,
    );
  });

  it("summarizes current and historical payable amounts for streamer mobile", () => {
    const summary = toStreamerEarningsSummary(rows, {
      currentMonth: "2026-05",
    });

    expect(summary).toEqual({
      currentMonth: {
        month: "2026-05",
        earned: 440,
        pending: 0,
        finalized: false,
        hours: 2,
      },
      history: [
        { month: "2026-05", earned: 440 },
        { month: "2026-04", earned: 500 },
      ],
      items: [
        expect.objectContaining({ id: "item-1", amount: 160 }),
        expect.objectContaining({ id: "item-2", amount: 280 }),
        expect.objectContaining({ id: "item-3", amount: 500 }),
      ],
    });
  });
});
