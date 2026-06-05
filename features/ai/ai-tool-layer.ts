import { writeAuditLog } from "@/lib/audit/audit";

import { createAiInvocationId, recordAiInvocation } from "./invocation-ledger";
import { recordAiToolInvocation } from "./tool-ledger";
import {
  scopeAllowsRole,
  type AiActor,
  type AiTool,
  type AiToolScope,
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
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        latencyMs,
        metadata: { toolName },
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
