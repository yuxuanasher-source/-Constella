import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";
import { SupabaseCustomRuleReadRepository } from "@/features/settlements/custom-rule-repository";
import { validateCustomRuleFormula } from "@/features/settlements/custom-rule-validator";
import type { ProjectCostImportBatchRecord } from "@/features/complex-cost/complex-cost-types";
import type { CustomSettlementRuleVersion } from "@/features/settlements/custom-rule-repository";
import type {
  RuntimeScalarType,
  RuntimeValueType,
  TypedRuntimeValue,
} from "@/features/settlements/custom-rule-types";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-route-utils", () => ({
  getComplexCostRouteContext: vi.fn(),
  complexCostActorFromContext: vi.fn((context) => context.auth),
  readJsonBody: async (request: Request) => request.json().catch(() => ({})),
  requiredString: (body: Record<string, unknown>, key: string) =>
    typeof body[key] === "string" ? (body[key] as string) : "",
  jsonError: (error: { message?: string; statusCode?: number }) =>
    Response.json(
      { error: error.message ?? "Unexpected error" },
      {
        status:
          error.statusCode ??
          (error.message?.startsWith("Organization is read-only because billing")
            ? 403
            : 500),
      },
    ),
  RouteError: class RouteError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  },
}));
vi.mock(
  "@/features/settlements/custom-rule-repository",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/settlements/custom-rule-repository")
      >();
    return {
      ...actual,
      SupabaseCustomRuleReadRepository: vi.fn(function Repository(
        this: { listCustomRules: ReturnType<typeof vi.fn>; resolveExecutableCustomRuleLayers: ReturnType<typeof vi.fn> },
      ) {
        this.listCustomRules = customRuleRepo.listCustomRules;
        this.resolveExecutableCustomRuleLayers =
          customRuleRepo.resolveExecutableCustomRuleLayers;
      }),
    };
  },
);

const ORG_ID = "org-1";
const PROJECT_ID = "project-1";
const USER_ID = "user-1";

const customRuleRepo = {
  listCustomRules: vi.fn(),
  resolveExecutableCustomRuleLayers: vi.fn(),
};

describe("external-cost rule preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customRuleRepo.listCustomRules.mockReset();
    customRuleRepo.resolveExecutableCustomRuleLayers.mockReset();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getComplexCostRouteContext).mockResolvedValue(context() as never);
    customRuleRepo.resolveExecutableCustomRuleLayers.mockResolvedValue({
      projectBaseVersion: externalRule(
        `external_cost = cost_items([
          { category: "traffic", amount: percent(sales_amount, rate_percent(10)), memo: "投流" },
          { category: "gift", amount: gift_amount, memo: "礼物" }
        ])`,
        ["sales_amount", "gift_amount"],
        { id: "active-rule", status: "active" },
      ),
      groupVersions: [],
      projectStreamerVersions: [],
      assignmentsByUnitKey: {},
    });
    customRuleRepo.listCustomRules.mockResolvedValue([
      externalRule(
        `external_cost = cost_items([{ category: "gift", amount: gift_amount, memo: "礼物" }])`,
        ["gift_amount"],
        { id: "draft-rule", status: "draft" },
      ),
    ]);
  });

  it("previews the active external-cost rule without confirming import rows or exposing raw upload columns", async () => {
    const repo = contextRepo();
    vi.mocked(getComplexCostRouteContext).mockResolvedValue(context(repo) as never);

    const response = await POST(request({ batchId: "batch-1" }), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(repo.getProjectEntitlement).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
    });
    expect(repo.confirmCostImportWithRuleItems).not.toHaveBeenCalled();
    expect(body.preview).toMatchObject({
      ruleSource: { kind: "active", ruleVersionId: "active-rule" },
      itemCount: 4,
      sourceCoverage: {
        totalRows: 3,
        evaluatedRows: 2,
        reviewRows: 1,
        emittedRows: 2,
      },
      pendingReview: true,
      categoryTotals: {
        traffic: { amountCents: 40_000, amountYuan: "400.00", itemCount: 2 },
        gift: {
          amountCents: 20_000,
          amountYuan: "200.00",
          itemCount: 2,
        },
      },
    });
    expect(body.preview.sampleRows).toHaveLength(2);
    expect(body.preview.sampleRows[0]).toMatchObject({
      rowIndex: 0,
      status: "emitted",
      items: expect.arrayContaining([
        expect.objectContaining({
          category: "gift",
          amountYuan: "150.00",
          ruleVersionId: "active-rule",
          status: "pending_review",
        }),
      ]),
      evidenceRefs: [{ kind: "linked_report", liveReportId: "report-1" }],
    });
    expect(JSON.stringify(body)).not.toContain("secretUploadColumn");
    expect(JSON.stringify(body)).not.toContain("external_cost =");
    expect(JSON.stringify(body)).not.toContain("compiledAst");
  });

  it("uses an explicit draft rule source and returns deterministic output", async () => {
    const first = await POST(
      request({ batchId: "batch-1", ruleVersionId: "draft-rule" }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );
    const second = await POST(
      request({ batchId: "batch-1", ruleVersionId: "draft-rule" }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody).toEqual(secondBody);
    expect(firstBody.preview).toMatchObject({
      ruleSource: { kind: "draft", ruleVersionId: "draft-rule" },
      categoryTotals: {
        gift: { amountCents: 29_999, amountYuan: "299.99", itemCount: 3 },
      },
    });
    expect(customRuleRepo.resolveExecutableCustomRuleLayers).not.toHaveBeenCalled();
  });

  it("requires auth, project isolation, entitlement, and billing read-only compatibility", async () => {
    vi.mocked(getComplexCostRouteContext).mockRejectedValueOnce(
      new ErrorWithStatus("Unauthorized", 401),
    );
    expect(
      (
        await POST(request({ batchId: "batch-1" }), {
          params: Promise.resolve({ projectId: PROJECT_ID }),
        })
      ).status,
    ).toBe(401);

    const isolatedRepo = contextRepo({
      batch: { ...importBatch(), projectId: "other-project" },
    });
    vi.mocked(getComplexCostRouteContext).mockResolvedValueOnce(
      context(isolatedRepo) as never,
    );
    expect(
      (
        await POST(request({ batchId: "batch-1" }), {
          params: Promise.resolve({ projectId: PROJECT_ID }),
        })
      ).status,
    ).toBe(404);

    const noEntitlementRepo = contextRepo({ entitlement: null });
    vi.mocked(getComplexCostRouteContext).mockResolvedValueOnce(
      context(noEntitlementRepo) as never,
    );
    expect(
      (
        await POST(request({ batchId: "batch-1" }), {
          params: Promise.resolve({ projectId: PROJECT_ID }),
        })
      ).status,
    ).toBe(403);

    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is past due"),
    );
    const readOnly = await POST(request({ batchId: "batch-1" }), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    expect(readOnly.status).toBe(200);
    expect(SupabaseCustomRuleReadRepository).toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>) {
  return new Request(
    `http://localhost/api/projects/${PROJECT_ID}/settlement-rules/external-cost/preview`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

function context(repo = contextRepo()) {
  return {
    supabase: { client: "supabase" },
    auth: {
      userId: USER_ID,
      name: "Ops",
      role: "ops_manager" as const,
      organizationId: ORG_ID,
    },
    repo,
    audit: vi.fn(),
  };
}

function contextRepo(overrides: {
  batch?: ProjectCostImportBatchRecord | null;
  entitlement?: Record<string, unknown> | null;
} = {}) {
  return {
    getProjectEntitlement: vi
      .fn()
      .mockResolvedValue(
        overrides.entitlement === undefined
          ? { organizationId: ORG_ID, projectId: PROJECT_ID }
          : overrides.entitlement,
      ),
    getImportBatchById: vi
      .fn()
      .mockResolvedValue(
        overrides.batch === undefined ? importBatch() : overrides.batch,
      ),
    confirmCostImportWithRuleItems: vi.fn(),
  };
}

function importBatch(): ProjectCostImportBatchRecord {
  return {
    id: "batch-1",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    importType: "gift",
    rowCount: 3,
    parsedPayload: [
      {
        salesAmountCents: 100_000,
        directAmountCents: 15_000,
        streamerId: "streamer-1",
        supplierOrganizationId: "supplier-1",
        liveReportId: "report-1",
        secretUploadColumn: "never expose",
      },
      {
        salesAmountCents: 300_000,
        directAmountCents: 5_000,
        streamerId: "streamer-2",
        secretUploadColumn: "never expose",
      },
      {
        directAmountCents: 9_999,
        streamerId: "streamer-3",
        secretUploadColumn: "never expose",
      },
    ],
    status: "parsed",
    createdBy: USER_ID,
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

function externalRule(
  formula: string,
  requiredInputs: string[],
  overrides: Partial<CustomSettlementRuleVersion> = {},
): CustomSettlementRuleVersion {
  const validation = validateCustomRuleFormula(formula, {
    scope: "external_cost",
    executionGrain: "report",
    compositionMode: "emit_items",
  });
  if (!validation.ok) throw new Error(validation.issues[0]?.code ?? "invalid");
  return {
    id: "rule-v1",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    scope: "external_cost",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "emit_items",
    priority: 0,
    versionNumber: 1,
    status: "active",
    formula,
    compiledAst: validation.compiledAst as CustomSettlementRuleVersion["compiledAst"],
    variables: requiredInputs.map((name) => ({
      variableId: name,
      name,
      required: false,
      category: "optional_input",
      valueType: valueTypeFor(name),
      missingDataPolicy: { action: "route_item_to_review" },
    })) as CustomSettlementRuleVersion["variables"],
    parameters: {},
    ruleContract: {
      schemaVersion: 1,
      scope: "external_cost",
      target: { targetType: "project", targetId: null },
      executionGrain: "report",
      compositionMode: "emit_items",
      title: "外部成本规则",
      summary: "外部成本规则",
      calculationComponents: [],
      requiredInputs: [],
      parameters: [],
      effectiveStartAt: "2026-07-01T00:00:00+08:00",
      effectiveEndAt: null,
      missingDataPolicy: { action: "route_item_to_review" },
      compositionDescription: "生成待审核项目成本",
      businessTimezone: "Asia/Shanghai",
      examples: [
        example("正常"),
        example("边界一", "boundary"),
        example("边界二", "boundary"),
      ],
    },
    systemExplanationTemplate: "外部成本规则",
    missingDataPolicy: {},
    testCases: [],
    simulationSummary: {
      totalRecords: 0,
      calculatedRecords: 0,
      routedToReviewRecords: 0,
      blockedRecords: 0,
      aggregateAmountCents: "0",
    },
    formulaHash: validation.formulaHash,
    contractHash: "b".repeat(64),
    parameterHash: "c".repeat(64),
    catalogHash: "d".repeat(64),
    dataSelectionHash: "e".repeat(64),
    simulationId: null,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: USER_ID,
    approvedBy: null,
    aiDraftId: null,
    reason: "preview",
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function valueTypeFor(name: string): RuntimeValueType {
  if (name === "order_count" || name === "import_row_index") {
    return scalar("integer");
  }
  if (
    name.endsWith("_id") ||
    name === "supplier_id" ||
    name === "report_id" ||
    name === "import_type"
  ) {
    return scalar("string");
  }
  return scalar("money_cents");
}

function scalar<ScalarType extends RuntimeScalarType>(
  scalarType: ScalarType,
): { kind: "scalar"; scalarType: ScalarType } {
  return { kind: "scalar", scalarType };
}

function example(name: string, kind: "normal" | "boundary" = "normal") {
  return {
    name,
    kind,
    description: "示例",
    inputs: {},
    expectedResult: { type: "array", items: [] } satisfies TypedRuntimeValue,
  };
}

class ErrorWithStatus extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
