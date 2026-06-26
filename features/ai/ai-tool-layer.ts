import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/audit";

import { runAiGateway } from "./llm-gateway";
import { createAiInvocationId, recordAiInvocation } from "./invocation-ledger";
import { recordAiToolInvocation } from "./tool-ledger";
import {
  scopeAllowsRole,
  type AiActor,
  type AiProvider,
  type AiProviderName,
  type AiTool,
  type AiToolScope,
  type AiUsage,
} from "./contracts";

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
  mode: "deterministic" | "llm";
  answer: string;
  output: Record<string, unknown>;
};

type AiToolOutput = Omit<AiToolResult, "toolName" | "mode" | "invocationId">;

type AiToolLlmConfig = {
  promptKey: string;
  promptVersion: number;
  systemPrompt: string;
  responseSchema: unknown;
  buildUserContent?(
    safeInput: Record<string, unknown>,
    baseline: Record<string, unknown>,
  ): string;
};

type RegisteredAiTool = AiTool<Record<string, unknown>, AiToolOutput> & {
  llm?: AiToolLlmConfig;
};

export type AiToolGateway = {
  providers: AiProvider[];
  primaryProvider?: AiProviderName;
};

type LlmOutcome = {
  mode: "deterministic" | "llm";
  answer: string;
  output: Record<string, unknown>;
  providerName: AiProviderName | "tencent_ocr";
  promptKey?: string;
  promptVersion?: number;
  usage: AiUsage;
  costCents: number;
  degradedReason?: string;
};

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
    handler(input) {
      const report = objectValue(input.report);
      const projectName = stringValue(report.projectName, "未命名项目");
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
  streamer_diagnosis: {
    name: "streamer_diagnosis",
    description:
      "Creates a read-only streamer-safe diagnosis from visible task data.",
    inputSchema: { type: "object" },
    scopes: ["streamer", "mcn_staff"],
    masking: { input: [], output: [], streamerForbiddenKeys },
    readOnly: true,
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
    llm: {
      promptKey: "streamer_diagnosis",
      promptVersion: 1,
      systemPrompt:
        "你是经营舱的主播诊断助手。只能基于用户提供的已脱敏数据，产出对主播安全、可执行的开播复盘建议。" +
        "严格输出 JSON，字段：diagnosisType（traffic_drop 或 content_rhythm）、answer（一句话中文结论）、" +
        "followUpQuestions（字符串数组）、scriptSuggestions（字符串数组）。" +
        "禁止输出任何厂家应收、毛利、成本等内部财务字段。",
      responseSchema: z.object({
        diagnosisType: z.string(),
        answer: z.string(),
        followUpQuestions: z.array(z.string()).min(1),
        scriptSuggestions: z.array(z.string()).min(1),
      }),
    },
  },
};

export function listRegisteredAiTools(): RegisteredAiTool[] {
  return Object.values(registeredTools);
}

export async function runAiToolQuery({
  client,
  actor,
  toolName,
  input,
  gateway,
}: {
  client: AiClient;
  actor: AiActor;
  toolName: string;
  input: Record<string, unknown>;
  gateway?: AiToolGateway;
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
    const baseline = await tool.handler(input, {
      actor,
      invocationId,
    });
    const llmOutcome = await maybeRunLlm({
      tool,
      gateway,
      actor,
      input,
      baseline,
    });
    const latencyMs = Date.now() - startedAt;
    const result: AiToolResult = {
      toolName,
      invocationId,
      mode: llmOutcome.mode,
      answer: llmOutcome.answer,
      output: llmOutcome.output,
    };

    await recordAiInvocation({
      client,
      actor,
      input: {
        id: invocationId,
        scene: "ai_tool_query",
        objectType: "ai_tool",
        objectId: toolName,
        providerName: llmOutcome.providerName,
        primaryProvider: gateway?.primaryProvider,
        status: "succeeded",
        promptKey: llmOutcome.promptKey,
        promptVersion: llmOutcome.promptVersion,
        usage: llmOutcome.usage,
        costCents: llmOutcome.costCents,
        latencyMs,
        degradedReason: llmOutcome.degradedReason,
        metadata: { toolName, mode: llmOutcome.mode },
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

async function maybeRunLlm({
  tool,
  gateway,
  actor,
  input,
  baseline,
}: {
  tool: RegisteredAiTool;
  gateway?: AiToolGateway;
  actor: AiActor;
  input: Record<string, unknown>;
  baseline: AiToolOutput;
}): Promise<LlmOutcome> {
  const fallback: LlmOutcome = {
    mode: "deterministic",
    answer: baseline.answer,
    output: baseline.output,
    providerName: "deterministic",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    costCents: 0,
  };

  if (!gateway || !tool.llm) {
    return fallback;
  }

  // 脱敏后才喂给 LLM：主播端绝不把厂家应收/毛利/成本带进 prompt。
  const safeInput = summarizeForActor(input, actor, tool);
  const userContent = tool.llm.buildUserContent
    ? tool.llm.buildUserContent(safeInput, baseline.output)
    : JSON.stringify({ input: safeInput, baseline: baseline.output });

  const gatewayResult = await runAiGateway({
    providers: gateway.providers,
    primaryProvider: gateway.primaryProvider,
    request: {
      kind: "structured",
      promptKey: tool.llm.promptKey,
      promptVersion: tool.llm.promptVersion,
      responseSchema: tool.llm.responseSchema,
      messages: [
        { role: "system", content: tool.llm.systemPrompt },
        { role: "user", content: userContent },
      ],
    },
  });

  // 只有真实 LLM provider 成功才升级为 llm 模式；其余一律回退确定性兜底，接口不因 LLM 故障而失败。
  if (
    gatewayResult.status !== "succeeded" ||
    !gatewayResult.providerName ||
    gatewayResult.providerName === "deterministic" ||
    !isRecord(gatewayResult.structuredOutput)
  ) {
    return {
      ...fallback,
      degradedReason:
        gatewayResult.degradedReason ??
        gatewayResult.errorSummary ??
        "llm_unavailable",
    };
  }

  const { answer: llmAnswer, ...rest } = gatewayResult.structuredOutput;
  // LLM 输出再过一次脱敏，防止模型回吐敏感字段。
  const mergedOutput = summarizeForActor(
    { ...baseline.output, ...rest },
    actor,
    tool,
  );

  return {
    mode: "llm",
    answer:
      typeof llmAnswer === "string" && llmAnswer.trim()
        ? llmAnswer
        : baseline.answer,
    output: mergedOutput,
    providerName: gatewayResult.providerName,
    promptKey: tool.llm.promptKey,
    promptVersion: tool.llm.promptVersion,
    usage: gatewayResult.usage,
    costCents: gatewayResult.costCents,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
