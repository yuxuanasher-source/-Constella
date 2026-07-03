import type { AiActor } from "@/features/ai/contracts";
import {
  createAiDraft,
  type DraftClient,
} from "@/features/ai/draft-repository";

import {
  buildAdmissionCalibrationDraft,
  buildCalibrationProposals,
  computeAdmissionReviewMetrics,
  type CalibrationProposal,
  type MetricRow,
} from "./metrics";

// 校准指标批处理：取窗口内对齐信号 → 计算指标 → 物化 metrics 表 →
// 漏放超阈的卡点生成 L2 校准提案草稿（人工确认，AI 永不自改阈值）。

export const METRICS_DEFAULT_WINDOW_DAYS = 28;

type SignalRow = {
  signal_kind: string;
  payload: unknown;
};

type MetricsJobDb = {
  from(table: "admission_review_signals"): {
    select(columns: string): {
      eq(
        column: "organization_id",
        value: string,
      ): {
        gte(
          column: "created_at",
          value: string,
        ): PromiseLike<{ data: SignalRow[] | null; error: Error | null }>;
      };
    };
  };
  from(table: "admission_review_metrics"): {
    upsert(
      payload: Record<string, unknown>[],
      options: { onConflict: string },
    ): PromiseLike<{ error: Error | null }>;
  };
};

export type AdmissionMetricsRunResult = {
  windowDays: number;
  periodStart: string;
  periodEnd: string;
  metrics: MetricRow[];
  proposals: CalibrationProposal[];
  draftIds: string[];
};

export async function runAdmissionReviewMetrics({
  client,
  actor,
  windowDays = METRICS_DEFAULT_WINDOW_DAYS,
  now = () => new Date(),
}: {
  client: MetricsJobDb & DraftClient;
  actor: AiActor;
  windowDays?: number;
  now?: () => Date;
}): Promise<AdmissionMetricsRunResult> {
  const normalizedWindow = Math.max(1, Math.min(Math.trunc(windowDays), 90));
  const endDate = now();
  const startDate = new Date(
    endDate.getTime() - normalizedWindow * 24 * 60 * 60 * 1000,
  );
  const periodStart = startDate.toISOString().slice(0, 10);
  const periodEnd = endDate.toISOString().slice(0, 10);

  const db = client as MetricsJobDb;
  const { data, error } = await db
    .from("admission_review_signals")
    .select("signal_kind, payload")
    .eq("organization_id", actor.organizationId)
    .gte("created_at", startDate.toISOString());

  if (error) {
    throw error;
  }

  const metrics = computeAdmissionReviewMetrics(data ?? []);

  if (metrics.length) {
    const { error: upsertError } = await db
      .from("admission_review_metrics")
      .upsert(
        metrics.map((row) => ({
          organization_id: actor.organizationId,
          period_start: periodStart,
          period_end: periodEnd,
          metric_key: row.metricKey,
          checkpoint_key: row.checkpointKey,
          numerator: row.numerator,
          denominator: row.denominator,
          computed_at: endDate.toISOString(),
        })),
        {
          onConflict:
            "organization_id,period_start,period_end,metric_key,checkpoint_key",
        },
      );
    if (upsertError) {
      throw upsertError;
    }
  }

  const proposals = buildCalibrationProposals(metrics);
  const draftIds: string[] = [];
  for (const proposal of proposals) {
    const draft = await createAiDraft(client, {
      organizationId: actor.organizationId,
      actingUserId: actor.userId,
      envelope: buildAdmissionCalibrationDraft(proposal, {
        periodStart,
        periodEnd,
      }),
    });
    if (draft) {
      draftIds.push(draft.id);
    }
  }

  return {
    windowDays: normalizedWindow,
    periodStart,
    periodEnd,
    metrics,
    proposals,
    draftIds,
  };
}
