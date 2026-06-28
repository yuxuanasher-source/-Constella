import { NextResponse } from "next/server";

import type {
  AiActor,
  AiInvocationStatus,
  AiMessage,
} from "@/features/ai/contracts";
import { buildDashboardChatGrounding } from "@/features/ai/dashboard-chat-grounding";
import {
  buildRetrospectiveDraft,
  type AiDraftEnvelope,
  type RetrospectiveMetric,
} from "@/features/ai/drafts";
import {
  createAiDraft,
  type DraftClient,
} from "@/features/ai/draft-repository";
import { recordAiInvocation } from "@/features/ai/invocation-ledger";
import type {
  KnowledgeCitation,
  KnowledgePassage,
} from "@/features/ai/knowledge-base";
import {
  searchKnowledgeDocuments,
  type KnowledgeClient,
} from "@/features/ai/knowledge-repository";
import { runAiGateway } from "@/features/ai/llm-gateway";
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "@/features/ai/provider-registry";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import {
  aggregateReviewKnowledge,
  buildReviewAssist,
  type ReviewAssist,
} from "@/features/live-review/live-review-knowledge";
import { listLiveReviewDocuments } from "@/features/live-review/live-review-service";
import { getAuthContext } from "@/lib/auth/context";
import type { AuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    const knowledgeContext = await buildDashboardKnowledgeContext({
      supabase,
      auth,
      query: lastMessage.content,
      facts: grounding.facts,
    });
    const routing = resolveAiProviderRouting();
    const primaryProvider = routing.primaryProvider ?? realProvider.name;
    const messages: AiMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: grounding.promptText },
      { role: "system", content: knowledgeContext.promptText },
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

    const invocationId = await recordAiInvocation({
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
          knowledgePassageCount: knowledgeContext.passages.length,
          reviewKnowledgeSampleSize: knowledgeContext.reviewAssist.sampleSize,
        },
      },
    }).catch(() => null);

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

    const retrospectiveDraftId = shouldCreateRetrospectiveDraft(
      lastMessage.content,
    )
      ? (
          await createAiDraft(supabase as unknown as DraftClient, {
            organizationId: auth.organizationId,
            actingUserId: auth.userId,
            aiInvocationId: invocationId,
            envelope: knowledgeContext.retrospectiveDraft,
          }).catch(() => null)
        )?.id
      : null;

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
      knowledge: {
        passages: knowledgeContext.passages,
        citations: knowledgeContext.citations,
        reviewAssist: knowledgeContext.reviewAssist,
      },
      retrospectiveDraft: knowledgeContext.retrospectiveDraft,
      retrospectiveDraftId,
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

type DashboardKnowledgeContext = {
  passages: KnowledgePassage[];
  citations: KnowledgeCitation[];
  reviewAssist: ReviewAssist;
  retrospectiveDraft: AiDraftEnvelope;
  promptText: string;
};

async function buildDashboardKnowledgeContext({
  supabase,
  auth,
  query,
  facts,
}: {
  supabase: SupabaseClient;
  auth: AuthContext;
  query: string;
  facts: Array<{ label: string; value?: string; source: string }>;
}): Promise<DashboardKnowledgeContext> {
  const passages = await searchKnowledgeDocuments(
    supabase as unknown as KnowledgeClient,
    {
      organizationId: auth.organizationId,
      query,
      limit: 5,
      candidateLimit: 200,
    },
  ).catch(() => []);

  const citations = passages.map((passage, index) => ({
    index: index + 1,
    title: passage.title,
    sourceRef: passage.sourceRef,
    docId: passage.id,
  }));

  const reviewDocuments = await listLiveReviewDocuments(
    supabase,
    {
      userId: auth.userId,
      name: auth.name,
      role: auth.role,
      organizationId: auth.organizationId,
    },
    { limit: 100 },
  ).catch(() => []);

  const reviewKnowledge = aggregateReviewKnowledge(
    reviewDocuments.map((doc) => ({
      id: doc.id,
      title: doc.title,
      contentMd: doc.contentMd,
      createdAt: doc.createdAt,
    })),
  );
  const reviewAssist = buildReviewAssist(reviewKnowledge, { goal: query });
  const retrospectiveDraft = buildRetrospectiveDraft({
    periodLabel: inferPeriodLabel(query),
    metrics: factsToRetrospectiveMetrics(facts),
    references: citations,
  });

  return {
    passages,
    citations,
    reviewAssist,
    retrospectiveDraft,
    promptText: buildKnowledgePromptText({
      passages,
      citations,
      reviewAssist,
      retrospectiveDraft,
    }),
  };
}

function buildKnowledgePromptText({
  passages,
  citations,
  reviewAssist,
  retrospectiveDraft,
}: {
  passages: KnowledgePassage[];
  citations: KnowledgeCitation[];
  reviewAssist: ReviewAssist;
  retrospectiveDraft: AiDraftEnvelope;
}): string {
  return [
    "知识库引用包：",
    JSON.stringify(
      {
        passages: passages.map((passage) => ({
          title: passage.title,
          snippet: passage.snippet,
          sourceRef: passage.sourceRef,
          docId: passage.id,
          tags: passage.tags,
        })),
        citations,
        reviewAssist: {
          sampleSize: reviewAssist.sampleSize,
          suggestions: reviewAssist.suggestions,
          watchOuts: reviewAssist.watchOuts,
          reusableWins: reviewAssist.reusableWins,
          assistMarkdown: reviewAssist.assistMarkdown,
        },
        retrospectiveDraft,
      },
      null,
      2,
    ),
    "",
    "知识库使用规则：",
    "1. 用户询问复盘、沉淀、归因、SOP、历史打法或改进建议时，必须优先结合 passages 与 reviewAssist。",
    "2. 引用知识库结论时必须标注 sourceRef 或 docId；没有命中时明确说明知识库暂无相关历史经验。",
    "3. 知识库只用于解释、归因和经验复用；金额、时长、ROI、数量等数字仍以真实业务事实包为准。",
    "4. retrospectiveDraft 只是待人工确认的复盘沉淀草稿，不代表已发布或已写入知识库。",
    "5. 如果用户要求沉淀/学习，把建议表达为“可保存到知识库的草稿”，提醒人工确认后再入库。",
  ].join("\n");
}

function factsToRetrospectiveMetrics(
  facts: Array<{ label: string; value?: string; source: string }>,
): RetrospectiveMetric[] {
  return facts
    .filter((fact) => fact.value)
    .slice(0, 12)
    .map((fact) => {
      const parsed = splitValueAndUnit(fact.value ?? "");
      return {
        label: fact.label,
        value: parsed.value,
        ...(parsed.unit ? { unit: parsed.unit } : {}),
        sourceRef: fact.source,
      };
    });
}

function splitValueAndUnit(value: string): { value: string; unit?: string } {
  const text = String(value ?? "").trim();
  const match = /^(.+?)\s+([^\s]+)$/.exec(text);
  if (!match) {
    return { value: text };
  }
  return { value: match[1], unit: match[2] };
}

function inferPeriodLabel(query: string): string {
  const text = String(query ?? "");
  if (text.includes("今日") || text.includes("今天")) return "今日经营复盘";
  if (text.includes("本周")) return "本周经营复盘";
  if (text.includes("本月")) return "本月经营复盘";
  if (text.includes("上月")) return "上月经营复盘";
  return "经营复盘";
}

function shouldCreateRetrospectiveDraft(query: string): boolean {
  return /(复盘|沉淀|经验|报告|总结)/.test(String(query ?? ""));
}
