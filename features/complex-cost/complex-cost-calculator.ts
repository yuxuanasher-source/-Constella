import type { ProjectCostItemType } from "./complex-cost-types";

export type ComplexCostPreviewInput = {
  expectedReceivableCents: number;
  streamerCount?: number;
  estimatedMinutesPerStreamer?: number;
  streamerHourlyCostCents?: number;
  streamerBaseCostCents?: number;
  supplierCostCents?: number;
  trafficCostCents?: number;
  platformFeeBps?: number;
  manualAdjustmentCents?: number;
};

export type ComplexCostPreviewResult = {
  expectedReceivableCents: number;
  estimatedDurationMinutes: number;
  streamerPayableCents: number;
  supplierCostCents: number;
  trafficCostCents: number;
  platformFeeCents: number;
  manualAdjustmentCents: number;
  grossMarginCents: number;
  marginRateBps: number;
  breakEvenReceivableCents: number;
  suggestedMinimumQuoteCents: number;
  riskNotes: string[];
};

export type ImportedCostAmountInput = {
  itemType: Extract<
    ProjectCostItemType,
    "cpa" | "cps" | "gift" | "supplier_fee" | "traffic" | "platform_fee"
  >;
  unitCount?: number;
  unitPriceCents?: number;
  salesAmountCents?: number;
  rateBps?: number;
  directAmountCents?: number;
};

export function calculateComplexCostPreview(
  input: ComplexCostPreviewInput,
): ComplexCostPreviewResult {
  const expectedReceivableCents = safeCents(input.expectedReceivableCents);
  const streamerCount = safeCount(input.streamerCount);
  const estimatedMinutesPerStreamer = safeCount(
    input.estimatedMinutesPerStreamer,
  );
  const estimatedDurationMinutes = streamerCount * estimatedMinutesPerStreamer;
  const hourlyStreamerCostCents = Math.round(
    (estimatedDurationMinutes / 60) * safeCents(input.streamerHourlyCostCents),
  );
  const baseStreamerCostCents =
    streamerCount * safeCents(input.streamerBaseCostCents);
  const streamerPayableCents = hourlyStreamerCostCents + baseStreamerCostCents;
  const supplierCostCents = safeCents(input.supplierCostCents);
  const trafficCostCents = safeCents(input.trafficCostCents);
  const platformFeeCents = Math.round(
    (expectedReceivableCents * safeBps(input.platformFeeBps)) / 10000,
  );
  const manualAdjustmentCents = safeSignedCents(input.manualAdjustmentCents);
  const breakEvenReceivableCents =
    streamerPayableCents +
    supplierCostCents +
    trafficCostCents +
    platformFeeCents -
    manualAdjustmentCents;
  const grossMarginCents = expectedReceivableCents - breakEvenReceivableCents;
  const marginRateBps = divideRound(
    grossMarginCents * 10000,
    expectedReceivableCents,
  );

  return {
    expectedReceivableCents,
    estimatedDurationMinutes,
    streamerPayableCents,
    supplierCostCents,
    trafficCostCents,
    platformFeeCents,
    manualAdjustmentCents,
    grossMarginCents,
    marginRateBps,
    breakEvenReceivableCents,
    suggestedMinimumQuoteCents: Math.max(
      breakEvenReceivableCents,
      Math.round(breakEvenReceivableCents / 0.8),
    ),
    riskNotes: buildRiskNotes({
      expectedReceivableCents,
      grossMarginCents,
      marginRateBps,
      platformFeeBps: safeBps(input.platformFeeBps),
      trafficCostCents,
    }),
  };
}

export function calculateImportedCostAmountCents(
  input: ImportedCostAmountInput,
): number {
  if (input.itemType === "cpa") {
    return safeCount(input.unitCount) * safeCents(input.unitPriceCents);
  }

  if (input.itemType === "cps" || input.itemType === "gift") {
    return Math.round(
      (safeCents(input.salesAmountCents) * safeBps(input.rateBps)) / 10000,
    );
  }

  return safeCents(input.directAmountCents);
}

function buildRiskNotes({
  expectedReceivableCents,
  grossMarginCents,
  marginRateBps,
  platformFeeBps,
  trafficCostCents,
}: {
  expectedReceivableCents: number;
  grossMarginCents: number;
  marginRateBps: number;
  platformFeeBps: number;
  trafficCostCents: number;
}): string[] {
  const notes: string[] = [];
  if (expectedReceivableCents <= 0) {
    notes.push("missing_receivable");
  }
  if (grossMarginCents < 0) {
    notes.push("negative_margin");
  } else if (marginRateBps > 0 && marginRateBps < 2000) {
    notes.push("low_margin");
  }
  if (platformFeeBps >= 3000) {
    notes.push("high_platform_fee");
  }
  if (trafficCostCents > expectedReceivableCents * 0.5) {
    notes.push("traffic_cost_exceeds_half_receivable");
  }
  return notes;
}

function safeCents(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
}

function safeSignedCents(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.trunc(value as number) : 0;
}

function safeCount(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
}

function safeBps(value: number | null | undefined) {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(10000, Math.trunc(value as number)))
    : 0;
}

function divideRound(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round(numerator / denominator) : 0;
}
