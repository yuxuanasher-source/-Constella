import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  arrayOfRecords,
  complexCostActorFromContext,
  getComplexCostRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
  requiredString,
} from "@/features/complex-cost/complex-cost-route-utils";
import { createProjectCostImportBatch } from "@/features/complex-cost/complex-cost-service";
import type { ProjectCostImportType } from "@/features/complex-cost/complex-cost-types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getComplexCostRouteContext();
    const batches = await context.repo.listImportBatches({
      organizationId: context.auth.organizationId,
      projectId,
      limit: 25,
    });

    return NextResponse.json({ batches });
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

    const importBatch = await createProjectCostImportBatch({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: complexCostActorFromContext(context),
      input: {
        projectId,
        importType: requiredString(body, "importType") as ProjectCostImportType,
        fileUrl: optionalString(body, "fileUrl"),
        parsedPayload: arrayOfRecords(body, "parsedPayload"),
      },
    });

    return NextResponse.json({ importBatch }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
