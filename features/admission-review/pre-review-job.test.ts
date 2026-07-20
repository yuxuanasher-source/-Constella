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
    self_check: {},
    key_moments: [],
    self_score_total: null,
    self_assessment_level: null,
    task_card_read_confirmed_at: null,
    submitter_note: null,
    ...overrides,
  };
}

function createJobClient({
  submissions = [submissionRow()],
  preReviewedSubmissionIds = [] as string[],
  projectRecordingGuides = [] as Array<Record<string, unknown>>,
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
      if (table === "project_recording_guides") {
        return {
          select: () => ({
            eq: () => ({
              in: (_column: string, values: string[]) =>
                Promise.resolve({
                  data: projectRecordingGuides.filter((guide) =>
                    values.includes(String(guide.project_id)),
                  ),
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
    const generate = (async (input: Record<string, unknown>) => {
      generated.push(input);
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
    expect(generated[0]).toMatchObject({
      submission: { submissionId: "submission-1" },
      projectGuide: null,
      selfCheck: null,
    });
  });

  it("passes project guide and normalized self-check context to generation", async () => {
    const dimensionScores = {
      product_understanding: 18,
      expression_control: 14,
      content_structure: 12,
      interaction_design: 10,
      commercial_task: 10,
      technical_compliance: 8,
    };
    const keyMoments = [
      {
        key: "best_performance",
        startSeconds: 12,
        endSeconds: 46,
        note: "开场承接较完整",
      },
      {
        key: "selling_point",
        startSeconds: 130,
        endSeconds: 168,
        note: "福利讲解",
      },
      {
        key: "commercial_task",
        startSeconds: 500,
        endSeconds: 530,
        note: "下载入口",
      },
    ];
    const generated: Array<Record<string, unknown>> = [];
    const generate = (async (input: Record<string, unknown>) => {
      generated.push(input);
      return {
        evaluation: { id: "evaluation-1" },
        decision: "needs_changes",
        confidence: "medium",
        noteDraft: "预审意见",
        checkpointResults: [],
        providerName: "deepseek",
      };
    }) as unknown as typeof generateAdmissionPreReview;

    await runAdmissionPreReviews({
      client: createJobClient({
        submissions: [
          submissionRow({
            self_check: dimensionScores,
            key_moments: keyMoments,
            self_score_total: 72,
            self_assessment_level: "L2",
            task_card_read_confirmed_at: "2026-07-03T09:02:00.000Z",
            submitter_note: "互动节奏还需要加强。",
          }),
        ],
        projectRecordingGuides: [
          {
            project_id: "project-1",
            game_name: "星海远征",
            game_version: "1.2.0",
            server_region: "国服",
            promotion_goal: "首播引导预约并突出福利节奏",
            target_audience: "策略游戏新手",
            required_content: ["展示新手十连福利", "演示主线副本"],
            required_talking_points: ["福利领取入口", "首日养成路线"],
            forbidden_content: ["承诺百分百中奖"],
            commercial_actions: ["引导点击下载入口"],
            technical_standard: { minDurationMinutes: 10 },
            template_text: "开场讲目标，中段展示玩法，结尾引导预约。",
            example_url: "https://example.com/demo.mp4",
          },
        ],
      }),
      actor,
      generate,
      findTranscript: transcriptStub,
    });

    expect(generated[0]).toMatchObject({
      submission: { submissionId: "submission-1" },
      projectGuide: {
        gameName: "星海远征",
        promotionGoal: "首播引导预约并突出福利节奏",
        requiredContent: ["展示新手十连福利", "演示主线副本"],
      },
      selfCheck: {
        readConfirmed: true,
        dimensionScores,
        totalScore: 72,
        selfLevel: "L2",
        keyMoments,
        note: "互动节奏还需要加强。",
      },
    });
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
