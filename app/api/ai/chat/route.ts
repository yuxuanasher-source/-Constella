import { NextResponse } from "next/server";

import type {
  AiActor,
  AiInvocationStatus,
  AiMessage,
} from "@/features/ai/contracts";
import { buildDashboardChatGrounding } from "@/features/ai/dashboard-chat-grounding";
import { recordAiInvocation } from "@/features/ai/invocation-ledger";
import { runAiGateway } from "@/features/ai/llm-gateway";
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "@/features/ai/provider-registry";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

const PROMPT_KEY = "dashboard.ai.chat";
const PROMPT_VERSION = 1;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4000;

const SYSTEM_PROMPT = [
  "你是经营舱的星耀 AI 助手，服务 MCN 经营团队。",
  "请使用简洁、专业、可执行的中文回答。",
  "只能基于当前对话与系统可见事实分析；缺少数据时要明确说明，不要编造数字、项目或结论。",
  "高风险动作只能给建议和草稿，必须提醒用户由人工确认后执行。",
].join("\n");

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can chat with the AI assistant" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      messages?: unknown;
    };
    const chatMessages = sanitizeMessages(body.messages);
    const lastMessage = chatMessages[chatMessages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") {
      return NextResponse.json(
        { error: "A non-empty user message is required" },
        { status: 400 },
      );
    }

    const providers = createConfiguredAiProviders();
    const realProvider = providers.find(
      (provider) => provider.name !== "deterministic",
    );
    if (!realProvider) {
      return NextResponse.json(
        {
          error:
            "真实 AI 大模型未配置：请设置 DEEPSEEK_API_KEY，并将 AI_PRIMARY_PROVIDER 设为 deepseek",
        },
        { status: 503 },
      );
    }

    const dashboard = await loadRoleHomeDashboard({ supabase, auth }).catch(
      () => null,
    );
    if (!dashboard) {
      return NextResponse.json(
        { error: "无法读取真实业务数据，已停止 AI 分析" },
        { status: 503 },
      );
    }

    const grounding = buildDashboardChatGrounding({ dashboard, auth });
    const routing = resolveAiProviderRouting();
    const primaryProvider = routing.primaryProvider ?? realProvider.name;
    const messages: AiMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: grounding.promptText },
      ...chatMessages,
    ];

    const gatewayResult = await runAiGateway({
      providers,
      primaryProvider,
      request: {
        kind: "text",
        promptKey: PROMPT_KEY,
        promptVersion: PROMPT_VERSION,
        messages,
        metadata: { source: "overview-board" },
      },
    });

    await recordAiInvocation({
      client: supabase,
      actor: auth as AiActor,
      input: {
        scene: "dashboard_ai_chat",
        providerName: gatewayResult.providerName,
        primaryProvider,
        shadowProvider: routing.shadowProvider,
        status: gatewayResult.status as AiInvocationStatus,
        promptKey: PROMPT_KEY,
        promptVersion: PROMPT_VERSION,
        usage: gatewayResult.usage,
        costCents: gatewayResult.costCents,
        latencyMs: gatewayResult.latencyMs,
        degradedReason: gatewayResult.degradedReason,
        errorSummary: gatewayResult.errorSummary,
        metadata: {
          fallbackUsed: gatewayResult.fallbackUsed,
          groundingFactCount: grounding.facts.length,
          groundingMissingDataCount: grounding.missingData.length,
        },
      },
    }).catch(() => {});

    if (
      gatewayResult.status !== "succeeded" ||
      !gatewayResult.text?.trim() ||
      gatewayResult.providerName === "deterministic"
    ) {
      return NextResponse.json(
        {
          error:
            gatewayResult.errorSummary ||
            "真实 AI 大模型调用失败，请检查 DeepSeek 配置或稍后重试",
          providerName: gatewayResult.providerName,
          status: gatewayResult.status,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      message: { role: "assistant", content: gatewayResult.text },
      providerName: gatewayResult.providerName,
      status: gatewayResult.status,
      fallbackUsed: gatewayResult.fallbackUsed,
      usage: gatewayResult.usage,
      grounding: {
        generatedAt: grounding.generatedAt,
        facts: grounding.facts,
        missingData: grounding.missingData,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }

    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

function sanitizeMessages(value: unknown): AiMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((message): AiMessage | null => {
      if (!isRecord(message)) {
        return null;
      }
      const role = sanitizeRole(message.role);
      const content =
        typeof message.content === "string"
          ? message.content.trim().slice(0, MAX_MESSAGE_CHARS)
          : "";
      return role && content ? { role, content } : null;
    })
    .filter((message): message is AiMessage => Boolean(message))
    .slice(-MAX_MESSAGES);
}

function sanitizeRole(value: unknown): AiMessage["role"] | null {
  if (value === "assistant") {
    return "assistant";
  }
  if (value === "user") {
    return "user";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
