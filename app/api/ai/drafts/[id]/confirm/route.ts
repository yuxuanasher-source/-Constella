import { NextResponse } from "next/server";

import {
  confirmAiDraft,
  getAiDraftForConfirmation,
  type AiDraftForConfirmation,
  type DraftClient,
} from "@/features/ai/draft-repository";
import { draftConfirmationRequirement } from "@/features/ai/drafts";
import {
  captureConfirmedDraftKnowledgeDocument,
  type CapturedKnowledgeDocument,
  type KnowledgeCaptureClient,
} from "@/features/ai/knowledge-capture";
import type { AiTransitionDecision } from "@/features/ai/tiers";
import { writeAuditLog } from "@/lib/audit/audit";
import type { AppRole } from "@/lib/rbac/roles";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

// 人工确认草稿（pending → confirmed）。确认是人的动作，记录 confirmed_by（审计）。
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can confirm AI drafts" },
        { status: 403 },
      );
    }

    const draft = await getAiDraftForConfirmation(
      supabase as unknown as DraftClient,
      {
        organizationId: auth.organizationId,
        draftId: id,
      },
    );
    if (!draft) {
      return NextResponse.json(
        { error: "AI draft not found" },
        { status: 404 },
      );
    }

    const gatewayDecision = confirmationGatewayDecision(draft);
    if (draft.status !== "pending") {
      await writeConfirmationAudit(supabase, {
        auth,
        draft,
        id,
        gatewayDecision,
        result: "failure",
        errorMessage: "AI draft is not pending",
      });
      return NextResponse.json(
        { error: "AI draft is not pending", gatewayDecision },
        { status: 409 },
      );
    }

    const ok = await confirmAiDraft(supabase as unknown as DraftClient, {
      organizationId: auth.organizationId,
      draftId: id,
      confirmedBy: auth.userId,
    });
    if (!ok) {
      await writeConfirmationAudit(supabase, {
        auth,
        draft,
        id,
        gatewayDecision,
        result: "failure",
        errorMessage: "AI draft confirmation did not transition",
      });
      return NextResponse.json(
        { error: "Failed to confirm AI draft", gatewayDecision },
        { status: 409 },
      );
    }

    const knowledgeCapture = await captureKnowledgeDocument(supabase, {
      auth,
      draft,
    });

    await writeConfirmationAudit(supabase, {
      auth,
      draft,
      id,
      gatewayDecision,
      result: "success",
      knowledgeDocumentId: knowledgeCapture.document?.id,
      knowledgeCaptureError: knowledgeCapture.errorMessage,
    });

    return NextResponse.json({
      ok: true,
      id,
      status: "confirmed",
      gatewayDecision,
      knowledgeDocument: knowledgeCapture.document,
      ...(knowledgeCapture.errorMessage
        ? { knowledgeCaptureError: knowledgeCapture.errorMessage }
        : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

type ConfirmAuth = {
  organizationId: string;
  userId: string;
  name?: string;
  role: AppRole;
};

type AuditClient = Parameters<typeof writeAuditLog>[0];

function confirmationGatewayDecision(
  draft: Pick<AiDraftForConfirmation, "targetStateMachine" | "targetState">,
): AiTransitionDecision {
  return draftConfirmationRequirement({
    targetStateMachine: draft.targetStateMachine ?? "unknown",
    targetState: draft.targetState ?? "unknown",
  });
}

async function writeConfirmationAudit(
  supabase: AuditClient,
  input: {
    auth: ConfirmAuth;
    draft: AiDraftForConfirmation;
    id: string;
    gatewayDecision: AiTransitionDecision;
    result: "success" | "failure";
    errorMessage?: string;
    knowledgeDocumentId?: string;
    knowledgeCaptureError?: string;
  },
) {
  await writeAuditLog(supabase, {
    organizationId: input.auth.organizationId,
    actorUserId: input.auth.userId,
    actorName: input.auth.name,
    actorRole: input.auth.role,
    action: "approve",
    module: "ai",
    objectType: "ai_draft",
    objectId: input.id,
    objectName: `${input.draft.draftType}:${input.id}`,
    before: { status: input.draft.status },
    after: {
      status: input.result === "success" ? "confirmed" : input.draft.status,
      confirmedBy: input.result === "success" ? input.auth.userId : null,
      draftType: input.draft.draftType,
      targetStateMachine: input.draft.targetStateMachine,
      targetState: input.draft.targetState,
      knowledgeDocumentId: input.knowledgeDocumentId ?? null,
      knowledgeCaptureError: input.knowledgeCaptureError,
      gatewayDecision: input.gatewayDecision,
    },
    changedFields:
      input.result === "success"
        ? ["status", "confirmed_by", "gateway_decision"]
        : ["gateway_decision"],
    result: input.result,
    errorMessage: input.errorMessage,
  });
}

async function captureKnowledgeDocument(
  supabase: KnowledgeCaptureClient,
  input: { auth: ConfirmAuth; draft: AiDraftForConfirmation },
): Promise<{ document: CapturedKnowledgeDocument | null; errorMessage?: string }> {
  try {
    const document = await captureConfirmedDraftKnowledgeDocument(supabase, {
      organizationId: input.auth.organizationId,
      confirmedBy: input.auth.userId,
      draft: input.draft,
    });
    return { document };
  } catch (error) {
    return {
      document: null,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Failed to capture AI draft knowledge",
    };
  }
}
