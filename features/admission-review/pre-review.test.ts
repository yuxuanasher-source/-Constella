import { describe, expect, it } from "vitest";

import type { AiProvider } from "@/features/ai/contracts";
import type { recordAiInvocation } from "@/features/ai/invocation-ledger";
import type { runAiGateway } from "@/features/ai/llm-gateway";
import type { RecordingProductionGuide } from "@/features/recordings/recording-production-guide";
import type { NormalizedRecordingSelfCheck } from "@/features/recordings/recording-production-standard";

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

const projectGuide: RecordingProductionGuide = {
  gameName: "星海远征",
  gameVersion: "1.2.0",
  serverRegion: "国服",
  promotionGoal: "首播引导预约并突出福利节奏",
  targetAudience: "策略游戏新手",
  requiredContent: ["展示新手十连福利", "演示主线副本"],
  requiredTalkingPoints: ["福利领取入口", "首日养成路线"],
  forbiddenContent: ["承诺百分百中奖"],
  commercialActions: ["引导点击下载入口"],
  technicalStandard: { minDurationMinutes: 10 },
  templateText: "开场讲目标，中段展示玩法，结尾引导预约。",
  exampleUrl: "https://example.com/demo.mp4",
};

const selfCheck: NormalizedRecordingSelfCheck = {
  readConfirmed: true,
  dimensionScores: {
    product_understanding: 18,
    expression_control: 14,
    content_structure: 12,
    interaction_design: 10,
    commercial_task: 10,
    technical_compliance: 8,
  },
  totalScore: 72,
  selfLevel: "L2",
  keyMoments: [
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
  ],
  note: "互动节奏还需要加强。",
};

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
        evidence: {
          source: "asr_transcript",
          quote: "先讲玩法再抽福利",
          structuredFeedback: {
            issue: null,
            howToImprove: null,
            rerecordSuggestion: "none",
            advisoryOnly: true,
          },
        },
      },
    );
    expect(invocations[0]).toMatchObject({
      scene: "admission.pre_review",
      providerName: "deepseek",
      status: "succeeded",
    });
  });

  it("includes guide and self-check context and records advisory structured feedback", async () => {
    const client = createEvaluationClient();
    const requests: unknown[] = [];
    const runGateway = ((input: unknown) => {
      requests.push(input);
      return Promise.resolve({
        status: "succeeded",
        providerName: "deepseek",
        fallbackUsed: false,
        structuredOutput: {
          decision: "needs_changes",
          confidence: "medium",
          noteDraft: "卖点覆盖不足，建议审核员重点复核福利讲解。",
          checkpoints: [
            {
              key: "script_fit",
              verdict: "fail",
              confidence: 0.76,
              evidence: "先讲玩法再抽福利",
              issue: "没有明确展示新手十连福利。",
              howToImprove: "补充福利领取入口与首日养成路线。",
              rerecordSuggestion: "clip",
            },
          ],
        },
        usage: { promptTokens: 1500, completionTokens: 400, totalTokens: 1900 },
        latencyMs: 1200,
        costCents: 3,
      });
    }) as unknown as typeof runAiGateway;

    await generateAdmissionPreReview({
      client: client as never,
      actor,
      submission,
      transcript,
      rubric: defaultAdmissionRubric(),
      projectGuide,
      selfCheck,
      providers: llmProviders,
      runGateway,
      recordInvocation: collectInvocations([]),
    });

    const request = requests[0] as {
      request: {
        messages: Array<{ role: string; content: string }>;
      };
    };
    const systemPrompt =
      request.request.messages.find((message) => message.role === "system")
        ?.content ?? "";
    const userPrompt =
      request.request.messages.find((message) => message.role === "user")
        ?.content ?? "";

    expect(systemPrompt).toContain("建议补录指定片段");
    expect(systemPrompt).toContain("建议整段重录");
    expect(systemPrompt).not.toContain("必须重录");
    expect(userPrompt).toContain("【项目任务卡】");
    expect(userPrompt).toContain("推广目标: 首播引导预约并突出福利节奏");
    expect(userPrompt).toContain("必须展示: 展示新手十连福利；演示主线副本");
    expect(userPrompt).toContain("【主播自检】");
    expect(userPrompt).toContain("主播自评总分: 72");
    expect(userPrompt).toContain("主播自评等级: L2");
    expect(userPrompt).toContain("best_performance=12-46s");

    expect(client.inserts.admission_review_checkpoint_results[0]).toMatchObject(
      {
        checkpoint_key: "script_fit",
        evidence: {
          source: "asr_transcript",
          quote: "先讲玩法再抽福利",
          structuredFeedback: {
            issue: "没有明确展示新手十连福利。",
            howToImprove: "补充福利领取入口与首日养成路线。",
            rerecordSuggestion: "clip",
            advisoryOnly: true,
          },
        },
      },
    );
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
