import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";
import {
  createSelectedNativeTurnExecutor,
  selectNativeTurnRuntime,
} from "@/app/api/ai/native-turn-runtime";
import { parseRetryTurnCommand } from "@/features/ai/conversation-contracts";
import { createConversationTurnStream } from "@/features/ai/conversation-stream-adapter";

export const maxDuration = 330;

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

    const selected = selectNativeTurnRuntime(context.actor);
    if (selected instanceof Response) return selected;

    const retriedTurn = await context.service.retryTurn(
      context.actor,
      turnId,
      command,
      selected.runtimeOption,
    );
    if (retriedTurn.duplicate) {
      return NextResponse.json(
        {
          error: "Retry already exists",
          turn: retriedTurn,
          reloadConversation: true,
        },
        { status: 409 },
      );
    }
    return createConversationTurnStream({
      request,
      actor: context.actor,
      turn: retriedTurn,
      attachments: [],
      service: context.service,
      executor: createSelectedNativeTurnExecutor({
        selected,
        service: context.service,
        auth: context.auth,
        sourceTurnId: turnId,
      }),
    });
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}
