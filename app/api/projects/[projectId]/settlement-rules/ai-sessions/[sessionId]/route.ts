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
  sessionId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ projectId: string; sessionId: string }>;
  },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;

    const input = parseCustomRuleParams(await params, paramsSchema);
    await context.requireProjectAccess(input.projectId);
    const drafts = await context.repository.listDrafts({
      organizationId: context.auth.organizationId,
      projectId: input.projectId,
      conversationId: input.sessionId,
      revisionOrder: "desc",
      limit: 1,
    });
    const draft = drafts[0];
    if (
      !draft ||
      draft.organizationId !== context.auth.organizationId ||
      draft.projectId !== input.projectId ||
      draft.conversationId !== input.sessionId ||
      !z.string().uuid().safeParse(draft.createdBy).success
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
      input.sessionId,
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
