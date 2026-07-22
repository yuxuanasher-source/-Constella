import type { ConversationStreamEvent } from "./conversation-contracts";
import type { AiAttachment } from "./contracts";
import type { CreatedConversationTurn } from "./conversation-repository";
import type { ConversationActor } from "./conversation-service";
import {
  createLegacyTurnExecutor,
  type ExecuteLegacyChat,
} from "./native-assistant/legacy-turn-executor";

export type ConversationTurnStreamService = {
  renewLease?(actor: ConversationActor, turnId: string): Promise<void>;
  renewLeaseV2?(actor: ConversationActor, turnId: string): Promise<void>;
};

export type ConversationTurnExecutorInput<TService = unknown> = {
  request: Request;
  actor: ConversationActor;
  turn: CreatedConversationTurn;
  attachments: AiAttachment[];
  service: TService;
};

export type ConversationTurnExecutor<TService = unknown> = {
  execute(input: ConversationTurnExecutorInput<TService>): AsyncIterable<ConversationStreamEvent>;
};

export function createConversationTurnStream<TService extends ConversationTurnStreamService>({
  request,
  actor,
  turn,
  attachments,
  service,
  executor,
  executeLegacyChat,
}: {
  request: Request;
  actor: ConversationActor;
  turn: CreatedConversationTurn;
  attachments: AiAttachment[];
  service: TService;
  executor?: ConversationTurnExecutor<TService>;
  executeLegacyChat?: ExecuteLegacyChat;
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
          const renew = service.renewLeaseV2 ?? service.renewLease;
          void renew
            ?.call(service, actor, turn.turnId)
            .catch(() => undefined)
            .finally(() => {
              renewalInFlight = false;
            });
        }
      }, 15_000);

      try {
        const source =
          executor ??
          (createLegacyTurnExecutor({
            executeLegacyChat,
          }) as unknown as ConversationTurnExecutor<TService>);
        for await (const event of source.execute({
          request,
          actor,
          turn,
          attachments,
          service,
        })) {
          send(event);
        }
      } catch (error) {
        closed = true;
        controller.error(new Error("AI terminal state could not be persisted"));
        return;
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // Client disconnected after terminal persistence.
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
