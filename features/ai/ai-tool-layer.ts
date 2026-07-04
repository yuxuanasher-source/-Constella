import { writeAuditLog } from "@/lib/audit/audit";

import { runBusinessCopilotAgent } from "./business-copilot-agent";
import { createAiInvocationId, recordAiInvocation } from "./invocation-ledger";
import { recordAiToolInvocation } from "./tool-ledger";
import { assertRegistrableTool, type AiTier } from "./tiers";
import {
  computeDeviation,
  deviationSummary,
  predictEvidence,
  predictionSummary,
} from "./evidence-prediction";
import {
  blacklistSummary,
  matchBlacklist,
  profileSummaryText,
  summarizeStreamerProfile,
} from "./profile-tools";
import {
  assembleKnowledgeAnswer,
  normalizePassage,
} from "./knowledge-base";
import {
  scopeAllowsRole,
  type AiActor,
  type AiTool,
  type AiToolScope,
} from "./contracts";
import { runXingyaoAssistant } from "./xingyao-assistant";
import type { XingyaoFeatureStore } from "./xingyao-feature-store";
import type { XingyaoRiskWeights } from "./xingyao-risk-radar";
import type { RoleHomeDashboardDto } from "@/features/dashboards/role-home";

type AiClient = {
  from(
    table:
      | "audit_logs"
      | "ai_invocations"
      | "ai_tool_invocations"
      | "usage_events",
  ): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
  };
};

export type AiToolResult = {
  toolName: string;
  invocationId: string;
  mode: "deterministic";
  answer: string;
  output: Record<string, unknown>;
};

type AiToolOutput = Omit<AiToolResult, "toolName" | "mode" | "invocationId">;
type RegisteredAiTool = AiTool<Record<string, unknown>, AiToolOutput>;

const streamerForbiddenKeys = [
  "receivableCents",
  "grossMarginCents",
  "supplierCostCents",
  "costCents",
  "vendorPriceCents",
  "vendorReceivableCents",
  "internalRiskNotes",
  "marginRateBps",
];

const registeredTools: Record<string, RegisteredAiTool> = {
  project_review_summary: {
    name: "project_review_summary",
    description:
      "Summarizes a project review report into a safe recommendation.",
    inputSchema: { type: "object", required: ["report"] },
    scopes: ["mcn_staff"],
    masking: { input: ["report"], output: [], streamerForbiddenKeys },
    readOnly: true,
    tier: "L1_PERCEIVE",
    handler(input) {
      const report = objectValue(input.report);
      const projectName = stringValue(report.projectName, "项目信息缺失");
      const shouldContinue = Boolean(report.shouldContinue);
      const marginRateBps = numberValue(report.marginRateBps);

      return {
        answer: `${projectName} 复盘已生成：利润率 ${marginRateBps} bps，建议${
          shouldContinue ? "继续接并优化主播组合" : "提价或暂停复接"
        }。`,
        output: {
          projectName,
          marginRateBps,
          shouldContinue,
          recommendation: shouldContinue
            ? "continue_project"
            : "raise_quote_or_pause",
        },
      };
    },
  },
  compute_deviation: {
    name: "compute_deviation",
    description:
      "Computes system-vs-screenshot duration deviation against the green/yellow threshold. Read-only, never persisted.",
    inputSchema: {
      type: "object",
      required: ["systemMinutes", "screenMinutes"],
    },
    scopes: ["streamer", "mcn_staff"],
    masking: { input: [], output: [], streamerForbiddenKeys },
    readOnly: true,
    tier: "L1_PERCEIVE",
    handler(input) {
      const result = computeDeviation(input.systemMinutes, input.screenMinutes);
      return { answer: deviationSummary(result), output: { ...result } };
    },
  },
  predict_evidence_color: {
    name: "predict_evidence_color",
    description:
      "Predicts the green/yellow/red evidence color at submit time by reusing the deterministic rule engine. Prediction only — the authoritative color is decided and frozen by the rule engine, not by AI.",
    inputSchema: { type: "object" },
    scopes: ["streamer", "mcn_staff"],
    masking: { input: [], output: [], streamerForbiddenKeys },
    readOnly: true,
    tier: "L1_PERCEIVE",
    handler(input) {
      const prediction = predictEvidence({
        systemMinutes: input.systemMinutes,
        screenMinutes: input.screenMinutes,
        declaredMinutes: input.declaredMinutes ?? input.claimedMinutes,
      });
      return { answer: predictionSummary(prediction), output: { ...prediction } };
    },
  },
  match_blacklist: {
    name: "match_blacklist",
    description:
      "Deterministically checks a streamer's risk signals against the blacklist / high-risk gate for admission. Read-only.",
    inputSchema: { type: "object" },
    scopes: ["mcn_staff"],
    masking: { input: [], output: [], streamerForbiddenKeys },
    readOnly: true,
    tier: "L1_PERCEIVE",
    handler(input) {
      const match = matchBlacklist({
        riskLevel: input.riskLevel,
        riskTags: input.riskTags,
        blacklistReason: input.blacklistReason,
        displayName: input.displayName,
      });
      return { answer: blacklistSummary(match), output: { ...match } };
    },
  },
  query_streamer_profile: {
    name: "query_streamer_profile",
    description:
      "Returns a role-masked streamer profile summary. Streamer-facing callers never see internal risk notes or operation notes.",
    inputSchema: { type: "object", required: ["profile"] },
    scopes: ["streamer", "mcn_staff"],
    masking: { input: ["profile"], output: [], streamerForbiddenKeys },
    readOnly: true,
    tier: "L1_PERCEIVE",
    handler(input, ctx) {
      const summary = summarizeStreamerProfile(
        objectValue(input.profile),
        ctx.actor.role,
      );
      return { answer: profileSummaryText(summary), output: { ...summary } };
    },
  },
  kb_search: {
    name: "kb_search",
    description:
      "Answers from knowledge-base passages with traceable citations. Never fabricates numbers — numeric facts must come from structured queries; returns 无数据 when nothing is retrieved.",
    inputSchema: { type: "object", required: ["query"] },
    scopes: ["mcn_staff"],
    masking: { input: ["passages"], output: [], streamerForbiddenKeys },
    readOnly: true,
    tier: "L1_PERCEIVE",
    handler(input) {
      const passages = Array.isArray(input.passages)
        ? input.passages
            .map((item) => normalizePassage(item))
            .filter((p): p is NonNullable<typeof p> => p !== null)
        : [];
      const result = assembleKnowledgeAnswer(String(input.query ?? ""), passages);
      return {
        answer: result.answer,
        output: {
          hasData: result.hasData,
          citations: result.citations,
          passageCount: passages.length,
        },
      };
    },
  },
  business_copilot_answer: {
    name: "business_copilot_answer",
    description:
      "Answers natural-language business questions from an authorized role dashboard DTO.",
    inputSchema: {
      type: "object",
      required: ["question", "dashboard"],
      properties: {
        question: { type: "string" },
        dashboard: { type: "object" },
      },
    },
    scopes: ["mcn_staff"],
    masking: { input: ["dashboard"], output: [], streamerForbiddenKeys },
    readOnly: true,
    tier: "L1_PERCEIVE",
    handler(input) {
      return {
        answer: "经营问答已生成。",
        output: runBusinessCopilotAgent({
          question: stringValue(input.question, ""),
          dashboard: objectValue(input.dashboard) as RoleHomeDashboardDto,
        }),
      };
    },
  },
  xingyao_org_diagnosis: {
    name: "xingyao_org_diagnosis",
    description:
      "Org-level business diagnosis: attributes ROI gaps and low show rates to concrete streamers/accounts/timeslots, and forecasts attainment/retention/ban/overdue risks from an injected feature store. Deterministic and read-only.",
    inputSchema: {
      type: "object",
      required: ["question", "store"],
      properties: {
        question: { type: "string" },
        store: { type: "object" },
        weights: { type: "object" },
      },
    },
    scopes: ["mcn_staff"],
    masking: { input: ["store"], output: [], streamerForbiddenKeys },
    readOnly: true,
    tier: "L1_PERCEIVE",
    handler(input) {
      const result = runXingyaoAssistant({
        question: stringValue(input.question, ""),
        store: objectValue(input.store) as unknown as XingyaoFeatureStore,
        weights: input.weights
          ? (objectValue(input.weights) as unknown as XingyaoRiskWeights)
          : undefined,
      });
      return {
        answer: result.answer,
        output: {
          intent: result.intent,
          entity: result.entity,
          report: result.report,
          agentOutput: result.output,
          validation: result.validation,
        },
      };
    },
  },
  streamer_diagnosis: {
    name: "streamer_diagnosis",
    description:
      "Creates a read-only streamer-safe diagnosis from visible task data.",
    inputSchema: { type: "object" },
    scopes: ["streamer", "mcn_staff"],
    masking: { input: [], output: [], streamerForbiddenKeys },
    readOnly: true,
    tier: "L1_PERCEIVE",
    handler(input, ctx) {
      const sourceSnapshot =
        ctx.actor.role === "streamer"
          ? stripForbiddenFields(input, streamerForbiddenKeys)
          : input;
      const feedback = Array.isArray(input.feedback)
        ? input.feedback.map(String)
        : [];
      const diagnosisType = feedback.some(
        (item) =>
          item.includes("互动") || item.toLowerCase().includes("interaction"),
      )
        ? "traffic_drop"
        : "content_rhythm";

      return {
        answer: "已基于可见任务、报数和反馈生成卡点诊断建议。",
        output: {
          diagnosisType,
          sourceSnapshot,
          followUpQuestions: [
            "本场开播前 10 分钟是否完成预热视频或粉丝群预热？",
            "前 15 分钟是否有明确福利节点或挑战目标？",
            "下播前是否记录了观众流失最高的时间点？",
          ],
          scriptSuggestions: [
            "把开场 3 分钟改成明确目标 + 福利节点，先建立停留理由。",
            "每 8-10 分钟插入一次互动问题，避免连续讲解导致互动断层。",
            "将复盘截图里的流量下滑点对应到脚本段落，下次优先改这几段。",
          ],
        },
      };
    },
  },
};

// 注册护栏（方案铁律 2 / 第 7.3 节）：只读工具默认 L1_PERCEIVE；任何声明 L4_FORBIDDEN
// 的工具一律拒绝注册——L4 不是「调用被拒」，而是从工具表上根本不存在。
function resolveTier(tool: RegisteredAiTool): AiTier {
  return tool.tier ?? "L1_PERCEIVE";
}
for (const [toolName, tool] of Object.entries(registeredTools)) {
  assertRegistrableTool(toolName, resolveTier(tool));
}

export function listRegisteredAiTools(): RegisteredAiTool[] {
  return Object.values(registeredTools);
}

export async function runAiToolQuery({
  client,
  actor,
  toolName,
  input,
}: {
  client: AiClient;
  actor: AiActor;
  toolName: string;
  input: Record<string, unknown>;
}): Promise<AiToolResult> {
  const tool = registeredTools[toolName];
  if (!tool) {
    throw new Error("AI tool is not registered");
  }

  const invocationId = createAiInvocationId();
  const startedAt = Date.now();

  if (!canRunTool(tool.scopes, actor)) {
    const latencyMs = Date.now() - startedAt;
    await recordAiInvocation({
      client,
      actor,
      input: {
        id: invocationId,
        scene: "ai_tool_query",
        objectType: "ai_tool",
        objectId: toolName,
        providerName: "deterministic",
        status: "failed",
        latencyMs,
        errorSummary: "Current role cannot run this AI tool",
      },
    });
    await recordAiToolInvocation({
      client,
      actor,
      invocationId,
      input: {
        toolName,
        inputSummary: summarizeForActor(input, actor, tool),
        scopes: tool.scopes,
        readOnly: true,
        allowed: false,
        status: "denied",
        latencyMs,
        errorSummary: "Current role cannot run this AI tool",
      },
    });
    throw new Error("Current role cannot run this AI tool");
  }

  try {
    const output = await tool.handler(input, {
      actor,
      invocationId,
    });
    const latencyMs = Date.now() - startedAt;
    const result: AiToolResult = {
      toolName,
      invocationId,
      mode: "deterministic",
      ...output,
    };

    await recordAiInvocation({
      client,
      actor,
      input: {
        id: invocationId,
        scene: "ai_tool_query",
        objectType: "ai_tool",
        objectId: toolName,
        providerName: "deterministic",
        status: "succeeded",
        // 确定性工具没有真实 token 消耗;记 0 并打 mode 标,避免污染用量报表。
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs,
        metadata: { toolName, mode: "deterministic" },
      },
    });
    await recordAiToolInvocation({
      client,
      actor,
      invocationId,
      input: {
        toolName,
        inputSummary: summarizeForActor(input, actor, tool),
        outputSummary: summarizeForActor(result.output, actor, tool),
        scopes: tool.scopes,
        readOnly: true,
        allowed: true,
        status: "succeeded",
        latencyMs,
      },
    });

    await writeAuditLog(client as Parameters<typeof writeAuditLog>[0], {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: actor.role,
      action: "create",
      module: "ai",
      objectType: "ai_query",
      objectName: toolName,
      after: {
        toolName,
        mode: result.mode,
        invocationId,
        actorRole: actor.role,
      },
      changedFields: ["tool_name"],
    });

    return result;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const errorSummary =
      error instanceof Error ? error.message : "AI tool failed unexpectedly";
    await recordAiInvocation({
      client,
      actor,
      input: {
        id: invocationId,
        scene: "ai_tool_query",
        objectType: "ai_tool",
        objectId: toolName,
        providerName: "deterministic",
        status: "failed",
        latencyMs,
        errorSummary,
      },
    });
    await recordAiToolInvocation({
      client,
      actor,
      invocationId,
      input: {
        toolName,
        inputSummary: summarizeForActor(input, actor, tool),
        scopes: tool.scopes,
        readOnly: true,
        allowed: true,
        status: "failed",
        latencyMs,
        errorSummary,
      },
    });
    throw error;
  }
}

function canRunTool(scopes: AiToolScope[], actor: AiActor): boolean {
  return scopes.some((scope) => scopeAllowsRole(scope, actor.role));
}

function summarizeForActor(
  value: Record<string, unknown>,
  actor: AiActor,
  tool: RegisteredAiTool,
): Record<string, unknown> {
  if (actor.role !== "streamer") {
    return value;
  }

  return stripForbiddenFields(
    value,
    tool.masking.streamerForbiddenKeys ?? streamerForbiddenKeys,
  ) as Record<string, unknown>;
}

function stripForbiddenFields(
  value: unknown,
  forbiddenKeys: string[],
): unknown {
  const forbidden = new Set(forbiddenKeys);

  if (Array.isArray(value)) {
    return value.map((item) => stripForbiddenFields(item, forbiddenKeys));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !forbidden.has(key))
        .map(([key, nestedValue]) => [
          key,
          stripForbiddenFields(nestedValue, forbiddenKeys),
        ]),
    );
  }
  return value;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
