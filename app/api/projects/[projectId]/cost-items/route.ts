import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  complexCostActorFromContext,
  getComplexCostRouteContext,
  jsonError,
  optionalRecord,
  readJsonBody,
  requiredNumber,
  requiredString,
} from "@/features/complex-cost/complex-cost-route-utils";
import { createManualProjectCostItem } from "@/features/complex-cost/complex-cost-service";
import type {
  ComplexCostEvidenceLevel,
  ProjectCostItemDirection,
  ProjectCostItemType,
} from "@/features/complex-cost/complex-cost-types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getComplexCostRouteContext();
    const items = await context.repo.listProjectCostItems({
      organizationId: context.auth.organizationId,
      projectId,
    });

    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await readJsonBody(request);
    const context = await getComplexCostRouteContext();

    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "complex_cost_rules",
    });

    const item = await createManualProjectCostItem({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: complexCostActorFromContext(context),
      input: {
        projectId,
        itemType: requiredString(body, "itemType") as ProjectCostItemType,
        amountCents: requiredNumber(body, "amountCents"),
        direction: requiredString(
          body,
          "direction",
        ) as ProjectCostItemDirection,
        evidenceLevel: requiredString(
          body,
          "evidenceLevel",
        ) as ComplexCostEvidenceLevel,
        reason: requiredString(body, "reason"),
        streamerId: stringOrNull(body.streamerId),
        supplierOrganizationId: stringOrNull(body.supplierOrganizationId),
        liveReportId: stringOrNull(body.liveReportId),
        settlementBatchId: stringOrNull(body.settlementBatchId),
        sourcePayload: optionalRecord(body, "sourcePayload") ?? {},
      },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
