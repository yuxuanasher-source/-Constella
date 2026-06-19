import type {
  EvidenceLevel,
  TimeSource,
} from "@/features/live-operations/live-report-evidence";

export type SettlementMethod =
  | "cpt"
  | "cpa"
  | "cps"
  | "gift"
  | "base_salary"
  | "base_salary_cpt"
  | "manual";

export type SettlementEngineReport = {
  id: string;
  settlementDuration: number | null;
  timeSource: TimeSource | null;
  evidenceLevel: EvidenceLevel | null;
};

export type SettlementHourlyTier = {
  // Upper bound of this tier in minutes; null marks the open-ended top tier.
  uptoMinutes: number | null;
  ratePerHour: number;
};

export type SettlementPenaltyTrigger =
  | "red_evidence"
  | "yellow_evidence"
  | "non_system_time";

export type SettlementPenalty = {
  key: string;
  trigger: SettlementPenaltyTrigger;
  mode: "fixed" | "percent";
  // fixed -> currency amount; percent -> bps of the pre-penalty system amount.
  value: number;
  label?: string;
};

export type SettlementRule = {
  settlementMethod: SettlementMethod;
  hourlyRate?: number | null;
  baseSalary?: number | null;
  cpsRateBps?: number | null;
  // Structured extensions (Phase 1): all optional and backward compatible.
  hourlyTiers?: SettlementHourlyTier[] | null;
  penalties?: SettlementPenalty[] | null;
  floorAmount?: number | null;
  capAmount?: number | null;
};

export type SettlementPenaltyApplied = {
  key: string;
  trigger: SettlementPenaltyTrigger;
  label?: string;
  amount: number;
};

export type SettlementBreakdown = {
  baseAmount: number;
  penaltyAmount: number;
  penalties: SettlementPenaltyApplied[];
  floorApplied: boolean;
  capApplied: boolean;
};

export type SettlementCalculatedItem = {
  computedAmount: number;
  manualAmount: number;
  adjustmentAmount: number;
  evidenceLevel: EvidenceLevel | null;
  evidenceSnapshot: Record<string, unknown>;
  breakdown: SettlementBreakdown;
};

export function calculateSettlementItem({
  report,
  rule,
  manualAmount = 0,
  adjustmentAmount = 0,
  includeBaseSalary = true,
}: {
  report: SettlementEngineReport;
  rule: SettlementRule;
  manualAmount?: number;
  adjustmentAmount?: number;
  includeBaseSalary?: boolean;
}): SettlementCalculatedItem {
  const baseAmount = roundCurrency(
    calculateSystemAmount(report, rule, includeBaseSalary),
  );

  const penalties = applyPenalties(report, rule, baseAmount);
  const penaltyAmount = roundCurrency(
    penalties.reduce((total, penalty) => total + penalty.amount, 0),
  );

  const afterPenalty = Math.max(0, baseAmount - penaltyAmount);
  const {
    value: clamped,
    floorApplied,
    capApplied,
  } = clampToBounds(afterPenalty, rule);
  const computedAmount = roundCurrency(clamped);

  return {
    computedAmount,
    manualAmount: roundCurrency(manualAmount),
    adjustmentAmount: roundCurrency(adjustmentAmount),
    evidenceLevel: report.evidenceLevel,
    evidenceSnapshot: {
      liveReportId: report.id,
      settlementDuration: report.settlementDuration,
      timeSource: report.timeSource,
      evidenceLevel: report.evidenceLevel,
    },
    breakdown: {
      baseAmount,
      penaltyAmount,
      penalties,
      floorApplied,
      capApplied,
    },
  };
}

export function calculateCpsManualAmount({
  salesAmount,
  cpsRateBps,
}: {
  salesAmount: number;
  cpsRateBps: number;
}): number {
  if (!Number.isFinite(salesAmount) || salesAmount < 0) {
    throw new Error("salesAmount must be non-negative");
  }
  if (!Number.isInteger(cpsRateBps) || cpsRateBps < 0 || cpsRateBps > 10000) {
    throw new Error("cpsRateBps must be between 0 and 10000");
  }
  return roundCurrency((salesAmount * cpsRateBps) / 10000);
}

export function summarizeEvidence(
  items: Array<{ evidenceLevel: EvidenceLevel | null }>,
) {
  return items.reduce(
    (summary, item) => {
      if (item.evidenceLevel === "green") {
        summary.green += 1;
      } else if (item.evidenceLevel === "yellow") {
        summary.yellow += 1;
      } else if (item.evidenceLevel === "red") {
        summary.red += 1;
      } else {
        summary.unknown += 1;
      }

      return summary;
    },
    { green: 0, yellow: 0, red: 0, unknown: 0 },
  );
}

function calculateSystemAmount(
  report: SettlementEngineReport,
  rule: SettlementRule,
  includeBaseSalary: boolean,
): number {
  if (rule.settlementMethod === "cpa" || rule.settlementMethod === "cps") {
    return 0;
  }

  if (rule.settlementMethod === "gift" || rule.settlementMethod === "manual") {
    return 0;
  }

  const baseSalary =
    includeBaseSalary &&
    (rule.settlementMethod === "base_salary" ||
      rule.settlementMethod === "base_salary_cpt")
      ? (rule.baseSalary ?? 0)
      : 0;
  const cpt =
    rule.settlementMethod === "cpt" ||
    rule.settlementMethod === "base_salary_cpt"
      ? calculateCptAmount(report, rule)
      : 0;

  return baseSalary + cpt;
}

function calculateCptAmount(
  report: SettlementEngineReport,
  rule: SettlementRule,
): number {
  if (report.evidenceLevel !== "green" || report.timeSource !== "system") {
    return 0;
  }

  const durationMinutes = Math.max(0, report.settlementDuration ?? 0);
  const tiers = normalizeHourlyTiers(rule.hourlyTiers);
  if (tiers.length > 0) {
    return calculateTieredCptAmount(durationMinutes, tiers);
  }

  return (durationMinutes / 60) * (rule.hourlyRate ?? 0);
}

function calculateTieredCptAmount(
  durationMinutes: number,
  tiers: SettlementHourlyTier[],
): number {
  let remaining = durationMinutes;
  let lowerBound = 0;
  let total = 0;

  for (const tier of tiers) {
    if (remaining <= 0) {
      break;
    }
    const upper = tier.uptoMinutes == null ? Infinity : tier.uptoMinutes;
    const span = Math.max(0, Math.min(upper, durationMinutes) - lowerBound);
    const minutesInTier = Math.min(remaining, span);
    total += (minutesInTier / 60) * tier.ratePerHour;
    remaining -= minutesInTier;
    lowerBound = upper;
  }

  return total;
}

// Sort tiers by their upper bound; the open-ended (null) tier always sits last.
function normalizeHourlyTiers(
  tiers: SettlementHourlyTier[] | null | undefined,
): SettlementHourlyTier[] {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return [];
  }
  return [...tiers]
    .filter(
      (tier) =>
        tier &&
        Number.isFinite(tier.ratePerHour) &&
        (tier.uptoMinutes == null || Number.isFinite(tier.uptoMinutes)),
    )
    .sort((a, b) => {
      const left = a.uptoMinutes == null ? Infinity : a.uptoMinutes;
      const right = b.uptoMinutes == null ? Infinity : b.uptoMinutes;
      return left - right;
    });
}

function applyPenalties(
  report: SettlementEngineReport,
  rule: SettlementRule,
  baseAmount: number,
): SettlementPenaltyApplied[] {
  if (!Array.isArray(rule.penalties) || rule.penalties.length === 0) {
    return [];
  }

  const applied: SettlementPenaltyApplied[] = [];
  for (const penalty of rule.penalties) {
    if (!penaltyTriggered(penalty.trigger, report)) {
      continue;
    }
    const amount =
      penalty.mode === "percent"
        ? roundCurrency((baseAmount * clampBps(penalty.value)) / 10000)
        : roundCurrency(Math.max(0, penalty.value));
    if (amount <= 0) {
      continue;
    }
    applied.push({
      key: penalty.key,
      trigger: penalty.trigger,
      label: penalty.label,
      amount,
    });
  }
  return applied;
}

function penaltyTriggered(
  trigger: SettlementPenaltyTrigger,
  report: SettlementEngineReport,
): boolean {
  if (trigger === "red_evidence") {
    return report.evidenceLevel === "red";
  }
  if (trigger === "yellow_evidence") {
    return report.evidenceLevel === "yellow";
  }
  if (trigger === "non_system_time") {
    return report.timeSource !== "system";
  }
  return false;
}

function clampToBounds(
  value: number,
  rule: SettlementRule,
): { value: number; floorApplied: boolean; capApplied: boolean } {
  let result = value;
  let floorApplied = false;
  let capApplied = false;

  if (
    rule.floorAmount != null &&
    Number.isFinite(rule.floorAmount) &&
    result < rule.floorAmount
  ) {
    result = rule.floorAmount;
    floorApplied = true;
  }
  if (
    rule.capAmount != null &&
    Number.isFinite(rule.capAmount) &&
    result > rule.capAmount
  ) {
    result = rule.capAmount;
    capApplied = true;
  }

  return { value: result, floorApplied, capApplied };
}

function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10000, value));
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
