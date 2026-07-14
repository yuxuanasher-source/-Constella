import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";

vi.mock("@/features/complex-cost/complex-cost-route-utils", () => ({
  getComplexCostRouteContext: vi.fn(),
  jsonError: (error: { message?: string; statusCode?: number }) =>
    Response.json(
      { error: error.message ?? "Unexpected error" },
      { status: error.statusCode ?? 500 },
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

const ORG_ID = "org-1";
const PROJECT_ID = "project-1";

describe("external-cost rule exception list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getComplexCostRouteContext).mockResolvedValue(context() as never);
  });

  it("lists unresolved import-row exceptions without replay snapshots", async () => {
    const repo = repoFixture();
    vi.mocked(getComplexCostRouteContext).mockResolvedValue(context(repo) as never);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID, batchId: "batch-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(repo.listExternalCostRuleExceptionsForImportBatch).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      importBatchId: "batch-1",
      status: "review_required",
    });
    expect(body.exceptions).toEqual([
      expect.objectContaining({
        id: "exception-1",
        rowIndex: 2,
        variableName: "sales_amount",
        status: "review_required",
        reviewedValue: null,
        sourceRefs: {
          importBatchId: "batch-1",
          ruleVersionId: "rule-v1",
          sourceContextHash: "hash-1",
        },
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("compiledAst");
    expect(JSON.stringify(body)).not.toContain("rawRow");
  });

  it("hides batches outside the requested project or organization and allows operator read-only access", async () => {
    const repo = repoFixture({ batch: { projectId: "other-project" } });
    vi.mocked(getComplexCostRouteContext).mockResolvedValueOnce(
      context(repo, "operator_business") as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID, batchId: "batch-1" }),
    });

    expect(response.status).toBe(404);
    expect(repo.listExternalCostRuleExceptionsForImportBatch).not.toHaveBeenCalled();

    const operatorRepo = repoFixture();
    vi.mocked(getComplexCostRouteContext).mockResolvedValueOnce(
      context(operatorRepo, "operator_business") as never,
    );
    const operator = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID, batchId: "batch-1" }),
    });
    expect(operator.status).toBe(200);
  });

  it("denies streamer access through the route context", async () => {
    vi.mocked(getComplexCostRouteContext).mockRejectedValueOnce(
      new ErrorWithStatus("Only MCN staff can manage complex cost rules", 403),
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID, batchId: "batch-1" }),
    });

    expect(response.status).toBe(403);
  });
});

function context(repo = repoFixture(), role = "ops_manager") {
  return {
    supabase: {},
    auth: { userId: "user-1", role, organizationId: ORG_ID },
    repo,
    audit: vi.fn(),
  };
}

function repoFixture(overrides: { batch?: { projectId?: string; organizationId?: string } | null } = {}) {
  return {
    getImportBatchById: vi.fn().mockResolvedValue(
      overrides.batch === null
        ? null
        : {
            id: "batch-1",
            organizationId: overrides.batch?.organizationId ?? ORG_ID,
            projectId: overrides.batch?.projectId ?? PROJECT_ID,
          },
    ),
    listExternalCostRuleExceptionsForImportBatch: vi.fn().mockResolvedValue([
      {
        id: "exception-1",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        importBatchId: "batch-1",
        importRowIndex: 2,
        ruleVersionId: "rule-v1",
        variableName: "sales_amount",
        policy: "route_item_to_review",
        status: "review_required",
        resolutionValue: null,
        resolutionReason: null,
        sourceContextSnapshot: {
          __source_context_hash: "hash-1",
          rawRow: { secret: "rawRow" },
          compiledAst: { kind: "secret" },
        },
      },
    ]),
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
