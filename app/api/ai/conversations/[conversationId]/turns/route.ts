import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";
import { parseCreateTurnCommand } from "@/features/ai/conversation-contracts";
import { createConversationTurnStream } from "@/features/ai/conversation-stream-adapter";
import { createGatewayTurnExecutor } from "@/features/ai/native-assistant/gateway-executor";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const context = await getAiConversationRouteContext();
    if (context instanceof Response) return context;
    const { conversationId } = await params;
    const command = parseCreateTurnCommand(
      await request.json().catch(() => null),
    );
    if (!conversationId || !command) {
      return NextResponse.json(
        { error: "A valid content, mode and clientRequestId are required" },
        { status: 400 },
      );
    }

    const turn = await context.service.acceptTurn(
      context.actor,
      conversationId,
      command,
    );
    if (turn.duplicate) {
      return NextResponse.json(
        { error: "Turn already exists", turn, reloadConversation: true },
        { status: 409 },
      );
    }

    return createConversationTurnStream({
      request,
      actor: context.actor,
      turn,
      attachments: command.attachments,
      service: context.service,
      executor: createGatewayTurnExecutor({
        service: context.service,
        auth: context.auth,
        provider: "hermes",
        model: "hermes-official-gateway",
      }),
    });
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}
