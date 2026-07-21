import type { AiActor } from "@/features/ai/contracts";
import type { recordAiInvocation } from "@/features/ai/invocation-ledger";
import {
  normalizeRecordingGuideRow,
  type RecordingGuideRow,
  type RecordingProductionGuide,
} from "@/features/recordings/recording-production-guide";
import {
  KEY_MOMENT_KEYS,
  RECORDING_PRODUCTION_DIMENSIONS,
  type NormalizedRecordingSelfCheck,
  type RecordingKeyMomentInput,
  type RecordingKeyMomentKey,
} from "@/features/recordings/recording-production-standard";

import type { AdmissionReviewClient } from "./evaluation-service";
import { resolveAdmissionRubric } from "./evaluation-service";
import { findSimilarReviewExamples } from "./few-shot";
import {
  findTranscriptForSubmission,
  generateAdmissionPreReview,
  type AdmissionPreReviewExample,
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
  self_check: unknown;
  key_moments: unknown;
  self_score_total: number | null;
  self_assessment_level: string | null;
  task_card_read_confirmed_at: string | null;
  submitter_note: string | null;
};

type ProjectRecordingGuideRow = RecordingGuideRow & {
  project_id: string;
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
  from(table: "project_recording_guides"): {
    select(columns: string): {
      eq(
        column: "organization_id",
        value: string,
      ): {
        in(
          column: "project_id",
          values: string[],
        ): PromiseLike<{
          data: ProjectRecordingGuideRow[] | null;
          error: Error | null;
        }>;
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
  findExamples = findSimilarReviewExamples,
}: {
  client: AdmissionReviewClient &
    PreReviewJobDb &
    Parameters<typeof findTranscriptForSubmission>[0]["client"] &
    Parameters<typeof recordAiInvocation>[0]["client"];
  actor: AiActor;
  limit?: number;
  generate?: typeof generateAdmissionPreReview;
  findTranscript?: typeof findTranscriptForSubmission;
  findExamples?: typeof findSimilarReviewExamples;
}): Promise<PreReviewRunResult> {
  const batchLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.trunc(limit), PRE_REVIEW_CLAIM_MAX_LIMIT))
    : PRE_REVIEW_CLAIM_DEFAULT_LIMIT;

  const db = client as PreReviewJobDb;
  const { data, error } = await db
    .from("recording_submissions")
    .select(
      "id, organization_id, application_id, project_id, streamer_id, duration_seconds, submitted_at, self_check, key_moments, self_score_total, self_assessment_level, task_card_read_confirmed_at, submitter_note",
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
  const projectGuideByProjectId = await loadProjectRecordingGuides({
    db,
    organizationId: actor.organizationId,
    projectIds: pending.map((row) => row.project_id),
  });

  const preReviews: PreReviewRunResult["preReviews"] = [];
  const failures: PreReviewRunResult["failures"] = [];
  let skippedNoTranscript = 0;
  // few-shot 判例按项目缓存，一个批次同项目只查一次。
  const exampleCache = new Map<string, AdmissionPreReviewExample[]>();

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

      let examples = exampleCache.get(submission.project_id);
      if (!examples) {
        examples = await findExamples({
          client: client as never,
          organizationId: actor.organizationId,
          projectId: submission.project_id,
        }).catch(() => []);
        exampleCache.set(submission.project_id, examples);
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
        examples,
        projectGuide: projectGuideByProjectId.get(submission.project_id) ?? null,
        selfCheck: selfCheckFromSubmission(submission),
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

async function loadProjectRecordingGuides({
  db,
  organizationId,
  projectIds,
}: {
  db: PreReviewJobDb;
  organizationId: string;
  projectIds: string[];
}): Promise<Map<string, RecordingProductionGuide>> {
  const uniqueProjectIds = Array.from(new Set(projectIds.filter(Boolean)));
  if (!uniqueProjectIds.length) {
    return new Map();
  }

  const { data, error } = await db
    .from("project_recording_guides")
    .select(
      "project_id, game_name, game_version, server_region, promotion_goal, target_audience, required_content, required_talking_points, forbidden_content, commercial_actions, technical_standard, template_text, example_url",
    )
    .eq("organization_id", organizationId)
    .in("project_id", uniqueProjectIds);

  if (error) {
    throw error;
  }

  const guides = new Map<string, RecordingProductionGuide>();
  for (const row of data ?? []) {
    const guide = normalizeRecordingGuideRow(row);
    if (guide) {
      guides.set(row.project_id, guide);
    }
  }
  return guides;
}

function selfCheckFromSubmission(
  row: SubmissionRow,
): NormalizedRecordingSelfCheck | null {
  const dimensionScores = normalizeStoredDimensionScores(row.self_check);
  const keyMoments = normalizeStoredKeyMoments(row.key_moments);
  if (
    !row.task_card_read_confirmed_at ||
    !isValidTotalScore(row.self_score_total) ||
    !isSelfAssessmentLevel(row.self_assessment_level) ||
    !dimensionScores ||
    !keyMoments
  ) {
    return null;
  }

  return {
    readConfirmed: true,
    dimensionScores,
    totalScore: row.self_score_total,
    selfLevel: row.self_assessment_level,
    keyMoments,
    note:
      typeof row.submitter_note === "string"
        ? row.submitter_note.trim() || null
        : null,
  };
}

function normalizeStoredDimensionScores(
  input: unknown,
): NormalizedRecordingSelfCheck["dimensionScores"] | null {
  if (!isRecord(input)) {
    return null;
  }

  const scores = {} as NormalizedRecordingSelfCheck["dimensionScores"];
  for (const dimension of RECORDING_PRODUCTION_DIMENSIONS) {
    const value = input[dimension.key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > dimension.weight
    ) {
      return null;
    }
    scores[dimension.key] = value;
  }
  return scores;
}

function normalizeStoredKeyMoments(
  input: unknown,
): RecordingKeyMomentInput[] | null {
  if (!Array.isArray(input)) {
    return null;
  }

  const byKey = new Map<RecordingKeyMomentKey, RecordingKeyMomentInput>();
  for (const item of input) {
    if (!isRecord(item) || !isRecordingKeyMomentKey(item.key)) {
      return null;
    }
    if (byKey.has(item.key)) {
      return null;
    }

    const { startSeconds, endSeconds, note } = item;
    if (
      typeof startSeconds !== "number" ||
      !Number.isInteger(startSeconds) ||
      startSeconds < 0 ||
      typeof endSeconds !== "number" ||
      !Number.isInteger(endSeconds) ||
      endSeconds <= startSeconds ||
      (note !== undefined && typeof note !== "string")
    ) {
      return null;
    }

    byKey.set(item.key, {
      key: item.key,
      startSeconds,
      endSeconds,
      note: note?.trim() || undefined,
    });
  }

  for (const key of KEY_MOMENT_KEYS) {
    if (!byKey.has(key)) {
      return null;
    }
  }
  return KEY_MOMENT_KEYS.map((key) => byKey.get(key)!);
}

function isValidTotalScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}

function isSelfAssessmentLevel(
  value: unknown,
): value is NormalizedRecordingSelfCheck["selfLevel"] {
  return (
    value === "L0" ||
    value === "L1" ||
    value === "L2" ||
    value === "L3" ||
    value === "L4"
  );
}

function isRecordingKeyMomentKey(
  value: unknown,
): value is RecordingKeyMomentKey {
  return KEY_MOMENT_KEYS.some((key) => key === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
