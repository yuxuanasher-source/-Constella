import { randomUUID } from "node:crypto";

import type { ConversationGatewayContext } from "@/features/ai/conversation-contracts";
import type {
  AiActor,
  AiChatMode,
  AiGatewayResult,
  AiMessage,
  AiProviderName,
} from "@/features/ai/contracts";
import { recordAiInvocation } from "@/features/ai/invocation-ledger";
import {
  createHermesActorAssertionForRun,
  getHermesRunEventResponse,
  readHermesRunEvents,
  resolveHermesRuntimeConfig,
  startHermesRun,
  type HermesConversationMessage,
  type HermesRunEvent,
} from "@/features/ai/hermes/runtime-client";
import { getAuthContext } from "@/lib/auth/context";
import type { AuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

import { buildNativeAssistantContext } from "./context-engine";

const PROMPT_KEY = "xingyao.native-hermes";
const PROMPT_VERSION = 1;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 12_000;

export type NativeHermesExecutorOptions = {
  trustedGatewayContext?: ConversationGatewayContext;
  onContextReady?: (context: ConversationGatewayContext) => Promise<void> | void;
  onGenerationStarted?: (providerName: AiProviderName) => Promise<void> | void;
  nativeAssistant?: {
    conversationId: string;
    invocationId: string;
    sessionId?: string;
  };
};

export async function executeNativeHermesAssistant(
  request: Request,
  options: NativeHermesExecutorOptions = {},
): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  if (!supabase || !auth) {
    return jsonError("Unauthorized", 401);
  }
  if (!isMcnStaff(auth.role)) {
    return jsonError("Only MCN staff can chat with Xingyao AI", 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    messages?: unknown;
    mode?: unknown;
    stream?: unknown;
    pageContext?: unknown;
  };
  const messages = sanitizeMessages(body.messages);
  const lastUserMessage = latestUserMessage(messages);
  if (!lastUserMessage) {
    return jsonError("A non-empty user message is required", 400);
  }

  const config = resolveHermesRuntimeConfig();
  if (!config) {
    return jsonError("Hermes runtime is not configured", 503);
  }

  const conversationId = options.nativeAssistant?.conversationId ?? randomUUID();
  const invocationId = options.nativeAssistant?.invocationId ?? randomUUID();
  const nativeContext = buildNativeAssistantContext({
    auth,
    conversationId,
    invocationId,
    clientRequest: {
      message: lastUserMessage,
      pageContext: body.pageContext,
      attachmentIds: [],
    },
  });
  if (!nativeContext) {
    return jsonError("Hermes actor context is invalid", 403);
  }

  const history = conversationHistoryBeforeLatestUser(messages);
  const gatewayContext = buildGatewayContext({
    messages,
    mode: sanitizeChatMode(body.mode),
    lastUserMessage,
    nativeContext,
  });
  await options.onContextReady?.(gatewayContext);
  await options.onGenerationStarted?.("hermes");

  try {
    const startedAt = Date.now();
    const actorAssertion = await createHermesActorAssertionForRun({
      actor: nativeContext.actor,
      config,
    });
    const run = await startHermesRun({
      actor: nativeContext.actor,
      input: nativeContext.message,
      conversationHistory: history,
      sessionId: options.nativeAssistant?.sessionId,
      config,
      actorAssertion,
    });
    const response = await getHermesRunEventResponse({
      runId: run.runId,
      config,
      actorAssertion,
    });

    return wantsStreamResponse(request, body.stream)
      ? streamNativeHermesResponse({
          response,
          supabase,
          auth,
          mode: gatewayContext.mode,
          runId: run.runId,
          sessionId: run.sessionId,
          startedAt,
          skillAudit: nativeContext.skillAudit,
        })
      : jsonNativeHermesResponse({
          response,
          supabase,
          auth,
          mode: gatewayContext.mode,
          runId: run.runId,
          sessionId: run.sessionId,
          startedAt,
          skillAudit: nativeContext.skillAudit,
        });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Hermes runtime failed",
      502,
    );
  }
}

function streamNativeHermesResponse({
  response,
  supabase,
  auth,
  mode,
  runId,
  sessionId,
  startedAt,
  skillAudit,
}: {
  response: Response;
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  auth: AuthContext;
  mode: AiChatMode;
  runId: string;
  sessionId: string;
  startedAt: number;
  skillAudit: NonNullable<ReturnType<typeof buildNativeAssistantContext>>["skillAudit"];
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      let content = "";
      let terminal = false;
      const toolEvents: HermesRunEvent[] = [];
      try {
        for await (const event of readHermesRunEvents(response)) {
          if (event.event === "message.delta") {
            content += event.data.delta;
            send("delta", { content: event.data.delta, providerName: "hermes" });
            continue;
          }
          if (event.event === "tool.started" || event.event === "tool.completed") {
            toolEvents.push(event);
            continue;
          }
          if (event.event === "run.completed") {
            const invocationId = await recordNativeInvocation({
              supabase,
              auth,
              status: "succeeded",
              content,
              mode,
              runId,
              sessionId,
              startedAt,
              toolEvents,
              skillAudit,
            });
            send("done", {
              message: { role: "assistant", content },
              providerName: "hermes",
              status: "succeeded",
              mode,
              usage: zeroUsage(),
              grounding: nativeGrounding(runId, sessionId),
              knowledge: nativeKnowledge(toolEvents),
              invocationId,
            });
            terminal = true;
            break;
          }
          if (event.event === "run.failed" || event.event === "run.cancelled") {
            const code = event.data.code ?? event.event;
            const invocationId = await recordNativeInvocation({
              supabase,
              auth,
              status: "failed",
              content,
              mode,
              runId,
              sessionId,
              startedAt,
              toolEvents,
              errorSummary: code,
              skillAudit,
            });
            send("error", {
              error: code,
              providerName: "hermes",
              status: "failed",
              invocationId,
            });
            terminal = true;
            break;
          }
        }
        if (!terminal) {
          send("error", {
            error: "Hermes stream ended before a terminal event",
            providerName: "hermes",
            status: "failed",
          });
        }
      } catch (error) {
        send("error", {
          error: error instanceof Error ? error.message : "Hermes stream failed",
          providerName: "hermes",
          status: "failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function jsonNativeHermesResponse(input: {
  response: Response;
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  auth: AuthContext;
  mode: AiChatMode;
  runId: string;
  sessionId: string;
  startedAt: number;
  skillAudit: NonNullable<ReturnType<typeof buildNativeAssistantContext>>["skillAudit"];
}): Promise<Response> {
  let content = "";
  const toolEvents: HermesRunEvent[] = [];
  for await (const event of readHermesRunEvents(input.response)) {
    if (event.event === "message.delta") content += event.data.delta;
    if (event.event === "tool.started" || event.event === "tool.completed") {
      toolEvents.push(event);
    }
    if (event.event === "run.failed" || event.event === "run.cancelled") {
      return jsonError(event.data.code ?? "Hermes run failed", 502);
    }
    if (event.event === "run.completed") {
      const invocationId = await recordNativeInvocation({
        supabase: input.supabase,
        auth: input.auth,
        status: "succeeded",
        content,
        mode: input.mode,
        runId: input.runId,
        sessionId: input.sessionId,
        startedAt: input.startedAt,
        toolEvents,
        skillAudit: input.skillAudit,
      });
      return Response.json({
        message: { role: "assistant", content },
        providerName: "hermes",
        status: "succeeded",
        invocationId,
        mode: input.mode,
        usage: zeroUsage(),
        grounding: nativeGrounding(input.runId, input.sessionId),
        knowledge: nativeKnowledge(toolEvents),
      });
    }
  }
  return jsonError("Hermes stream ended before a terminal event", 502);
}

async function recordNativeInvocation({
  supabase,
  auth,
  status,
  content,
  mode,
  runId,
  sessionId,
  startedAt,
  toolEvents,
  skillAudit,
  errorSummary,
}: {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  auth: AuthContext;
  status: "succeeded" | "failed";
  content: string;
  mode: AiChatMode;
  runId: string;
  sessionId: string;
  startedAt: number;
  toolEvents: HermesRunEvent[];
  skillAudit: NonNullable<ReturnType<typeof buildNativeAssistantContext>>["skillAudit"];
  errorSummary?: string;
}): Promise<string | null> {
  const result: AiGatewayResult = {
    status,
    providerName: "hermes",
    fallbackUsed: false,
    text: content,
    usage: zeroUsage(),
    latencyMs: Math.max(0, Date.now() - startedAt),
    costCents: 0,
    ...(errorSummary ? { errorSummary } : {}),
  };
  return recordAiInvocation({
    client: supabase,
    actor: auth as AiActor,
    input: {
      scene: "dashboard_ai_chat",
      providerName: "hermes",
      primaryProvider: "hermes",
      status,
      promptKey: PROMPT_KEY,
      promptVersion: PROMPT_VERSION,
      usage: result.usage,
      costCents: result.costCents,
      latencyMs: result.latencyMs,
      errorSummary,
      metadata: {
        kernel: "hermes-agent-fork",
        mode,
        runId,
        sessionId,
        skillAudit,
        toolEvents: summarizeToolEvents(toolEvents),
      },
    },
  }).catch(() => null);
}

function buildGatewayContext({
  messages,
  mode,
  lastUserMessage,
  nativeContext,
}: {
  messages: AiMessage[];
  mode: AiChatMode;
  lastUserMessage: string;
  nativeContext: NonNullable<ReturnType<typeof buildNativeAssistantContext>>;
}): ConversationGatewayContext {
  return {
    messages,
    attachments: [],
    mode,
    primaryProvider: "hermes",
    lastUserMessage,
    responseMetadata: {
      grounding: nativeGrounding(
        nativeContext.actor.conversationId,
        nativeContext.actor.invocationId,
      ),
      knowledge: {},
      retrospectiveDraft: null,
    },
    invocationMetadata: {
      kernelId: nativeContext.assistant.kernelId,
      profileVersion: nativeContext.actor.profileVersion,
      allowedReadScopes: nativeContext.actor.allowedReadScopes,
      skillGrantsHash: nativeContext.actor.skillGrantsHash,
    },
  };
}

function nativeGrounding(runId: string, sessionId: string): Record<string, unknown> {
  return {
    assistant: "xingyao-ai",
    kernel: "hermes-agent-fork",
    runId,
    sessionId,
  };
}

function nativeKnowledge(toolEvents: HermesRunEvent[]): Record<string, unknown> {
  return {
    toolEvidence: summarizeToolEvents(toolEvents),
  };
}

function summarizeToolEvents(events: HermesRunEvent[]): Record<string, unknown>[] {
  return events
    .filter((event) => event.event === "tool.completed")
    .map((event) => ({
      toolInvocationId: event.data.toolInvocationId,
      traceId: event.data.traceId,
      evidenceRefs: event.data.evidenceRefs ?? [],
      sourceLabels: event.data.sourceLabels ?? [],
      permissionDenials: event.data.permissionDenials ?? [],
      truncated: Boolean(event.data.truncated),
      error: Boolean(event.data.error),
    }));
}

function sanitizeMessages(value: unknown): AiMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((message): AiMessage | null => {
      if (!isRecord(message)) return null;
      const role =
        message.role === "user" || message.role === "assistant"
          ? message.role
          : null;
      const content =
        typeof message.content === "string"
          ? message.content.trim().slice(0, MAX_MESSAGE_CHARS)
          : "";
      return role && content ? { role, content } : null;
    })
    .filter((message): message is AiMessage => Boolean(message))
    .slice(-MAX_MESSAGES);
}

function latestUserMessage(messages: AiMessage[]): string {
  return [...messages].reverse().find((message) => message.role === "user")
    ?.content ?? "";
}

function conversationHistoryBeforeLatestUser(
  messages: AiMessage[],
): HermesConversationMessage[] {
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
  return (lastUserIndex <= 0 ? [] : messages.slice(0, lastUserIndex)).map(
    (message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }),
  );
}

function sanitizeChatMode(value: unknown): AiChatMode {
  return value === "deep" ? "deep" : "fast";
}

function wantsStreamResponse(request: Request, streamFlag: unknown): boolean {
  return (
    streamFlag === true ||
    (request.headers.get("accept") ?? "").includes("text/event-stream")
  );
}

function zeroUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function jsonError(error: string, status: number): Response {
  return Response.json(
    {
      error,
      providerName: "hermes",
      status: "failed",
    },
    { status },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
