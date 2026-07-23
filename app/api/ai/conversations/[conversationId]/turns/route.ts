import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";
import {
  createSelectedNativeTurnExecutor,
  selectNativeTurnRuntime,
} from "@/app/api/ai/native-turn-runtime";
import { parseCreateTurnCommand } from "@/features/ai/conversation-contracts";
import { createConversationTurnStream } from "@/features/ai/conversation-stream-adapter";

export const maxDuration = 330;

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

    const selected = selectNativeTurnRuntime(context.actor);
    if (selected instanceof Response) return selected;

    const turn = await context.service.acceptTurn(
      context.actor,
      conversationId,
      command,
      selected.runtimeOption,
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
      executor: createSelectedNativeTurnExecutor({
        selected,
        service: context.service,
        auth: context.auth,
      }),
    });
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}
