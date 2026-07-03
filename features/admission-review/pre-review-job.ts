import type { AiActor } from "@/features/ai/contracts";
import type { recordAiInvocation } from "@/features/ai/invocation-ledger";

import type { AdmissionReviewClient } from "./evaluation-service";
import { resolveAdmissionRubric } from "./evaluation-service";
import {
  findTranscriptForSubmission,
  generateAdmissionPreReview,
} from "./pre-review";

// AI 预审批处理：扫描待审/审核中且尚无 ai_pre_review 评估的录屏提交，
// 有转写的生成预审（L2 草稿）。无转写的跳过（等录屏 AI 分析先跑完）。

export const PRE_REVIEW_CLAIM_DEFAULT_LIMIT = 5;
export const PRE_REVIEW_CLAIM_MAX_LIMIT = 10;

type SubmissionRow = {
  id: string;
  organization_id: string;
  application_id: string;
  project_id: string;
  streamer_id: string;
  duration_seconds: number | null;
  submitted_at: string;
};

type PreReviewJobDb = {
  from(table: "recording_submissions"): {
    select(columns: string): {
      eq(
        column: "organization_id",
        value: string,
      ): {
        in(
          column: "status",
          values: string[],
        ): {
          order(
            column: "submitted_at",
            options: { ascending: boolean },
          ): {
            limit(count: number): PromiseLike<{
              data: SubmissionRow[] | null;
              error: Error | null;
            }>;
          };
        };
      };
    };
  };
  from(table: "admission_review_evaluations"): {
    select(columns: string): {
      in(
        column: "submission_id",
        values: string[],
      ): {
        eq(
          column: "stage",
          value: string,
        ): PromiseLike<{
          data: Array<{ submission_id: string }> | null;
          error: Error | null;
        }>;
      };
    };
  };
};

export type PreReviewRunResult = {
  processed: number;
  skippedNoTranscript: number;
  preReviews: Array<{
    submissionId: string;
    decision: string;
    confidence: string;
  }>;
  failures: Array<{ submissionId: string; errorSummary: string }>;
};

export async function runAdmissionPreReviews({
  client,
  actor,
  limit = PRE_REVIEW_CLAIM_DEFAULT_LIMIT,
  generate = generateAdmissionPreReview,
  findTranscript = findTranscriptForSubmission,
}: {
  client: AdmissionReviewClient &
    PreReviewJobDb &
    Parameters<typeof findTranscriptForSubmission>[0]["client"] &
    Parameters<typeof recordAiInvocation>[0]["client"];
  actor: AiActor;
  limit?: number;
  generate?: typeof generateAdmissionPreReview;
  findTranscript?: typeof findTranscriptForSubmission;
}): Promise<PreReviewRunResult> {
  const batchLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.trunc(limit), PRE_REVIEW_CLAIM_MAX_LIMIT))
    : PRE_REVIEW_CLAIM_DEFAULT_LIMIT;

  const db = client as PreReviewJobDb;
  const { data, error } = await db
    .from("recording_submissions")
    .select(
      "id, organization_id, application_id, project_id, streamer_id, duration_seconds, submitted_at",
    )
    .eq("organization_id", actor.organizationId)
    .in("status", ["submitted", "reviewing"])
    .order("submitted_at", { ascending: true })
    .limit(batchLimit * 4);

  if (error) {
    throw error;
  }

  const candidates = data ?? [];
  if (!candidates.length) {
    return {
      processed: 0,
      skippedNoTranscript: 0,
      preReviews: [],
      failures: [],
    };
  }

  const { data: existing, error: existingError } = await db
    .from("admission_review_evaluations")
    .select("submission_id")
    .in(
      "submission_id",
      candidates.map((row) => row.id),
    )
    .eq("stage", "ai_pre_review");
  if (existingError) {
    throw existingError;
  }

  const done = new Set((existing ?? []).map((row) => row.submission_id));
  const pending = candidates
    .filter((row) => !done.has(row.id))
    .slice(0, batchLimit);
  if (!pending.length) {
    return {
      processed: 0,
      skippedNoTranscript: 0,
      preReviews: [],
      failures: [],
    };
  }

  const rubric = await resolveAdmissionRubric({
    client,
    organizationId: actor.organizationId,
  });

  const preReviews: PreReviewRunResult["preReviews"] = [];
  const failures: PreReviewRunResult["failures"] = [];
  let skippedNoTranscript = 0;

  for (const submission of pending) {
    try {
      const transcript = await findTranscript({
        client,
        submissionId: submission.id,
      });
      if (!transcript) {
        skippedNoTranscript += 1;
        continue;
      }

      const result = await generate({
        client,
        actor,
        submission: {
          organizationId: submission.organization_id,
          applicationId: submission.application_id,
          submissionId: submission.id,
          durationSeconds: submission.duration_seconds,
        },
        transcript,
        rubric,
      });

      preReviews.push({
        submissionId: submission.id,
        decision: result.decision,
        confidence: result.confidence,
      });
    } catch (error) {
      failures.push({
        submissionId: submission.id,
        errorSummary:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "pre-review failed",
      });
    }
  }

  return {
    processed: preReviews.length,
    skippedNoTranscript,
    preReviews,
    failures,
  };
}
