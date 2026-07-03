import { describe, expect, it } from "vitest";

import type {
  findTranscriptForSubmission,
  generateAdmissionPreReview,
} from "./pre-review";
import { runAdmissionPreReviews } from "./pre-review-job";

const actor = {
  userId: "runner-user",
  name: "Admission Runner",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

function submissionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "submission-1",
    organization_id: "org-1",
    application_id: "application-1",
    project_id: "project-1",
    streamer_id: "streamer-1",
    duration_seconds: 1800,
    submitted_at: "2026-07-03T09:00:00.000Z",
    ...overrides,
  };
}

function createJobClient({
  submissions = [submissionRow()],
  preReviewedSubmissionIds = [] as string[],
} = {}) {
  return {
    from(table: string) {
      if (table === "recording_submissions") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: async () => ({ data: submissions, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "admission_review_evaluations") {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({
                data: preReviewedSubmissionIds.map((id) => ({
                  submission_id: id,
                })),
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "admission_review_checkpoints") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

const transcriptStub = (async ({ submissionId }: { submissionId: string }) =>
  submissionId === "submission-no-transcript"
    ? null
    : {
        transcriptText: "转写内容",
        scorecard: {},
        summary: null,
      }) as typeof findTranscriptForSubmission;

describe("runAdmissionPreReviews", () => {
  it("generates pre-reviews for pending submissions with transcripts", async () => {
    const generated: Array<Record<string, unknown>> = [];
    const generate = (async (input: { submission: { submissionId: string } }) => {
      generated.push(input.submission);
      return {
        evaluation: { id: "evaluation-1" },
        decision: "needs_changes",
        confidence: "medium",
        noteDraft: "预审意见",
        checkpointResults: [],
        providerName: "deepseek",
      };
    }) as unknown as typeof generateAdmissionPreReview;

    const result = await runAdmissionPreReviews({
      client: createJobClient(),
      actor,
      generate,
      findTranscript: transcriptStub,
    });

    expect(result.processed).toBe(1);
    expect(result.preReviews).toEqual([
      {
        submissionId: "submission-1",
        decision: "needs_changes",
        confidence: "medium",
      },
    ]);
    expect(generated[0]).toMatchObject({ submissionId: "submission-1" });
  });

  it("skips submissions that already have a pre-review", async () => {
    const result = await runAdmissionPreReviews({
      client: createJobClient({ preReviewedSubmissionIds: ["submission-1"] }),
      actor,
      generate: (() => {
        throw new Error("should not generate");
      }) as unknown as typeof generateAdmissionPreReview,
      findTranscript: transcriptStub,
    });

    expect(result.processed).toBe(0);
  });

  it("counts submissions without transcripts separately", async () => {
    const result = await runAdmissionPreReviews({
      client: createJobClient({
        submissions: [submissionRow({ id: "submission-no-transcript" })],
      }),
      actor,
      generate: (() => {
        throw new Error("should not generate");
      }) as unknown as typeof generateAdmissionPreReview,
      findTranscript: transcriptStub,
    });

    expect(result.processed).toBe(0);
    expect(result.skippedNoTranscript).toBe(1);
  });

  it("collects per-submission failures without aborting the batch", async () => {
    const generate = (async (input: { submission: { submissionId: string } }) => {
      if (input.submission.submissionId === "submission-1") {
        throw new Error("llm exploded");
      }
      return {
        evaluation: { id: "evaluation-2" },
        decision: "approved",
        confidence: "high",
        noteDraft: "ok",
        checkpointResults: [],
        providerName: "deepseek",
      };
    }) as unknown as typeof generateAdmissionPreReview;

    const result = await runAdmissionPreReviews({
      client: createJobClient({
        submissions: [
          submissionRow(),
          submissionRow({ id: "submission-2" }),
        ],
      }),
      actor,
      generate,
      findTranscript: transcriptStub,
    });

    expect(result.processed).toBe(1);
    expect(result.failures).toEqual([
      { submissionId: "submission-1", errorSummary: "llm exploded" },
    ]);
  });
});
