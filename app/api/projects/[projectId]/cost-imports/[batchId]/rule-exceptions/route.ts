import { NextResponse } from "next/server";

import {
  getComplexCostRouteContext,
  jsonError,
  RouteError,
} from "@/features/complex-cost/complex-cost-route-utils";
import type { ExternalCostRuleExceptionRecord } from "@/features/complex-cost/complex-cost-types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; batchId: string }> },
) {
  try {
    const { projectId, batchId } = await params;
    const context = await getComplexCostRouteContext();
    const batch = await context.repo.getImportBatchById(batchId);
    if (
      !batch ||
      batch.organizationId !== context.auth.organizationId ||
      batch.projectId !== projectId
    ) {
      throw new RouteError("Project cost import batch not found", 404);
    }

    const exceptions =
      await context.repo.listExternalCostRuleExceptionsForImportBatch({
        organizationId: context.auth.organizationId,
        projectId,
        importBatchId: batchId,
        status: "review_required",
      });

    return NextResponse.json({ exceptions: exceptions.map(toExceptionDto) });
  } catch (error) {
    return jsonError(error);
  }
}

function toExceptionDto(exception: ExternalCostRuleExceptionRecord) {
  return {
    id: exception.id,
    projectId: exception.projectId,
    importBatchId: exception.importBatchId,
    rowIndex: exception.importRowIndex,
    variableName: exception.variableName,
    policy: exception.policy,
    status: exception.status,
    reviewedValue: exception.resolutionValue ?? null,
    reviewedReason: exception.resolutionReason ?? null,
    sourceRefs: {
      importBatchId: exception.importBatchId,
      ruleVersionId: exception.ruleVersionId ?? null,
      sourceContextHash:
        typeof exception.sourceContextSnapshot.__source_context_hash ===
        "string"
          ? exception.sourceContextSnapshot.__source_context_hash
          : null,
    },
  };
}
