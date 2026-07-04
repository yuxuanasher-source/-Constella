import { describe, expect, it } from "vitest";

import { buildXingyaoFeatureStore } from "./xingyao-feature-store";
import {
  predictAccountBanRisk,
  predictProjectMonthlyAttainment,
  predictSettlementOverdueRisk,
  predictStreamerRetention,
  riskLevelForScore,
  runXingyaoRiskRadar,
  scoreRiskSignals,
} from "./xingyao-risk-radar";
import { createInput, createProjectSlice } from "./xingyao-test-fixtures";

describe("scoreRiskSignals", () => {
  it("computes the weighted average with per-signal contributions", () => {
    const { scoreBps, signals } = scoreRiskSignals(
      { a: 10_000, b: 0 },
      { a: 3_000, b: 7_000 },
    );
    expect(scoreBps).toBe(3_000);
    expect(signals).toEqual([
      expect.objectContaining({ key: "a", contributionBps: 3_000 }),
      expect.objectContaining({ key: "b", contributionBps: 0 }),
    ]);
  });

  it("returns zero when no weights are configured", () => {
    expect(scoreRiskSignals({ a: 8_000 }, {}).scoreBps).toBe(0);
  });
});

describe("risk level thresholds", () => {
  it("maps scores onto low / medium / high", () => {
    expect(riskLevelForScore(3_999)).toBe("low");
    expect(riskLevelForScore(4_000)).toBe("medium");
    expect(riskLevelForScore(7_000)).toBe("high");
  });
});

describe("predictors", () => {
  const store = buildXingyaoFeatureStore(createInput());

  it("predicts project monthly attainment from the revenue-trend proxy without a target", () => {
    const prediction = predictProjectMonthlyAttainment({
      project: store.projects[0],
      periodElapsedRatioBps: store.periodElapsedRatioBps,
    });
    expect(prediction.riskScoreBps).toBe(2_278);
    expect(prediction.attainmentProbabilityBps).toBe(7_722);
    expect(prediction.level).toBe("low");
  });

  it("predicts progress gap against an explicit monthly target", () => {
    const targetStore = buildXingyaoFeatureStore(
      createInput({
        periodElapsedRatioBps: 5_000,
        projects: [
          createProjectSlice({
            monthlyTargetRevenueCents: 1_000_000,
            receivableCents: 250_000,
          }),
        ],
      }),
    );
    const prediction = predictProjectMonthlyAttainment({
      project: targetStore.projects[0],
      periodElapsedRatioBps: targetStore.periodElapsedRatioBps,
    });
    const progressGap = prediction.signals.find(
      (signal) => signal.key === "progress_gap",
    );
    expect(progressGap?.valueBps).toBe(5_000);
  });

  it("predicts streamer retention risk from attendance/income/dispute signals", () => {
    const prediction = predictStreamerRetention({
      streamer: store.streamers[0],
    });
    expect(prediction.riskScoreBps).toBe(3_958);
    expect(prediction.signals.map((signal) => signal.key)).toEqual([
      "attendance_decline",
      "dispute_pressure",
      "inactivity",
      "income_decline",
      "training_gap",
    ]);
  });

  it("predicts account ban risk and escalates on frozen status", () => {
    const active = predictAccountBanRisk({ account: store.accounts[0] });
    expect(active.riskScoreBps).toBe(5_339);
    expect(active.level).toBe("medium");

    const frozenStore = buildXingyaoFeatureStore(
      createInput({
        accounts: [{ ...createInput().accounts[0], status: "frozen" as const }],
      }),
    );
    const frozen = predictAccountBanRisk({ account: frozenStore.accounts[0] });
    expect(frozen.riskScoreBps).toBe(7_839);
    expect(frozen.level).toBe("high");
  });

  it("predicts settlement overdue risk from exposure and history", () => {
    const prediction = predictSettlementOverdueRisk({
      settlement: store.settlements[0],
    });
    expect(prediction.riskScoreBps).toBe(4_450);
    expect(prediction.level).toBe("medium");
  });
});

describe("runXingyaoRiskRadar", () => {
  it("sorts predictions, surfaces medium+ alerts and passes the output contract", () => {
    const store = buildXingyaoFeatureStore(createInput());
    const radar = runXingyaoRiskRadar({ store });

    expect(radar.predictions).toHaveLength(4);
    expect(radar.alerts.map((alert) => alert.objectId)).toEqual(["a-1", "b-1"]);
    expect(radar.output.facts).toHaveLength(4);
    expect(radar.output.recommendations).toHaveLength(2);
    expect(radar.validation).toEqual({ valid: true, errors: [] });
    expect(
      radar.output.recommendations.every(
        (recommendation) => recommendation.requiresHumanApproval === true,
      ),
    ).toBe(true);
  });

  it("reports a safe posture when nothing crosses the alert threshold", () => {
    const store = buildXingyaoFeatureStore(
      createInput({
        accounts: [],
        settlements: [],
        streamers: [],
      }),
    );
    const radar = runXingyaoRiskRadar({ store });

    expect(radar.alerts).toHaveLength(0);
    expect(radar.output.findings[0].summary).toContain("安全水位");
    expect(radar.validation.valid).toBe(true);
  });
});
