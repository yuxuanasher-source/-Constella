import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { diffBusinessRuleContracts } from "@/features/settlements/custom-rule-contract";
import { buildCustomRuleTemplateExplanation } from "@/features/settlements/custom-rule-explanation";
import { getCustomRuleRouteContext } from "@/features/settlements/custom-rule-route-context";
import { validateCustomRuleFormula } from "@/features/settlements/custom-rule-validator";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));

vi.mock("@/features/settlements/custom-rule-validator", () => ({
  validateCustomRuleFormula: vi.fn(),
}));

vi.mock(
  "@/features/settlements/custom-rule-contract",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/settlements/custom-rule-contract")
      >();
    return { ...actual, diffBusinessRuleContracts: vi.fn() };
  },
);

vi.mock(
  "@/features/settlements/custom-rule-explanation",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/settlements/custom-rule-explanation")
      >();
    return { ...actual, buildCustomRuleTemplateExplanation: vi.fn() };
  },
);

vi.mock(
  "@/features/settlements/custom-rule-route-context",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/settlements/custom-rule-route-context")
      >();
    return { ...actual, getCustomRuleRouteContext: vi.fn() };
  },
);

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function contract() {
  return {
    schemaVersion: 1,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "replace",
    title: "项目主播按场计费",
    summary: "每场直播按系统时长计算主播应付金额。",
    calculationComponents: [
      {
        name: "final",
        description: "计算最终应付金额",
        expression: "按确认业务规则计算最终金额",
        resultType: { kind: "scalar", scalarType: "money_cents" },
      },
    ],
    requiredInputs: [
      {
        name: "system_minutes",
        description: "系统直播时长",
        source: "直播报告系统计时",
        valueType: { kind: "scalar", scalarType: "integer" },
        userFacingUnit: "分钟",
      },
    ],
    parameters: [
      {
        name: "hourly_rate",
        description: "每小时结算单价",
        valueType: { kind: "scalar", scalarType: "money_cents" },
        userFacingUnit: "元/小时",
        defaultValue: { type: "money_cents", amountCents: 10_000 },
      },
    ],
    effectiveStartAt: "2026-07-12T00:00:00+08:00",
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    compositionDescription: "替换项目现有的主播应付基础规则。",
    businessTimezone: "Asia/Shanghai",
    examples: [
      {
        name: "标准一小时",
        kind: "normal",
        description: "直播六十分钟按一小时结算。",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 10_000 },
      },
      {
        name: "零时长",
        kind: "boundary",
        description: "直播时长为零时金额为零。",
        inputs: { system_minutes: { type: "integer", value: 0 } },
        expectedResult: { type: "money_cents", amountCents: 0 },
      },
      {
        name: "最小分钟",
        kind: "boundary",
        description: "直播一分钟按最小粒度结算。",
        inputs: { system_minutes: { type: "integer", value: 1 } },
        expectedResult: { type: "money_cents", amountCents: 167 },
      },
    ],
  };
}

function context(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
  };
}

function request(body: unknown = validBody()) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validBody() {
  const previousContract = contract();
  previousContract.summary = "旧版按场结算说明。";
  return {
    formula: "money_result({ final: yuan(record.system_minutes * 100 / 60) })",
    contract: contract(),
    previousContract,
  };
}

describe("settlement rule validation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(validateCustomRuleFormula).mockReturnValue({
      ok: true,
      compiledAst: { kind: "literal", value: 1 },
      variables: ["system_minutes"],
      parameters: [],
      formulaHash: "a".repeat(64),
    } as never);
    vi.mocked(buildCustomRuleTemplateExplanation).mockReturnValue(
      "最终金额按系统直播时长和小时单价确定。",
    );
    vi.mocked(diffBusinessRuleContracts).mockReturnValue([
      {
        field: "summary",
        before: "旧版按场结算说明。",
        after: "每场直播按系统时长计算主播应付金额。",
      },
    ] as never);
  });

  it.each(["owner", "ops_manager", "operator_business"])(
    "allows %s to validate an edited formula",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await POST(request(), {
        params: Promise.resolve({ projectId: PROJECT_ID }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        validation: {
          ok: true,
          compiledAst: { kind: "literal", value: 1 },
          explanation: "最终金额按系统直播时长和小时单价确定。",
          contractDiff: [
            {
              field: "summary",
              before: "旧版按场结算说明。",
              after: "每场直播按系统时长计算主播应付金额。",
            },
          ],
          variables: ["system_minutes"],
          parameters: [],
          formulaHash: "a".repeat(64),
        },
      });
      expect(buildCustomRuleTemplateExplanation).toHaveBeenCalledWith({
        ast: { kind: "literal", value: 1 },
      });
      expect(diffBusinessRuleContracts).toHaveBeenCalledWith(
        validBody().previousContract,
        validBody().contract,
      );
      expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(
        PROJECT_ID,
      );
      expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
        client: routeContext.supabase,
        organizationId: ORGANIZATION_ID,
        featureKey: "settlement",
      });
    },
  );

  it("prevents finance from validating or submitting edited formulas", async () => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CUSTOM_RULE_AUTHOR_ROLE_REQUIRED",
        message: "Current role cannot author settlement rules",
        retryable: false,
      },
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(validateCustomRuleFormula).not.toHaveBeenCalled();
  });

  it("stops before validation when billing rejects the write", async () => {
    const routeContext = context("owner");
    vi.mocked(assertBillingWriteAllowed).mockRejectedValue(
      new Error("Organization is read-only because billing is past due"),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BILLING_WRITE_BLOCKED", retryable: false },
    });
    expect(validateCustomRuleFormula).not.toHaveBeenCalled();
    expect(buildCustomRuleTemplateExplanation).not.toHaveBeenCalled();
    expect(diffBusinessRuleContracts).not.toHaveBeenCalled();
  });

  it("returns malformed JSON as a safe 400 instead of an empty object", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request("{"), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON",
        retryable: false,
      },
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
  });

  it("maps deterministic validation issues to the safe envelope", async () => {
    vi.mocked(validateCustomRuleFormula).mockReturnValue({
      ok: false,
      issues: [
        {
          code: "CUSTOM_RULE_UNIT_MISMATCH",
          message: "金额不能与百分比直接相加",
          span: { start: 0, end: 4 },
          path: "final",
        },
      ],
    });
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      context("owner") as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CUSTOM_RULE_UNIT_MISMATCH",
        message: "金额不能与百分比直接相加",
        path: ["formula", "final"],
        retryable: false,
      },
    });
  });

  it("stops before billing and validation when project scope is unavailable", async () => {
    const routeContext = context("owner");
    const { CustomRuleRouteError } =
      await import("@/features/settlements/custom-rule-route-context");
    routeContext.requireProjectAccess.mockRejectedValue(
      new CustomRuleRouteError({
        code: "CUSTOM_RULE_PROJECT_NOT_FOUND",
        message: "Project not found",
        status: 404,
        retryable: false,
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(404);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(validateCustomRuleFormula).not.toHaveBeenCalled();
  });
});
