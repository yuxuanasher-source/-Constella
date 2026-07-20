import {
  findCheckpoint,
  type AdmissionReviewStage,
  type AdmissionRubric,
} from "./contracts";
import {
  resolveAdmissionRubric,
  type AdmissionReviewClient,
} from "./evaluation-service";

// 主播端结构化驳回反馈：把最近一次驳回/需修改评估的 fail 卡点连同名称
// 回流给主播（哪些卡点没过、怎么改），替代过去只有一段自由文本。

export type StructuredRejectionReason = {
  key: string;
  label: string;
  note: string | null;
  issue: string | null;
  howToImprove: string | null;
  rerecordSuggestion: "none" | "clip" | "full";
  advisoryOnly: true;
};

export type StructuredRejectionFeedback = {
  stage: Exclude<AdmissionReviewStage, "ai_pre_review">;
  decision: string;
  reasons: StructuredRejectionReason[];
  note: string | null;
  createdAt: string;
};

type EvaluationRow = {
  id: string;
  application_id: string;
  stage: string;
  decision: string;
  note: string | null;
  created_at: string;
};

type ResultRow = {
  evaluation_id: string;
  checkpoint_key: string;
  verdict: string;
  note: string | null;
  evidence: Record<string, unknown> | null;
};

type RejectionFeedbackDb = {
  from(table: "admission_review_evaluations"): {
    select(columns: string): {
      in(
        column: "application_id",
        values: string[],
      ): {
        in(
          column: "decision",
          values: string[],
        ): {
          in(
            column: "stage",
            values: string[],
          ): {
            order(
              column: "created_at",
              options: { ascending: boolean },
            ): PromiseLike<{
              data: EvaluationRow[] | null;
              error: Error | null;
            }>;
          };
        };
      };
    };
  };
  from(table: "admission_review_checkpoint_results"): {
    select(columns: string): {
      in(
        column: "evaluation_id",
        values: string[],
      ): {
        eq(
          column: "verdict",
          value: string,
        ): PromiseLike<{ data: ResultRow[] | null; error: Error | null }>;
      };
    };
  };
};

export async function listLatestRejectionFeedback({
  client,
  organizationId,
  applicationIds,
}: {
  client: AdmissionReviewClient & RejectionFeedbackDb;
  organizationId: string;
  applicationIds: string[];
}): Promise<Map<string, StructuredRejectionFeedback>> {
  const feedback = new Map<string, StructuredRejectionFeedback>();
  const ids = applicationIds.filter(Boolean);
  if (!ids.length) {
    return feedback;
  }

  const db = client as RejectionFeedbackDb;
  const { data, error } = await db
    .from("admission_review_evaluations")
    .select("id, application_id, stage, decision, note, created_at")
    .in("application_id", ids)
    .in("decision", ["rejected", "needs_changes"])
    .in("stage", ["mcn_first", "vendor_second"])
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  // 已按时间倒序：每个 application 取最近一条。
  const latestByApplication = new Map<string, EvaluationRow>();
  for (const row of data ?? []) {
    if (!latestByApplication.has(row.application_id)) {
      latestByApplication.set(row.application_id, row);
    }
  }
  if (!latestByApplication.size) {
    return feedback;
  }

  const evaluationIds = [...latestByApplication.values()].map((row) => row.id);
  const { data: results, error: resultsError } = await db
    .from("admission_review_checkpoint_results")
    .select("evaluation_id, checkpoint_key, verdict, note, evidence")
    .in("evaluation_id", evaluationIds)
    .eq("verdict", "fail");

  if (resultsError) {
    throw resultsError;
  }

  const rubric = await resolveAdmissionRubric({ client, organizationId });
  const resultsByEvaluation = new Map<string, ResultRow[]>();
  for (const row of results ?? []) {
    const list = resultsByEvaluation.get(row.evaluation_id) ?? [];
    list.push(row);
    resultsByEvaluation.set(row.evaluation_id, list);
  }

  for (const [applicationId, evaluation] of latestByApplication) {
    feedback.set(applicationId, {
      stage: evaluation.stage as StructuredRejectionFeedback["stage"],
      decision: evaluation.decision,
      note: evaluation.note,
      createdAt: evaluation.created_at,
      reasons: (resultsByEvaluation.get(evaluation.id) ?? []).map((row) => ({
        key: row.checkpoint_key,
        label: checkpointLabel(rubric, row.checkpoint_key),
        note: row.note,
        ...readStructuredFeedback(row.evidence),
      })),
    });
  }

  return feedback;
}

function checkpointLabel(rubric: AdmissionRubric, key: string): string {
  return findCheckpoint(rubric, key)?.label ?? key;
}

export function readStructuredFeedback(evidence: unknown): Pick<
  StructuredRejectionReason,
  "issue" | "howToImprove" | "rerecordSuggestion" | "advisoryOnly"
> {
  const structuredFeedback =
    evidence && typeof evidence === "object"
      ? (evidence as Record<string, unknown>).structuredFeedback
      : null;
  const record =
    structuredFeedback && typeof structuredFeedback === "object"
      ? (structuredFeedback as Record<string, unknown>)
      : {};
  const rerecordSuggestion = record.rerecordSuggestion;

  return {
    issue: readFeedbackText(record.issue),
    howToImprove: readFeedbackText(record.howToImprove),
    rerecordSuggestion:
      rerecordSuggestion === "clip" || rerecordSuggestion === "full"
        ? rerecordSuggestion
        : "none",
    advisoryOnly: true,
  };
}

function readFeedbackText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
