import {
  defaultAdmissionRubric,
  failedHardBlocks,
  normalizeReasonCodes,
  type AdmissionCheckpoint,
  type AdmissionCheckpointResultInput,
  type AdmissionEvaluationDecision,
  type AdmissionEvaluationNoteSource,
  type AdmissionEvaluationRecord,
  type AdmissionReviewStage,
  type AdmissionRubric,
} from "./contracts";

// 审核评估落库：一审 / 二审 / AI 预审共用同一存储结构，天然可对齐。
// 本模块只写 admission_review_evaluations + checkpoint_results；
// 业务状态流转与审计仍在 application-service / share-board 原路径。

type CheckpointRow = {
  rubric_version: number;
  key: string;
  label: string;
  description: string | null;
  severity: AdmissionCheckpoint["severity"];
  applicable_stage: AdmissionCheckpoint["applicableStage"];
  weight: number;
  active: boolean;
};

type EvaluationRow = {
  id: string;
  organization_id: string;
  application_id: string;
  submission_id: string;
  stage: AdmissionReviewStage;
  rubric_version: number;
  decision: AdmissionEvaluationDecision;
  decision_confidence: "high" | "medium" | "low" | null;
  reviewer_id: string | null;
  vendor_review_id: string | null;
  ai_invocation_id: string | null;
  note: string | null;
  note_source: AdmissionEvaluationNoteSource;
  created_at: string;
};

type AbortableQuery<T> = PromiseLike<T> & {
  abortSignal(signal: AbortSignal): PromiseLike<T>;
};

export type AdmissionReviewClient = {
  from(table: "admission_review_checkpoints"): {
    select(columns: string): {
      eq(
        column: "organization_id",
        value: string,
      ): {
        eq(
          column: "active",
          value: boolean,
        ): {
          order(
            column: "rubric_version",
            options: { ascending: boolean },
          ): AbortableQuery<{
            data: CheckpointRow[] | null;
            error: Error | null;
          }>;
        };
      };
    };
  };
  from(table: "admission_review_evaluations"): {
    insert(payload: Record<string, unknown>): {
      select(columns: string): {
        single(): AbortableQuery<{
          data: EvaluationRow | null;
          error: Error | null;
        }>;
      };
    };
  };
  from(table: "admission_review_checkpoint_results"): {
    insert(
      payload: Record<string, unknown>[],
    ): AbortableQuery<{ error: Error | null }>;
  };
};

/**
 * 解析组织卡点字典：有自定义行则用最高版本，否则用内置默认 v1。
 */
export async function resolveAdmissionRubric({
  client,
  organizationId,
  signal,
}: {
  client: AdmissionReviewClient;
  organizationId: string;
  signal?: AbortSignal;
}): Promise<AdmissionRubric> {
  const query = client
    .from("admission_review_checkpoints")
    .select(
      "rubric_version, key, label, description, severity, applicable_stage, weight, active",
    )
    .eq("organization_id", organizationId)
    .eq("active", true)
    .order("rubric_version", { ascending: false });
  const { data, error } = await abortableQuery(query, signal);

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  if (!rows.length) {
    return defaultAdmissionRubric();
  }

  const latestVersion = rows[0].rubric_version;
  return {
    rubricVersion: latestVersion,
    source: "organization",
    checkpoints: rows
      .filter((row) => row.rubric_version === latestVersion)
      .map((row) => ({
        key: row.key,
        label: row.label,
        description: row.description ?? "",
        severity: row.severity,
        applicableStage: row.applicable_stage,
        weight: Number(row.weight) || 1,
        active: row.active,
      })),
  };
}

export type RecordAdmissionEvaluationInput = {
  organizationId: string;
  applicationId: string;
  submissionId: string;
  stage: AdmissionReviewStage;
  decision: AdmissionEvaluationDecision;
  decisionConfidence?: "high" | "medium" | "low";
  reviewerId?: string;
  vendorReviewId?: string;
  aiInvocationId?: string;
  note?: string;
  noteSource?: AdmissionEvaluationNoteSource;
  checkpointResults?: AdmissionCheckpointResultInput[];
  /** 便捷输入：理由码 = fail 的卡点 key（与 checkpointResults 合并去重）。 */
  reasonCodes?: string[];
};

export async function recordAdmissionEvaluation({
  client,
  rubric,
  input,
  signal,
}: {
  client: AdmissionReviewClient;
  rubric: AdmissionRubric;
  input: RecordAdmissionEvaluationInput;
  signal?: AbortSignal;
}): Promise<AdmissionEvaluationRecord> {
  const results = mergeCheckpointResults({ rubric, input });

  // 硬卡点服务端强制：任一硬卡点 fail 时不允许「通过」类决定。
  if (isApprovingDecision(input.decision)) {
    const hardBlocks = failedHardBlocks(rubric, results);
    if (hardBlocks.length) {
      throw new Error(
        `Hard-block checkpoints failed, cannot approve: ${hardBlocks.join(", ")}`,
      );
    }
  }

  const evaluationQuery = client
    .from("admission_review_evaluations")
    .insert({
      organization_id: input.organizationId,
      application_id: input.applicationId,
      submission_id: input.submissionId,
      stage: input.stage,
      rubric_version: rubric.rubricVersion,
      decision: input.decision,
      decision_confidence: input.decisionConfidence ?? null,
      reviewer_id: input.reviewerId ?? null,
      vendor_review_id: input.vendorReviewId ?? null,
      ai_invocation_id: input.aiInvocationId ?? null,
      note: input.note?.trim() || null,
      note_source: input.noteSource ?? "human",
    })
    .select(
      "id, organization_id, application_id, submission_id, stage, rubric_version, decision, decision_confidence, reviewer_id, vendor_review_id, ai_invocation_id, note, note_source, created_at",
    )
    .single();
  const { data, error } = await abortableQuery(evaluationQuery, signal);

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Failed to record admission review evaluation");
  }

  if (results.length) {
    const resultsQuery = client
      .from("admission_review_checkpoint_results")
      .insert(
        results.map((result) => ({
          organization_id: input.organizationId,
          evaluation_id: data.id,
          checkpoint_key: result.checkpointKey,
          verdict: result.verdict,
          confidence: normalizeConfidence(result.confidence),
          note: result.note?.trim() || null,
          evidence: result.evidence ?? {},
        })),
      );
    const { error: resultsError } = await abortableQuery(resultsQuery, signal);
    if (resultsError) {
      throw resultsError;
    }
  }

  return toEvaluationRecord(data);
}

function abortableQuery<T>(
  query: AbortableQuery<T>,
  signal: AbortSignal | undefined,
): PromiseLike<T> {
  return signal ? query.abortSignal(signal) : query;
}

function mergeCheckpointResults({
  rubric,
  input,
}: {
  rubric: AdmissionRubric;
  input: RecordAdmissionEvaluationInput;
}): AdmissionCheckpointResultInput[] {
  const stage = input.stage === "ai_pre_review" ? "mcn_first" : input.stage;
  const results = new Map<string, AdmissionCheckpointResultInput>();

  for (const result of input.checkpointResults ?? []) {
    const [code] = normalizeReasonCodes(rubric, stage, [result.checkpointKey]);
    if (code) {
      results.set(code, { ...result, checkpointKey: code });
    }
  }

  // 理由码是 fail 结果的简写；显式 checkpointResults 优先。
  for (const code of normalizeReasonCodes(
    rubric,
    stage,
    input.reasonCodes ?? [],
  )) {
    if (!results.has(code)) {
      results.set(code, { checkpointKey: code, verdict: "fail" });
    }
  }

  return [...results.values()];
}

function isApprovingDecision(decision: AdmissionEvaluationDecision): boolean {
  return decision === "approved" || decision === "selected";
}

function normalizeConfidence(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}

function toEvaluationRecord(row: EvaluationRow): AdmissionEvaluationRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    applicationId: row.application_id,
    submissionId: row.submission_id,
    stage: row.stage,
    rubricVersion: row.rubric_version,
    decision: row.decision,
    decisionConfidence: row.decision_confidence,
    reviewerId: row.reviewer_id,
    vendorReviewId: row.vendor_review_id,
    aiInvocationId: row.ai_invocation_id,
    note: row.note,
    noteSource: row.note_source,
    createdAt: row.created_at,
  };
}
