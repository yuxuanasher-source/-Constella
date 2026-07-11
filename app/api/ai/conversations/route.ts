import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";

export async function GET() {
  try {
    const context = await getAiConversationRouteContext();
    if (context instanceof Response) return context;

    const conversations = await context.service.listConversations(
      context.actor,
      30,
    );
    return NextResponse.json({ conversations });
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAiConversationRouteContext();
    if (context instanceof Response) return context;

    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
    };
    if (body.title != null && typeof body.title !== "string") {
      return NextResponse.json(
        { error: "title must be a string" },
        { status: 400 },
      );
    }
    const conversation = await context.service.createConversation(
      context.actor,
      typeof body.title === "string" ? body.title : "新会话",
    );
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}
