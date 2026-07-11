import { describe, expect, it } from "vitest";

import type { RuntimeValueType } from "./custom-rule-types";
import {
  buildCustomRuleVariableCatalog,
  hashCustomRuleCatalogState,
  type CustomRuleCatalogHashInput,
  type ProjectVariableCoverage,
} from "./custom-rule-variable-catalog";

const integerType: RuntimeValueType = {
  kind: "scalar",
  scalarType: "integer",
};

describe("buildCustomRuleVariableCatalog", () => {
  it("exposes only compiler-allowed payable report metadata", () => {
    const catalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture(),
    });

    expect(catalog.variables.map((variable) => variable.id)).toEqual([
      "approved_at",
      "base_hourly_rate",
      "base_salary",
      "collaboration_id",
      "cps_rate",
      "evidence_level",
      "gift_amount",
      "hour_of_day",
      "live_started_at",
      "manual_adjustment",
      "orders_count",
      "project_id",
      "project_tags",
      "sales_amount",
      "screenshot_minutes",
      "settlement_minutes",
      "streamer_group_ids",
      "streamer_id",
      "streamer_level",
      "streamer_source",
      "system_minutes",
      "time_source",
      "views",
      "weekday",
    ]);

    expect(catalog.variables).not.toContainEqual(
      expect.objectContaining({ id: "period_system_minutes" }),
    );
    expect(catalog.variables).not.toContainEqual(
      expect.objectContaining({ id: "supplier_fee" }),
    );
    expect(catalog.variables).not.toContainEqual(
      expect.objectContaining({ id: "tax_amount" }),
    );
  });

  it("maps schema-backed, normalized-import, and unavailable sources honestly", () => {
    const catalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture(),
    });

    expect(variable(catalog, "system_minutes")).toEqual({
      id: "system_minutes",
      label: "系统计时分钟",
      runtimeType: integerType,
      unit: "分钟",
      sourceLabel: "直播报告系统计时",
      availability: "available",
      coverageNumerator: 8,
      coverageDenominator: 10,
      latestSampledPeriod: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-30T23:59:59.999Z",
      },
    });
    expect(variable(catalog, "approved_at")).toMatchObject({
      availability: "available",
      coverageNumerator: 10,
      coverageDenominator: 10,
      sourceLabel: "已通过直播报告的审核时间",
    });
    expect(variable(catalog, "gift_amount")).toMatchObject({
      availability: "partial",
      sourceLabel: "已确认的规范化礼物导入项",
    });
    expect(variable(catalog, "sales_amount")).toMatchObject({
      availability: "unavailable",
      sourceLabel: "暂无规范化销售额字段",
    });
    expect(variable(catalog, "orders_count")).toMatchObject({
      availability: "unavailable",
      sourceLabel: "暂无规范化订单数字段",
    });
    expect(variable(catalog, "streamer_level")).toMatchObject({
      availability: "unavailable",
    });
  });

  it("gates weekday and hour on a confirmed valid IANA business timezone", () => {
    const confirmed = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture(),
    });
    const unconfirmed = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({ businessTimezoneConfirmed: false }),
    });
    const invalid = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({ businessTimezone: "Mars/Olympus" }),
    });

    expect(variable(confirmed, "weekday").availability).toBe("available");
    expect(variable(confirmed, "hour_of_day").availability).toBe("available");
    expect(variable(unconfirmed, "weekday").availability).toBe("unavailable");
    expect(variable(invalid, "hour_of_day").availability).toBe("unavailable");
  });

  it("exposes compatible period aggregates only at aggregate grains", () => {
    const catalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "project_streamer_period",
      coverage: coverageFixture(),
    });

    expect(catalog.variables).toContainEqual(
      expect.objectContaining({
        id: "period_system_minutes",
        availability: "available",
      }),
    );
    expect(catalog.variables).toContainEqual(
      expect.objectContaining({ id: "period_start" }),
    );
    expect(catalog.variables).not.toContainEqual(
      expect.objectContaining({ id: "system_minutes" }),
    );
  });

  it("does not advertise variables for Phase 1-disabled compiler scopes", () => {
    const coverage = coverageFixture();

    expect(
      buildCustomRuleVariableCatalog({
        scope: "external_cost",
        executionGrain: "report",
        coverage,
      }).variables,
    ).toEqual([]);
    expect(
      buildCustomRuleVariableCatalog({
        scope: "reconciliation",
        executionGrain: "project_period",
        coverage,
      }).variables,
    ).toEqual([]);
  });

  it("returns an AI-facing DTO without values, amounts, raw rows, or secret IDs", () => {
    const coverage = coverageFixture();
    coverage.variables.system_minutes = {
      ...coverage.variables.system_minutes,
      rawRows: [{ id: "report-secret", amountCents: 123_456 }],
      streamerAmounts: [100, 200],
      internalMargin: 999,
      tax: 88,
    } as ProjectVariableCoverage["variables"][string];

    const catalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage,
    });
    const serialized = JSON.stringify(catalog);

    expect(Object.keys(catalog.variables[0] ?? {}).sort()).toEqual([
      "availability",
      "coverageDenominator",
      "coverageNumerator",
      "id",
      "label",
      "latestSampledPeriod",
      "runtimeType",
      "sourceLabel",
      "unit",
    ]);
    expect(serialized).not.toContain("report-secret");
    expect(serialized).not.toContain("amountCents");
    expect(serialized).not.toContain("streamerAmounts");
    expect(serialized).not.toContain("internalMargin");
    expect(serialized).not.toContain('"tax"');
    expect(serialized).not.toContain("rawRows");
  });

  it("builds a stable catalog version from semantic source and coverage state", () => {
    const base = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture(),
    });
    const reordered = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({ reverseCoverageInsertion: true }),
    });
    const changedCoverage = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({ systemMinutesNumerator: 9 }),
    });
    const changedPeriod = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({
        latestSampledPeriod: {
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-07-31T23:59:59.999Z",
        },
      }),
    });
    const changedTimezone = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({ businessTimezone: "Asia/Tokyo" }),
    });

    expect(reordered.version).toBe(base.version);
    expect(changedCoverage.version).not.toBe(base.version);
    expect(changedPeriod.version).not.toBe(base.version);
    expect(changedTimezone.version).not.toBe(base.version);
  });
});

describe("hashCustomRuleCatalogState", () => {
  it("changes for source mappings but ignores Chinese label copy and insertion order", () => {
    const base = hashInput();
    const reorderedWithNewCopy = {
      ...base,
      variables: [...base.variables]
        .reverse()
        .map((entry) => ({ ...entry, label: "改写文案" })),
    } as CustomRuleCatalogHashInput;
    const remapped: CustomRuleCatalogHashInput = {
      ...base,
      variables: base.variables.map((entry) =>
        entry.id === "system_minutes"
          ? { ...entry, sourceKey: "live_reports.claimed_duration" }
          : entry,
      ),
    };

    expect(hashCustomRuleCatalogState(reorderedWithNewCopy)).toBe(
      hashCustomRuleCatalogState(base),
    );
    expect(hashCustomRuleCatalogState(remapped)).not.toBe(
      hashCustomRuleCatalogState(base),
    );
  });
});

function variable(
  catalog: ReturnType<typeof buildCustomRuleVariableCatalog>,
  id: string,
) {
  const item = catalog.variables.find((candidate) => candidate.id === id);
  expect(item, `missing catalog variable ${id}`).toBeDefined();
  return item!;
}

function coverageFixture(
  overrides: {
    businessTimezone?: string | null;
    businessTimezoneConfirmed?: boolean;
    systemMinutesNumerator?: number;
    latestSampledPeriod?: { start: string; end: string } | null;
    reverseCoverageInsertion?: boolean;
  } = {},
): ProjectVariableCoverage {
  const latestSampledPeriod =
    overrides.latestSampledPeriod === undefined
      ? {
          start: "2026-06-01T00:00:00.000Z",
          end: "2026-06-30T23:59:59.999Z",
        }
      : overrides.latestSampledPeriod;
  const entries = [
    ["system_minutes", overrides.systemMinutesNumerator ?? 8],
    ["screenshot_minutes", 7],
    ["settlement_minutes", 10],
    ["evidence_level", 10],
    ["time_source", 10],
    ["views", 6],
    ["live_started_at", 10],
    ["approved_at", 10],
    ["project_id", 10],
    ["streamer_id", 10],
    ["streamer_source", 10],
    ["collaboration_id", 4],
    ["base_hourly_rate", 10],
    ["base_salary", 10],
    ["cps_rate", 10],
    ["gift_amount", 3],
  ] as const;
  const orderedEntries = overrides.reverseCoverageInsertion
    ? [...entries].reverse()
    : entries;

  return {
    hasHistory: true,
    businessTimezone: overrides.businessTimezone ?? "Asia/Shanghai",
    businessTimezoneConfirmed:
      overrides.businessTimezoneConfirmed ?? true,
    variables: Object.fromEntries(
      orderedEntries.map(([id, numerator]) => [
        id,
        {
          numerator,
          denominator: 10,
          latestSampledPeriod,
        },
      ]),
    ),
  };
}

function hashInput(): CustomRuleCatalogHashInput {
  return {
    scope: "payable",
    executionGrain: "report",
    businessTimezone: "Asia/Shanghai",
    businessTimezoneConfirmed: true,
    variables: [
      {
        id: "system_minutes",
        runtimeType: integerType,
        unit: "分钟",
        sourceKey: "live_reports.system_duration",
        availability: "available",
        coverageNumerator: 8,
        coverageDenominator: 10,
        latestSampledPeriod: {
          start: "2026-06-01T00:00:00.000Z",
          end: "2026-06-30T23:59:59.999Z",
        },
      },
      {
        id: "streamer_level",
        runtimeType: { kind: "scalar", scalarType: "string" },
        unit: "文本",
        sourceKey: "unavailable:streamer_level",
        availability: "unavailable",
        coverageNumerator: 0,
        coverageDenominator: 10,
        latestSampledPeriod: null,
      },
    ],
  };
}
