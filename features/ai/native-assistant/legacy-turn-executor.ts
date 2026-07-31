import type {
  ConversationContextSnapshot,
  ConversationGatewayContext,
} from "../conversation-contracts";
import type {
  AiAttachment,
  AiChatMode,
  AiMessage,
  AiProviderName,
} from "../contracts";
import type {
  ConversationTurnExecutor,
  ConversationTurnExecutorInput,
} from "../conversation-stream-adapter";
import type { ConversationActor } from "../conversation-service";
import { executeNativeHermesAssistant } from "./executor";

type PreparedTurn = {
  turn: { mode: AiChatMode };
  messages: AiMessage[];
  snapshot: ConversationContextSnapshot;
};

export type LegacyConversationTurnService = {
  prepareTurn(
    actor: ConversationActor,
    turnId: string,
    groundingRefs?: string[],
  ): Promise<PreparedTurn>;
  markGenerating(
    actor: ConversationActor,
    turnId: string,
    providerName?: AiProviderName,
    invocationId?: string,
  ): Promise<void>;
  markValidating(actor: ConversationActor, turnId: string): Promise<void>;
  completeTurn(
    actor: ConversationActor,
    turnId: string,
    input: {
      content: string;
      providerName?: AiProviderName;
      invocationId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void>;
  failTurn(
    actor: ConversationActor,
    turnId: string,
    input: {
      content?: string;
      providerName?: AiProviderName;
      invocationId?: string;
      errorCode: string;
      errorSummary: string;
      retryable: boolean;
    },
  ): Promise<void>;
  captureGatewayContext(
    actor: ConversationActor,
    turnId: string,
    snapshot: ConversationContextSnapshot,
    gatewayContext: ConversationGatewayContext,
  ): Promise<ConversationContextSnapshot | void>;
  renewLease?(actor: ConversationActor, turnId: string): Promise<void>;
};

type LegacyEvent = {
  event: string;
  data: Record<string, unknown>;
};

type ConversationTurnExecutorOptions = {
  trustedGatewayContext?: ConversationGatewayContext;
  onContextReady?: (
    context: ConversationGatewayContext,
  ) => Promise<void> | void;
  onGenerationStarted?: (providerName: AiProviderName) => Promise<void> | void;
  nativeAssistant?: {
    conversationId: string;
    invocationId: string;
  };
};

export type ExecuteLegacyChat = (
  request: Request,
  options?: ConversationTurnExecutorOptions,
) => Promise<Response>;

export function createLegacyTurnExecutor({
  executeLegacyChat = executeNativeHermesAssistant,
}: {
  executeLegacyChat?: ExecuteLegacyChat;
} = {}): ConversationTurnExecutor<LegacyConversationTurnService> {
  return {
    async *execute({
      request,
      actor,
      turn,
      attachments,
      service,
    }: ConversationTurnExecutorInput<LegacyConversationTurnService>) {
      let accumulatedContent = "";
      let providerName: AiProviderName | undefined;
      let invocationId: string | undefined;

      yield {
        type: "turn.started",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        userMessageId: turn.userMessageId,
        assistantMessageId: turn.assistantMessageId,
      };

      const prepared = await service.prepareTurn(actor, turn.turnId, [
        "dashboard:role-home",
        "xingyao:feature-store",
        "knowledge-base",
        "web-search",
      ]);

      const legacyResponse = await executeLegacyChat(
        buildLegacyChatRequest({
          request,
          messages: prepared.messages,
          mode: prepared.turn.mode,
          attachments,
        }),
        {
          ...(prepared.snapshot.gatewayContext
            ? { trustedGatewayContext: prepared.snapshot.gatewayContext }
            : {}),
          onContextReady: async (gatewayContext) => {
            await service.captureGatewayContext(
              actor,
              turn.turnId,
              prepared.snapshot,
              gatewayContext,
            );
          },
          onGenerationStarted: async (selectedProvider) => {
            await service.markGenerating(actor, turn.turnId, selectedProvider);
          },
          nativeAssistant: {
            conversationId: turn.conversationId,
            invocationId: turn.turnId,
          },
        },
      );

      yield {
        type: "context.ready",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        snapshotVersion: prepared.snapshot.version,
      };

      if (
        !legacyResponse.ok ||
        !legacyResponse.headers
          .get("content-type")
          ?.includes("text/event-stream")
      ) {
        const summary = await responseErrorSummary(legacyResponse);
        await service.failTurn(actor, turn.turnId, {
          errorCode: "upstream_rejected",
          errorSummary: summary,
          retryable: legacyResponse.status >= 500,
        });
        yield {
          type: "response.failed",
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          code: "upstream_rejected",
          retryable: legacyResponse.status >= 500,
          message: summary,
        };
        return;
      }

      for await (const legacyEvent of readLegacySse(legacyResponse)) {
        if (legacyEvent.event === "delta") {
          const delta = stringField(legacyEvent.data.content) ?? "";
          if (!delta) continue;
          providerName =
            providerField(legacyEvent.data.providerName) ?? providerName;
          accumulatedContent += delta;
          yield {
            type: "response.delta",
            conversationId: turn.conversationId,
            turnId: turn.turnId,
            messageId: turn.assistantMessageId,
            delta,
          };
          continue;
        }

        if (legacyEvent.event === "done") {
          const content =
            messageContent(legacyEvent.data.message) ?? accumulatedContent;
          const metadata = responseMetadata(legacyEvent.data);
          providerName =
            providerField(legacyEvent.data.providerName) ?? providerName;
          invocationId =
            stringField(legacyEvent.data.invocationId) ?? invocationId;
          await service.markValidating(actor, turn.turnId);
          await service.completeTurn(actor, turn.turnId, {
            content,
            providerName,
            invocationId,
            metadata,
          });
          yield {
            type: "response.completed",
            conversationId: turn.conversationId,
            turnId: turn.turnId,
            messageId: turn.assistantMessageId,
            content,
            outcome: "complete",
            evidence: [],
            missing: [],
            observationTimes: {
              firstObservedAt: null,
              lastObservedAt: null,
            },
            ...(Object.keys(metadata).length ? { meta: metadata } : {}),
            ...(invocationId ? { invocationId } : {}),
          };
          return;
        }

        if (legacyEvent.event === "error") {
          const summary =
            stringField(legacyEvent.data.error) ?? "AI provider failed";
          providerName =
            providerField(legacyEvent.data.providerName) ?? providerName;
          invocationId =
            stringField(legacyEvent.data.invocationId) ?? invocationId;
          await service.failTurn(actor, turn.turnId, {
            content: accumulatedContent,
            providerName,
            invocationId,
            errorCode: "provider_failed",
            errorSummary: summary,
            retryable: true,
          });
          yield {
            type: "response.failed",
            conversationId: turn.conversationId,
            turnId: turn.turnId,
            code: "provider_failed",
            retryable: true,
            message: summary,
            ...(invocationId ? { invocationId } : {}),
          };
          return;
        }
      }

      await service.failTurn(actor, turn.turnId, {
        content: accumulatedContent,
        providerName,
        invocationId,
        errorCode: "stream_failed",
        errorSummary: "AI stream ended before a terminal event",
        retryable: true,
      });
      yield {
        type: "response.failed",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        code: "stream_failed",
        retryable: true,
        message: "AI stream ended before a terminal event",
      };
    },
  };
}

function buildLegacyChatRequest({
  request,
  messages,
  mode,
  attachments,
}: {
  request: Request;
  messages: AiMessage[];
  mode: AiChatMode;
  attachments: AiAttachment[];
}): Request {
  const headers = new Headers(request.headers);
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  return new Request(new URL("/api/ai/chat", request.url), {
    method: "POST",
    headers,
    body: JSON.stringify({ messages, mode, attachments, stream: true }),
  });
}

async function* readLegacySse(response: Response): AsyncGenerator<LegacyEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseLegacyEvent(block);
      if (event) yield event;
    }
    if (done) break;
  }

  const finalEvent = parseLegacyEvent(buffer);
  if (finalEvent) yield finalEvent;
}

function parseLegacyEvent(block: string): LegacyEvent | null {
  if (!block.trim()) return null;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    const data = JSON.parse(dataLines.join("\n")) as unknown;
    return isRecord(data) ? { event, data } : null;
  } catch {
    return null;
  }
}

async function responseErrorSummary(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as unknown;
    if (isRecord(body) && stringField(body.error)) {
      return stringField(body.error) ?? "AI request failed";
    }
  } catch {
    // Fall back to HTTP status below.
  }
  return `AI request failed with status ${response.status}`;
}

function messageContent(value: unknown): string | null {
  return isRecord(value) ? stringField(value.content) : null;
}

function responseMetadata(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(isRecord(value.grounding) ? { grounding: value.grounding } : {}),
    ...(isRecord(value.knowledge) ? { knowledge: value.knowledge } : {}),
    ...(typeof value.retrospectiveDraftId === "string"
      ? { retrospectiveDraftId: value.retrospectiveDraftId }
      : {}),
  };
}

function providerField(value: unknown): AiProviderName | undefined {
  return value === "openai" ||
    value === "hunyuan" ||
    value === "deepseek" ||
    value === "hermes" ||
    value === "deterministic"
    ? value
    : undefined;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
