import { createHash } from "node:crypto";

import type {
  CustomRuleExecutionGrain,
  CustomRuleScope,
  RuntimeScalarType,
  RuntimeValueType,
} from "./custom-rule-types";

export type CustomRuleVariableAvailability =
  | "available"
  | "partial"
  | "unavailable"
  | "not_applicable";

export type CustomRuleLatestSampledPeriod = {
  start: string;
  end: string;
};

export type CustomRuleVariableCoverage = {
  numerator: number;
  denominator: number;
  latestSampledPeriod: CustomRuleLatestSampledPeriod | null;
};

export type CustomRuleBusinessTimezoneSource =
  | "contract_default"
  | "organization_setting"
  | "confirmed_contract"
  | "unresolved";

export type ProjectVariableCoverage = {
  hasHistory: boolean;
  businessTimezone: string | null;
  businessTimezoneConfirmed: boolean;
  businessTimezoneSource: CustomRuleBusinessTimezoneSource;
  variables: Record<string, CustomRuleVariableCoverage>;
};

export type CustomRuleVariableCatalogItem = {
  id: string;
  label: string;
  runtimeType: RuntimeValueType;
  unit: string;
  sourceLabel: string;
  availability: Exclude<
    CustomRuleVariableAvailability,
    "not_applicable"
  >;
  coverageNumerator: number;
  coverageDenominator: number;
  latestSampledPeriod: CustomRuleLatestSampledPeriod | null;
};

export type CustomRuleVariableCatalog = {
  scope: CustomRuleScope;
  executionGrain: CustomRuleExecutionGrain;
  businessTimezone: string | null;
  businessTimezoneConfirmed: boolean;
  businessTimezoneSource: CustomRuleBusinessTimezoneSource;
  hasHistory: boolean;
  version: string;
  variables: CustomRuleVariableCatalogItem[];
};

export type CustomRuleCatalogHashInput = {
  scope: CustomRuleScope;
  executionGrain: CustomRuleExecutionGrain;
  businessTimezone: string | null;
  businessTimezoneConfirmed: boolean;
  businessTimezoneSource: CustomRuleBusinessTimezoneSource;
  hasHistory?: boolean;
  variables: ReadonlyArray<{
    id: string;
    runtimeType: RuntimeValueType;
    unit: string;
    sourceKey: string;
    availability: Exclude<
      CustomRuleVariableAvailability,
      "not_applicable"
    >;
    coverageNumerator: number;
    coverageDenominator: number;
    latestSampledPeriod: CustomRuleLatestSampledPeriod | null;
  }>;
};

export class CustomRuleCoverageValidationError extends TypeError {
  readonly code = "CUSTOM_RULE_INVALID_COVERAGE";

  constructor(readonly variableId: string, message: string) {
    super(`${variableId}: ${message}`);
    this.name = "CustomRuleCoverageValidationError";
  }
}

type SourceAvailability = "available" | "partial" | "unavailable";

type VariableDefinition = {
  id: string;
  label: string;
  runtimeType: RuntimeValueType;
  unit: string;
  sourceLabel: string;
  sourceKey: string;
  sourceAvailability: SourceAvailability;
  scopes: readonly CustomRuleScope[];
  grains: readonly CustomRuleExecutionGrain[];
  coverageFrom?: string;
  requiresBusinessTimezone?: boolean;
};

const REPORT_GRAIN = ["report"] as const;
const ALL_GRAINS = [
  "report",
  "project_streamer_period",
  "batch",
  "project_period",
] as const;
const STREAMER_GRAINS = ["report", "project_streamer_period"] as const;
const PERIOD_GRAINS = [
  "project_streamer_period",
  "batch",
  "project_period",
] as const;
const PAYABLE_AND_RECEIVABLE = ["payable", "receivable"] as const;
const PAYABLE_ONLY = ["payable"] as const;
const RECEIVABLE_ONLY = ["receivable"] as const;
const EXTERNAL_COST_ONLY = ["external_cost"] as const;
const RECONCILIATION_ONLY = ["reconciliation"] as const;
const ALL_SCOPES = [
  "payable",
  "receivable",
  "external_cost",
  "reconciliation",
] as const;
const DISABLED_PHASE_ONE_SCOPES = new Set<CustomRuleScope>([
  "external_cost",
  "reconciliation",
]);

const scalar = (scalarType: RuntimeScalarType): RuntimeValueType => ({
  kind: "scalar",
  scalarType,
});

const MONEY_TYPE = scalar("money_cents");
const RATE_TYPE = scalar("rate_bps");
const INTEGER_TYPE = scalar("integer");
const STRING_TYPE = scalar("string");
const TIMESTAMP_TYPE = scalar("timestamp");
const STRING_ARRAY_TYPE: RuntimeValueType = {
  kind: "array",
  itemType: STRING_TYPE,
};

const VARIABLE_DEFINITIONS: readonly VariableDefinition[] =
  deepFreezeVariableDefinitions([
  source({
    id: "system_minutes",
    label: "系统计时分钟",
    runtimeType: INTEGER_TYPE,
    unit: "分钟",
    sourceLabel: "直播报告系统计时",
    sourceKey: "live_reports.system_duration",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
  }),
  source({
    id: "screenshot_minutes",
    label: "截图计时分钟",
    runtimeType: INTEGER_TYPE,
    unit: "分钟",
    sourceLabel: "直播报告截图计时",
    sourceKey: "live_reports.screenshot_duration",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
  }),
  source({
    id: "settlement_minutes",
    label: "结算分钟",
    runtimeType: INTEGER_TYPE,
    unit: "分钟",
    sourceLabel: "已审核直播报告结算时长",
    sourceKey: "live_reports.settlement_duration@status=approved",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
  }),
  source({
    id: "evidence_level",
    label: "证据等级",
    runtimeType: STRING_TYPE,
    unit: "等级",
    sourceLabel: "已审核直播报告证据等级",
    sourceKey: "live_reports.evidence_level@status=approved",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
  }),
  source({
    id: "time_source",
    label: "计时来源",
    runtimeType: STRING_TYPE,
    unit: "文本",
    sourceLabel: "已审核直播报告计时来源",
    sourceKey: "live_reports.time_source@status=approved",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
  }),
  source({
    id: "views",
    label: "观看人数",
    runtimeType: INTEGER_TYPE,
    unit: "人次",
    sourceLabel: "直播报告观看人数",
    sourceKey: "live_reports.viewers",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
  }),
  source({
    id: "live_started_at",
    label: "开播时间",
    runtimeType: TIMESTAMP_TYPE,
    unit: "时间",
    sourceLabel: "直播任务系统开播时间",
    sourceKey: "live_reports.live_task_id->live_tasks.system_started_at",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
  }),
  source({
    id: "weekday",
    label: "开播星期",
    runtimeType: INTEGER_TYPE,
    unit: "星期",
    sourceLabel: "按业务时区从系统开播时间派生",
    sourceKey:
      "derived:live_tasks.system_started_at@confirmed_business_timezone:weekday",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
    coverageFrom: "live_started_at",
    requiresBusinessTimezone: true,
  }),
  source({
    id: "hour_of_day",
    label: "开播小时",
    runtimeType: INTEGER_TYPE,
    unit: "小时",
    sourceLabel: "按业务时区从系统开播时间派生",
    sourceKey:
      "derived:live_tasks.system_started_at@confirmed_business_timezone:hour",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
    coverageFrom: "live_started_at",
    requiresBusinessTimezone: true,
  }),
  source({
    id: "approved_at",
    label: "审核通过时间",
    runtimeType: TIMESTAMP_TYPE,
    unit: "时间",
    sourceLabel: "已通过直播报告的审核时间",
    sourceKey: "live_reports.reviewed_at@status=approved",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
  }),
  source({
    id: "project_id",
    label: "项目标识",
    runtimeType: STRING_TYPE,
    unit: "标识符",
    sourceLabel: "当前授权项目",
    sourceKey: "request.project_id@authorized_scope",
    scopes: ALL_SCOPES,
    grains: ALL_GRAINS,
  }),
  unavailable({
    id: "project_tags",
    label: "项目标签",
    runtimeType: STRING_ARRAY_TYPE,
    unit: "标签",
    sourceLabel: "暂无规范化项目标签字段",
    scopes: ALL_SCOPES,
    grains: ALL_GRAINS,
    coverageFrom: "project_id",
  }),
  source({
    id: "streamer_id",
    label: "主播标识",
    runtimeType: STRING_TYPE,
    unit: "标识符",
    sourceLabel: "项目主播关系",
    sourceKey: "project_streamers.streamer_id",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: STREAMER_GRAINS,
  }),
  unavailable({
    id: "streamer_level",
    label: "主播等级",
    runtimeType: STRING_TYPE,
    unit: "等级",
    sourceLabel: "暂无规范化主播等级字段",
    scopes: PAYABLE_ONLY,
    grains: STREAMER_GRAINS,
    coverageFrom: "streamer_id",
  }),
  source({
    id: "streamer_source",
    label: "主播来源",
    runtimeType: STRING_TYPE,
    unit: "文本",
    sourceLabel: "项目主播关联的主播来源",
    sourceKey: "project_streamers.streamer_id->streamers.source_type",
    scopes: PAYABLE_ONLY,
    grains: STREAMER_GRAINS,
  }),
  source({
    id: "collaboration_id",
    label: "协作标识",
    runtimeType: STRING_TYPE,
    unit: "标识符",
    sourceLabel: "项目主播冻结协作归属",
    sourceKey: "project_streamers.collaboration_id",
    scopes: PAYABLE_ONLY,
    grains: STREAMER_GRAINS,
  }),
  source({
    id: "base_hourly_rate",
    label: "基础时薪",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "项目主播加入时冻结时薪",
    sourceKey: "project_streamers.hourly_rate",
    scopes: PAYABLE_ONLY,
    grains: STREAMER_GRAINS,
  }),
  source({
    id: "base_salary",
    label: "基础底薪",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "项目主播加入时冻结底薪",
    sourceKey: "project_streamers.base_salary",
    scopes: PAYABLE_ONLY,
    grains: STREAMER_GRAINS,
  }),
  source({
    id: "cps_rate",
    label: "CPS 比例",
    runtimeType: RATE_TYPE,
    unit: "%",
    sourceLabel: "项目主播加入时冻结 CPS 比例",
    sourceKey: "project_streamers.cps_rate_bps",
    scopes: PAYABLE_ONLY,
    grains: STREAMER_GRAINS,
  }),
  unavailable({
    id: "streamer_group_ids",
    label: "主播分组",
    runtimeType: STRING_ARRAY_TYPE,
    unit: "标识符列表",
    sourceLabel: "Phase 2 前暂无规范化主播分组关系",
    scopes: PAYABLE_ONLY,
    grains: STREAMER_GRAINS,
    coverageFrom: "streamer_id",
  }),
  unavailable({
    id: "sales_amount",
    label: "销售金额",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "暂无规范化销售额字段",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
    coverageFrom: "project_id",
  }),
  unavailable({
    id: "orders_count",
    label: "订单数",
    runtimeType: INTEGER_TYPE,
    unit: "单",
    sourceLabel: "暂无规范化订单数字段",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
    coverageFrom: "project_id",
  }),
  partial({
    id: "gift_amount",
    label: "礼物金额",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "已确认的规范化礼物导入项",
    sourceKey:
      "project_cost_items.amount_cents@source=import,status=confirmed,item_type=gift",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
  }),
  partial({
    id: "supplier_fee",
    label: "供应商费用",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "已确认的规范化供应商导入项",
    sourceKey:
      "project_cost_items.amount_cents@source=import,status=confirmed,item_type=supplier_fee",
    scopes: EXTERNAL_COST_ONLY,
    grains: REPORT_GRAIN,
  }),
  partial({
    id: "traffic_cost",
    label: "投流费用",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "已确认的规范化投流导入项",
    sourceKey:
      "project_cost_items.amount_cents@source=import,status=confirmed,item_type=traffic",
    scopes: EXTERNAL_COST_ONLY,
    grains: REPORT_GRAIN,
  }),
  unavailable({
    id: "manual_adjustment",
    label: "人工调整",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "暂无报告粒度的规范化人工调整字段",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: REPORT_GRAIN,
    coverageFrom: "project_id",
  }),
  source({
    id: "period_system_minutes",
    label: "周期系统计时分钟",
    runtimeType: INTEGER_TYPE,
    unit: "分钟",
    sourceLabel: "周期内系统计时汇总",
    sourceKey: "derived:sum(live_reports.system_duration)",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: PERIOD_GRAINS,
    coverageFrom: "system_minutes",
  }),
  source({
    id: "period_settlement_minutes",
    label: "周期结算分钟",
    runtimeType: INTEGER_TYPE,
    unit: "分钟",
    sourceLabel: "周期内结算时长汇总",
    sourceKey:
      "derived:sum(live_reports.settlement_duration@status=approved)",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: PERIOD_GRAINS,
    coverageFrom: "settlement_minutes",
  }),
  unavailable({
    id: "period_sales_amount",
    label: "周期销售金额",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "暂无规范化周期销售额字段",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: PERIOD_GRAINS,
    coverageFrom: "sales_amount",
  }),
  unavailable({
    id: "period_orders_count",
    label: "周期订单数",
    runtimeType: INTEGER_TYPE,
    unit: "单",
    sourceLabel: "暂无规范化周期订单数字段",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: PERIOD_GRAINS,
    coverageFrom: "orders_count",
  }),
  source({
    id: "period_report_count",
    label: "周期报告数",
    runtimeType: INTEGER_TYPE,
    unit: "份",
    sourceLabel: "周期内已通过直播报告计数",
    sourceKey: "derived:count(live_reports.id@status=approved)",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: PERIOD_GRAINS,
    coverageFrom: "project_id",
  }),
  source({
    id: "red_evidence_count",
    label: "红色证据报告数",
    runtimeType: INTEGER_TYPE,
    unit: "份",
    sourceLabel: "周期内红色证据报告计数",
    sourceKey:
      "derived:count(live_reports.id@status=approved,evidence_level=red)",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: PERIOD_GRAINS,
    coverageFrom: "evidence_level",
  }),
  source({
    id: "yellow_evidence_count",
    label: "黄色证据报告数",
    runtimeType: INTEGER_TYPE,
    unit: "份",
    sourceLabel: "周期内黄色证据报告计数",
    sourceKey:
      "derived:count(live_reports.id@status=approved,evidence_level=yellow)",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: PERIOD_GRAINS,
    coverageFrom: "evidence_level",
  }),
  source({
    id: "period_payable_amount",
    label: "周期应付金额",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "应付结算批次项汇总",
    sourceKey:
      "derived:sum(settlement_batch_items.computed_amount@settlement_batches.batch_type=payable)",
    scopes: PAYABLE_ONLY,
    grains: PERIOD_GRAINS,
  }),
  source({
    id: "period_receivable_amount",
    label: "周期应收金额",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "应收结算批次项汇总",
    sourceKey:
      "derived:sum(settlement_batch_items.computed_amount@settlement_batches.batch_type=receivable)",
    scopes: RECEIVABLE_ONLY,
    grains: PERIOD_GRAINS,
  }),
  source({
    id: "period_start",
    label: "周期开始时间",
    runtimeType: TIMESTAMP_TYPE,
    unit: "时间",
    sourceLabel: "授权样本周期开始时间",
    sourceKey: "derived:authorized_sample_period.start",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: PERIOD_GRAINS,
    coverageFrom: "project_id",
  }),
  source({
    id: "period_end",
    label: "周期结束时间",
    runtimeType: TIMESTAMP_TYPE,
    unit: "时间",
    sourceLabel: "授权样本周期结束时间",
    sourceKey: "derived:authorized_sample_period.end",
    scopes: PAYABLE_AND_RECEIVABLE,
    grains: PERIOD_GRAINS,
    coverageFrom: "project_id",
  }),
  unavailable({
    id: "receivable_amount",
    label: "应收金额",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "Phase 1 不开放对账输入",
    scopes: RECONCILIATION_ONLY,
    grains: PERIOD_GRAINS,
  }),
  unavailable({
    id: "payable_amount",
    label: "应付金额",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "Phase 1 不开放对账输入",
    scopes: RECONCILIATION_ONLY,
    grains: PERIOD_GRAINS,
  }),
  unavailable({
    id: "external_cost_amount",
    label: "外部成本",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "Phase 1 不开放对账输入",
    scopes: RECONCILIATION_ONLY,
    grains: PERIOD_GRAINS,
  }),
  unavailable({
    id: "tax_amount",
    label: "税额",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "Phase 1 不开放税务输入",
    scopes: RECONCILIATION_ONLY,
    grains: PERIOD_GRAINS,
  }),
  unavailable({
    id: "gross_margin",
    label: "毛利",
    runtimeType: MONEY_TYPE,
    unit: "元",
    sourceLabel: "Phase 1 不开放内部毛利输入",
    scopes: RECONCILIATION_ONLY,
    grains: PERIOD_GRAINS,
  }),
  unavailable({
    id: "margin_rate",
    label: "毛利率",
    runtimeType: RATE_TYPE,
    unit: "%",
    sourceLabel: "Phase 1 不开放内部毛利输入",
    scopes: RECONCILIATION_ONLY,
    grains: PERIOD_GRAINS,
  }),
  ]);

export function buildCustomRuleVariableCatalog(input: {
  scope: CustomRuleScope;
  executionGrain: CustomRuleExecutionGrain;
  coverage: ProjectVariableCoverage;
}): CustomRuleVariableCatalog {
  validateProjectCoverage(input.coverage);

  const definitions = DISABLED_PHASE_ONE_SCOPES.has(input.scope)
    ? []
    : VARIABLE_DEFINITIONS.filter(
        (definition) =>
          definition.scopes.includes(input.scope) &&
          definition.grains.includes(input.executionGrain),
      );
  const businessTimezoneSource = normalizeCustomRuleBusinessTimezoneSource(
    input.coverage.businessTimezoneSource,
  );
  const timezoneReady = isConfirmedIanaTimezone({
    businessTimezone: input.coverage.businessTimezone,
    businessTimezoneConfirmed:
      input.coverage.businessTimezoneConfirmed,
    businessTimezoneSource,
  });
  const hashVariables: Array<
    CustomRuleCatalogHashInput["variables"][number]
  > = [];
  const variables = definitions
    .map((definition): CustomRuleVariableCatalogItem => {
      const coverage = resolveCoverage(definition, input.coverage);
      const runtimeType = cloneAndFreezeRuntimeType(definition.runtimeType);
      const availability =
        definition.requiresBusinessTimezone && !timezoneReady
          ? "unavailable"
          : definition.sourceAvailability;
      const effectiveCoverage =
        availability === "unavailable" &&
        definition.sourceAvailability === "unavailable"
          ? {
              numerator: 0,
              denominator: coverage.denominator,
              latestSampledPeriod: null,
            }
          : coverage;
      const item: CustomRuleVariableCatalogItem = {
        id: definition.id,
        label: definition.label,
        runtimeType,
        unit: definition.unit,
        sourceLabel: definition.sourceLabel,
        availability,
        coverageNumerator: effectiveCoverage.numerator,
        coverageDenominator: effectiveCoverage.denominator,
        latestSampledPeriod: effectiveCoverage.latestSampledPeriod,
      };

      hashVariables.push({
        id: item.id,
        runtimeType: item.runtimeType,
        unit: item.unit,
        sourceKey: definition.sourceKey,
        availability: item.availability,
        coverageNumerator: item.coverageNumerator,
        coverageDenominator: item.coverageDenominator,
        latestSampledPeriod: item.latestSampledPeriod,
      });
      return item;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const version = hashCustomRuleCatalogState({
    scope: input.scope,
    executionGrain: input.executionGrain,
    businessTimezone: input.coverage.businessTimezone,
    businessTimezoneConfirmed: timezoneReady,
    businessTimezoneSource,
    hasHistory: input.coverage.hasHistory,
    variables: hashVariables,
  });

  return {
    scope: input.scope,
    executionGrain: input.executionGrain,
    businessTimezone: input.coverage.businessTimezone,
    businessTimezoneConfirmed: timezoneReady,
    businessTimezoneSource,
    hasHistory: input.coverage.hasHistory,
    version,
    variables,
  };
}

export function hashCustomRuleCatalogState(
  input: CustomRuleCatalogHashInput,
): string {
  const businessTimezoneSource = normalizeCustomRuleBusinessTimezoneSource(
    input.businessTimezoneSource,
  );
  const businessTimezoneConfirmed = isConfirmedIanaTimezone({
    businessTimezone: input.businessTimezone,
    businessTimezoneConfirmed: input.businessTimezoneConfirmed,
    businessTimezoneSource,
  });
  const variables = input.variables
    .map((variable) => {
      assertCoverageCounts(
        variable.id,
        variable.coverageNumerator,
        variable.coverageDenominator,
      );
      return {
        id: variable.id,
        runtimeType: variable.runtimeType,
        unit: variable.unit,
        sourceKey: variable.sourceKey,
        availability: variable.availability,
        coverageNumerator: variable.coverageNumerator,
        coverageDenominator: variable.coverageDenominator,
        latestSampledPeriod: variable.latestSampledPeriod,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const canonical = canonicalJson({
    scope: input.scope,
    executionGrain: input.executionGrain,
    businessTimezone: input.businessTimezone,
    businessTimezoneConfirmed,
    businessTimezoneSource,
    hasHistory:
      input.hasHistory ??
      variables.some((item) => item.coverageDenominator > 0),
    variables,
  });

  return createHash("sha256").update(canonical).digest("hex");
}

export function assertCoverageCounts(
  variableId: string,
  numerator: number,
  denominator: number,
): void {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new CustomRuleCoverageValidationError(
      variableId,
      "coverage numerator must be a nonnegative safe integer",
    );
  }
  if (!Number.isSafeInteger(denominator) || denominator < 0) {
    throw new CustomRuleCoverageValidationError(
      variableId,
      "coverage denominator must be a nonnegative safe integer",
    );
  }
  if (numerator > denominator) {
    throw new CustomRuleCoverageValidationError(
      variableId,
      "coverage numerator cannot exceed denominator",
    );
  }
}

export function isConfirmedIanaTimezone(
  coverage: Pick<
    ProjectVariableCoverage,
    | "businessTimezone"
    | "businessTimezoneConfirmed"
    | "businessTimezoneSource"
  >,
): boolean {
  const source = normalizeCustomRuleBusinessTimezoneSource(
    coverage.businessTimezoneSource,
  );
  if (
    !coverage.businessTimezoneConfirmed ||
    !coverage.businessTimezone ||
    source === "unresolved" ||
    (source === "contract_default" &&
      coverage.businessTimezone !== "Asia/Shanghai")
  ) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: coverage.businessTimezone,
    }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeCustomRuleBusinessTimezoneSource(
  value: unknown,
): CustomRuleBusinessTimezoneSource {
  return value === "contract_default" ||
    value === "organization_setting" ||
    value === "confirmed_contract" ||
    value === "unresolved"
    ? value
    : "unresolved";
}

function deepFreezeVariableDefinitions(
  definitions: VariableDefinition[],
): readonly VariableDefinition[] {
  const pending: object[] = [definitions];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") {
        pending.push(value);
      }
    }
    Object.freeze(current);
  }
  return definitions;
}

function cloneAndFreezeRuntimeType(
  runtimeType: RuntimeValueType,
): RuntimeValueType {
  if (runtimeType.kind === "scalar") {
    return Object.freeze({
      kind: "scalar",
      scalarType: runtimeType.scalarType,
    });
  }
  if (runtimeType.kind === "array") {
    return Object.freeze({
      kind: "array",
      itemType: cloneAndFreezeRuntimeType(runtimeType.itemType),
    });
  }

  const fields = Object.fromEntries(
    Object.keys(runtimeType.fields)
      .sort()
      .map((key) => [
        key,
        cloneAndFreezeRuntimeType(runtimeType.fields[key]),
      ]),
  ) as Record<string, RuntimeValueType>;
  return Object.freeze({
    kind: "object",
    fields: Object.freeze(fields),
  });
}

function source(
  input: Omit<VariableDefinition, "sourceAvailability">,
): VariableDefinition {
  return { ...input, sourceAvailability: "available" };
}

function partial(
  input: Omit<VariableDefinition, "sourceAvailability">,
): VariableDefinition {
  return { ...input, sourceAvailability: "partial" };
}

function unavailable(
  input: Omit<
    VariableDefinition,
    "sourceAvailability" | "sourceKey"
  >,
): VariableDefinition {
  return {
    ...input,
    sourceKey: `unavailable:${input.id}`,
    sourceAvailability: "unavailable",
  };
}

function validateProjectCoverage(coverage: ProjectVariableCoverage): void {
  for (const [variableId, counts] of Object.entries(coverage.variables)) {
    assertCoverageCounts(variableId, counts.numerator, counts.denominator);
  }
}

function resolveCoverage(
  definition: VariableDefinition,
  coverage: ProjectVariableCoverage,
): CustomRuleVariableCoverage {
  const direct = coverage.variables[definition.id];
  if (direct) {
    return copyCoverage(direct);
  }
  if (definition.coverageFrom) {
    const inherited = coverage.variables[definition.coverageFrom];
    if (inherited) {
      return copyCoverage(inherited);
    }
  }

  return {
    numerator: 0,
    denominator: inferCoverageDenominator(coverage),
    latestSampledPeriod: null,
  };
}

function copyCoverage(
  coverage: CustomRuleVariableCoverage,
): CustomRuleVariableCoverage {
  return {
    numerator: coverage.numerator,
    denominator: coverage.denominator,
    latestSampledPeriod: coverage.latestSampledPeriod
      ? {
          start: coverage.latestSampledPeriod.start,
          end: coverage.latestSampledPeriod.end,
        }
      : null,
  };
}

function inferCoverageDenominator(coverage: ProjectVariableCoverage): number {
  return Object.values(coverage.variables).reduce(
    (maximum, item) => Math.max(maximum, item.denominator),
    0,
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
