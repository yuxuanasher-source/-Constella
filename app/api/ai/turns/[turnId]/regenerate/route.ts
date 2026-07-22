import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";
import { parseRetryTurnCommand } from "@/features/ai/conversation-contracts";
import { createConversationTurnStream } from "@/features/ai/conversation-stream-adapter";
import { createGatewayTurnExecutor } from "@/features/ai/native-assistant/gateway-executor";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ turnId: string }> },
) {
  try {
    const context = await getAiConversationRouteContext();
    if (context instanceof Response) return context;
    const { turnId } = await params;
    const command = parseRetryTurnCommand(
      await request.json().catch(() => null),
    );
    if (!turnId || !command) {
      return NextResponse.json(
        { error: "A valid clientRequestId is required" },
        { status: 400 },
      );
    }

    const regeneratedTurn = await context.service.regenerateTurn(
      context.actor,
      turnId,
      command,
    );
    if (regeneratedTurn.duplicate) {
      return NextResponse.json(
        {
          error: "Regeneration already exists",
          turn: regeneratedTurn,
          reloadConversation: true,
        },
        { status: 409 },
      );
    }
    return createConversationTurnStream({
      request,
      actor: context.actor,
      turn: regeneratedTurn,
      attachments: [],
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
