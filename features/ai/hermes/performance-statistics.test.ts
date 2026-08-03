import { describe, expect, it } from "vitest";

import {
  evaluateFastTurnGate,
  nearestRankPercentile,
  type FastTurnPerformanceSample,
} from "./performance-statistics";

const gateThresholds = {
  minSamples: 100,
  minSuccessRate: 0.99,
  maxFirstDeltaP95Ms: 8_000,
  maxTotalP95Ms: 30_000,
};

describe("nearestRankPercentile", () => {
  it("uses the nearest-rank percentile without mutating its input", () => {
    const values = [11_530, 36_900, 38_230, 46_950, 62_640];

    expect(nearestRankPercentile(values, 0.95)).toBe(62_640);
    expect(values).toEqual([11_530, 36_900, 38_230, 46_950, 62_640]);
  });

  it.each([
    { values: [], percentile: 0.95 },
    { values: [Number.NaN], percentile: 0.95 },
    { values: [Number.POSITIVE_INFINITY], percentile: 0.95 },
    { values: [-1], percentile: 0.95 },
    { values: [100], percentile: 0 },
    { values: [100], percentile: 1.01 },
    { values: [100], percentile: Number.NaN },
  ])("rejects invalid latency or percentile input: %o", (input) => {
    expect(() => nearestRankPercentile(input.values, input.percentile)).toThrow(
      RangeError,
    );
  });
});

describe("evaluateFastTurnGate", () => {
  it("passes one hundred representative Fast samples within every budget", () => {
    const samples = Array.from({ length: 100 }, (_, index) => ({
      success: true,
      firstDeltaMs: 1_000 + index * 10,
      totalMs: 10_000 + index * 100,
    }));

    expect(evaluateFastTurnGate({ samples, ...gateThresholds })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("enforces the minimum success rate", () => {
    const successfulSamples = Array.from({ length: 98 }, () => ({
      success: true,
      firstDeltaMs: 1_000,
      totalMs: 10_000,
    }));
    const failedSamples: FastTurnPerformanceSample[] = Array.from(
      { length: 2 },
      () => ({ success: false, firstDeltaMs: null, totalMs: 10_000 }),
    );

    expect(
      evaluateFastTurnGate({
        samples: [...successfulSamples, ...failedSamples],
        ...gateThresholds,
      }).failures,
    ).toContain("success_rate_below_minimum");
  });

  it("fails closed when the report has too few samples", () => {
    expect(
      evaluateFastTurnGate({
        samples: [{ success: true, firstDeltaMs: 1_000, totalMs: 10_000 }],
        ...gateThresholds,
      }).failures,
    ).toContain("insufficient_samples");
  });

  it("enforces first-delta and total p95 budgets", () => {
    const samples = Array.from({ length: 100 }, () => ({
      success: true,
      firstDeltaMs: 8_001,
      totalMs: 30_001,
    }));

    expect(evaluateFastTurnGate({ samples, ...gateThresholds })).toEqual({
      ok: false,
      failures: ["first_delta_p95_exceeded", "total_p95_exceeded"],
    });
  });

  it.each([
    {
      input: { ...gateThresholds, minSamples: 0 },
      failure: "invalid_min_samples",
    },
    {
      input: { ...gateThresholds, minSuccessRate: 1.01 },
      failure: "invalid_min_success_rate",
    },
    {
      input: { ...gateThresholds, maxFirstDeltaP95Ms: -1 },
      failure: "invalid_max_first_delta_p95_ms",
    },
    {
      input: { ...gateThresholds, maxTotalP95Ms: Number.NaN },
      failure: "invalid_max_total_p95_ms",
    },
  ])(
    "fails closed for an invalid gate threshold: $failure",
    ({ input, failure }) => {
      const result = evaluateFastTurnGate({
        samples: [{ success: true, firstDeltaMs: 1_000, totalMs: 10_000 }],
        ...input,
      });

      expect(result.ok).toBe(false);
      expect(result.failures).toContain(failure);
    },
  );

  it.each([
    {
      sample: { success: true, firstDeltaMs: null, totalMs: 10_000 },
    },
    {
      sample: { success: true, firstDeltaMs: -1, totalMs: 10_000 },
    },
    {
      sample: {
        success: true,
        firstDeltaMs: 1_000,
        totalMs: Number.POSITIVE_INFINITY,
      },
    },
  ])("fails closed for an invalid performance sample: %o", ({ sample }) => {
    const result = evaluateFastTurnGate({
      samples: [sample],
      ...gateThresholds,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("invalid_samples");
  });
});
