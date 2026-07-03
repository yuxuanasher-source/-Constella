// 对齐信号：把「AI 预测 vs 一审」「一审 vs 二审」物化到 admission_review_signals，
// 供校准指标（Phase 3）与自学习检索使用。信号缺任一侧时静默跳过（返回 null），
// 写入失败不阻塞审核主流程（调用方需 catch）。

import type { AdmissionCheckpointVerdict } from "./contracts";

type EvaluationWithResultsRow = {
  id: string;
  application_id: string;
  submission_id: string;
  stage: string;
  decision: string;
  decision_confidence: string | null;
  created_at: string;
  admission_review_checkpoint_results?: Array<{
    checkpoint_key: string;
    verdict: string;
  }> | null;
};

type SignalsDb = {
  from(table: "admission_review_evaluations"): {
    select(columns: string): {
      eq(
        column: "submission_id",
        value: string,
      ): {
        in(
          column: "stage",
          values: string[],
        ): {
          order(
            column: "created_at",
            options: { ascending: boolean },
          ): PromiseLike<{
            data: EvaluationWithResultsRow[] | null;
            error: Error | null;
          }>;
        };
      };
    };
  };
  from(table: "admission_review_signals"): {
    upsert(
      payload: Record<string, unknown>,
      options: { onConflict: string },
    ): PromiseLike<{ error: Error | null }>;
  };
};

const evaluationSelect = [
  "id",
  "application_id",
  "submission_id",
  "stage",
  "decision",
  "decision_confidence",
  "created_at",
  "admission_review_checkpoint_results(checkpoint_key, verdict)",
].join(", ");

export type CheckpointDelta = {
  key: string;
  ai: AdmissionCheckpointVerdict | null;
  mcn: AdmissionCheckpointVerdict | null;
  match: boolean;
};

export type AiVsMcnSignalPayload = {
  aiEvaluationId: string;
  mcnEvaluationId: string;
  aiDecision: string;
  aiConfidence: string | null;
  mcnDecision: string;
  overallAgreement: boolean;
  checkpointDeltas: CheckpointDelta[];
};

export type McnVsVendorSignalPayload = {
  mcnEvaluationId: string;
  vendorEvaluationId: string;
  mcnDecision: string;
  vendorDecision: string;
  vendorReasonCodes: string[];
  /** 一审通过、二审驳回/需修改 = 一审漏判。 */
  mcnMiss: boolean;
};

/**
 * AI 预审 vs 一审对齐。一审提交后调用；任一侧缺失返回 null。
 */
export async function recordAiVsMcnSignal({
  client,
  organizationId,
  submissionId,
}: {
  client: SignalsDb;
  organizationId: string;
  submissionId: string;
}): Promise<AiVsMcnSignalPayload | null> {
  const { ai, mcn } = await loadStagePair(client, submissionId, [
    "ai_pre_review",
    "mcn_first",
  ]).then((byStage) => ({
    ai: byStage.get("ai_pre_review") ?? null,
    mcn: byStage.get("mcn_first") ?? null,
  }));

  if (!ai || !mcn) {
    return null;
  }

  const aiVerdicts = verdictMap(ai);
  const mcnVerdicts = verdictMap(mcn);
  const keys = new Set([...aiVerdicts.keys(), ...mcnVerdicts.keys()]);
  const checkpointDeltas: CheckpointDelta[] = [...keys].sort().map((key) => {
    const aiVerdict = aiVerdicts.get(key) ?? null;
    const mcnVerdict = mcnVerdicts.get(key) ?? null;
    return {
      key,
      ai: aiVerdict,
      mcn: mcnVerdict,
      match: aiVerdict !== null && aiVerdict === mcnVerdict,
    };
  });

  const payload: AiVsMcnSignalPayload = {
    aiEvaluationId: ai.id,
    mcnEvaluationId: mcn.id,
    aiDecision: ai.decision,
    aiConfidence: ai.decision_confidence,
    mcnDecision: mcn.decision,
    overallAgreement: decisionsAgree(ai.decision, mcn.decision),
    checkpointDeltas,
  };

  await upsertSignal(client, {
    organizationId,
    applicationId: mcn.application_id,
    submissionId,
    signalKind: "ai_vs_mcn",
    payload,
  });

  return payload;
}

/**
 * 一审 vs 二审对齐。二审评估落库后调用；任一侧缺失返回 null。
 */
export async function recordMcnVsVendorSignal({
  client,
  organizationId,
  submissionId,
}: {
  client: SignalsDb;
  organizationId: string;
  submissionId: string;
}): Promise<McnVsVendorSignalPayload | null> {
  const byStage = await loadStagePair(client, submissionId, [
    "mcn_first",
    "vendor_second",
  ]);
  const mcn = byStage.get("mcn_first") ?? null;
  const vendor = byStage.get("vendor_second") ?? null;

  if (!mcn || !vendor) {
    return null;
  }

  const vendorNegative =
    vendor.decision === "rejected" || vendor.decision === "needs_changes";
  const payload: McnVsVendorSignalPayload = {
    mcnEvaluationId: mcn.id,
    vendorEvaluationId: vendor.id,
    mcnDecision: mcn.decision,
    vendorDecision: vendor.decision,
    vendorReasonCodes: (vendor.admission_review_checkpoint_results ?? [])
      .filter((result) => result.verdict === "fail")
      .map((result) => result.checkpoint_key),
    mcnMiss: mcn.decision === "approved" && vendorNegative,
  };

  await upsertSignal(client, {
    organizationId,
    applicationId: mcn.application_id,
    submissionId,
    signalKind: "mcn_vs_vendor",
    payload,
  });

  return payload;
}

async function loadStagePair(
  client: SignalsDb,
  submissionId: string,
  stages: string[],
): Promise<Map<string, EvaluationWithResultsRow>> {
  const { data, error } = await client
    .from("admission_review_evaluations")
    .select(evaluationSelect)
    .eq("submission_id", submissionId)
    .in("stage", stages)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  // 已按时间倒序：每个 stage 取最近一条。
  const byStage = new Map<string, EvaluationWithResultsRow>();
  for (const row of data ?? []) {
    if (!byStage.has(row.stage)) {
      byStage.set(row.stage, row);
    }
  }
  return byStage;
}

async function upsertSignal(
  client: SignalsDb,
  input: {
    organizationId: string;
    applicationId: string;
    submissionId: string;
    signalKind: string;
    payload: unknown;
  },
): Promise<void> {
  const { error } = await client.from("admission_review_signals").upsert(
    {
      organization_id: input.organizationId,
      application_id: input.applicationId,
      submission_id: input.submissionId,
      signal_kind: input.signalKind,
      payload: input.payload,
    },
    { onConflict: "submission_id,signal_kind" },
  );
  if (error) {
    throw error;
  }
}

function verdictMap(
  row: EvaluationWithResultsRow,
): Map<string, AdmissionCheckpointVerdict> {
  const map = new Map<string, AdmissionCheckpointVerdict>();
  for (const result of row.admission_review_checkpoint_results ?? []) {
    if (
      result.verdict === "pass" ||
      result.verdict === "fail" ||
      result.verdict === "not_applicable"
    ) {
      map.set(result.checkpoint_key, result.verdict);
    }
  }
  return map;
}

function decisionsAgree(aiDecision: string, mcnDecision: string): boolean {
  if (aiDecision === "manual_review") {
    // AI 主动交人工时不算分歧也不算一致，按不一致计免得虚高一致率。
    return false;
  }
  return aiDecision === mcnDecision;
}
