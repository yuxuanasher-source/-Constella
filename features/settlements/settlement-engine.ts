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

export type SettlementRule = {
  settlementMethod: SettlementMethod;
  hourlyRate?: number | null;
  baseSalary?: number | null;
};

export type SettlementCalculatedItem = {
  computedAmount: number;
  manualAmount: number;
  adjustmentAmount: number;
  evidenceLevel: EvidenceLevel | null;
  evidenceSnapshot: Record<string, unknown>;
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
  const computedAmount = roundCurrency(
    calculateSystemAmount(report, rule, includeBaseSalary),
  );

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
  };
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
      ? calculateCptAmount(report, rule.hourlyRate ?? 0)
      : 0;

  return baseSalary + cpt;
}

function calculateCptAmount(
  report: SettlementEngineReport,
  hourlyRate: number,
): number {
  if (report.evidenceLevel !== "green" || report.timeSource !== "system") {
    return 0;
  }

  return ((report.settlementDuration ?? 0) / 60) * hourlyRate;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
