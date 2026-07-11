import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const context = await getAiConversationRouteContext();
    if (context instanceof Response) return context;
    const { conversationId } = await params;
    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await context.service.getHistory(context.actor, conversationId),
    );
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}
