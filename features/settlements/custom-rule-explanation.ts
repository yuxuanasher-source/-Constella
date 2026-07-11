import { typedRuntimeValueSchema } from "./custom-rule-contract";
import {
  CustomRuleExecutionError,
  executeCompiledCustomRuleWithTrace,
  preflightCompiledCustomRuleAst,
  type CustomRuleExecutionTraceEvent,
  type CustomRuleMoneyResult,
} from "./custom-rule-engine";
import type {
  CompiledAstNode,
  RuntimeScalarType,
  TypedRuntimeValue,
} from "./custom-rule-types";

export type CustomRuleLabelRegistry = Readonly<{
  variables: Readonly<Record<string, string>>;
  functions: Readonly<Record<string, string>>;
  parameters: Readonly<Record<string, string>>;
  components: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
}>;

export const DEFAULT_CUSTOM_RULE_LABEL_REGISTRY: CustomRuleLabelRegistry =
  deepFreezeOwned({
    variables: {
      system_minutes: "系统直播时长",
      screenshot_minutes: "截图时长",
      settlement_minutes: "结算时长",
      evidence_level: "凭证等级",
      time_source: "计时来源",
      views: "观看量",
      project_id: "项目",
      project_tags: "项目标签",
      streamer_id: "主播",
      streamer_level: "主播等级",
      streamer_source: "主播来源",
      base_hourly_rate: "基础时薪",
      base_salary: "底薪",
      cps_rate: "CPS比例",
      sales_amount: "销售金额",
      orders_count: "订单数",
      gift_amount: "礼物金额",
      manual_adjustment: "人工调整",
      period_system_minutes: "周期系统时长",
      period_settlement_minutes: "周期结算时长",
      period_sales_amount: "周期销售金额",
      period_orders_count: "周期订单数",
      period_report_count: "周期场次数",
      red_evidence_count: "红色凭证数",
      yellow_evidence_count: "黄色凭证数",
    },
    functions: {
      if: "条件判断",
      min: "取较小值",
      max: "取较大值",
      clamp: "区间限制",
      round_money: "金额取整",
      tiered: "分段计费",
      percent: "比例计算",
      evidence_multiplier: "凭证折扣",
      in: "候选匹配",
      contains: "标签匹配",
      parameter: "业务参数",
      money_result: "结算结果",
    },
    parameters: {},
    components: {
      base: "基础金额",
      bonus: "奖励",
      penalty: "扣减",
      discounted: "折后金额",
      modifier: "调整金额",
      selected: "选定金额",
      final: "最终金额",
    },
    values: {
      green: "绿色",
      yellow: "黄色",
      red: "红色",
    },
  });

export type CustomRuleExplanationIssue = Readonly<{
  code: string;
  message: string;
  path: string;
}>;

export class CustomRuleExplanationError extends Error {
  readonly issue: CustomRuleExplanationIssue;

  constructor(issue: CustomRuleExplanationIssue) {
    super(issue.message);
    this.name = "CustomRuleExplanationError";
    this.issue = Object.freeze({ ...issue });
  }
}

export type BuildCustomRuleTemplateExplanationInput = Readonly<{
  ast: CompiledAstNode;
  labels?: CustomRuleLabelRegistry;
}>;

export type BuildCustomRuleExecutionExplanationInput = Readonly<{
  ast: CompiledAstNode;
  trace: readonly CustomRuleExecutionTraceEvent[];
  result: CustomRuleMoneyResult;
  labels?: CustomRuleLabelRegistry;
}>;

type ParsedRoot = Readonly<{
  ast: CompiledAstNode;
  componentNames: readonly string[];
}>;

type VariableUnit = "minutes" | "count";

const VARIABLE_UNITS: Readonly<Record<string, VariableUnit>> = Object.freeze({
  system_minutes: "minutes",
  screenshot_minutes: "minutes",
  settlement_minutes: "minutes",
  period_system_minutes: "minutes",
  period_settlement_minutes: "minutes",
  views: "count",
  orders_count: "count",
  period_orders_count: "count",
  period_report_count: "count",
  red_evidence_count: "count",
  yellow_evidence_count: "count",
});

class DataSnapshotFailure extends Error {}

export function buildCustomRuleTemplateExplanation(
  input: BuildCustomRuleTemplateExplanationInput,
): string {
  const values = parseOuterInput(input, ["ast"], ["labels"]);
  const root = parseRoot(values.ast);
  const labels = parseLabelRegistry(values.labels);
  const functionIds = collectFunctionIds(root.ast);
  const componentText = root.componentNames
    .map((name) => labelFor(labels.components, name, "组件"))
    .join("、");
  const functionText = functionIds
    .map((id) => labelFor(labels.functions, id, "函数"))
    .join("、");

  return (
    `结算公式按组件顺序输出：${componentText}。` +
    (functionText.length > 0 ? `计算使用：${functionText}。` : "") +
    "金额以元显示，比例以%显示。"
  );
}

export function buildCustomRuleExecutionExplanation(
  input: BuildCustomRuleExecutionExplanationInput,
): string {
  const values = parseOuterInput(
    input,
    ["ast", "trace", "result"],
    ["labels"],
  );
  const root = parseRoot(values.ast);
  const trace = parseTrace(values.trace);
  const result = parseResult(values.result);
  const labels = parseLabelRegistry(values.labels);
  verifyExecution(root.ast, trace, result);

  const sentences: string[] = [];
  const describedValues = new Set<string>();
  for (const event of trace) {
    switch (event.kind) {
      case "ast":
      case "component":
        break;
      case "variable": {
        const key = `variable:${event.name}`;
        if (!describedValues.has(key)) {
          describedValues.add(key);
          sentences.push(
            `${labelFor(labels.variables, event.name, "变量")}：${formatRuntimeValue(
              event.value,
              labels,
              VARIABLE_UNITS[event.name],
            )}。`,
          );
        }
        break;
      }
      case "parameter": {
        const key = `parameter:${event.name}`;
        if (!describedValues.has(key)) {
          describedValues.add(key);
          sentences.push(
            `${labelFor(labels.parameters, event.name, "参数")}：${formatRuntimeValue(
              event.value,
              labels,
            )}。`,
          );
        }
        break;
      }
      case "branch":
        sentences.push(
          `${labelFor(labels.functions, "if", "函数")}：${
            event.condition ? "满足条件" : "不满足条件"
          }，采用已触发分支。`,
        );
        break;
      case "tier":
        sentences.push(
          `${labelFor(labels.functions, "tiered", "函数")}第${
            event.tierIndex + 1
          }档：${formatPlainNumber(event.minutesApplied)} 分钟 × ${formatMoney(
            event.ratePerHourCents,
          )}/小时 = ${formatMoney(event.amountCents)}。`,
        );
        break;
      case "evidence":
        sentences.push(
          `${labelFor(labels.functions, "evidence_multiplier", "函数")}：${labelFor(
            labels.values,
            event.level,
            "值",
          )}，采用 ${formatRate(event.rateBps)}。`,
        );
        break;
      case "percent":
        sentences.push(
          `${labelFor(labels.functions, "percent", "函数")}：${formatMoney(
            event.amountCents,
          )} × ${formatRate(event.rateBps)} = ${formatMoney(
            event.resultCents,
          )}。`,
        );
        break;
      case "clamp":
        if (event.outcome !== "unchanged") {
          const boundary = event.outcome === "floor" ? event.floor : event.cap;
          sentences.push(
            `${labelFor(labels.functions, "clamp", "函数")}：触发${
              event.outcome === "floor" ? "下限" : "上限"
            } ${formatTraceNumeric(boundary, event.scalarType)}，结果 ${formatTraceNumeric(
              event.result,
              event.scalarType,
            )}。`,
          );
        }
        break;
    }
  }

  const componentText = root.componentNames
    .map(
      (name) =>
        `${labelFor(labels.components, name, "组件")}：${formatMoney(
          result.componentsCents[name],
        )}`,
    )
    .join("；");
  sentences.push(`${componentText}。`);
  return sentences.join("");
}

function parseOuterInput(
  input: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): Record<string, unknown> {
  let snapshot: unknown;
  try {
    snapshot = snapshotOwnData(input);
  } catch {
    invalidInput();
  }
  if (!isPlainRecord(snapshot)) {
    invalidInput();
  }
  const keys = Object.keys(snapshot);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    !requiredKeys.every((key) => Object.hasOwn(snapshot, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    invalidInput();
  }
  return snapshot;
}

function invalidInput(): never {
  explanationFailure(
    "EXPLANATION_INVALID_INPUT",
    "Explanation input must contain only AST, trace, result, and labels",
    "$",
  );
}

function parseRoot(value: unknown): ParsedRoot {
  let parsed: CompiledAstNode;
  try {
    parsed = preflightCompiledCustomRuleAst(value);
  } catch (error) {
    if (!(error instanceof CustomRuleExecutionError)) {
      throw error;
    }
    invalidAst();
  }
  if (
    parsed.kind !== "call" ||
    parsed.callee !== "money_result" ||
    parsed.arguments.length !== 1 ||
    parsed.arguments[0]?.kind !== "object"
  ) {
    invalidAst();
  }
  const componentNames = parsed.arguments[0].entries.map((entry) => entry.key);
  if (
    componentNames.length === 0 ||
    new Set(componentNames).size !== componentNames.length ||
    componentNames.filter((name) => name === "final").length !== 1
  ) {
    invalidAst();
  }
  return { ast: parsed, componentNames };
}

function invalidAst(): never {
  explanationFailure(
    "EXPLANATION_INVALID_AST",
    "Explanation requires a valid compiled money_result AST",
    "$.ast",
  );
}

function parseLabelRegistry(value: unknown): CustomRuleLabelRegistry {
  if (value === undefined) {
    return DEFAULT_CUSTOM_RULE_LABEL_REGISTRY;
  }
  if (!isPlainRecord(value)) {
    invalidInput();
  }
  const keys = ["variables", "functions", "parameters", "components", "values"];
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    invalidInput();
  }
  const registry = {} as Record<string, Readonly<Record<string, string>>>;
  for (const key of keys) {
    const labels = value[key];
    if (
      !isPlainRecord(labels) ||
      Object.values(labels).some(
        (label) => typeof label !== "string" || label.trim().length === 0,
      )
    ) {
      invalidInput();
    }
    registry[key] = labels as Record<string, string>;
  }
  return registry as CustomRuleLabelRegistry;
}

function parseResult(value: unknown): CustomRuleMoneyResult {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["kind", "componentsCents"])) {
    invalidResult();
  }
  if (value.kind !== "money_result" || !isPlainRecord(value.componentsCents)) {
    invalidResult();
  }
  const componentsCents: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value.componentsCents)) {
    if (!Number.isSafeInteger(amount)) {
      invalidResult();
    }
    componentsCents[key] = amount as number;
  }
  if (
    !Object.hasOwn(componentsCents, "final") ||
    componentsCents.final < 0
  ) {
    invalidResult();
  }
  return { kind: "money_result", componentsCents };
}

function invalidResult(): never {
  explanationFailure(
    "EXPLANATION_INVALID_RESULT",
    "Explanation result must be a safe money_result",
    "$.result",
  );
}

function parseTrace(value: unknown): readonly CustomRuleExecutionTraceEvent[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalidTrace();
  }
  const trace = value.map((event, index) => parseTraceEvent(event, index));
  if (
    trace[0]?.kind !== "ast" ||
    trace.slice(1).some((event) => event.kind === "ast")
  ) {
    invalidTrace();
  }
  return trace;
}

function parseTraceEvent(
  value: unknown,
  index: number,
): CustomRuleExecutionTraceEvent {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    invalidTrace(index);
  }
  switch (value.kind) {
    case "ast":
      if (
        !hasExactKeys(value, ["kind", "path", "canonicalAst"]) ||
        value.path !== "$" ||
        typeof value.canonicalAst !== "string"
      ) {
        invalidTrace(index);
      }
      return value as CustomRuleExecutionTraceEvent;
    case "variable":
    case "parameter": {
      if (
        !hasExactKeys(value, ["kind", "path", "name", "value"]) ||
        typeof value.path !== "string" ||
        typeof value.name !== "string"
      ) {
        invalidTrace(index);
      }
      const parsedValue = typedRuntimeValueSchema.safeParse(value.value);
      if (!parsedValue.success) {
        invalidTrace(index);
      }
      return {
        kind: value.kind,
        path: value.path,
        name: value.name,
        value: parsedValue.data,
      };
    }
    case "branch":
      if (
        !hasExactKeys(value, ["kind", "path", "condition", "selected"]) ||
        typeof value.path !== "string" ||
        typeof value.condition !== "boolean" ||
        (value.selected !== "when_true" && value.selected !== "when_false") ||
        value.selected !== (value.condition ? "when_true" : "when_false")
      ) {
        invalidTrace(index);
      }
      return value as CustomRuleExecutionTraceEvent;
    case "tier":
      if (
        !hasExactKeys(value, [
          "kind",
          "path",
          "tierIndex",
          "minutesApplied",
          "ratePerHourCents",
          "amountCents",
        ]) ||
        typeof value.path !== "string" ||
        !isNonNegativeSafeInteger(value.tierIndex) ||
        !isNonNegativeFiniteNumber(value.minutesApplied) ||
        !Number.isSafeInteger(value.ratePerHourCents) ||
        !Number.isSafeInteger(value.amountCents)
      ) {
        invalidTrace(index);
      }
      return value as CustomRuleExecutionTraceEvent;
    case "evidence":
      if (
        !hasExactKeys(value, ["kind", "path", "level", "rateBps"]) ||
        typeof value.path !== "string" ||
        typeof value.level !== "string" ||
        !Number.isSafeInteger(value.rateBps)
      ) {
        invalidTrace(index);
      }
      return value as CustomRuleExecutionTraceEvent;
    case "percent":
      if (
        !hasExactKeys(value, [
          "kind",
          "path",
          "amountCents",
          "rateBps",
          "resultCents",
        ]) ||
        typeof value.path !== "string" ||
        !Number.isSafeInteger(value.amountCents) ||
        !Number.isSafeInteger(value.rateBps) ||
        !Number.isSafeInteger(value.resultCents)
      ) {
        invalidTrace(index);
      }
      return value as CustomRuleExecutionTraceEvent;
    case "clamp":
      if (
        !hasExactKeys(value, [
          "kind",
          "path",
          "outcome",
          "value",
          "floor",
          "cap",
          "result",
          "scalarType",
        ]) ||
        typeof value.path !== "string" ||
        !["floor", "cap", "unchanged"].includes(value.outcome as string) ||
        !["money_cents", "rate_bps", "number", "integer"].includes(
          value.scalarType as string,
        ) ||
        ![value.value, value.floor, value.cap, value.result].every(
          (item) => typeof item === "number" && Number.isFinite(item),
        )
      ) {
        invalidTrace(index);
      }
      return value as CustomRuleExecutionTraceEvent;
    case "component":
      if (
        !hasExactKeys(value, ["kind", "path", "name", "amountCents"]) ||
        typeof value.path !== "string" ||
        typeof value.name !== "string" ||
        !Number.isSafeInteger(value.amountCents)
      ) {
        invalidTrace(index);
      }
      return value as CustomRuleExecutionTraceEvent;
    default:
      invalidTrace(index);
  }
}

function invalidTrace(index?: number): never {
  explanationFailure(
    "EXPLANATION_INVALID_TRACE",
    "Explanation trace has an invalid own-data event shape",
    index === undefined ? "$.trace" : `$.trace[${index}]`,
  );
}

function verifyExecution(
  ast: CompiledAstNode,
  trace: readonly CustomRuleExecutionTraceEvent[],
  result: CustomRuleMoneyResult,
): void {
  const astEvent = trace[0];
  if (
    astEvent?.kind !== "ast" ||
    astEvent.canonicalAst !== canonicalJson(ast)
  ) {
    executionMismatch("AST does not match the execution trace");
  }

  const variables: Record<string, TypedRuntimeValue> = {};
  const parameters: Record<string, TypedRuntimeValue> = {};
  for (const event of trace) {
    if (event.kind !== "variable" && event.kind !== "parameter") {
      continue;
    }
    const target = event.kind === "variable" ? variables : parameters;
    if (
      Object.hasOwn(target, event.name) &&
      canonicalJson(target[event.name]) !== canonicalJson(event.value)
    ) {
      invalidTrace();
    }
    target[event.name] = event.value;
  }

  let recomputed;
  try {
    recomputed = executeCompiledCustomRuleWithTrace({ ast, variables, parameters });
  } catch (error) {
    if (error instanceof CustomRuleExecutionError) {
      executionMismatch("Trace cannot reproduce the compiled AST execution");
    }
    throw error;
  }
  if (
    canonicalJson(recomputed.trace) !== canonicalJson(trace) ||
    canonicalJson(recomputed.result) !== canonicalJson(result)
  ) {
    executionMismatch("AST, trace, and result are not one deterministic execution");
  }
}

function executionMismatch(message: string): never {
  explanationFailure(
    "EXPLANATION_EXECUTION_MISMATCH",
    message,
    "$",
  );
}

function collectFunctionIds(ast: CompiledAstNode): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const visit = (node: CompiledAstNode): void => {
    if (node.kind === "call") {
      if (node.callee !== "money_result" && !seen.has(node.callee)) {
        seen.add(node.callee);
        ids.push(node.callee);
      }
      node.arguments.forEach(visit);
      return;
    }
    if (node.kind === "unary") {
      visit(node.argument);
      return;
    }
    if (node.kind === "binary") {
      visit(node.left);
      visit(node.right);
      return;
    }
    if (node.kind === "array") {
      node.elements.forEach(visit);
      return;
    }
    if (node.kind === "object") {
      node.entries.forEach((entry) => visit(entry.value));
    }
  };
  visit(ast);
  return ids;
}

function labelFor(
  registry: Readonly<Record<string, string>>,
  id: string,
  fallbackKind: string,
): string {
  return Object.hasOwn(registry, id) ? registry[id] : `${fallbackKind}“${id}”`;
}

function formatRuntimeValue(
  value: TypedRuntimeValue,
  labels: CustomRuleLabelRegistry,
  unit?: VariableUnit,
): string {
  switch (value.type) {
    case "money_cents":
      return formatMoney(value.amountCents);
    case "rate_bps":
      return formatRate(value.rateBps);
    case "integer":
    case "number":
      return `${formatPlainNumber(value.value)}${
        unit === "minutes" ? " 分钟" : unit === "count" ? " 个" : ""
      }`;
    case "boolean":
      return value.value ? "是" : "否";
    case "string": {
      const displayValue = Object.hasOwn(labels.values, value.value)
        ? labels.values[value.value]
        : value.value;
      return `“${displayValue}”`;
    }
    case "timestamp":
      return `“${value.value}”`;
    case "array":
      return `【${value.items
        .map((item) => formatRuntimeValue(item, labels))
        .join("、")}】`;
    case "object":
      return `【${Object.keys(value.fields)
        .sort()
        .map(
          (key) => `${key}：${formatRuntimeValue(value.fields[key], labels)}`,
        )
        .join("、")}】`;
  }
}

function formatTraceNumeric(value: number, scalarType: RuntimeScalarType): string {
  if (scalarType === "money_cents") {
    return formatMoney(value);
  }
  if (scalarType === "rate_bps") {
    return formatRate(value);
  }
  return formatPlainNumber(value);
}

function formatMoney(cents: number): string {
  const amount = BigInt(cents);
  const sign = amount < BigInt(0) ? "-" : "";
  const absolute = amount < BigInt(0) ? -amount : amount;
  const yuan = absolute / BigInt(100);
  const remainder = (absolute % BigInt(100)).toString().padStart(2, "0");
  return `${sign}${yuan.toString()}.${remainder} 元`;
}

function formatRate(rateBps: number): string {
  const rate = BigInt(rateBps);
  const sign = rate < BigInt(0) ? "-" : "";
  const absolute = rate < BigInt(0) ? -rate : rate;
  const percent = absolute / BigInt(100);
  const remainder = (absolute % BigInt(100)).toString().padStart(2, "0");
  return `${sign}${percent.toString()}.${remainder}%`;
}

function formatPlainNumber(value: number): string {
  return Object.is(value, -0) ? "0" : value.toString();
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function snapshotOwnData(value: unknown): unknown {
  const ancestors = new WeakSet<object>();
  let nodes = 0;

  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > 200_000 || depth > 256) {
      throw new DataSnapshotFailure();
    }
    if (current === null || typeof current !== "object") {
      if (
        typeof current === "undefined" ||
        typeof current === "function" ||
        typeof current === "symbol" ||
        typeof current === "bigint"
      ) {
        throw new DataSnapshotFailure();
      }
      return current;
    }
    if (ancestors.has(current)) {
      throw new DataSnapshotFailure();
    }
    ancestors.add(current);

    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) {
        throw new DataSnapshotFailure();
      }
      const length = current.length;
      if (!Number.isSafeInteger(length) || length > 200_000) {
        throw new DataSnapshotFailure();
      }
      const names = Object.getOwnPropertyNames(current);
      if (
        names.length !== length + 1 ||
        Object.getOwnPropertySymbols(current).length > 0
      ) {
        throw new DataSnapshotFailure();
      }
      const copy: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (
          !descriptor ||
          descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, "value")
        ) {
          throw new DataSnapshotFailure();
        }
        copy.push(visit(descriptor.value, depth + 1));
      }
      ancestors.delete(current);
      return copy;
    }

    if (!isPlainRecord(current)) {
      throw new DataSnapshotFailure();
    }
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") {
        throw new DataSnapshotFailure();
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        !descriptor ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, "value")
      ) {
        throw new DataSnapshotFailure();
      }
      copy[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(current);
    return copy;
  };

  return visit(value, 0);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function explanationFailure(code: string, message: string, path: string): never {
  throw new CustomRuleExplanationError({ code, message, path });
}

function deepFreezeOwned<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreezeOwned(child);
    }
    Object.freeze(value);
  }
  return value;
}
