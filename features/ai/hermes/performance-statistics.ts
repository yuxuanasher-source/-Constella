export type FastTurnPerformanceSample = {
  success: boolean;
  firstDeltaMs: number | null;
  totalMs: number;
};

type FastTurnGateInput = {
  samples: FastTurnPerformanceSample[];
  minSamples: number;
  minSuccessRate: number;
  maxFirstDeltaP95Ms: number;
  maxTotalP95Ms: number;
};

type FastTurnGateResult = {
  ok: boolean;
  failures: string[];
};

export function nearestRankPercentile(
  values: number[],
  percentile: number,
): number {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !isNonNegativeFiniteNumber(value))
  ) {
    throw new RangeError("Percentile values must be non-negative and finite");
  }
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new RangeError(
      "Percentile must be greater than zero and at most one",
    );
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(percentile * sorted.length);
  return sorted[rank - 1];
}

export function evaluateFastTurnGate(
  input: FastTurnGateInput,
): FastTurnGateResult {
  const failures: string[] = [];

  if (!Number.isInteger(input.minSamples) || input.minSamples <= 0) {
    failures.push("invalid_min_samples");
  }
  if (
    !Number.isFinite(input.minSuccessRate) ||
    input.minSuccessRate < 0 ||
    input.minSuccessRate > 1
  ) {
    failures.push("invalid_min_success_rate");
  }
  if (!isNonNegativeFiniteNumber(input.maxFirstDeltaP95Ms)) {
    failures.push("invalid_max_first_delta_p95_ms");
  }
  if (!isNonNegativeFiniteNumber(input.maxTotalP95Ms)) {
    failures.push("invalid_max_total_p95_ms");
  }
  if (!Array.isArray(input.samples) || input.samples.some(isInvalidSample)) {
    failures.push("invalid_samples");
  }
  if (failures.length > 0) {
    return { ok: false, failures };
  }

  if (input.samples.length < input.minSamples) {
    failures.push("insufficient_samples");
  }

  const successfulSamples = input.samples.filter((sample) => sample.success);
  const successRate = successfulSamples.length / input.samples.length;
  if (successRate < input.minSuccessRate) {
    failures.push("success_rate_below_minimum");
  }

  if (successfulSamples.length > 0) {
    const firstDeltaP95Ms = nearestRankPercentile(
      successfulSamples.map((sample) => sample.firstDeltaMs as number),
      0.95,
    );
    if (firstDeltaP95Ms > input.maxFirstDeltaP95Ms) {
      failures.push("first_delta_p95_exceeded");
    }

    const totalP95Ms = nearestRankPercentile(
      successfulSamples.map((sample) => sample.totalMs),
      0.95,
    );
    if (totalP95Ms > input.maxTotalP95Ms) {
      failures.push("total_p95_exceeded");
    }
  }

  return { ok: failures.length === 0, failures };
}

function isInvalidSample(sample: FastTurnPerformanceSample): boolean {
  if (
    typeof sample !== "object" ||
    sample === null ||
    typeof sample.success !== "boolean" ||
    !isNonNegativeFiniteNumber(sample.totalMs)
  ) {
    return true;
  }

  if (sample.firstDeltaMs === null) {
    return sample.success;
  }
  return (
    !isNonNegativeFiniteNumber(sample.firstDeltaMs) ||
    sample.firstDeltaMs > sample.totalMs
  );
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
