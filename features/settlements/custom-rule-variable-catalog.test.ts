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

  it("fails closed when timezone provenance is missing, unresolved, or inconsistent", () => {
    const missingSourceCoverage = coverageFixture();
    delete (missingSourceCoverage as Partial<ProjectVariableCoverage>)
      .businessTimezoneSource;
    const missingSource = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: missingSourceCoverage,
    });
    const unresolved = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({ businessTimezoneSource: "unresolved" }),
    });
    const inconsistentDefault = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({
        businessTimezone: "Asia/Tokyo",
        businessTimezoneSource: "contract_default",
      }),
    });

    expect(missingSource.businessTimezoneSource).toBe("unresolved");
    expect(variable(missingSource, "weekday").availability).toBe(
      "unavailable",
    );
    expect(variable(unresolved, "hour_of_day").availability).toBe(
      "unavailable",
    );
    expect(variable(inconsistentDefault, "weekday").availability).toBe(
      "unavailable",
    );
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

  it("advertises only normalized external-cost sources and never raw import JSON keys", () => {
    const coverage = coverageFixture();
    coverage.variables.supplier_fee = {
      numerator: 2,
      denominator: 3,
      latestSampledPeriod: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-30T23:59:59.999Z",
      },
    };
    coverage.variables.traffic_cost = {
      numerator: 1,
      denominator: 3,
      latestSampledPeriod: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-30T23:59:59.999Z",
      },
    };

    const catalog = buildCustomRuleVariableCatalog({
      scope: "external_cost",
      executionGrain: "report",
      coverage,
    });
    const ids = catalog.variables.map((item) => item.id);

    expect(ids).toEqual([
      "gift_amount",
      "import_row_index",
      "import_type",
      "order_count",
      "project_id",
      "report_id",
      "sales_amount",
      "streamer_id",
      "supplier_fee",
      "supplier_id",
      "traffic_cost",
    ]);
    expect(variable(catalog, "supplier_fee")).toMatchObject({
      availability: "partial",
      sourceLabel: "已确认的规范化供应商导入项",
      coverageNumerator: 2,
      coverageDenominator: 3,
    });
    expect(variable(catalog, "import_type")).toMatchObject({
      availability: "unavailable",
      runtimeType: { kind: "scalar", scalarType: "string" },
    });
    for (const id of ["import_row_index", "sales_amount", "order_count"]) {
      expect(variable(catalog, id)).toMatchObject({
        availability: "unavailable",
      });
    }
    expect(JSON.stringify(catalog)).not.toContain("rawImport");
    expect(JSON.stringify(catalog)).not.toContain("parsedPayload");
    expect(JSON.stringify(catalog)).not.toContain("json");
  });

  it("advertises finalized core reconciliation amounts and evidence counts at aggregate grains", () => {
    const catalog = buildCustomRuleVariableCatalog({
      scope: "reconciliation",
      executionGrain: "project_period",
      coverage: coverageFixture(),
    });

    expect(catalog.variables.map((item) => item.id)).toEqual([
      "external_cost_amount",
      "gross_margin",
      "margin_rate",
      "payable_amount",
      "receivable_amount",
      "red_evidence_count",
      "tax_amount",
      "yellow_evidence_count",
    ]);
    expect(variable(catalog, "receivable_amount")).toMatchObject({
      availability: "available",
      sourceLabel: "已定稿对账核心结果：应收金额",
    });
    expect(variable(catalog, "red_evidence_count")).toMatchObject({
      availability: "available",
    });

    expect(
      buildCustomRuleVariableCatalog({
        scope: "reconciliation",
        executionGrain: "report",
        coverage: coverageFixture(),
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
    const changedTimezoneSource = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture({
        businessTimezoneSource: "confirmed_contract",
      }),
    });

    expect(reordered.version).toBe(base.version);
    expect(changedCoverage.version).not.toBe(base.version);
    expect(changedPeriod.version).not.toBe(base.version);
    expect(changedTimezone.version).not.toBe(base.version);
    expect(changedTimezoneSource.version).not.toBe(base.version);
  });

  it("isolates and deep-freezes nested runtime types for every catalog DTO", () => {
    const first = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture(),
    });
    const second = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture(),
    });
    const firstType = variable(first, "project_tags").runtimeType;
    const secondType = variable(second, "project_tags").runtimeType;

    expect(firstType).not.toBe(secondType);
    expect(firstType.kind).toBe("array");
    expect(secondType.kind).toBe("array");
    if (firstType.kind !== "array" || secondType.kind !== "array") {
      throw new Error("project_tags must remain an array runtime type");
    }
    expect(firstType.itemType).not.toBe(secondType.itemType);
    expect(Object.isFrozen(firstType)).toBe(true);
    expect(Object.isFrozen(firstType.itemType)).toBe(true);
    expect(() =>
      Object.assign(firstType.itemType, {
        kind: "scalar",
        scalarType: "number",
      }),
    ).toThrow(TypeError);

    const third = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture(),
    });
    expect(variable(third, "project_tags").runtimeType).toEqual({
      kind: "array",
      itemType: { kind: "scalar", scalarType: "string" },
    });
    expect(third.version).toBe(first.version);
  });

  it("deep-freezes the complete catalog DTO so versioned content cannot drift", () => {
    const catalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: coverageFixture(),
    });
    const item = variable(catalog, "system_minutes");
    const serialized = JSON.stringify(catalog);
    const version = catalog.version;

    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.variables)).toBe(true);
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item.latestSampledPeriod)).toBe(true);
    expect(() => Object.assign(catalog, { scope: "receivable" })).toThrow(
      TypeError,
    );
    expect(() => catalog.variables.push(item)).toThrow(TypeError);
    expect(() =>
      Object.assign(item, {
        availability: "unavailable",
        coverageNumerator: 0,
      }),
    ).toThrow(TypeError);
    expect(() =>
      Object.assign(item.latestSampledPeriod ?? {}, {
        start: "2099-01-01T00:00:00.000Z",
      }),
    ).toThrow(TypeError);
    expect(catalog.version).toBe(version);
    expect(JSON.stringify(catalog)).toBe(serialized);
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
    businessTimezoneSource?: ProjectVariableCoverage["businessTimezoneSource"];
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
    businessTimezoneSource:
      overrides.businessTimezoneSource ?? "contract_default",
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
    businessTimezoneSource: "contract_default",
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
