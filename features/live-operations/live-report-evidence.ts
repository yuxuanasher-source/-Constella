export type TimeSource = "system" | "screenshot" | "claimed";
export type EvidenceLevel = "green" | "yellow" | "red";

export type ReportEvidenceInput = {
  systemDuration?: number | null;
  screenshotDuration?: number | null;
  claimedDuration?: number | null;
  divergenceThresholdPct?: number;
  divergenceThresholdMin?: number;
};

export type ReportEvidenceSnapshot = {
  settlementDuration: number;
  timeSource: TimeSource;
  evidenceLevel: EvidenceLevel;
  divergencePct: number | null;
  riskFlags: string[];
};

const defaultDivergenceThresholdPct = 0.1;
const defaultDivergenceThresholdMin = 15;

export function resolveReportEvidence(
  input: ReportEvidenceInput,
): ReportEvidenceSnapshot {
  const systemDuration = validDuration(input.systemDuration);
  // A screenshot/claimed duration of 0 means the value was never captured, not
  // that the stream genuinely lasted 0 minutes. Treat it as "not provided" so a
  // missing screenshot is flagged as missing_screenshot_duration instead of
  // being scored as a 100% divergence from the system duration.
  const screenshotDuration = validDuration(input.screenshotDuration, {
    treatZeroAsMissing: true,
  });
  const claimedDuration = validDuration(input.claimedDuration, {
    treatZeroAsMissing: true,
  });
  const riskFlags: string[] = [];

  if (systemDuration !== null) {
    if (screenshotDuration === null) {
      return {
        settlementDuration: systemDuration,
        timeSource: "system",
        evidenceLevel: "yellow",
        divergencePct: null,
        riskFlags: ["missing_screenshot_duration"],
      };
    }

    const divergencePct = roundDivergence(
      Math.abs(systemDuration - screenshotDuration) /
        Math.max(systemDuration, 1),
    );
    const allowedDiff = Math.max(
      systemDuration *
        (input.divergenceThresholdPct ?? defaultDivergenceThresholdPct),
      input.divergenceThresholdMin ?? defaultDivergenceThresholdMin,
    );
    const isAligned =
      Math.abs(systemDuration - screenshotDuration) <= allowedDiff;

    return {
      settlementDuration: systemDuration,
      timeSource: "system",
      evidenceLevel: isAligned ? "green" : "yellow",
      divergencePct,
      riskFlags: isAligned ? riskFlags : ["duration_divergence"],
    };
  }

  riskFlags.push("missing_system_duration");

  if (screenshotDuration !== null) {
    return {
      settlementDuration: screenshotDuration,
      timeSource: "screenshot",
      evidenceLevel: "yellow",
      divergencePct: null,
      riskFlags,
    };
  }

  riskFlags.push("missing_screenshot_duration");

  if (claimedDuration !== null) {
    return {
      settlementDuration: claimedDuration,
      timeSource: "claimed",
      evidenceLevel: "red",
      divergencePct: null,
      riskFlags,
    };
  }

  throw new Error("Report requires system, screenshot, or claimed duration");
}

function validDuration(
  value: number | null | undefined,
  options: { treatZeroAsMissing?: boolean } = {},
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Duration must be a non-negative number");
  }

  const floored = Math.floor(value);
  if (options.treatZeroAsMissing && floored === 0) {
    return null;
  }

  return floored;
}

function roundDivergence(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
