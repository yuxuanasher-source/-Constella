import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";
import {
  toPublicTurnRecoverySnapshot,
  type ConversationTurnStatus,
} from "@/features/ai/conversation-contracts";
import { isUuid } from "@/features/ai/hermes/contracts";

const ACTIVE_TURN_STATUSES = new Set<ConversationTurnStatus>([
  "accepted",
  "grounding",
  "generating",
  "validating",
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string; turnId: string }> },
) {
  try {
    const context = await getAiConversationRouteContext();
    if (context instanceof Response) {
      context.headers.set("Cache-Control", "no-store");
      return context;
    }

    const { conversationId, turnId } = await params;
    const after = parseAfterCursor(
      new URL(request.url).searchParams.get("after"),
    );
    if (!isUuid(conversationId) || !isUuid(turnId) || after == null) {
      return jsonNoStore({ error: "Invalid turn recovery cursor" }, 400);
    }

    const record = await context.service.getRecoverySnapshot(
      context.actor,
      conversationId,
      turnId,
    );
    if (!record) {
      return jsonNoStore({ error: "Turn not found" }, 404);
    }

    if (
      ACTIVE_TURN_STATUSES.has(record.status) &&
      record.eventSequence <= after
    ) {
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    }

    return jsonNoStore(toPublicTurnRecoverySnapshot(record), 200);
  } catch (error) {
    const response = conversationRouteErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

function parseAfterCursor(value: string | null): number | null {
  if (value == null || value === "") return 0;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function jsonNoStore(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
