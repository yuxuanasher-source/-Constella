export type PricingSettlementMethod =
  | "cpt"
  | "fixed_budget"
  | "base_salary"
  | "base_salary_cpt";

export type ProjectPricingInput = {
  vendorSettlementMethod: PricingSettlementMethod;
  streamerCount: number;
  estimatedMinutesPerStreamer: number;
  vendorBudgetCents?: number | null;
  vendorHourlyRateCents?: number | null;
  vendorBaseFeeCents?: number | null;
  streamerHourlyCostCents?: number | null;
  streamerBaseCostCents?: number | null;
  supplierCostCents?: number | null;
  expectedManualRevenueCents?: number | null;
  platformFeeBps?: number | null;
  manualAdjustmentCents?: number | null;
  targetMarginBps?: number | null;
};

export type ProjectPricingResult = {
  estimatedDurationMinutes: number;
  expectedReceivableCents: number;
  streamerPayableCents: number;
  supplierCostCents: number;
  platformFeeCents: number;
  carriedManualRevenueCents: number;
  manualRevenueEvidenceLevel: "red";
  grossMarginCents: number;
  marginRateBps: number;
  breakEvenQuoteCents: number | null;
  breakEvenVendorHourlyRateCents: number | null;
  suggestedMinimumQuoteCents: number | null;
  suggestedMinimumVendorHourlyRateCents: number | null;
  recommendedSettlementMethod: PricingSettlementMethod;
  riskNotes: string[];
};

export function calculateProjectPricing(
  input: ProjectPricingInput,
): ProjectPricingResult {
  const streamerCount = safeNonNegativeInteger(input.streamerCount);
  const minutesPerStreamer = safeNonNegativeInteger(
    input.estimatedMinutesPerStreamer,
  );
  const estimatedDurationMinutes = streamerCount * minutesPerStreamer;
  const carriedManualRevenueCents = safeCents(input.expectedManualRevenueCents);
  const supplierCostCents = safeCents(input.supplierCostCents);
  const platformFeeBps = safeBps(input.platformFeeBps);
  const manualAdjustmentCents = safeCents(input.manualAdjustmentCents);
  const targetMarginBps = safeBps(input.targetMarginBps ?? 2000);

  const engineReceivableCents = calculateVendorReceivable(
    input,
    estimatedDurationMinutes,
  );
  const expectedReceivableCents =
    engineReceivableCents + carriedManualRevenueCents;
  const streamerPayableCents = calculateStreamerPayable(
    input,
    streamerCount,
    estimatedDurationMinutes,
  );
  const platformFeeCents = divideRound(
    expectedReceivableCents * platformFeeBps,
    10000,
  );
  const grossMarginCents =
    expectedReceivableCents -
    streamerPayableCents -
    supplierCostCents -
    platformFeeCents +
    manualAdjustmentCents;
  const marginRateBps =
    expectedReceivableCents > 0
      ? divideRound(grossMarginCents * 10000, expectedReceivableCents)
      : 0;

  const costBeforeReceivableFee =
    streamerPayableCents + supplierCostCents - manualAdjustmentCents;
  const breakEvenQuoteCents = quoteForMargin({
    costBeforeReceivableFee,
    platformFeeBps,
    targetMarginBps: 0,
  });
  const suggestedMinimumQuoteCents = quoteForMargin({
    costBeforeReceivableFee,
    platformFeeBps,
    targetMarginBps,
  });

  const riskNotes = buildRiskNotes({
    estimatedDurationMinutes,
    expectedReceivableCents,
    grossMarginCents,
    marginRateBps,
    targetMarginBps,
    platformFeeBps,
    suggestedMinimumQuoteCents,
  });

  return {
    estimatedDurationMinutes,
    expectedReceivableCents,
    streamerPayableCents,
    supplierCostCents,
    platformFeeCents,
    carriedManualRevenueCents,
    manualRevenueEvidenceLevel: "red",
    grossMarginCents,
    marginRateBps,
    breakEvenQuoteCents,
    breakEvenVendorHourlyRateCents: hourlyRateForQuote(
      breakEvenQuoteCents,
      estimatedDurationMinutes,
    ),
    suggestedMinimumQuoteCents,
    suggestedMinimumVendorHourlyRateCents: hourlyRateForQuote(
      suggestedMinimumQuoteCents,
      estimatedDurationMinutes,
    ),
    recommendedSettlementMethod:
      estimatedDurationMinutes > 0
        ? input.vendorSettlementMethod
        : "fixed_budget",
    riskNotes,
  };
}

function calculateVendorReceivable(
  input: ProjectPricingInput,
  estimatedDurationMinutes: number,
): number {
  if (input.vendorSettlementMethod === "fixed_budget") {
    return safeCents(input.vendorBudgetCents);
  }

  if (input.vendorSettlementMethod === "base_salary") {
    return safeCents(input.vendorBaseFeeCents ?? input.vendorBudgetCents);
  }

  const cpt = amountForMinutes(
    estimatedDurationMinutes,
    safeCents(input.vendorHourlyRateCents),
  );
  const base =
    input.vendorSettlementMethod === "base_salary_cpt"
      ? safeCents(input.vendorBaseFeeCents)
      : 0;
  return base + cpt;
}

function calculateStreamerPayable(
  input: ProjectPricingInput,
  streamerCount: number,
  estimatedDurationMinutes: number,
): number {
  const cpt = amountForMinutes(
    estimatedDurationMinutes,
    safeCents(input.streamerHourlyCostCents),
  );
  const base = streamerCount * safeCents(input.streamerBaseCostCents);
  return cpt + base;
}

function quoteForMargin({
  costBeforeReceivableFee,
  platformFeeBps,
  targetMarginBps,
}: {
  costBeforeReceivableFee: number;
  platformFeeBps: number;
  targetMarginBps: number;
}): number | null {
  const denominator = 10000 - platformFeeBps - targetMarginBps;
  if (denominator <= 0) {
    return null;
  }
  return divideCeil(Math.max(0, costBeforeReceivableFee) * 10000, denominator);
}

function hourlyRateForQuote(
  quoteCents: number | null,
  estimatedDurationMinutes: number,
): number | null {
  if (quoteCents === null || estimatedDurationMinutes <= 0) {
    return null;
  }
  return divideCeil(quoteCents * 60, estimatedDurationMinutes);
}

function amountForMinutes(minutes: number, hourlyRateCents: number): number {
  return divideRound(minutes * hourlyRateCents, 60);
}

function buildRiskNotes({
  estimatedDurationMinutes,
  expectedReceivableCents,
  grossMarginCents,
  marginRateBps,
  targetMarginBps,
  platformFeeBps,
  suggestedMinimumQuoteCents,
}: {
  estimatedDurationMinutes: number;
  expectedReceivableCents: number;
  grossMarginCents: number;
  marginRateBps: number;
  targetMarginBps: number;
  platformFeeBps: number;
  suggestedMinimumQuoteCents: number | null;
}): string[] {
  const notes: string[] = [];
  if (estimatedDurationMinutes <= 0) {
    notes.push("zero_estimated_duration");
  }
  if (expectedReceivableCents <= 0) {
    notes.push("zero_receivable");
  }
  if (grossMarginCents < 0) {
    notes.push("negative_margin");
  } else if (expectedReceivableCents > 0 && marginRateBps < targetMarginBps) {
    notes.push("low_margin");
  }
  if (platformFeeBps >= 2000) {
    notes.push("high_platform_fee");
  }
  if (suggestedMinimumQuoteCents === null) {
    notes.push("invalid_margin_target");
  }
  return notes;
}

function safeCents(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.trunc(value as number) : 0;
}

function safeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function safeBps(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value as number));
}

function divideRound(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Math.round(numerator / denominator);
}

function divideCeil(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.ceil(numerator / denominator);
}
