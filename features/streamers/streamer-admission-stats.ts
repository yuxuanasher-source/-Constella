export type StreamerAdmissionCheckpointResultRow = {
  organization_id: string;
  checkpoint_key: string;
  verdict: string;
};

export type StreamerAdmissionEvaluationRow = {
  id: string;
  vendor_review_id?: string | null;
  submission_id?: string | null;
  organization_id: string;
  stage: string;
  decision?: string | null;
  created_at?: string | null;
  admission_review_checkpoint_results?:
    | StreamerAdmissionCheckpointResultRow[]
    | null;
};

export type StreamerVendorReviewRow = {
  id: string;
  organization_id: string;
  decision: string;
  submitted_at?: string | null;
};

export type StreamerAdmissionApplicationRow = {
  organization_id: string;
  project_recording_vendor_reviews?: StreamerVendorReviewRow[] | null;
  admission_review_evaluations?: StreamerAdmissionEvaluationRow[] | null;
};

export type StreamerAdmissionStats = {
  vendorPassRateBps: number | null;
  rejectionReasonHistogram: Record<string, number>;
  evaluatedCount: number;
  mcnFirstPassRateBps: number | null;
  mcnFirstEvaluatedCount: number;
};

const EVALUATED_VENDOR_DECISIONS = new Set([
  "selected",
  "backup",
  "rejected",
  "needs_changes",
]);

export function aggregateStreamerAdmissionStats({
  applications,
  organizationId,
}: {
  applications: StreamerAdmissionApplicationRow[] | null | undefined;
  organizationId: string;
}): StreamerAdmissionStats {
  const reviews = new Map<string, string>();
  const failedCheckpointKeysByEvaluation = new Map<string, Set<string>>();
  const latestMcnEvaluationBySubmission = new Map<
    string,
    StreamerAdmissionEvaluationRow
  >();

  for (const application of applications ?? []) {
    if (application.organization_id !== organizationId) {
      continue;
    }

    for (const review of application.project_recording_vendor_reviews ?? []) {
      if (
        review.id &&
        review.organization_id === organizationId &&
        EVALUATED_VENDOR_DECISIONS.has(review.decision) &&
        !reviews.has(review.id)
      ) {
        reviews.set(review.id, review.decision);
      }
    }

    for (const evaluation of application.admission_review_evaluations ?? []) {
      if (!evaluation.id || evaluation.organization_id !== organizationId) {
        continue;
      }

      if (evaluation.stage === "mcn_first") {
        const submissionId = evaluation.submission_id?.trim();
        const decision = evaluation.decision?.trim();
        if (
          !submissionId ||
          !decision ||
          decision === "pending" ||
          decision === "manual_review"
        ) {
          continue;
        }
        const current = latestMcnEvaluationBySubmission.get(submissionId);
        if (!current || isLaterEvaluation(evaluation, current)) {
          latestMcnEvaluationBySubmission.set(submissionId, evaluation);
        }
        continue;
      }

      if (evaluation.stage !== "vendor_second") {
        continue;
      }

      const reasonSampleId = evaluation.vendor_review_id?.trim() || evaluation.id;
      let failedCheckpointKeys =
        failedCheckpointKeysByEvaluation.get(reasonSampleId);
      if (!failedCheckpointKeys) {
        failedCheckpointKeys = new Set<string>();
        failedCheckpointKeysByEvaluation.set(
          reasonSampleId,
          failedCheckpointKeys,
        );
      }

      for (const result of evaluation.admission_review_checkpoint_results ??
        []) {
        const checkpointKey = result.checkpoint_key.trim();
        if (
          result.organization_id === organizationId &&
          result.verdict === "fail" &&
          checkpointKey
        ) {
          failedCheckpointKeys.add(checkpointKey);
        }
      }
    }
  }

  const rejectionReasonCounts = new Map<string, number>();
  for (const failedCheckpointKeys of failedCheckpointKeysByEvaluation.values()) {
    for (const checkpointKey of failedCheckpointKeys) {
      rejectionReasonCounts.set(
        checkpointKey,
        (rejectionReasonCounts.get(checkpointKey) ?? 0) + 1,
      );
    }
  }

  const rejectionReasonHistogram = Object.fromEntries(
    [...rejectionReasonCounts.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );

  const evaluatedCount = reviews.size;
  const passedCount = [...reviews.values()].filter(
    (decision) => decision === "selected",
  ).length;
  const mcnFirstEvaluatedCount = latestMcnEvaluationBySubmission.size;
  const mcnFirstPassedCount = [
    ...latestMcnEvaluationBySubmission.values(),
  ].filter(
    (evaluation) =>
      evaluation.decision === "approved" ||
      evaluation.decision === "selected",
  ).length;

  return {
    vendorPassRateBps:
      evaluatedCount === 0
        ? null
        : Math.max(
            0,
            Math.min(
              10_000,
              Math.round((passedCount * 10_000) / evaluatedCount),
            ),
          ),
    rejectionReasonHistogram,
    evaluatedCount,
    mcnFirstPassRateBps:
      mcnFirstEvaluatedCount === 0
        ? null
        : Math.max(
            0,
            Math.min(
              10_000,
              Math.round(
                (mcnFirstPassedCount * 10_000) / mcnFirstEvaluatedCount,
              ),
            ),
          ),
    mcnFirstEvaluatedCount,
  };
}

function isLaterEvaluation(
  candidate: StreamerAdmissionEvaluationRow,
  current: StreamerAdmissionEvaluationRow,
): boolean {
  const candidateTime = dateMs(candidate.created_at);
  const currentTime = dateMs(current.created_at);
  return (
    candidateTime > currentTime ||
    (candidateTime === currentTime && candidate.id.localeCompare(current.id) > 0)
  );
}

function dateMs(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
