import { describe, expect, it } from "vitest";

import type { CustomRuleMissingDataPolicy } from "./custom-rule-types";
import {
  analyzeCustomRuleDataReadiness,
  CustomRuleReadinessInputError,
  isCustomRuleSimulationReadinessFresh,
} from "./custom-rule-data-readiness";
import {
  buildCustomRuleVariableCatalog,
  CustomRuleCoverageValidationError,
  type CustomRuleVariableCatalog,
  type ProjectVariableCoverage,
} from "./custom-rule-variable-catalog";

describe("analyzeCustomRuleDataReadiness", () => {
  it("returns deterministic available, partial, unavailable, and not-applicable statuses", () => {
    const report = analyzeCustomRuleDataReadiness({
      catalog: payableReportCatalog(),
      inputs: [
        { variableId: "evidence_level", required: true },
        { variableId: "system_minutes", required: true },
        { variableId: "streamer_level", required: true },
        { variableId: "period_system_minutes", required: true },
      ],
    });

    expect(report.inputs.map(({ variableId, status, code }) => ({
      variableId,
      status,
      code,
    }))).toEqual([
      {
        variableId: "evidence_level",
        status: "available",
        code: "CUSTOM_RULE_INPUT_AVAILABLE",
      },
      {
        variableId: "period_system_minutes",
        status: "not_applicable",
        code: "CUSTOM_RULE_INPUT_NOT_APPLICABLE",
      },
      {
        variableId: "streamer_level",
        status: "unavailable",
        code: "CUSTOM_RULE_INPUT_UNAVAILABLE",
      },
      {
        variableId: "system_minutes",
        status: "partial",
        code: "CUSTOM_RULE_REQUIRED_INPUT_INCOMPLETE",
      },
    ]);
    expect(report.readyForSimulation).toBe(false);
    expect(report.readyForActivation).toBe(false);
    expect(report.inputs.every((input) => /[\u4e00-\u9fff]/u.test(input.reasonZh))).toBe(
      true,
    );
  });

  it("fails required inputs below complete historical coverage", () => {
    const report = analyzeCustomRuleDataReadiness({
      catalog: payableReportCatalog(),
      inputs: [{ variableId: "system_minutes", required: true }],
    });

    expect(report.inputs[0]).toMatchObject({
      status: "partial",
      ready: false,
      coverageNumerator: 8,
      coverageDenominator: 10,
      code: "CUSTOM_RULE_REQUIRED_INPUT_INCOMPLETE",
    });
  });

  it.each([
    [
      { action: "route_item_to_review" },
      "CUSTOM_RULE_OPTIONAL_INPUT_ROUTE_TO_REVIEW",
    ],
    [{ action: "block_batch" }, "CUSTOM_RULE_OPTIONAL_INPUT_BLOCK_BATCH"],
    [
      {
        action: "use_explicit_default",
        defaultValue: { type: "money_cents", amountCents: 0 },
      },
      "CUSTOM_RULE_OPTIONAL_INPUT_EXPLICIT_DEFAULT",
    ],
  ] as const)(
    "accepts partial optional input with explicit policy %j",
    (missingDataPolicy, code) => {
      const report = analyzeCustomRuleDataReadiness({
        catalog: payableReportCatalog(),
        inputs: [
          {
            variableId: "gift_amount",
            required: false,
            missingDataPolicy,
          },
        ],
      });

      expect(report.inputs[0]).toMatchObject({
        status: "partial",
        ready: true,
        code,
      });
      expect(report.readyForSimulation).toBe(true);
      expect(report.readyForActivation).toBe(true);
    },
  );

  it("requires every optional input to name a missing-data policy", () => {
    const report = analyzeCustomRuleDataReadiness({
      catalog: payableReportCatalog(),
      inputs: [{ variableId: "views", required: false }],
    });

    expect(report.inputs[0]).toMatchObject({
      status: "partial",
      ready: false,
      code: "CUSTOM_RULE_MISSING_DATA_POLICY_REQUIRED",
    });
  });

  it.each([
    "project_id",
    "streamer_id",
    "collaboration_id",
    "system_minutes",
    "screenshot_minutes",
    "settlement_minutes",
    "evidence_level",
    "time_source",
    "live_started_at",
    "approved_at",
  ])("forbids explicit defaults for identity/evidence field %s", (variableId) => {
    const report = analyzeCustomRuleDataReadiness({
      catalog: payableReportCatalog(),
      inputs: [
        {
          variableId,
          required: false,
          missingDataPolicy: defaultFor(variableId),
        },
      ],
    });

    expect(report.inputs[0]).toMatchObject({
      ready: false,
      code: "CUSTOM_RULE_EXPLICIT_DEFAULT_FORBIDDEN",
    });
  });

  it.each(["period_start", "period_end"])(
    "forbids explicit defaults for authorized sample boundary %s",
    (variableId) => {
      const report = analyzeCustomRuleDataReadiness({
        catalog: buildCustomRuleVariableCatalog({
          scope: "payable",
          executionGrain: "project_streamer_period",
          coverage: coverageFixture(),
        }),
        inputs: [
          {
            variableId,
            required: false,
            missingDataPolicy: {
              action: "use_explicit_default",
              defaultValue: {
                type: "timestamp",
                value: "2026-06-01T00:00:00.000Z",
              },
            },
          },
        ],
      });

      expect(report.inputs[0]).toMatchObject({
        ready: false,
        code: "CUSTOM_RULE_EXPLICIT_DEFAULT_FORBIDDEN",
      });
    },
  );

  it("rejects an explicit default whose runtime type does not match the variable", () => {
    const report = analyzeCustomRuleDataReadiness({
      catalog: payableReportCatalog(),
      inputs: [
        {
          variableId: "gift_amount",
          required: false,
          missingDataPolicy: {
            action: "use_explicit_default",
            defaultValue: { type: "string", value: "0" },
          },
        },
      ],
    });

    expect(report.inputs[0]).toMatchObject({
      ready: false,
      code: "CUSTOM_RULE_EXPLICIT_DEFAULT_TYPE_MISMATCH",
    });
  });

  it("allows schema-ready simulation for a project with no history without treating 0/0 as 100%", () => {
    const catalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({ hasHistory: false, denominator: 0 }),
    });
    const report = analyzeCustomRuleDataReadiness({
      catalog,
      inputs: [{ variableId: "system_minutes", required: true }],
    });

    expect(report).toMatchObject({
      historicalVerification: "unverified",
      readyForSimulation: true,
      readyForActivation: false,
      warnings: [
        {
          code: "CUSTOM_RULE_PROJECT_NO_HISTORY",
          reasonZh: expect.stringContaining("暂无历史数据"),
        },
      ],
    });
    expect(report.inputs[0]).toMatchObject({
      status: "available",
      coverageNumerator: 0,
      coverageDenominator: 0,
      code: "CUSTOM_RULE_INPUT_SCHEMA_READY_NO_HISTORY",
    });
    expect(report.inputs[0]).not.toHaveProperty("coveragePercent");
  });

  it("requires a confirmed IANA timezone for weekday/hour and invalidates prior simulation freshness", () => {
    const beforeCatalog = payableReportCatalog();
    const before = analyzeCustomRuleDataReadiness({
      catalog: beforeCatalog,
      inputs: [{ variableId: "weekday", required: true }],
    });
    const changedCatalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({ businessTimezone: "Asia/Tokyo" }),
    });
    const changed = analyzeCustomRuleDataReadiness({
      catalog: changedCatalog,
      inputs: [{ variableId: "weekday", required: true }],
    });
    const unconfirmed = analyzeCustomRuleDataReadiness({
      catalog: buildCustomRuleVariableCatalog({
        scope: "payable",
        executionGrain: "report",
        coverage: coverageFixture({ businessTimezoneConfirmed: false }),
      }),
      inputs: [{ variableId: "weekday", required: true }],
    });

    expect(changed.catalogVersion).not.toBe(before.catalogVersion);
    expect(changed.readinessHash).not.toBe(before.readinessHash);
    expect(
      isCustomRuleSimulationReadinessFresh(
        {
          catalogVersion: before.catalogVersion,
          readinessHash: before.readinessHash,
          businessTimezone: before.businessTimezone,
        },
        changed,
      ),
    ).toBe(false);
    expect(unconfirmed.inputs[0]).toMatchObject({
      status: "unavailable",
      ready: false,
      code: "CUSTOM_RULE_BUSINESS_TIMEZONE_UNCONFIRMED",
    });
  });

  it("uses the stable timezone code when provenance is unresolved", () => {
    const report = analyzeCustomRuleDataReadiness({
      catalog: buildCustomRuleVariableCatalog({
        scope: "payable",
        executionGrain: "report",
        coverage: coverageFixture({
          businessTimezoneConfirmed: true,
          businessTimezoneSource: "unresolved",
        }),
      }),
      inputs: [{ variableId: "hour_of_day", required: true }],
    });

    expect(report.inputs[0]).toMatchObject({
      status: "unavailable",
      ready: false,
      code: "CUSTOM_RULE_BUSINESS_TIMEZONE_UNCONFIRMED",
    });
  });

  it.each([
    [-1, 10],
    [1.5, 10],
    [11, 10],
    [1, -1],
    [1, 1.5],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1],
  ])(
    "rejects unsafe coverage counts numerator=%s denominator=%s",
    (coverageNumerator, coverageDenominator) => {
      const catalog = payableReportCatalog();
      catalog.variables = catalog.variables.map((item) =>
        item.id === "system_minutes"
          ? { ...item, coverageNumerator, coverageDenominator }
          : item,
      );

      expect(() =>
        analyzeCustomRuleDataReadiness({
          catalog,
          inputs: [{ variableId: "system_minutes", required: true }],
        }),
      ).toThrow(CustomRuleCoverageValidationError);
    },
  );

  it("hashes canonical input state without insertion-order drift", () => {
    const catalog = payableReportCatalog();
    const forward = analyzeCustomRuleDataReadiness({
      catalog,
      inputs: [
        { variableId: "evidence_level", required: true },
        {
          variableId: "gift_amount",
          required: false,
          missingDataPolicy: { action: "route_item_to_review" },
        },
      ],
    });
    const reverse = analyzeCustomRuleDataReadiness({
      catalog,
      inputs: [
        {
          variableId: "gift_amount",
          required: false,
          missingDataPolicy: { action: "route_item_to_review" },
        },
        { variableId: "evidence_level", required: true },
      ],
    });

    expect(reverse.readinessHash).toBe(forward.readinessHash);
    expect(reverse.inputs).toEqual(forward.inputs);
  });

  it.each([
    ["unknown action", { action: "retry_later" }],
    ["missing default payload", { action: "use_explicit_default" }],
    [
      "missing money payload",
      { action: "use_explicit_default", defaultValue: { type: "money_cents" } },
    ],
    [
      "NaN money payload",
      {
        action: "use_explicit_default",
        defaultValue: { type: "money_cents", amountCents: Number.NaN },
      },
    ],
    [
      "infinite number payload",
      {
        action: "use_explicit_default",
        defaultValue: { type: "number", value: Number.POSITIVE_INFINITY },
      },
    ],
    [
      "null money payload",
      {
        action: "use_explicit_default",
        defaultValue: { type: "money_cents", amountCents: null },
      },
    ],
  ])("rejects malformed policy boundary: %s", (_label, missingDataPolicy) => {
    expect(() =>
      analyzeUnsafe({
        catalog: payableReportCatalog(),
        inputs: [
          {
            variableId: "gift_amount",
            required: false,
            missingDataPolicy,
          },
        ],
      }),
    ).toThrow(CustomRuleReadinessInputError);
  });

  it.each([
    [
      "requirement",
      {
        variableId: "system_minutes",
        required: true,
        unexpected: true,
      },
    ],
    [
      "policy",
      {
        variableId: "gift_amount",
        required: false,
        missingDataPolicy: {
          action: "route_item_to_review",
          unexpected: true,
        },
      },
    ],
    [
      "runtime value",
      {
        variableId: "gift_amount",
        required: false,
        missingDataPolicy: {
          action: "use_explicit_default",
          defaultValue: {
            type: "money_cents",
            amountCents: 0,
            unexpected: true,
          },
        },
      },
    ],
  ])("rejects extra keys on %s objects", (_label, requirement) => {
    expect(() =>
      analyzeUnsafe({
        catalog: payableReportCatalog(),
        inputs: [requirement],
      }),
    ).toThrow(CustomRuleReadinessInputError);
  });

  it("rejects accessors without invoking caller code", () => {
    let accessorReads = 0;
    const requirement = { required: true } as Record<string, unknown>;
    Object.defineProperty(requirement, "variableId", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "system_minutes";
      },
    });
    const policy = {} as Record<string, unknown>;
    Object.defineProperty(policy, "action", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "route_item_to_review";
      },
    });
    const defaultValue = { type: "money_cents" } as Record<string, unknown>;
    Object.defineProperty(defaultValue, "amountCents", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 0;
      },
    });

    for (const unsafeRequirement of [
      requirement,
      {
        variableId: "gift_amount",
        required: false,
        missingDataPolicy: policy,
      },
      {
        variableId: "gift_amount",
        required: false,
        missingDataPolicy: {
          action: "use_explicit_default",
          defaultValue,
        },
      },
    ]) {
      expect(() =>
        analyzeUnsafe({
          catalog: payableReportCatalog(),
          inputs: [unsafeRequirement],
        }),
      ).toThrow(CustomRuleReadinessInputError);
    }
    expect(accessorReads).toBe(0);
  });

  it("rejects proxies without invoking traps", () => {
    let trapCalls = 0;
    const proxy = new Proxy(
      { action: "route_item_to_review" },
      {
        get(target, property, receiver) {
          trapCalls += 1;
          return Reflect.get(target, property, receiver);
        },
        getOwnPropertyDescriptor(target, property) {
          trapCalls += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
        getPrototypeOf(target) {
          trapCalls += 1;
          return Reflect.getPrototypeOf(target);
        },
        ownKeys(target) {
          trapCalls += 1;
          return Reflect.ownKeys(target);
        },
      },
    );

    expect(() =>
      analyzeUnsafe({
        catalog: payableReportCatalog(),
        inputs: [
          {
            variableId: "gift_amount",
            required: false,
            missingDataPolicy: proxy,
          },
        ],
      }),
    ).toThrow(CustomRuleReadinessInputError);
    expect(trapCalls).toBe(0);
  });

  it("rejects runtime values deeper than 20 levels", () => {
    let defaultValue: unknown = { type: "string", value: "leaf" };
    for (let depth = 0; depth < 21; depth += 1) {
      defaultValue = { type: "array", items: [defaultValue] };
    }

    expect(() =>
      analyzeUnsafe({
        catalog: payableReportCatalog(),
        inputs: [
          {
            variableId: "gift_amount",
            required: false,
            missingDataPolicy: {
              action: "use_explicit_default",
              defaultValue,
            },
          },
        ],
      }),
    ).toThrow(CustomRuleReadinessInputError);
  });

  it.each([
    [
      "array items",
      {
        type: "array",
        items: Array.from({ length: 301 }, () => ({
          type: "string",
          value: "item",
        })),
      },
    ],
    [
      "object fields",
      {
        type: "object",
        fields: Object.fromEntries(
          Array.from({ length: 301 }, (_, index) => [
            `field_${index}`,
            { type: "string", value: "item" },
          ]),
        ),
      },
    ],
  ])("rejects more than 300 %s", (_label, defaultValue) => {
    expect(() =>
      analyzeUnsafe({
        catalog: payableReportCatalog(),
        inputs: [
          {
            variableId: "gift_amount",
            required: false,
            missingDataPolicy: {
              action: "use_explicit_default",
              defaultValue,
            },
          },
        ],
      }),
    ).toThrow(CustomRuleReadinessInputError);
  });

  it("rejects more than 300 requirements", () => {
    expect(() =>
      analyzeUnsafe({
        catalog: payableReportCatalog(),
        inputs: Array.from({ length: 301 }, (_, index) => ({
          variableId: `variable_${index}`,
          required: true,
        })),
      }),
    ).toThrow(CustomRuleReadinessInputError);
  });

  it("exposes a stable code for readiness boundary failures", () => {
    try {
      analyzeUnsafe({
        catalog: payableReportCatalog(),
        inputs: [
          {
            variableId: "gift_amount",
            required: false,
            missingDataPolicy: { action: "bogus" },
          },
        ],
      });
      throw new Error("expected readiness validation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "CUSTOM_RULE_READINESS_INPUT_INVALID",
      });
    }
  });
});

function analyzeUnsafe(input: unknown) {
  return analyzeCustomRuleDataReadiness(
    input as Parameters<typeof analyzeCustomRuleDataReadiness>[0],
  );
}

function payableReportCatalog(): CustomRuleVariableCatalog {
  return buildCustomRuleVariableCatalog({
    scope: "payable",
    executionGrain: "report",
    coverage: coverageFixture(),
  });
}

function coverageFixture(
  overrides: {
    hasHistory?: boolean;
    denominator?: number;
    businessTimezone?: string | null;
    businessTimezoneConfirmed?: boolean;
    businessTimezoneSource?: ProjectVariableCoverage["businessTimezoneSource"];
  } = {},
): ProjectVariableCoverage {
  const denominator = overrides.denominator ?? 10;
  const period = denominator
    ? {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-30T23:59:59.999Z",
      }
    : null;
  const counts = (numerator: number) => ({
    numerator: denominator === 0 ? 0 : numerator,
    denominator,
    latestSampledPeriod: period,
  });

  return {
    hasHistory: overrides.hasHistory ?? true,
    businessTimezone: overrides.businessTimezone ?? "Asia/Shanghai",
    businessTimezoneConfirmed:
      overrides.businessTimezoneConfirmed ?? true,
    businessTimezoneSource:
      overrides.businessTimezoneSource ?? "contract_default",
    variables: {
      system_minutes: counts(8),
      screenshot_minutes: counts(7),
      settlement_minutes: counts(10),
      evidence_level: counts(10),
      time_source: counts(10),
      views: counts(6),
      live_started_at: counts(10),
      approved_at: counts(10),
      project_id: counts(10),
      streamer_id: counts(10),
      streamer_source: counts(10),
      collaboration_id: counts(4),
      base_hourly_rate: counts(10),
      base_salary: counts(10),
      cps_rate: counts(10),
      gift_amount: counts(3),
    },
  };
}

function defaultFor(variableId: string): CustomRuleMissingDataPolicy {
  if (
    variableId.endsWith("_at") ||
    variableId === "live_started_at"
  ) {
    return {
      action: "use_explicit_default",
      defaultValue: {
        type: "timestamp",
        value: "2026-06-01T00:00:00.000Z",
      },
    };
  }
  if (
    variableId.endsWith("_minutes") ||
    variableId === "views"
  ) {
    return {
      action: "use_explicit_default",
      defaultValue: { type: "integer", value: 0 },
    };
  }
  return {
    action: "use_explicit_default",
    defaultValue: { type: "string", value: "unknown" },
  };
}
