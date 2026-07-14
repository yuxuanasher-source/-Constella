import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  customRuleErrorResponse,
  customRuleUserExamplesSchema,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
  toCustomRuleDraftDto,
  toCustomRuleSimulationDto,
  toCustomRuleSimulationSummaryDto,
} from "@/features/settlements/custom-rule-route-context";

const clientRequestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const groupPopulationSchema = z.strictObject({
  assignedProjectStreamerIds: z.array(z.string().uuid()).max(10_000),
  unassignedProjectStreamerIds: z.array(z.string().uuid()).max(10_000),
  groupSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
const selectionSchema = z
  .strictObject({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    criteriaCodes: z
      .array(
        z.enum([
          "approved_reports",
          "period_overlap",
          "complete_evidence",
          "project_scope",
        ]),
      )
      .min(1)
      .max(4),
    groupPopulation: groupPopulationSchema.optional(),
    userExamples: customRuleUserExamplesSchema.optional(),
  })
  .superRefine((selection, context) => {
    if (selection.periodStart > selection.periodEnd) {
      context.addIssue({
        code: "custom",
        path: ["periodStart"],
        message: "selection period is invalid",
      });
    }
    if (
      new Set(selection.criteriaCodes).size !== selection.criteriaCodes.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["criteriaCodes"],
        message: "selection criteria codes must be unique",
      });
    }
  });
const paramsSchema = z.strictObject({ projectId: z.string().uuid() });
const bodySchema = z.strictObject({
  sessionId: z.string().uuid(),
  draftId: z.string().uuid(),
  expectedRevisionNumber: z.number().int().positive(),
  clientRequestId: clientRequestIdSchema,
  simulationSelection: selectionSchema,
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
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
    const authorizedSelection = await context.authorizeSimulationSelection({
      actor: context.actor,
      projectId: inputParams.projectId,
      conversationId: body.sessionId,
      draftId: body.draftId,
      expectedRevisionNumber: body.expectedRevisionNumber,
      selection: body.simulationSelection,
    });
    const result = await context.simulation.simulateExistingDraft({
      actor: context.actor,
      projectId: inputParams.projectId,
      conversationId: body.sessionId,
      draftId: body.draftId,
      expectedRevisionNumber: body.expectedRevisionNumber,
      clientRequestId: body.clientRequestId,
      selection: authorizedSelection,
    });
    await context.audit({
      organizationId: context.auth.organizationId,
      actorUserId: context.auth.userId,
      actorName: context.auth.name,
      actorRole: context.auth.role,
      action: "create",
      module: "settlement_rule_authoring",
      objectType: "settlement_formula_simulation",
      objectId: result.simulation.id,
      projectId: inputParams.projectId,
      after: { draftId: result.draft.id },
    });
    return NextResponse.json(
      {
        draft: toCustomRuleDraftDto(result.draft),
        simulation: toCustomRuleSimulationDto(result.simulation),
        summary: toCustomRuleSimulationSummaryDto(result.summary),
      },
      { status: 201 },
    );
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
