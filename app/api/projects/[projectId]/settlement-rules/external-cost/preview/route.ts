import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  getComplexCostRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/complex-cost/complex-cost-route-utils";
import type {
  ConfirmCostImportExceptionInput,
  ConfirmCostImportItemInput,
} from "@/features/complex-cost/complex-cost-repository";
import type { ProjectCostImportBatchRecord } from "@/features/complex-cost/complex-cost-types";
import {
  executeExternalCostRuleForImport,
  type ExecuteExternalCostRuleForImportResult,
} from "@/features/settlements/custom-rule-external-cost";
import {
  SupabaseCustomRuleReadRepository,
  type CustomSettlementRuleVersion,
} from "@/features/settlements/custom-rule-repository";

const SAMPLE_ROW_LIMIT = 2;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await readJsonBody(request);
    const batchId = requiredString(body, "batchId");
    const ruleVersionId =
      typeof body.ruleVersionId === "string" && body.ruleVersionId.trim()
        ? body.ruleVersionId.trim()
        : null;
    const context = await getComplexCostRouteContext();

    const batch = await requireImportBatch(context, projectId, batchId);
    await requireEntitlement(context, projectId);

    const customRuleRepo = new SupabaseCustomRuleReadRepository(context.supabase);
    const rule = ruleVersionId
      ? await resolveExplicitRule(customRuleRepo, context, projectId, ruleVersionId)
      : await resolveActiveRule(customRuleRepo, context, batch);

    if (!rule) {
      throw new RouteError("External cost rule was not found", 404);
    }

    const result = executeExternalCostRuleForImport({
      organizationId: context.auth.organizationId,
      projectId,
      importBatch: batch,
      ruleVersion: rule,
      reason: "Preview external-cost generated project costs",
      createdBy: context.auth.userId,
    });

    return NextResponse.json({
      preview: toPreviewDto({
        batch,
        rule,
        ruleSource: ruleVersionId
          ? { kind: rule.status === "draft" ? "draft" : "version" }
          : { kind: "active" },
        result,
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function requireImportBatch(
  context: Awaited<ReturnType<typeof getComplexCostRouteContext>>,
  projectId: string,
  batchId: string,
) {
  const batch = await context.repo.getImportBatchById(batchId);
  if (
    !batch ||
    batch.organizationId !== context.auth.organizationId ||
    batch.projectId !== projectId
  ) {
    throw new RouteError("Project cost import batch not found", 404);
  }
  return batch;
}

async function requireEntitlement(
  context: Awaited<ReturnType<typeof getComplexCostRouteContext>>,
  projectId: string,
) {
  const entitlement = await context.repo.getProjectEntitlement({
    organizationId: context.auth.organizationId,
    projectId,
  });
  if (!entitlement) {
    throw new RouteError(
      "Complex cost rules are not enabled for this project",
      403,
    );
  }
}

async function resolveActiveRule(
  customRuleRepo: SupabaseCustomRuleReadRepository,
  context: Awaited<ReturnType<typeof getComplexCostRouteContext>>,
  batch: ProjectCostImportBatchRecord,
) {
  const executionTimestamp = batch.createdAt ?? new Date(0).toISOString();
  const resolved = await customRuleRepo.resolveExecutableCustomRuleLayers({
    organizationId: context.auth.organizationId,
    projectId: batch.projectId,
    scope: "external_cost",
    executionTimestamp,
    executionUnits: [
      {
        key: `cost_import:${batch.id}`,
        grain: "report",
        projectId: batch.projectId,
        projectStreamerId: "import",
        streamerId: undefined,
        periodStart: executionTimestamp,
        periodEnd: executionTimestamp,
        sourceReportIds: [],
        membershipSnapshot: {
          projectStreamerId: "import",
          effectiveAt: executionTimestamp,
          groups: [],
          snapshotHash: sha256({
            importBatchId: batch.id,
            executionTimestamp,
          }),
        },
        variables: {},
      },
    ],
  });
  return resolved.projectBaseVersion?.scope === "external_cost"
    ? resolved.projectBaseVersion
    : null;
}

async function resolveExplicitRule(
  customRuleRepo: SupabaseCustomRuleReadRepository,
  context: Awaited<ReturnType<typeof getComplexCostRouteContext>>,
  projectId: string,
  ruleVersionId: string,
) {
  const rules = await customRuleRepo.listCustomRules({
    organizationId: context.auth.organizationId,
    projectId,
  });
  return (
    rules.find(
      (rule) => rule.id === ruleVersionId && rule.scope === "external_cost",
    ) ?? null
  );
}

function toPreviewDto(input: {
  batch: ProjectCostImportBatchRecord;
  rule: CustomSettlementRuleVersion;
  ruleSource: { kind: "active" | "draft" | "version" };
  result: ExecuteExternalCostRuleForImportResult;
}) {
  const itemsByRow = groupByRow(input.result.items);
  const exceptionsByRow = groupByRow(input.result.exceptions);
  const rows = Array.from({ length: input.batch.rowCount }, (_, rowIndex) =>
    rowPreview({
      rowIndex,
      items: itemsByRow.get(rowIndex) ?? [],
      exceptions: exceptionsByRow.get(rowIndex) ?? [],
    }),
  );
  const reviewRows = rows.filter((row) => row.status === "review_required");
  const emittedRows = rows.filter((row) => row.status === "emitted");

  return {
    importBatchId: input.batch.id,
    ruleSource: {
      kind: input.ruleSource.kind,
      ruleVersionId: input.rule.id,
      versionNumber: input.rule.versionNumber,
      status: input.rule.status,
    },
    itemCount: input.result.items.length,
    categoryTotals: categoryTotals(input.result.items),
    sourceCoverage: {
      totalRows: input.batch.rowCount,
      evaluatedRows: emittedRows.length,
      reviewRows: reviewRows.length,
      emittedRows: emittedRows.length,
      emptyRows: rows.filter((row) => row.status === "empty").length,
    },
    missingDataOutcomes: input.result.exceptions.map((exception) => ({
      rowIndex: exception.importRowIndex,
      variableName: exception.variableName,
      policy: exception.policy,
      outcome: "pending_review",
    })),
    warnings:
      input.result.exceptions.length > 0
        ? [
            {
              code: "EXTERNAL_COST_PREVIEW_REVIEW_REQUIRED",
              message: "Some import rows need reviewed values before costs exist.",
            },
          ]
        : [],
    pendingReview:
      input.result.items.some((item) => item.status === "pending_review") ||
      input.result.exceptions.length > 0,
    sampleRows: rows
      .filter((row) => row.status !== "empty")
      .slice(0, SAMPLE_ROW_LIMIT),
    previewHash: sha256({
      inputHash: input.result.inputHash,
      itemCount: input.result.items.length,
      exceptionCount: input.result.exceptions.length,
    }),
  };
}

function rowPreview(input: {
  rowIndex: number;
  items: ConfirmCostImportItemInput[];
  exceptions: ConfirmCostImportExceptionInput[];
}) {
  const status =
    input.exceptions.length > 0
      ? "review_required"
      : input.items.length > 0
        ? "emitted"
        : "empty";
  const evidenceRefs = uniqueEvidenceRefs(input.items);
  return {
    rowIndex: input.rowIndex,
    status,
    items: input.items.map((item) => ({
      category: item.itemType,
      amountCents: item.amountCents,
      amountYuan: centsToYuan(item.amountCents),
      direction: item.direction,
      evidenceLevel: item.evidenceLevel,
      status: item.status,
      ruleVersionId: item.ruleVersionId ?? null,
      sourceRefs: {
        sourceInputHash: item.sourceInputHash,
        sourceExecutionKey: item.sourceExecutionKey,
        explanation: item.sourceExplanation ?? null,
      },
    })),
    missingData: input.exceptions.map((exception) => ({
      variableName: exception.variableName,
      policy: exception.policy,
      outcome: "pending_review",
    })),
    evidenceRefs,
  };
}

function groupByRow<T extends { importRowIndex?: number }>(items: T[]) {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const rowIndex =
      typeof item.importRowIndex === "number" &&
      Number.isSafeInteger(item.importRowIndex)
        ? item.importRowIndex
        : -1;
    grouped.set(rowIndex, [...(grouped.get(rowIndex) ?? []), item]);
  }
  return grouped;
}

function categoryTotals(items: ConfirmCostImportItemInput[]) {
  const totals = new Map<string, { amountCents: number; itemCount: number }>();
  for (const item of items) {
    const current = totals.get(item.itemType) ?? { amountCents: 0, itemCount: 0 };
    totals.set(item.itemType, {
      amountCents: current.amountCents + item.amountCents,
      itemCount: current.itemCount + 1,
    });
  }
  return Object.fromEntries(
    [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, total]) => [
        category,
        {
          amountCents: total.amountCents,
          amountYuan: centsToYuan(total.amountCents),
          itemCount: total.itemCount,
        },
      ]),
  );
}

function uniqueEvidenceRefs(items: ConfirmCostImportItemInput[]) {
  const refs = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const evidence = item.sourcePayload.evidence;
    if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
      refs.set(JSON.stringify(evidence), evidence as Record<string, unknown>);
    }
  }
  return [...refs.values()];
}

function centsToYuan(cents: number) {
  return (cents / 100).toFixed(2);
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
