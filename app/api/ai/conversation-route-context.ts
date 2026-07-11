import { NextResponse } from "next/server";

import {
  ConversationServiceError,
  createConversationService,
  createSupabaseConversationPersistence,
} from "@/features/ai/conversation-service";
import type { ConversationRepositoryClient } from "@/features/ai/conversation-repository";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function getAiConversationRouteContext() {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  if (!supabase || !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isMcnStaff(auth.role)) {
    return NextResponse.json(
      { error: "Only MCN staff can use Xingyao conversations" },
      { status: 403 },
    );
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "AI conversation storage is not configured" },
      { status: 503 },
    );
  }

  const service = createConversationService(
    createSupabaseConversationPersistence(
      admin as unknown as ConversationRepositoryClient,
    ),
  );
  return {
    auth,
    actor: { organizationId: auth.organizationId, userId: auth.userId },
    service,
  };
}

export function conversationRouteErrorResponse(error: unknown): Response {
  if (error instanceof ConversationServiceError) {
    const status =
      error.code === "conversation_not_found" || error.code === "turn_not_found"
        ? 404
        : error.code === "turn_not_retryable" ||
            error.code === "turn_not_regeneratable" ||
            error.code === "turn_state_conflict"
          ? 409
          : error.code === "invalid_assistant_content"
            ? 422
            : 500;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status },
    );
  }
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : "Unexpected error",
    },
    { status: 500 },
  );
}
