import { writeAuditLog } from "@/lib/audit/audit";
import type { AuthContext } from "@/lib/auth/context";
import type { AppRole } from "@/lib/rbac/roles";
import { isMcnStaff } from "@/lib/rbac/roles";

type AiClient = {
  from(table: "audit_logs"): unknown;
};

type AiActor = Pick<AuthContext, "userId" | "name" | "role" | "organizationId">;

export type AiToolResult = {
  toolName: string;
  mode: "placeholder";
  answer: string;
  output: Record<string, unknown>;
};

type AiToolDefinition = {
  canRun(role: AppRole): boolean;
  run(input: Record<string, unknown>, actor: AiActor): Omit<AiToolResult, "toolName" | "mode">;
};

const registeredTools: Record<string, AiToolDefinition> = {
  project_review_summary: {
    canRun: isMcnStaff,
    run(input) {
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
          recommendation: shouldContinue ? "continue_project" : "raise_quote_or_pause",
        },
      };
    },
  },
  streamer_diagnosis: {
    canRun(role) {
      return role === "streamer" || isMcnStaff(role);
    },
    run(input, actor) {
      const sourceSnapshot =
        actor.role === "streamer" ? stripStreamerForbiddenFields(input) : input;
      const feedback = Array.isArray(input.feedback)
        ? input.feedback.map(String)
        : [];
      const diagnosisType = feedback.some((item) => item.includes("互动"))
        ? "traffic_drop"
        : "content_rhythm";

      return {
        answer: "已基于可见任务、报数和反馈生成卡点诊断占位建议。",
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
            "将复盘截图里流量下滑点对应到脚本段落，下次优先改这几段。",
          ],
        },
      };
    },
  },
};

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
  if (!tool.canRun(actor.role)) {
    throw new Error("Current role cannot run this AI tool");
  }

  const output = tool.run(input, actor);
  const result = {
    toolName,
    mode: "placeholder" as const,
    ...output,
  };

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
      actorRole: actor.role,
    },
    changedFields: ["tool_name"],
  });

  return result;
}

const streamerForbiddenKeys = new Set([
  "receivableCents",
  "grossMarginCents",
  "supplierCostCents",
  "costCents",
  "vendorPriceCents",
  "vendorReceivableCents",
  "internalRiskNotes",
  "marginRateBps",
]);

function stripStreamerForbiddenFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripStreamerForbiddenFields);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !streamerForbiddenKeys.has(key))
        .map(([key, nestedValue]) => [key, stripStreamerForbiddenFields(nestedValue)]),
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
