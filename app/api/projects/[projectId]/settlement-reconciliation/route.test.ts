import { beforeEach, describe, expect, it, vi } from "vitest";

import { runProjectSettlementReconciliation } from "@/features/settlements/project-settlement-reconciliation-service";
import {
  getSettlementRouteContext,
  RouteError,
} from "@/features/settlements/settlement-route-utils";

import { GET } from "./route";

vi.mock("@/features/settlements/project-settlement-reconciliation-service", () => ({
  runProjectSettlementReconciliation: vi.fn(),
  SupabaseReconciliationDataSource: vi.fn(function SupabaseReconciliationDataSource(
    this: { client: unknown },
    client: unknown,
  ) {
    this.client = client;
  }),
}));

vi.mock("@/features/settlements/settlement-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settlements/settlement-route-utils")
  >("@/features/settlements/settlement-route-utils");
  return { ...actual, getSettlementRouteContext: vi.fn() };
});

const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const supabase = {};

describe("project settlement reconciliation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase,
      repo: {},
      audit: vi.fn(),
      notify: vi.fn(),
      gate: {
        assertNoOpenRuleExceptions: vi.fn(),
        evaluateReconciliation: vi.fn(),
      },
      auth: {
        userId: "user-finance",
        name: "Finance",
        role: "finance",
        organizationId: "org-1",
      },
    } as never);
    vi.mocked(runProjectSettlementReconciliation).mockResolvedValue(
      reconciliationResult() as never,
    );
  });

  it("returns provenance, run freshness, and gate verdict metadata", async () => {
    vi.mocked(runProjectSettlementReconciliation).mockResolvedValueOnce(
      reconciliationResult({
        run: {
          id: "run-1",
          inputHash: "hash-1",
          createdAt: "2026-07-14T00:00:00.000Z",
        },
        checks: [
          {
            key: "evidence_red",
            severity: "warn",
            message: "Core warning",
          },
          {
            code: "custom_rule:rule-1:0",
            severity: "block",
            message: "Custom block",
            source: "custom_rule",
            ruleVersionId: "rule-1",
            formulaHash: "formula-hash",
          },
        ],
        hasBlocking: true,
        hasWarning: true,
        canConfirm: false,
        canLock: false,
      }) as never,
    );

    const response = await GET(
      new Request(
        `http://localhost/api/projects/${PROJECT_ID}/settlement-reconciliation?periodStart=2026-06-01&periodEnd=2026-06-30&forceApproved=true`,
      ),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(runProjectSettlementReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ userId: "user-finance" }),
        projectId: PROJECT_ID,
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        forceApproved: true,
      }),
    );
    expect(body.metadata).toEqual({
      checks: [
        {
          code: "evidence_red",
          severity: "warn",
          source: "core",
        },
        {
          code: "custom_rule:rule-1:0",
          severity: "block",
          source: "custom_rule",
          ruleVersionId: "rule-1",
        },
      ],
      provenance: {
        coreCheckCodes: ["evidence_red"],
        customCheckCodes: ["custom_rule:rule-1:0"],
      },
      run: {
        id: "run-1",
        inputHash: "hash-1",
        createdAt: "2026-07-14T00:00:00.000Z",
        freshness: "fresh",
      },
      gate: {
        verdict: "blocked",
        hasBlocking: true,
        hasWarning: true,
        canConfirm: false,
        canLock: false,
      },
    });
    expect(JSON.stringify(body.metadata)).not.toContain("formula-hash");
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getSettlementRouteContext).mockRejectedValueOnce(
      new RouteError("Unauthorized", 401),
    );

    const response = await GET(
      new Request(
        `http://localhost/api/projects/${PROJECT_ID}/settlement-reconciliation?periodStart=2026-06-01&periodEnd=2026-06-30`,
      ),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(401);
    expect(runProjectSettlementReconciliation).not.toHaveBeenCalled();
  });
});

function reconciliationResult(
  patch: Partial<{
    run: { id: string; inputHash: string; createdAt?: string | null };
    checks: unknown[];
    hasBlocking: boolean;
    hasWarning: boolean;
    canConfirm: boolean;
    canLock: boolean;
  }> = {},
) {
  return {
    income: { receivableCents: 1_000_000 },
    cost: {
      payableCents: 400_000,
      externalCostCents: 100_000,
      procurementCents: 0,
      totalCents: 500_000,
    },
    tax: {
      isInvoiced: false,
      outputVatCents: 0,
      surtaxCents: 0,
      taxTotalCents: 0,
      invoiceAmountCents: 1_000_000,
    },
    profit: {
      grossMarginCents: 500_000,
      marginRateBps: 5_000,
      manualAdjustmentCents: 0,
    },
    evidence: { green: 8, yellow: 0, red: 0, unknown: 0 },
    checks: patch.checks ?? [],
    hasBlocking: patch.hasBlocking ?? false,
    hasWarning: patch.hasWarning ?? false,
    canConfirm: patch.canConfirm ?? true,
    canLock: patch.canLock ?? true,
    ...(patch.run ? { run: patch.run } : {}),
  };
}
