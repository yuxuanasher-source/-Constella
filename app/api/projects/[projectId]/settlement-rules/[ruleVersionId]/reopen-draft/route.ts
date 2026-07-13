import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  CustomRuleRouteError,
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
  toCustomRuleLifecycleResultDto,
  toCustomRuleSessionDto,
} from "@/features/settlements/custom-rule-route-context";

const paramsSchema = z.strictObject({
  projectId: z.string().uuid(),
  ruleVersionId: z.string().uuid(),
});
const bodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(1_000),
  clientRequestId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u),
});
const draftSessionRowSchema = z.strictObject({
  conversation_id: z.string().uuid(),
  created_by: z.string().uuid(),
});

type CustomRuleContext = Exclude<
  Awaited<ReturnType<typeof getCustomRuleRouteContext>>,
  Response
>;

async function loadReopenedDraftSession(
  context: CustomRuleContext,
  projectId: string,
  aiDraftId: string | null,
) {
  if (!aiDraftId) return null;
  const { data, error } = await context.supabase
    .from("ai_settlement_rule_drafts")
    .select("conversation_id, created_by")
    .eq("organization_id", context.auth.organizationId)
    .eq("project_id", projectId)
    .eq("id", aiDraftId)
    .maybeSingle();
  if (error) {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_STORAGE_UNAVAILABLE",
      message: "Reopened settlement rule draft is unavailable",
      status: 503,
      retryable: true,
    });
  }
  const row = draftSessionRowSchema.safeParse(data);
  if (!row.success) {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_SESSION_NOT_FOUND",
      message: "Reopened settlement rule draft not found",
      status: 404,
      retryable: false,
    });
  }
  const draft = await context.repository.getDraft({
    organizationId: context.auth.organizationId,
    projectId,
    conversationId: row.data.conversation_id,
    draftId: aiDraftId,
  });
  if (!draft) {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_SESSION_NOT_FOUND",
      message: "Reopened settlement rule draft not found",
      status: 404,
      retryable: false,
    });
  }
  const history = await context.conversation.getHistory(
    { organizationId: context.auth.organizationId, userId: row.data.created_by },
    row.data.conversation_id,
  );
  const simulations = await context.repository.listSimulations({
    organizationId: context.auth.organizationId,
    projectId,
    owner: { kind: "ai_draft", id: draft.id },
    limit: 1,
  });
  return toCustomRuleSessionDto({
    history,
    draft,
    simulation: simulations[0] ?? null,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; ruleVersionId: string }> },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;

    const inputParams = parseCustomRuleParams(await params, paramsSchema);
    const body = await parseCustomRuleJson(request, bodySchema);
    await context.requireProjectAccess(inputParams.projectId);
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const result = await context.lifecycle.reopenRequestedChangesAsDraft({
      actor: context.actor,
      projectId: inputParams.projectId,
      ruleVersionId: inputParams.ruleVersionId,
      reason: body.reason,
      clientRequestId: body.clientRequestId,
    });

    const session = await loadReopenedDraftSession(
      context,
      inputParams.projectId,
      result.version.aiDraftId,
    );

    return NextResponse.json({
      ...toCustomRuleLifecycleResultDto(result),
      ...(session ? { session } : {}),
    });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
