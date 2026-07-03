import { describe, expect, it } from "vitest";

import type { AiProvider } from "@/features/ai/contracts";
import type { recordAiInvocation } from "@/features/ai/invocation-ledger";
import type { runAiGateway } from "@/features/ai/llm-gateway";

import { defaultAdmissionRubric } from "./contracts";
import type { AdmissionReviewClient } from "./evaluation-service";
import {
  findTranscriptForSubmission,
  generateAdmissionPreReview,
} from "./pre-review";

const actor = {
  userId: "runner-user",
  name: "Admission Runner",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

const submission = {
  organizationId: "org-1",
  applicationId: "application-1",
  submissionId: "submission-1",
  projectName: "新品首发",
  streamerName: "主播一号",
  durationSeconds: 1800,
};

const transcript = {
  transcriptText: "大家好，今天首播新品，先讲玩法再抽福利。",
  scorecard: { rhythm: 82, compliance: 88 },
  summary: "开场直入主题。",
};

const llmProviders = [
  {
    name: "deepseek",
    capabilities: ["text", "structured", "shadow"],
  } as unknown as AiProvider,
];

function createEvaluationClient() {
  const inserts = {
    admission_review_evaluations: [] as Record<string, unknown>[],
    admission_review_checkpoint_results: [] as Record<string, unknown>[],
  };
  const client = {
    inserts,
    from(table: string) {
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
      if (table === "admission_review_evaluations") {
        return {
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                inserts.admission_review_evaluations.push(payload);
                return {
                  data: {
                    id: "evaluation-1",
                    created_at: "2026-07-03T12:00:00.000Z",
                    ...payload,
                  },
                  error: null,
                };
              },
            }),
          }),
        };
      }
      if (table === "admission_review_checkpoint_results") {
        return {
          insert: async (payload: Record<string, unknown>[]) => {
            inserts.admission_review_checkpoint_results.push(...payload);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return client as unknown as AdmissionReviewClient & {
    inserts: typeof inserts;
  };
}

function gatewayReturning(output: unknown): typeof runAiGateway {
  return (() =>
    Promise.resolve({
      status: "succeeded",
      providerName: "deepseek",
      fallbackUsed: false,
      structuredOutput: output,
      usage: { promptTokens: 1200, completionTokens: 400, totalTokens: 1600 },
      latencyMs: 900,
      costCents: 2,
    })) as unknown as typeof runAiGateway;
}

function collectInvocations(records: Array<Record<string, unknown>>) {
  return (({ input }: { input: Record<string, unknown> }) => {
    records.push(input);
    return Promise.resolve(String(input.id));
  }) as unknown as typeof recordAiInvocation;
}

describe("generateAdmissionPreReview", () => {
  it("maps the LLM output onto rubric checkpoints and records the evaluation", async () => {
    const client = createEvaluationClient();
    const invocations: Array<Record<string, unknown>> = [];

    const result = await generateAdmissionPreReview({
      client: client as never,
      actor,
      submission,
      transcript,
      rubric: defaultAdmissionRubric(),
      providers: llmProviders,
      runGateway: gatewayReturning({
        decision: "needs_changes",
        confidence: "medium",
        noteDraft: "互动引导偏少，建议补充后复审。",
        checkpoints: [
          {
            key: "script_fit",
            verdict: "pass",
            confidence: 0.85,
            evidence: "先讲玩法再抽福利",
          },
          {
            key: "interaction_guidance",
            verdict: "fail",
            confidence: 0.7,
            evidence: "",
          },
          {
            key: "made_up_checkpoint",
            verdict: "fail",
            confidence: 0.9,
            evidence: "编造",
          },
        ],
      }),
      recordInvocation: collectInvocations(invocations),
    });

    expect(result.decision).toBe("needs_changes");
    expect(result.providerName).toBe("deepseek");
    // 编造的卡点被过滤。
    expect(result.checkpointResults.map((item) => item.checkpointKey)).toEqual(
      ["script_fit", "interaction_guidance"],
    );

    expect(client.inserts.admission_review_evaluations[0]).toMatchObject({
      stage: "ai_pre_review",
      decision: "needs_changes",
      decision_confidence: "medium",
      note_source: "llm_classified",
    });
    expect(client.inserts.admission_review_checkpoint_results[0]).toMatchObject(
      {
        checkpoint_key: "script_fit",
        verdict: "pass",
        confidence: 0.85,
        evidence: { source: "asr_transcript", quote: "先讲玩法再抽福利" },
      },
    );
    expect(invocations[0]).toMatchObject({
      scene: "admission.pre_review",
      providerName: "deepseek",
      status: "succeeded",
    });
  });

  it("downgrades approved to manual_review when a hard block failed", async () => {
    const client = createEvaluationClient();

    const result = await generateAdmissionPreReview({
      client: client as never,
      actor,
      submission,
      transcript,
      rubric: defaultAdmissionRubric(),
      providers: llmProviders,
      runGateway: gatewayReturning({
        decision: "approved",
        confidence: "high",
        noteDraft: "整体不错。",
        checkpoints: [
          {
            key: "compliance_violation",
            verdict: "fail",
            confidence: 0.8,
            evidence: "承诺百分百中奖",
          },
        ],
      }),
      recordInvocation: collectInvocations([]),
    });

    expect(result.decision).toBe("manual_review");
    expect(client.inserts.admission_review_evaluations[0]).toMatchObject({
      decision: "manual_review",
    });
  });

  it("throws when the LLM call fails so the runner records a failure", async () => {
    const failingGateway = (() =>
      Promise.resolve({
        status: "failed",
        fallbackUsed: true,
        errorSummary: "all providers failed",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 10,
        costCents: 0,
      })) as unknown as typeof runAiGateway;

    await expect(
      generateAdmissionPreReview({
        client: createEvaluationClient() as never,
        actor,
        submission,
        transcript,
        rubric: defaultAdmissionRubric(),
        providers: llmProviders,
        runGateway: failingGateway,
        recordInvocation: collectInvocations([]),
      }),
    ).rejects.toThrow(/all providers failed/);
  });

  it("requires a real structured provider", async () => {
    await expect(
      generateAdmissionPreReview({
        client: createEvaluationClient() as never,
        actor,
        submission,
        transcript,
        rubric: defaultAdmissionRubric(),
        providers: [],
        runGateway: gatewayReturning({}),
        recordInvocation: collectInvocations([]),
      }),
    ).rejects.toThrow(/requires a real LLM provider/);
  });
});

describe("findTranscriptForSubmission", () => {
  function createLookupClient({
    sources = [{ asset_id: "asset-1" }],
    analyses = [
      {
        transcript_text: "转写内容",
        scorecard: { rhythm: 82, bogus: "text" },
        summary: "摘要",
      },
    ],
  }: {
    sources?: Array<Record<string, unknown>>;
    analyses?: Array<Record<string, unknown>>;
  } = {}) {
    return {
      from(table: string) {
        if (table === "recording_asset_sources") {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({ data: sources, error: null }),
              }),
            }),
          };
        }
        if (table === "recording_ai_analyses") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: async () => ({ data: analyses, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  it("returns the transcript with a numeric-only scorecard", async () => {
    const transcriptSource = await findTranscriptForSubmission({
      client: createLookupClient(),
      submissionId: "submission-1",
    });

    expect(transcriptSource).toEqual({
      transcriptText: "转写内容",
      scorecard: { rhythm: 82 },
      summary: "摘要",
    });
  });

  it("returns null when the submission has no linked asset", async () => {
    await expect(
      findTranscriptForSubmission({
        client: createLookupClient({ sources: [] }),
        submissionId: "submission-1",
      }),
    ).resolves.toBeNull();
  });

  it("returns null when the analysis has no transcript", async () => {
    await expect(
      findTranscriptForSubmission({
        client: createLookupClient({
          analyses: [{ transcript_text: "  ", scorecard: {}, summary: null }],
        }),
        submissionId: "submission-1",
      }),
    ).resolves.toBeNull();
  });
});
