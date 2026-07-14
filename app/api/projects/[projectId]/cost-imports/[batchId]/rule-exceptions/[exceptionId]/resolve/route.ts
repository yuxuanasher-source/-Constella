import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  complexCostActorFromContext,
  getComplexCostRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/complex-cost/complex-cost-route-utils";
import { resolveExternalCostRuleExceptionWithReplay } from "@/features/complex-cost/complex-cost-service";
import type {
  ExternalCostRuleExceptionRecord,
  ProjectCostItemRecord,
} from "@/features/complex-cost/complex-cost-types";

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      projectId: string;
      batchId: string;
      exceptionId: string;
    }>;
  },
) {
  try {
    const { projectId, batchId, exceptionId } = await params;
    const body = await readJsonBody(request);
    const context = await getComplexCostRouteContext();

    if (!canResolve(context.auth.role)) {
      throw new RouteError(
        "Current role cannot resolve external cost rule exceptions",
        403,
      );
    }
    const resolutionValue = typedRuntimeValue(body.resolutionValue);
    if (!resolutionValue) {
      throw new RouteError("resolutionValue must be a typed runtime value", 400);
    }
    const resolutionReason = requiredString(body, "resolutionReason");

    const existing = await context.repo.getExternalCostRuleExceptionById({
      organizationId: context.auth.organizationId,
      exceptionId,
    });
    if (
      !existing ||
      existing.projectId !== projectId ||
      existing.importBatchId !== batchId
    ) {
      throw new RouteError("External cost rule exception not found", 404);
    }

    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "complex_cost_rules",
    });

    const result = await resolveExternalCostRuleExceptionWithReplay({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: complexCostActorFromContext(context),
      exceptionId,
      resolutionValue,
      resolutionReason,
    });

    return NextResponse.json({
      exception: toExceptionDto(result.exception),
      replay: {
        replayed: result.replayed,
        replayDeferred: result.replayDeferred,
        openSiblingCount: result.openSiblingCount,
        needsReplay: result.needsReplay,
        idempotencyStatus: result.replay?.idempotencyStatus ?? null,
      },
      items: result.items.map(toItemDto),
    });
  } catch (error) {
    return jsonError(error);
  }
}

function canResolve(role: string) {
  return role === "owner" || role === "ops_manager" || role === "finance";
}

function toExceptionDto(exception: ExternalCostRuleExceptionRecord) {
  return {
    id: exception.id,
    projectId: exception.projectId,
    importBatchId: exception.importBatchId,
    rowIndex: exception.importRowIndex,
    variableName: exception.variableName,
    status: exception.status,
    reviewedValue: exception.resolutionValue ?? null,
    reviewedReason: exception.resolutionReason ?? null,
  };
}

function toItemDto(item: ProjectCostItemRecord) {
  return {
    id: item.id,
    category: item.itemType,
    amountCents: item.amountCents,
    amountYuan: (item.amountCents / 100).toFixed(2),
    status: item.status,
    ruleVersionId: item.sourceRuleVersionId ?? null,
    importBatchId: item.sourceImportBatchId ?? null,
    sourceExecutionKey: item.sourceExecutionKey ?? null,
    sourceInputHash: item.sourceInputHash ?? null,
    explanation: item.sourceExplanation ?? null,
  };
}

function typedRuntimeValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") return null;
  if (record.type === "money_cents") {
    return Number.isSafeInteger(record.amountCents) ? record : null;
  }
  if (record.type === "rate_bps") {
    return Number.isSafeInteger(record.rateBps) ? record : null;
  }
  if (record.type === "integer") {
    return Number.isSafeInteger(record.value) ? record : null;
  }
  if (record.type === "number") {
    return typeof record.value === "number" && Number.isFinite(record.value)
      ? record
      : null;
  }
  if (record.type === "boolean") {
    return typeof record.value === "boolean" ? record : null;
  }
  if (record.type === "string" || record.type === "timestamp") {
    return typeof record.value === "string" ? record : null;
  }
  return null;
}
