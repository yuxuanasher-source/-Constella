import type {
  ConversationContextSnapshot,
  ConversationGatewayContext,
  ConversationStreamEvent,
} from "./conversation-contracts";
import type {
  AiAttachment,
  AiChatMode,
  AiMessage,
  AiProviderName,
} from "./contracts";
import type { CreatedConversationTurn } from "./conversation-repository";
import type { ConversationActor } from "./conversation-service";

type PreparedTurn = {
  turn: { mode: AiChatMode };
  messages: AiMessage[];
  snapshot: ConversationContextSnapshot;
};

export type ConversationTurnStreamService = {
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
  ): Promise<ConversationContextSnapshot>;
  renewLease(actor: ConversationActor, turnId: string): Promise<void>;
};

type LegacyEvent = {
  event: string;
  data: Record<string, unknown>;
};

export function createConversationTurnStream({
  request,
  actor,
  turn,
  attachments,
  service,
  executeLegacyChat,
}: {
  request: Request;
  actor: ConversationActor;
  turn: CreatedConversationTurn;
  attachments: AiAttachment[];
  service: ConversationTurnStreamService;
  executeLegacyChat: (
    request: Request,
    options?: {
      trustedGatewayContext?: ConversationGatewayContext;
      onContextReady?: (
        context: ConversationGatewayContext,
      ) => Promise<void> | void;
      onGenerationStarted?: (
        providerName: AiProviderName,
      ) => Promise<void> | void;
    },
  ) => Promise<Response>;
}): Response {
  if (turn.duplicate) {
    return new Response(
      JSON.stringify({
        error: "Turn already exists",
        turn,
        reloadConversation: true,
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let terminalSent = false;
      let accumulatedContent = "";
      let providerName: AiProviderName | undefined;
      let invocationId: string | undefined;
      let renewalInFlight = false;

      const send = (event: ConversationStreamEvent) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          ),
        );
      };
      const heartbeat = setInterval(() => {
        send({
          type: "heartbeat",
          conversationId: turn.conversationId,
          turnId: turn.turnId,
        });
        if (!renewalInFlight) {
          renewalInFlight = true;
          void service
            .renewLease(actor, turn.turnId)
            .catch(() => undefined)
            .finally(() => {
              renewalInFlight = false;
            });
        }
      }, 15_000);

      send({
        type: "turn.started",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        userMessageId: turn.userMessageId,
        assistantMessageId: turn.assistantMessageId,
      });

      try {
        const prepared = await service.prepareTurn(actor, turn.turnId, [
          "dashboard:role-home",
          "xingyao:feature-store",
          "knowledge-base",
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
              await service.markGenerating(
                actor,
                turn.turnId,
                selectedProvider,
              );
            },
          },
        );

        send({
          type: "context.ready",
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          snapshotVersion: prepared.snapshot.version,
        });

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
          send({
            type: "response.failed",
            conversationId: turn.conversationId,
            turnId: turn.turnId,
            code: "upstream_rejected",
            retryable: legacyResponse.status >= 500,
            message: summary,
          });
          terminalSent = true;
          return;
        }

        for await (const legacyEvent of readLegacySse(legacyResponse)) {
          if (legacyEvent.event === "delta") {
            const delta = stringField(legacyEvent.data.content) ?? "";
            if (!delta) continue;
            providerName = providerField(legacyEvent.data.providerName) ?? providerName;
            accumulatedContent += delta;
            send({
              type: "response.delta",
              conversationId: turn.conversationId,
              turnId: turn.turnId,
              messageId: turn.assistantMessageId,
              delta,
            });
            continue;
          }

          if (legacyEvent.event === "done") {
            const content =
              messageContent(legacyEvent.data.message) ?? accumulatedContent;
            const metadata = responseMetadata(legacyEvent.data);
            providerName = providerField(legacyEvent.data.providerName) ?? providerName;
            invocationId = stringField(legacyEvent.data.invocationId) ?? invocationId;
            await service.markValidating(actor, turn.turnId);
            await service.completeTurn(actor, turn.turnId, {
              content,
              providerName,
              invocationId,
              metadata,
            });
            send({
              type: "response.completed",
              conversationId: turn.conversationId,
              turnId: turn.turnId,
              messageId: turn.assistantMessageId,
              content,
              ...(Object.keys(metadata).length ? { meta: metadata } : {}),
              ...(invocationId ? { invocationId } : {}),
            });
            terminalSent = true;
            break;
          }

          if (legacyEvent.event === "error") {
            const summary =
              stringField(legacyEvent.data.error) ?? "AI provider failed";
            providerName = providerField(legacyEvent.data.providerName) ?? providerName;
            invocationId = stringField(legacyEvent.data.invocationId) ?? invocationId;
            await service.failTurn(actor, turn.turnId, {
              content: accumulatedContent,
              providerName,
              invocationId,
              errorCode: "provider_failed",
              errorSummary: summary,
              retryable: true,
            });
            send({
              type: "response.failed",
              conversationId: turn.conversationId,
              turnId: turn.turnId,
              code: "provider_failed",
              retryable: true,
              message: summary,
              ...(invocationId ? { invocationId } : {}),
            });
            terminalSent = true;
            break;
          }
        }

        if (!terminalSent) {
          throw new Error("AI stream ended before a terminal event");
        }
      } catch (error) {
        const summary =
          error instanceof Error ? error.message : "Unexpected AI stream error";
        if (!terminalSent) {
          let terminalPersisted = false;
          try {
            await service.failTurn(actor, turn.turnId, {
              content: accumulatedContent,
              providerName,
              invocationId,
              errorCode: "stream_failed",
              errorSummary: summary,
              retryable: true,
            });
            terminalPersisted = true;
          } catch {
            // A terminal event is only valid after its matching ledger state exists.
          }
          if (!terminalPersisted) {
            closed = true;
            controller.error(
              new Error("AI terminal state could not be persisted"),
            );
            return;
          }
          send({
            type: "response.failed",
            conversationId: turn.conversationId,
            turnId: turn.turnId,
            code: "stream_failed",
            retryable: true,
            message: summary,
          });
        }
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may have disconnected while the final state was persisted.
        }
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
