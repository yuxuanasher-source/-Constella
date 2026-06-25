import {
  buildAutoReviewRolloutMetrics,
  type AuditReviewSample,
  type AutoReviewRolloutMetricsConfig,
  type AutoReviewRolloutMetricsSnapshot,
  type ShadowHumanDecision,
  type ShadowReviewOutcome,
} from "./auto-review-rollout-metrics";

export type AutoReviewRolloutMetricAuditRow = {
  id: string;
  organization_id: string;
  action: string;
  module: string;
  object_type: string;
  object_id: string | null;
  after_json: Record<string, unknown>;
  result: "success" | "failure";
  created_at: string;
};

export type AutoReviewRolloutMetricQueryClient = {
  from(table: "audit_logs"): {
    select(columns: string): AutoReviewRolloutMetricQueryBuilder;
  };
};

type AutoReviewRolloutMetricQueryBuilder = {
  eq(column: string, value: unknown): AutoReviewRolloutMetricQueryBuilder;
  in(column: string, values: unknown[]): AutoReviewRolloutMetricQueryBuilder;
  order(
    column: string,
    options: { ascending: boolean },
  ): AutoReviewRolloutMetricQueryBuilder;
  limit(count: number): PromiseLike<{
    data: AutoReviewRolloutMetricAuditRow[] | null;
    error: Error | null;
  }>;
};

const autoReviewRolloutMetricAuditSelect = `
  id,
  organization_id,
  action,
  module,
  object_type,
  object_id,
  after_json,
  result,
  created_at
`;

export async function listAutoReviewRolloutMetricRows(
  client: AutoReviewRolloutMetricQueryClient,
  input: {
    organizationId: string;
    config: AutoReviewRolloutMetricsConfig;
    limit?: number;
  },
): Promise<AutoReviewRolloutMetricsSnapshot> {
  const { data, error } = await client
    .from("audit_logs")
    .select(autoReviewRolloutMetricAuditSelect)
    .eq("organization_id", input.organizationId)
    .in("module", ["auto_review", "live_report"])
    .eq("object_type", "live_report")
    .eq("result", "success")
    .order("created_at", { ascending: false })
    .limit(safeLimit(input.limit));

  if (error) {
    throw error;
  }

  return buildAutoReviewRolloutMetricsFromAuditRows({
    config: input.config,
    rows: data ?? [],
  });
}

export function buildAutoReviewRolloutMetricsFromAuditRows(input: {
  config: AutoReviewRolloutMetricsConfig;
  rows: AutoReviewRolloutMetricAuditRow[];
}): AutoReviewRolloutMetricsSnapshot {
  const rows = [...input.rows].sort(compareRowsNewestFirst);
  const humanDecisionsByReportId = new Map<string, ShadowHumanDecision>();

  for (const row of rows) {
    if (row.module !== "live_report" || row.object_type !== "live_report") {
      continue;
    }
    if (!row.object_id || humanDecisionsByReportId.has(row.object_id)) {
      continue;
    }
    humanDecisionsByReportId.set(row.object_id, mapHumanDecision(row));
  }

  const shadowOutcomes: ShadowReviewOutcome[] = [];
  const auditSamples: AuditReviewSample[] = [];

  for (const row of rows) {
    if (row.module !== "auto_review" || row.object_type !== "live_report") {
      continue;
    }
    const mode = stringValue(row.after_json.mode);

    if (mode === "shadow") {
      const decision = mapShadowDecision(row.after_json.decision);
      if (!row.object_id || !decision) {
        continue;
      }
      shadowOutcomes.push({
        reportId: row.object_id,
        shadowDecision: decision,
        finalHumanDecision:
          humanDecisionsByReportId.get(row.object_id) ?? "unknown",
      });
    }

    if (mode === "active") {
      const sample = mapAuditSample(row);
      if (sample) {
        auditSamples.push(sample);
      }
    }
  }

  return buildAutoReviewRolloutMetrics({
    config: input.config,
    shadowOutcomes,
    auditSamples,
  });
}

function compareRowsNewestFirst(
  left: AutoReviewRolloutMetricAuditRow,
  right: AutoReviewRolloutMetricAuditRow,
): number {
  return Date.parse(right.created_at) - Date.parse(left.created_at);
}

function mapHumanDecision(
  row: AutoReviewRolloutMetricAuditRow,
): ShadowHumanDecision {
  const status = stringValue(row.after_json.status);

  if (row.action === "approve" || status === "approved") {
    return "approve";
  }
  if (row.action === "reject" && status === "rejected") {
    return "reject";
  }
  if (row.action === "reject" && status === "need_more") {
    return "needs_changes";
  }

  return "unknown";
}

function mapShadowDecision(
  value: unknown,
): ShadowReviewOutcome["shadowDecision"] | null {
  if (
    value === "auto_pass_candidate" ||
    value === "manual_review" ||
    value === "disabled"
  ) {
    return value;
  }

  return null;
}

function mapAuditSample(
  row: AutoReviewRolloutMetricAuditRow,
): AuditReviewSample | null {
  const auditOutcome = objectValue(row.after_json.auditOutcome);
  const expectedDecision = mapAuditDecision(auditOutcome.expectedDecision);
  const actualDecision = mapAuditDecision(auditOutcome.actualDecision);

  if (!expectedDecision || !actualDecision) {
    return null;
  }

  return {
    sampleId: row.id,
    expectedDecision,
    actualDecision,
  };
}

function mapAuditDecision(value: unknown): ShadowHumanDecision | null {
  if (
    value === "approve" ||
    value === "reject" ||
    value === "needs_changes" ||
    value === "unknown"
  ) {
    return value;
  }

  return null;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function safeLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) {
    return 100;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 500);
}
