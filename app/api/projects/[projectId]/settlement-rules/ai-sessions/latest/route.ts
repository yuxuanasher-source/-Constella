import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CustomRuleRouteError,
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleParams,
  toCustomRuleSessionDto,
} from "@/features/settlements/custom-rule-route-context";

const paramsSchema = z.strictObject({
  projectId: z.string().uuid(),
});
const latestDraftRowSchema = z.strictObject({
  conversation_id: z.string().uuid(),
  created_by: z.string().uuid(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;

    const input = parseCustomRuleParams(await params, paramsSchema);
    await context.requireProjectAccess(input.projectId);

    const { data, error } = await context.supabase
      .from("ai_settlement_rule_drafts")
      .select("conversation_id, created_by")
      .eq("organization_id", context.auth.organizationId)
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: false })
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new CustomRuleRouteError({
        code: "CUSTOM_RULE_STORAGE_UNAVAILABLE",
        message: "Latest settlement rule session is unavailable",
        status: 503,
        retryable: true,
      });
    }
    if (!data) {
      return NextResponse.json({ session: null });
    }

    const row = latestDraftRowSchema.safeParse(data);
    if (!row.success) {
      throw new CustomRuleRouteError({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        message: "Latest settlement rule session row is invalid",
        status: 502,
        retryable: true,
      });
    }

    const drafts = await context.repository.listDrafts({
      organizationId: context.auth.organizationId,
      projectId: input.projectId,
      conversationId: row.data.conversation_id,
      revisionOrder: "desc",
      limit: 1,
    });
    const draft = drafts[0];
    if (
      !draft ||
      draft.organizationId !== context.auth.organizationId ||
      draft.projectId !== input.projectId ||
      draft.conversationId !== row.data.conversation_id ||
      draft.createdBy !== row.data.created_by
    ) {
      throw new CustomRuleRouteError({
        code: "CUSTOM_RULE_SESSION_NOT_FOUND",
        message: "Settlement rule session not found",
        status: 404,
        retryable: false,
      });
    }

    const history = await context.conversation.getHistory(
      {
        organizationId: context.auth.organizationId,
        userId: draft.createdBy,
      },
      row.data.conversation_id,
    );
    const simulations = await context.repository.listSimulations({
      organizationId: context.auth.organizationId,
      projectId: input.projectId,
      owner: { kind: "ai_draft", id: draft.id },
      limit: 1,
    });

    return NextResponse.json({
      session: toCustomRuleSessionDto({
        history,
        draft,
        simulation: simulations[0] ?? null,
      }),
    });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
