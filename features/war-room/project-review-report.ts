import {
  scoreSupplierQuality,
  type SupplierQualityScore,
  type SupplierQualitySnapshot,
} from "./matching-engine";

export type ProjectReviewInput = {
  project: {
    id: string;
    name: string;
    category: string;
    platform: string;
    periodStart: string;
    periodEnd: string;
  };
  finance: {
    receivableCents: number;
    payableCents: number;
    supplierCostCents: number;
    adjustmentCents: number;
    manualRevenueCents: number;
  };
  streamers: ProjectReviewStreamer[];
  suppliers: SupplierQualitySnapshot[];
  evidenceSummary: {
    green: number;
    yellow: number;
    red: number;
    unknown: number;
  };
  targetMarginBps?: number;
};

export type ProjectReviewStreamer = {
  id: string;
  name: string;
  durationMinutes: number;
  totalViews: number;
  completionRateBps: number;
  roiBps: number;
  grossMarginContributionCents: number;
  anomalyCount: number;
  disputeCount: number;
};

export type ProjectReviewReport = {
  projectId: string;
  projectName: string;
  category: string;
  platform: string;
  periodStart: string;
  periodEnd: string;
  streamerCount: number;
  totalDurationMinutes: number;
  totalViews: number;
  effectiveManualRevenueCents: number;
  receivableCents: number;
  payableCents: number;
  supplierCostCents: number;
  grossMarginCents: number;
  marginRateBps: number;
  bestStreamer: ReviewedStreamer | null;
  worstStreamer: ReviewedStreamer | null;
  supplierPerformance: SupplierQualityScore[];
  evidenceSummary: ProjectReviewInput["evidenceSummary"];
  anomalyCount: number;
  disputeCount: number;
  shouldContinue: boolean;
  nextSuggestedQuoteCents: number;
  nextRoundRecommendations: string[];
  riskNotes: string[];
};

type ReviewedStreamer = {
  streamerId: string;
  name: string;
  score: number;
};

export function buildProjectReviewReport(
  input: ProjectReviewInput,
): ProjectReviewReport {
  const totalDurationMinutes = sumBy(input.streamers, "durationMinutes");
  const totalViews = sumBy(input.streamers, "totalViews");
  const anomalyCount = sumBy(input.streamers, "anomalyCount");
  const disputeCount = sumBy(input.streamers, "disputeCount");
  const receivableCents = safeCents(input.finance.receivableCents);
  const payableCents = safeCents(input.finance.payableCents);
  const supplierCostCents = safeCents(input.finance.supplierCostCents);
  const grossMarginCents =
    receivableCents -
    payableCents -
    supplierCostCents +
    safeCents(input.finance.adjustmentCents);
  const marginRateBps =
    receivableCents > 0
      ? Math.round((grossMarginCents * 10000) / receivableCents)
      : 0;
  const targetMarginBps = safeBps(input.targetMarginBps ?? 3000);
  const reviewedStreamers = input.streamers
    .map(scoreReviewedStreamer)
    .sort((left, right) => right.score - left.score);
  const riskNotes = buildRiskNotes({
    receivableCents,
    grossMarginCents,
    marginRateBps,
    targetMarginBps,
    anomalyCount,
    disputeCount,
  });
  const shouldContinue =
    marginRateBps >= targetMarginBps &&
    grossMarginCents > 0 &&
    anomalyCount <= Math.max(1, input.streamers.length);
  const nextRoundRecommendations = buildRecommendations({
    shouldContinue,
    anomalyCount,
    disputeCount,
    reviewedStreamers,
  });

  return {
    projectId: input.project.id,
    projectName: input.project.name,
    category: input.project.category,
    platform: input.project.platform,
    periodStart: input.project.periodStart,
    periodEnd: input.project.periodEnd,
    streamerCount: input.streamers.length,
    totalDurationMinutes,
    totalViews,
    effectiveManualRevenueCents: safeCents(input.finance.manualRevenueCents),
    receivableCents,
    payableCents,
    supplierCostCents,
    grossMarginCents,
    marginRateBps,
    bestStreamer: reviewedStreamers[0] ?? null,
    worstStreamer: reviewedStreamers.at(-1) ?? null,
    supplierPerformance: input.suppliers.map(scoreSupplierQuality),
    evidenceSummary: input.evidenceSummary,
    anomalyCount,
    disputeCount,
    shouldContinue,
    nextSuggestedQuoteCents: suggestNextQuote({
      receivableCents,
      payableCents,
      supplierCostCents,
      adjustmentCents: safeCents(input.finance.adjustmentCents),
      shouldContinue,
    }),
    nextRoundRecommendations,
    riskNotes,
  };
}

function scoreReviewedStreamer(streamer: ProjectReviewStreamer): ReviewedStreamer {
  const score = clampScore(
    Math.round((safeBps(streamer.completionRateBps) / 10000) * 35) +
      Math.round((Math.min(20000, safeBps(streamer.roiBps)) / 20000) * 30) +
      Math.round(
        (Math.max(0, Math.min(500000, streamer.grossMarginContributionCents)) /
          500000) *
          25,
      ) -
      streamer.anomalyCount * 5 -
      streamer.disputeCount * 10,
  );

  return {
    streamerId: streamer.id,
    name: streamer.name,
    score,
  };
}

function buildRiskNotes({
  receivableCents,
  grossMarginCents,
  marginRateBps,
  targetMarginBps,
  anomalyCount,
  disputeCount,
}: {
  receivableCents: number;
  grossMarginCents: number;
  marginRateBps: number;
  targetMarginBps: number;
  anomalyCount: number;
  disputeCount: number;
}): string[] {
  const notes: string[] = [];
  if (receivableCents <= 0) {
    notes.push("zero_receivable");
  }
  if (grossMarginCents < 0) {
    notes.push("negative_margin");
  } else if (receivableCents > 0 && marginRateBps < targetMarginBps) {
    notes.push("low_margin");
  }
  if (anomalyCount > 0) {
    notes.push("anomalies_present");
  }
  if (disputeCount > 0) {
    notes.push("disputes_present");
  }
  return notes;
}

function buildRecommendations({
  shouldContinue,
  anomalyCount,
  disputeCount,
  reviewedStreamers,
}: {
  shouldContinue: boolean;
  anomalyCount: number;
  disputeCount: number;
  reviewedStreamers: ReviewedStreamer[];
}): string[] {
  const recommendations = shouldContinue
    ? ["continue_project"]
    : ["raise_quote_or_pause"];
  if (reviewedStreamers.length > 0) {
    recommendations.push("retain_best_streamers");
  }
  if (anomalyCount > 0 || disputeCount > 0) {
    recommendations.push("replace_high_risk_streamers");
  }
  return recommendations;
}

function suggestNextQuote({
  receivableCents,
  payableCents,
  supplierCostCents,
  adjustmentCents,
  shouldContinue,
}: {
  receivableCents: number;
  payableCents: number;
  supplierCostCents: number;
  adjustmentCents: number;
  shouldContinue: boolean;
}): number {
  if (receivableCents > 0) {
    return shouldContinue
      ? Math.round(receivableCents * 1.1)
      : Math.round(receivableCents * 1.2);
  }
  return Math.max(0, payableCents + supplierCostCents - adjustmentCents);
}

function sumBy<T, K extends keyof T>(rows: T[], key: K): number {
  return rows.reduce((sum, row) => {
    const value = row[key];
    return sum + (typeof value === "number" ? safeCents(value) : 0);
  }, 0);
}

function safeCents(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function safeBps(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
