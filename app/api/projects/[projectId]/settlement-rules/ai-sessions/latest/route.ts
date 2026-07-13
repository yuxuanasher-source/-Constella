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
const querySchema = z.strictObject({
  scope: z
    .enum(["receivable", "payable", "external_cost", "reconciliation"])
    .optional(),
  targetType: z
    .enum(["project", "streamer_group", "project_streamer"])
    .optional(),
  targetId: z.string().uuid().optional(),
});
const latestDraftRowSchema = z.strictObject({
  conversation_id: z.string().uuid(),
  created_by: z.string().uuid(),
});

function optionalSearchParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value === null || value === "" ? undefined : value;
}

function draftMatchesRequestedContext(
  draft: {
    businessContract: {
      scope: string;
      target: { targetType: string; targetId?: string | null };
    };
  },
  query: z.infer<typeof querySchema>,
) {
  if (query.scope && draft.businessContract.scope !== query.scope) {
    return false;
  }
  if (
    query.targetType &&
    draft.businessContract.target.targetType !== query.targetType
  ) {
    return false;
  }
  if (
    query.targetId &&
    draft.businessContract.target.targetId !== query.targetId
  ) {
    return false;
  }
  return true;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;

    const input = parseCustomRuleParams(await params, paramsSchema);
    const searchParams = new URL(request.url).searchParams;
    const query = parseCustomRuleParams(
      {
        scope: optionalSearchParam(searchParams, "scope"),
        targetType: optionalSearchParam(searchParams, "targetType"),
        targetId: optionalSearchParam(searchParams, "targetId"),
      },
      querySchema,
    );
    await context.requireProjectAccess(input.projectId);

    let latestDraftQuery = context.supabase
      .from("ai_settlement_rule_drafts")
      .select("conversation_id, created_by")
      .eq("organization_id", context.auth.organizationId)
      .eq("project_id", input.projectId);
    if (query.scope) {
      latestDraftQuery = latestDraftQuery.eq(
        "business_contract->>scope",
        query.scope,
      );
    }
    if (query.targetType) {
      latestDraftQuery = latestDraftQuery.eq(
        "business_contract->target->>targetType",
        query.targetType,
      );
    }
    if (query.targetId) {
      latestDraftQuery = latestDraftQuery.eq(
        "business_contract->target->>targetId",
        query.targetId,
      );
    }
    const { data, error } = await latestDraftQuery
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
    if (!draftMatchesRequestedContext(draft, query)) {
      return NextResponse.json({ session: null });
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
