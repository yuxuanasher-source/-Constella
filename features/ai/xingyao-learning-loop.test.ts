import { describe, expect, it, vi } from "vitest";

import type { KnowledgeAssetIndexClient } from "./knowledge-asset-index";
import {
  buildValidatedStrategyKnowledgeDocument,
  calibrateXingyaoWeights,
  captureValidatedStrategyPlaybooks,
  evaluateStrategyTrials,
  type XingyaoOutcomeSample,
  type XingyaoStrategyTrial,
} from "./xingyao-learning-loop";
import { DEFAULT_XINGYAO_RISK_WEIGHTS } from "./xingyao-risk-radar";

describe("calibrateXingyaoWeights", () => {
  it("raises under-weighted signals until misses become hits", () => {
    const samples: XingyaoOutcomeSample[] = Array.from({ length: 10 }, () => ({
      model: "account_ban" as const,
      signals: {
        violation_density: 10_000,
        traffic_collapse: 0,
        live_hours_spike: 0,
        frozen_status: 0,
      },
      outcomeOccurred: true,
    }));

    const result = calibrateXingyaoWeights({ samples });

    expect(result.report.sampleCount).toBe(10);
    expect(result.report.hitRateBeforeBps).toBe(0);
    expect(result.report.hitRateAfterBps).toBe(10_000);
    expect(result.report.improved).toBe(true);
    expect(result.report.adjustedWeightKeys).toEqual([
      "account_ban.violation_density",
    ]);
    expect(result.weights.account_ban.violation_density).toBeGreaterThan(
      DEFAULT_XINGYAO_RISK_WEIGHTS.account_ban.violation_density,
    );
    // 无信号强度的键不动。
    expect(result.weights.account_ban.traffic_collapse).toBe(
      DEFAULT_XINGYAO_RISK_WEIGHTS.account_ban.traffic_collapse,
    );
  });

  it("keeps weights inside the 0-10000 database range and never mutates the input", () => {
    const samples: XingyaoOutcomeSample[] = Array.from({ length: 50 }, () => ({
      model: "settlement_overdue" as const,
      signals: {
        overdue_exposure: 10_000,
        counterparty_history: 10_000,
        amount_concentration: 10_000,
        dispute_flag: 10_000,
      },
      outcomeOccurred: false,
    }));

    const result = calibrateXingyaoWeights({ samples });

    for (const weight of Object.values(result.weights.settlement_overdue)) {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(10_000);
    }
    expect(
      DEFAULT_XINGYAO_RISK_WEIGHTS.settlement_overdue.overdue_exposure,
    ).toBe(3_500);
  });

  it("ignores sample signals that the model does not declare", () => {
    const result = calibrateXingyaoWeights({
      samples: [
        {
          model: "account_ban",
          signals: { unknown_signal: 10_000 },
          outcomeOccurred: true,
        },
      ],
    });
    expect(result.report.adjustedWeightKeys).toEqual([]);
    expect(result.weights.account_ban).toEqual(
      DEFAULT_XINGYAO_RISK_WEIGHTS.account_ban,
    );
  });
});

describe("evaluateStrategyTrials", () => {
  const baseTrial: XingyaoStrategyTrial = {
    id: "trial-1",
    title: "夜间时段替补主播机制",
    hypothesis: "为夜间低上播时段配置替补主播可提升项目开播率",
    appliedTo: "project:p-1",
    metricKey: "broadcast_rate",
    baselineBps: 6_000,
    observedBps: 7_500,
    minimumLiftBps: 1_000,
    sampleSize: 30,
    minimumSampleSize: 20,
  };

  it("validates a strategy with sufficient lift and sample size", () => {
    const [evaluation] = evaluateStrategyTrials([baseTrial]);
    expect(evaluation.validated).toBe(true);
    expect(evaluation.liftBps).toBe(1_500);
  });

  it("rejects insufficient samples and insufficient lift separately", () => {
    const [thinSample, weakLift] = evaluateStrategyTrials([
      { ...baseTrial, id: "trial-2", sampleSize: 5 },
      { ...baseTrial, id: "trial-3", observedBps: 6_400 },
    ]);
    expect(thinSample.validated).toBe(false);
    expect(thinSample.reason).toContain("样本量不足");
    expect(weakLift.validated).toBe(false);
    expect(weakLift.reason).toContain("未达到最小有效阈值");
  });

  it("distills a validated strategy into a traceable playbook document", () => {
    const [evaluation] = evaluateStrategyTrials([baseTrial]);
    const doc = buildValidatedStrategyKnowledgeDocument({
      evaluation,
      organizationId: "org-1",
      createdBy: "user-1",
    });

    expect(doc.docType).toBe("playbook");
    expect(doc.sourceRef).toBe("xingyao_strategy:trial-1");
    expect(doc.tags).toEqual(
      expect.arrayContaining(["xingyao", "validated_strategy"]),
    );
    expect(doc.body).toContain("夜间时段替补主播机制");
    expect(doc.body).toContain("source_ref");
  });
});

describe("captureValidatedStrategyPlaybooks", () => {
  it("persists only validated strategies through the knowledge asset index", async () => {
    const upserts: Record<string, unknown>[] = [];
    const client = {
      from: vi.fn((table: string) => {
        if (table === "knowledge_documents") {
          return {
            upsert: (payload: Record<string, unknown>) => {
              upserts.push(payload);
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: `doc-${upserts.length}` },
                    error: null,
                  }),
                }),
              };
            },
          };
        }
        return {
          delete: () => ({ match: async () => ({ error: null }) }),
          insert: async () => ({ error: null }),
        };
      }),
    } as unknown as KnowledgeAssetIndexClient;

    const trials: XingyaoStrategyTrial[] = [
      {
        id: "trial-ok",
        title: "验证有效策略",
        hypothesis: "假设",
        appliedTo: "project:p-1",
        metricKey: "roi",
        baselineBps: 9_000,
        observedBps: 11_000,
        minimumLiftBps: 1_000,
        sampleSize: 40,
        minimumSampleSize: 20,
      },
      {
        id: "trial-bad",
        title: "未验证策略",
        hypothesis: "假设",
        appliedTo: "project:p-2",
        metricKey: "roi",
        baselineBps: 9_000,
        observedBps: 9_100,
        minimumLiftBps: 1_000,
        sampleSize: 40,
        minimumSampleSize: 20,
      },
    ];

    const result = await captureValidatedStrategyPlaybooks(client, {
      organizationId: "org-1",
      createdBy: "user-1",
      evaluations: evaluateStrategyTrials(trials),
    });

    expect(result.capturedIds).toEqual(["doc-1"]);
    expect(result.skippedCount).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      organization_id: "org-1",
      doc_type: "playbook",
      source_ref: "xingyao_strategy:trial-ok",
    });
  });
});
