import type {
  SupplierQualityScore,
  StreamerMatchResult,
} from "./matching-engine";
import type {
  ProjectPricingResult,
  PricingSettlementMethod,
} from "./pricing-calculator";
import type { ProjectReviewReport } from "./project-review-report";

const settlementMethodLabels: Record<PricingSettlementMethod, string> = {
  cpt: "CPT",
  fixed_budget: "固定预算",
  base_salary: "底薪",
  base_salary_cpt: "底薪 + CPT",
};

export function toPricingResultDto(result: ProjectPricingResult) {
  return {
    estimatedDurationLabel: `${(result.estimatedDurationMinutes / 60).toFixed(1)} h`,
    expectedReceivableLabel: money(result.expectedReceivableCents),
    streamerPayableLabel: money(result.streamerPayableCents),
    supplierCostLabel: money(result.supplierCostCents),
    platformFeeLabel: money(result.platformFeeCents),
    grossMarginLabel: money(result.grossMarginCents),
    marginRateLabel: bps(result.marginRateBps),
    breakEvenQuoteLabel: money(result.breakEvenQuoteCents),
    suggestedMinimumQuoteLabel: money(result.suggestedMinimumQuoteCents),
    recommendedSettlementMethodLabel:
      settlementMethodLabels[result.recommendedSettlementMethod],
    riskNotes: result.riskNotes,
  };
}

export function toStreamerMatchDtos(matches: StreamerMatchResult[]) {
  return matches.map((match) => ({
    id: match.streamerId,
    alias: match.streamerName,
    score: match.score,
    reasons: match.reasons,
    risks: match.riskNotes,
    suggestedSettlementMethodLabel:
      settlementMethodLabels[match.suggestedSettlementMethod],
  }));
}

export function toSupplierQualityDtos(suppliers: SupplierQualityScore[]) {
  return suppliers.map((supplier) => ({
    id: supplier.supplierId,
    name: supplier.supplierName,
    score: supplier.score,
    grade: supplier.grade,
    streamers: 0,
    finishRate: 0,
    anomalyRate: 0,
    grossContrib: 0,
    trend: "+0",
    reasons: supplier.reasons,
    risks: supplier.riskNotes,
  }));
}

export function toProjectReviewDto(report: ProjectReviewReport) {
  return {
    conclusionLabel: report.shouldContinue ? "继续投入" : "谨慎复盘",
    grossMarginLabel: money(report.grossMarginCents),
    marginRateLabel: bps(report.marginRateBps),
    nextSuggestedQuoteLabel: money(report.nextSuggestedQuoteCents),
    totalDurationLabel: `${(report.totalDurationMinutes / 60).toFixed(1)} h`,
    totalViewsLabel: report.totalViews.toLocaleString("zh-CN"),
    bestStreamerLabel: report.bestStreamer?.name ?? "—",
    worstStreamerLabel: report.worstStreamer?.name ?? "—",
    recommendations: report.nextRoundRecommendations,
    riskNotes: report.riskNotes,
  };
}

function money(cents: number | null | undefined) {
  if (typeof cents !== "number") {
    return "—";
  }

  return `${(cents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} 元`;
}

function bps(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}
