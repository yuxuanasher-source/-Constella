import {
  businessRuleContractSchema,
  type BusinessRuleContract,
} from "./custom-rule-contract";

export type CustomRuleSystemTemplateKind =
  | "cpt"
  | "cps"
  | "base_plus_performance"
  | "evidence_discount"
  | "floor_cap"
  | "group_bonus";

export type CustomRuleSystemTemplate = {
  id: string;
  kind: CustomRuleSystemTemplateKind;
  name: string;
  description: string;
  contract: BusinessRuleContract;
};

const MONEY_TYPE = Object.freeze({
  kind: "scalar" as const,
  scalarType: "money_cents" as const,
});
const RATE_TYPE = Object.freeze({
  kind: "scalar" as const,
  scalarType: "rate_bps" as const,
});
const INTEGER_TYPE = Object.freeze({
  kind: "scalar" as const,
  scalarType: "integer" as const,
});
const STRING_TYPE = Object.freeze({
  kind: "scalar" as const,
  scalarType: "string" as const,
});
const EFFECTIVE_START = "2026-01-01T00:00:00+08:00";

const RAW_TEMPLATE_DEFINITIONS: CustomRuleSystemTemplate[] = [
  {
    id: "system:cpt:v1",
    kind: "cpt",
    name: "按直播时长计费",
    description: "按每场系统直播分钟数和小时单价计算主播应付金额。",
    contract: contract({
      executionGrain: "report",
      compositionMode: "replace",
      title: "按直播时长计算主播应付",
      summary: "每场直播按系统记录时长和小时单价计算主播应付金额。",
      calculationComponents: [
        component("base", "按直播分钟数计算基础金额", "直播分钟数乘以小时单价"),
        component("final", "输出最终应付金额", "基础金额作为最终金额"),
      ],
      requiredInputs: [
        requiredInput(
          "system_minutes",
          "系统直播时长",
          "直播报告系统计时",
          INTEGER_TYPE,
          "分钟",
        ),
      ],
      parameters: [
        moneyParameter("hourly_rate", "每小时结算单价", "元/小时", 10_000),
      ],
      compositionDescription: "替换项目现有的按场基础应付规则。",
      examples: [
        example(
          "标准一小时",
          "normal",
          "直播六十分钟时按一小时单价结算。",
          { system_minutes: integerValue(60) },
          moneyValue(10_000),
        ),
        example(
          "零时长",
          "boundary",
          "直播时长为零时结算金额为零。",
          { system_minutes: integerValue(0) },
          moneyValue(0),
        ),
        example(
          "最小分钟",
          "boundary",
          "直播一分钟时按最小时间粒度计算。",
          { system_minutes: integerValue(1) },
          moneyValue(167),
        ),
      ],
    }),
  },
  {
    id: "system:cps:v1",
    kind: "cps",
    name: "按销售额分成",
    description: "按已归一化销售金额和确认的分成比例计算主播应付金额。",
    contract: contract({
      executionGrain: "report",
      compositionMode: "replace",
      title: "按销售额计算主播分成",
      summary: "每场直播按归一化销售金额和分成比例计算主播应付金额。",
      calculationComponents: [
        component("base", "读取直播销售金额", "使用归一化销售金额"),
        component("final", "计算销售分成", "销售金额乘以分成比例"),
      ],
      requiredInputs: [
        requiredInput(
          "sales_amount",
          "归一化销售金额",
          "已归一化销售导入",
          MONEY_TYPE,
          "元",
        ),
      ],
      parameters: [
        rateParameter("cps_rate", "销售分成比例", "%", 2_000),
      ],
      compositionDescription: "替换项目现有的按场销售分成基础规则。",
      examples: [
        example(
          "标准销售额",
          "normal",
          "销售一百元时按百分之二十分成。",
          { sales_amount: moneyValue(10_000) },
          moneyValue(2_000),
        ),
        example(
          "零销售额",
          "boundary",
          "没有销售额时结算金额为零。",
          { sales_amount: moneyValue(0) },
          moneyValue(0),
        ),
        example(
          "最小销售金额",
          "boundary",
          "最小货币单位仍按确认比例计算。",
          { sales_amount: moneyValue(1) },
          moneyValue(0),
        ),
      ],
    }),
  },
  {
    id: "system:base-plus-performance:v1",
    kind: "base_plus_performance",
    name: "底薪加绩效",
    description: "按主播周期底薪和订单绩效奖励合并计算应付金额。",
    contract: contract({
      executionGrain: "project_streamer_period",
      compositionMode: "replace",
      title: "主播周期底薪加绩效奖励",
      summary: "每个主播周期按固定底薪加订单绩效奖励计算应付金额。",
      calculationComponents: [
        component("base", "计算周期固定底薪", "读取确认的周期底薪"),
        component("bonus", "计算订单绩效奖励", "周期订单数乘以单笔奖励"),
        component("final", "合并底薪和奖励", "固定底薪加绩效奖励"),
      ],
      requiredInputs: [
        requiredInput(
          "period_settlement_minutes",
          "周期结算时长",
          "项目主播周期汇总",
          INTEGER_TYPE,
          "分钟",
        ),
        requiredInput(
          "period_orders_count",
          "周期订单数",
          "已归一化订单汇总",
          INTEGER_TYPE,
          "单",
        ),
      ],
      parameters: [
        moneyParameter("base_salary", "周期固定底薪", "元/周期", 100_000),
        moneyParameter("order_bonus", "每单绩效奖励", "元/单", 1_000),
      ],
      compositionDescription: "替换项目主播周期的基础应付规则。",
      examples: [
        example(
          "标准周期绩效",
          "normal",
          "完成十单时在固定底薪上增加十单奖励。",
          {
            period_settlement_minutes: integerValue(6_000),
            period_orders_count: integerValue(10),
          },
          moneyValue(110_000),
        ),
        example(
          "零订单",
          "boundary",
          "没有订单时只结算周期固定底薪。",
          {
            period_settlement_minutes: integerValue(6_000),
            period_orders_count: integerValue(0),
          },
          moneyValue(100_000),
        ),
        example(
          "零时长零订单",
          "boundary",
          "周期时长和订单均为零时仍按已确认底薪规则处理。",
          {
            period_settlement_minutes: integerValue(0),
            period_orders_count: integerValue(0),
          },
          moneyValue(100_000),
        ),
      ],
    }),
  },
  {
    id: "system:evidence-discount:v1",
    kind: "evidence_discount",
    name: "凭证等级折扣",
    description: "先计算直播基础金额，再按绿色、黄色和红色凭证等级折扣。",
    contract: contract({
      executionGrain: "report",
      compositionMode: "replace",
      title: "按凭证等级折算主播应付",
      summary: "每场先按直播时长计算基础金额，再按凭证等级应用确认折扣。",
      calculationComponents: [
        component("base", "按直播时长计算基础金额", "直播分钟数乘以小时单价"),
        component("discounted", "应用凭证等级折扣", "按绿色黄色红色凭证比例折算"),
        component("final", "输出折后应付金额", "折后金额作为最终金额"),
      ],
      requiredInputs: [
        requiredInput(
          "system_minutes",
          "系统直播时长",
          "直播报告系统计时",
          INTEGER_TYPE,
          "分钟",
        ),
        requiredInput(
          "evidence_level",
          "直播凭证等级",
          "直播报告凭证判定",
          STRING_TYPE,
          "等级",
        ),
      ],
      parameters: [
        moneyParameter("hourly_rate", "每小时结算单价", "元/小时", 10_000),
        rateParameter("yellow_evidence_rate", "黄色凭证结算比例", "%", 8_000),
        rateParameter("red_evidence_rate", "红色凭证结算比例", "%", 0),
      ],
      compositionDescription: "替换项目现有基础应付并显式应用凭证等级折扣。",
      examples: [
        example(
          "绿色凭证",
          "normal",
          "绿色凭证按完整基础金额结算。",
          {
            system_minutes: integerValue(60),
            evidence_level: stringValue("green"),
          },
          moneyValue(10_000),
        ),
        example(
          "黄色凭证",
          "boundary",
          "黄色凭证按百分之八十结算。",
          {
            system_minutes: integerValue(60),
            evidence_level: stringValue("yellow"),
          },
          moneyValue(8_000),
        ),
        example(
          "红色凭证",
          "boundary",
          "红色凭证按确认的零比例结算。",
          {
            system_minutes: integerValue(60),
            evidence_level: stringValue("red"),
          },
          moneyValue(0),
        ),
      ],
    }),
  },
  {
    id: "system:floor-cap:v1",
    kind: "floor_cap",
    name: "保底和封顶",
    description: "将主播周期金额限制在确认的最低保底和最高封顶之间。",
    contract: contract({
      executionGrain: "project_streamer_period",
      compositionMode: "clamp",
      title: "主播周期应付保底和封顶",
      summary: "按周期结算时长计算金额，并应用确认的最低保底和最高封顶。",
      calculationComponents: [
        component("base", "按周期时长计算基础金额", "周期结算分钟数乘以小时单价"),
        component("final", "应用保底和封顶", "基础金额限制在最低和最高金额之间"),
      ],
      requiredInputs: [
        requiredInput(
          "period_settlement_minutes",
          "周期结算时长",
          "项目主播周期汇总",
          INTEGER_TYPE,
          "分钟",
        ),
      ],
      parameters: [
        moneyParameter("hourly_rate", "每小时结算单价", "元/小时", 10_000),
        moneyParameter("minimum_guarantee", "周期最低保底", "元/周期", 50_000),
        moneyParameter("maximum_cap", "周期最高封顶", "元/周期", 200_000),
      ],
      compositionDescription: "作为项目主播周期金额的保底和封顶约束。",
      examples: [
        example(
          "区间内金额",
          "normal",
          "基础金额位于保底和封顶之间时保持不变。",
          { period_settlement_minutes: integerValue(600) },
          moneyValue(100_000),
        ),
        example(
          "低于保底",
          "boundary",
          "基础金额低于保底时使用最低保底。",
          { period_settlement_minutes: integerValue(60) },
          moneyValue(50_000),
        ),
        example(
          "超过封顶",
          "boundary",
          "基础金额超过封顶时使用最高封顶。",
          { period_settlement_minutes: integerValue(1_800) },
          moneyValue(200_000),
        ),
      ],
    }),
  },
  {
    id: "system:group-bonus:v1",
    kind: "group_bonus",
    name: "主播组绩效奖励",
    description: "复制后选择目标主播组，按主播周期场次增加组级绩效奖励。",
    contract: contract({
      executionGrain: "project_streamer_period",
      compositionMode: "add",
      title: "主播组周期场次奖励",
      summary: "按主播周期有效场次数计算可叠加的主播组绩效奖励。",
      calculationComponents: [
        component("bonus", "计算主播组场次奖励", "周期有效场次数乘以单场组奖励"),
        component("final", "输出组级奖励金额", "场次奖励作为加法修饰金额"),
      ],
      requiredInputs: [
        requiredInput(
          "period_report_count",
          "周期有效场次数",
          "项目主播周期汇总",
          INTEGER_TYPE,
          "场",
        ),
      ],
      parameters: [
        moneyParameter("group_bonus", "主播组单场奖励", "元/场", 2_000),
      ],
      compositionDescription: "复制后选择目标主播组，并叠加到项目基础应付金额。",
      examples: [
        example(
          "标准十场奖励",
          "normal",
          "周期完成十场时增加十场组级奖励。",
          { period_report_count: integerValue(10) },
          moneyValue(20_000),
        ),
        example(
          "零场次",
          "boundary",
          "周期没有有效场次时组级奖励为零。",
          { period_report_count: integerValue(0) },
          moneyValue(0),
        ),
        example(
          "单场奖励",
          "boundary",
          "周期只有一场时增加一份组级奖励。",
          { period_report_count: integerValue(1) },
          moneyValue(2_000),
        ),
      ],
    }),
  },
];

export const CUSTOM_RULE_SYSTEM_TEMPLATE_DEFINITIONS: readonly Readonly<CustomRuleSystemTemplate>[] =
  deepFreezeOwned(
    RAW_TEMPLATE_DEFINITIONS.map((definition) => ({
      ...definition,
      contract: businessRuleContractSchema.parse(definition.contract),
    })),
  );

export function listCustomRuleSystemTemplates(): CustomRuleSystemTemplate[] {
  return CUSTOM_RULE_SYSTEM_TEMPLATE_DEFINITIONS.map(cloneTemplate);
}

export function getCustomRuleSystemTemplate(
  templateId: string,
): CustomRuleSystemTemplate | null {
  const definition = CUSTOM_RULE_SYSTEM_TEMPLATE_DEFINITIONS.find(
    (template) => template.id === templateId,
  );
  return definition ? cloneTemplate(definition) : null;
}

function cloneTemplate(
  template: Readonly<CustomRuleSystemTemplate>,
): CustomRuleSystemTemplate {
  return {
    id: template.id,
    kind: template.kind,
    name: template.name,
    description: template.description,
    contract: businessRuleContractSchema.parse(template.contract),
  };
}

function contract(
  values: Pick<
    BusinessRuleContract,
    | "executionGrain"
    | "compositionMode"
    | "title"
    | "summary"
    | "calculationComponents"
    | "requiredInputs"
    | "parameters"
    | "compositionDescription"
    | "examples"
  >,
): BusinessRuleContract {
  return {
    schemaVersion: 1,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    ...values,
    effectiveStartAt: EFFECTIVE_START,
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    businessTimezone: "Asia/Shanghai",
  };
}

function component(name: string, description: string, expression: string) {
  return { name, description, expression, resultType: MONEY_TYPE };
}

function requiredInput(
  name: string,
  description: string,
  source: string,
  valueType: BusinessRuleContract["requiredInputs"][number]["valueType"],
  userFacingUnit: string,
) {
  return { name, description, source, valueType, userFacingUnit };
}

function moneyParameter(
  name: string,
  description: string,
  userFacingUnit: string,
  amountCents: number,
) {
  return {
    name,
    description,
    valueType: MONEY_TYPE,
    userFacingUnit,
    defaultValue: moneyValue(amountCents),
  };
}

function rateParameter(
  name: string,
  description: string,
  userFacingUnit: string,
  rateBps: number,
) {
  return {
    name,
    description,
    valueType: RATE_TYPE,
    userFacingUnit,
    defaultValue: { type: "rate_bps" as const, rateBps },
  };
}

function example(
  name: string,
  kind: "normal" | "boundary",
  description: string,
  inputs: BusinessRuleContract["examples"][number]["inputs"],
  expectedResult: BusinessRuleContract["examples"][number]["expectedResult"],
) {
  return { name, kind, description, inputs, expectedResult };
}

function moneyValue(amountCents: number) {
  return { type: "money_cents" as const, amountCents };
}

function integerValue(value: number) {
  return { type: "integer" as const, value };
}

function stringValue(value: string) {
  return { type: "string" as const, value };
}

function deepFreezeOwned<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ("value" in descriptor) deepFreezeOwned(descriptor.value);
  }
  return Object.freeze(value);
}
