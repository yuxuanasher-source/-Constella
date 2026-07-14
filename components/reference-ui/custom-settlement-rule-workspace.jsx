"use client";

import React from "react";
import {
  AlertCircle,
  Bot,
  Building2,
  Calculator,
  CheckCircle2,
  RefreshCw,
  Send,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  CustomSettlementRuleApiError,
  createCustomSettlementRuleApi,
} from "./custom-settlement-rule-api";
import CustomSettlementRuleGroupPanel from "./custom-settlement-rule-group-panel";
import CustomSettlementRuleReviewDialog from "./custom-settlement-rule-review-dialog";
import CustomSettlementRuleVersionPanel from "./custom-settlement-rule-version-panel";

const CONTRACT_FIELD_ORDER = [
  "scope",
  "target",
  "executionGrain",
  "compositionMode",
  "title",
  "summary",
  "calculationComponents",
  "requiredInputs",
  "parameters",
  "effectiveStartAt",
  "effectiveEndAt",
  "missingDataPolicy",
  "compositionDescription",
  "businessTimezone",
  "examples",
];

const CONTRACT_FIELD_LABELS = {
  schemaVersion: "规则版本",
  scope: "适用范围",
  target: "适用对象",
  executionGrain: "执行口径",
  compositionMode: "组合方式",
  title: "规则名称",
  summary: "业务说明",
  calculationComponents: "计算步骤",
  requiredInputs: "所需数据",
  parameters: "业务参数",
  effectiveStartAt: "生效时间",
  effectiveEndAt: "结束时间",
  missingDataPolicy: "缺少数据时",
  compositionDescription: "与现有规则关系",
  businessTimezone: "业务时区",
  examples: "业务样例",
};

const SCOPE_OPTIONS = [
  {
    value: "receivable",
    label: "客户应收",
    icon: Building2,
    executionGrain: "project_period",
  },
  {
    value: "payable",
    label: "主播应付",
    icon: Users,
    executionGrain: "report",
  },
  {
    value: "external_cost",
    label: "项目成本",
    icon: Calculator,
    executionGrain: "report",
  },
];

const INITIAL_REQUEST_STATE = {
  contextKey: null,
  status: "idle",
  operation: null,
  lastOperation: null,
  requestId: null,
  catalogStatus: "idle",
  catalog: null,
  authoritative: null,
  error: null,
  announcement: "",
  focusTarget: null,
  recovery: null,
};

const INITIAL_GOVERNANCE_STATE = {
  contextKey: null,
  status: "idle",
  versions: [],
  reviews: [],
  groups: [],
  templates: [],
  announcement: "",
  error: null,
};
const EMPTY_TEMPLATES = Object.freeze([]);

const OPTIONAL_GOVERNANCE_FAILURE = Symbol("optional governance failure");

const SESSION_SYNC_ERROR_CODES = new Set([
  "CUSTOM_RULE_SESSION_CONFLICT",
  "CUSTOM_RULE_IDEMPOTENCY_CONFLICT",
  "CUSTOM_RULE_STALE_REVISION",
  "CUSTOM_RULE_INVALID_TRANSITION",
  "CUSTOM_RULE_UNRESOLVED_AMBIGUITIES",
  "CUSTOM_RULE_DUPLICATE_CONFIRMATION",
  "CUSTOM_RULE_STALE_CONTRACT",
  "CUSTOM_RULE_STALE_FORMULA",
  "CUSTOM_RULE_STALE_EVIDENCE",
  "CUSTOM_RULE_STALE_SELECTION",
  "CUSTOM_RULE_RESPONSE_INVALID",
]);
const CATALOG_SYNC_ERROR_CODES = new Set([
  "CUSTOM_RULE_STALE_CATALOG",
  "CUSTOM_RULE_CATALOG_UNAVAILABLE",
]);

function freshRequestState() {
  return { ...INITIAL_REQUEST_STATE };
}

function defaultRequestId(operation) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
  return `task9:${operation}:${suffix}`;
}

function defaultUuid() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    "00000000-0000-4000-8000-000000000000"
  );
}

function normalizeTarget(target) {
  if (
    target?.targetType === "project_streamer" ||
    target?.targetType === "streamer_group"
  ) {
    return { targetType: target.targetType, targetId: String(target.targetId) };
  }
  return { targetType: "project", targetId: null };
}

function scopeOption(scope) {
  return (
    SCOPE_OPTIONS.find((option) => option.value === scope) ?? SCOPE_OPTIONS[0]
  );
}

function contextIsValid(project, period) {
  return Boolean(
    project?.id && period?.start && period?.end && period.start <= period.end,
  );
}

function parseBusinessDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day
    ? parts
    : null;
}

function calendarUtcEpoch(parts) {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, 0);
  return date.getTime();
}

function zonedCalendarParts(instant, formatter) {
  const values = {};
  const parts = formatter.formatToParts(instant);
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  if (
    !Number.isInteger(values.year) ||
    !Number.isInteger(values.month) ||
    !Number.isInteger(values.day) ||
    !Number.isInteger(values.hour) ||
    !Number.isInteger(values.minute) ||
    !Number.isInteger(values.second)
  ) {
    throw new Error("business timezone could not be resolved");
  }
  return values;
}

function compareCalendarDate(left, right) {
  if (left.year !== right.year) return left.year < right.year ? -1 : 1;
  if (left.month !== right.month) return left.month < right.month ? -1 : 1;
  if (left.day !== right.day) return left.day < right.day ? -1 : 1;
  return 0;
}

function calendarPart(value) {
  return String(value).padStart(2, "0");
}

function businessDateBoundary(value, timeZone) {
  const date = parseBusinessDate(value);
  if (!date) {
    throw new CustomSettlementRuleApiError({
      code: "CUSTOM_RULE_BUSINESS_DATE_UNAVAILABLE",
      status: 0,
      retryable: false,
    });
  }
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw new CustomSettlementRuleApiError({
      code: "CUSTOM_RULE_RESPONSE_INVALID",
      status: 200,
      retryable: true,
    });
  }

  const targetEpochSeconds = Math.floor(calendarUtcEpoch(date) / 1_000);
  const searchRadiusSeconds = 48 * 60 * 60;
  let lower = targetEpochSeconds - searchRadiusSeconds;
  let upper = targetEpochSeconds + searchRadiusSeconds;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const local = zonedCalendarParts(middle * 1_000, formatter);
    if (compareCalendarDate(local, date) >= 0) upper = middle;
    else lower = middle + 1;
  }

  const instant = lower * 1_000;
  const resolved = zonedCalendarParts(instant, formatter);
  if (compareCalendarDate(resolved, date) !== 0) {
    throw new CustomSettlementRuleApiError({
      code: "CUSTOM_RULE_BUSINESS_DATE_UNAVAILABLE",
      status: 0,
      retryable: false,
    });
  }
  const offsetMinutes = (calendarUtcEpoch(resolved) - instant) / 60_000;
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 24 * 60) {
    throw new CustomSettlementRuleApiError({
      code: "CUSTOM_RULE_RESPONSE_INVALID",
      status: 200,
      retryable: true,
    });
  }
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, "0");
  const sign = offsetMinutes >= 0 ? "+" : "-";
  return `${value}T${calendarPart(resolved.hour)}:${calendarPart(resolved.minute)}:${calendarPart(resolved.second)}.000${sign}${offsetHours}:${offsetRemainder}`;
}

function catalogTimezoneReady(catalog) {
  return Boolean(
    catalog?.businessTimezone &&
    catalog.businessTimezoneConfirmed &&
    catalog.businessTimezoneSource !== "unresolved",
  );
}

function createSeedContract({
  scope,
  target,
  projectName,
  effectiveStartAt,
  businessTimezone,
}) {
  const payable = scope === "payable";
  const externalCost = scope === "external_cost";
  const inputName = externalCost
    ? "sales_amount"
    : payable
      ? "system_minutes"
      : "period_report_count";
  const inputDescription = externalCost
    ? "导入行销售金额"
    : payable
      ? "系统直播时长"
      : "周期内已审核报告数";
  const inputSource = externalCost
    ? "项目成本导入"
    : payable
      ? "直播报告系统计时"
      : "周期内已审核直播报告";
  const inputUnit = externalCost ? "元" : payable ? "分钟" : "份";
  const title = externalCost
    ? `${projectName || "当前项目"}项目成本规则草案`
    : payable
    ? `${projectName || "当前项目"}主播应付规则草案`
    : `${projectName || "当前项目"}客户应收规则草案`;
  const summary = externalCost
    ? "按成本导入行生成待审核项目成本。"
    : payable
    ? "按项目直播报告计算主播应付金额。"
    : "按项目结算周期计算客户应收金额。";
  const description = externalCost
    ? "生成待审核项目成本"
    : payable
      ? "计算最终主播应付金额"
      : "计算最终客户应收金额";

  const example = (name, kind, descriptionText, value, amountCents) => ({
    name,
    kind,
    description: descriptionText,
    inputs: { [inputName]: { type: "integer", value } },
    expectedResult: { type: "money_cents", amountCents },
  });
  const externalCostExample = (
    name,
    kind,
    descriptionText,
    amountCents,
    items,
  ) => ({
    name,
    kind,
    description: descriptionText,
    inputs: { [inputName]: { type: "money_cents", amountCents } },
    expectedResult: {
      type: "cost_items",
      items: items.map((item) => ({
        category: item.category,
        amountCents: item.amountCents,
        status: "pending_review",
      })),
    },
  });

  return {
    schemaVersion: 1,
    scope,
    target:
      scope === "receivable" || externalCost
        ? { targetType: "project", targetId: null }
        : target,
    executionGrain: payable || externalCost ? "report" : "project_period",
    compositionMode: externalCost ? "emit_items" : "replace",
    title,
    summary,
    calculationComponents: [
      {
        name: "final",
        description,
        expression: externalCost
          ? "cost_items([{ category, amount: sales_amount * cost_rate, status: 'pending_review' }])"
          : "按确认后的业务条件计算最终金额",
        resultType: externalCost
          ? { kind: "array", itemType: { kind: "object", fields: {} } }
          : { kind: "scalar", scalarType: "money_cents" },
      },
    ],
    requiredInputs: [
      {
        name: inputName,
        description: inputDescription,
        source: inputSource,
        valueType: {
          kind: "scalar",
          scalarType: externalCost ? "money_cents" : "integer",
        },
        userFacingUnit: inputUnit,
      },
    ],
    parameters: [
      {
        name: "unit_price",
        description: externalCost
          ? "项目成本金额或比例参数"
          : payable
            ? "基础结算单价"
            : "基础应收单价",
        valueType: { kind: "scalar", scalarType: "money_cents" },
        userFacingUnit: "元",
        defaultValue: { type: "money_cents", amountCents: 0 },
      },
    ],
    effectiveStartAt,
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    compositionDescription: externalCost
      ? "生成项目成本待审核明细，不自动确认入账。"
      : payable
      ? "替换当前项目的主播应付基础规则。"
      : "替换当前项目的客户应收基础规则。",
    businessTimezone,
    examples: externalCost
      ? [
          externalCostExample(
            "导入行生成流量成本",
            "normal",
            "销售金额生成一条待审核项目成本。",
            100_000,
            [{ category: "traffic", amountCents: 12_000 }],
          ),
          externalCostExample(
            "零金额导入行",
            "boundary",
            "没有可计算金额时不生成已确认成本。",
            0,
            [],
          ),
          externalCostExample(
            "多类别成本",
            "normal",
            "同一导入行可生成多条待审核项目成本。",
            200_000,
            [
              { category: "traffic", amountCents: 18_000 },
              { category: "supplier_fee", amountCents: 6_000 },
            ],
          ),
        ]
      : [
          example("标准情况", "normal", "按一个标准单位计算。", 1, 0),
          example("零值情况", "boundary", "业务数量为零时金额为零。", 0, 0),
          example("最小单位", "boundary", "按最小业务单位计算。", 1, 0),
        ],
  };
}

function authorityFromResult(result, conversation = null) {
  if (!result?.draft) return null;
  return {
    conversation,
    messages: [],
    turns: [],
    draft: result.draft,
    diff: result.kind === "clarifying" ? result.diff : [],
    simulation: result.kind === "simulated" ? result.simulation : null,
    summary: result.kind === "simulated" ? result.summary : null,
  };
}

function authorityFromSession(session) {
  return {
    conversation: session.conversation,
    messages: session.messages,
    turns: session.turns,
    draft: session.draft,
    diff: [],
    simulation: session.simulation,
    summary:
      session.summary ??
      (session.simulation?.version === 2 ? session.simulation.summary : null),
  };
}

function reopenedRevisionAuthority(session) {
  const authority = authorityFromSession(session);
  return {
    ...authority,
    draft: {
      ...authority.draft,
      reopenedForRevision: true,
    },
  };
}

const ACTIVE_TURN_STATUSES = new Set([
  "accepted",
  "grounding",
  "generating",
  "validating",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CONFIRM_CONTRACT_AMBIGUITY = "confirm_contract";

function latestTurn(authority) {
  return authority?.turns?.[authority.turns.length - 1] ?? null;
}

function authorityIsActive(authority) {
  return authority?.turns?.some((turn) =>
    ACTIVE_TURN_STATUSES.has(turn.status),
  );
}

function authorityNeedsRefresh(authority) {
  return (
    authorityIsActive(authority) || authority?.draft?.status === "superseded"
  );
}

function authorityHasValidTerminalShape(authority) {
  if (!authority?.draft) return false;
  return (
    Boolean(authority.simulation) === (authority.draft.status === "simulated")
  );
}

function invalidAuthorityError() {
  return new CustomSettlementRuleApiError({
    code: "CUSTOM_RULE_RESPONSE_INVALID",
    status: 200,
    retryable: true,
  });
}

function invalidSubmitLifecycleError() {
  return new CustomSettlementRuleApiError({
    code: "CUSTOM_RULE_RESPONSE_INVALID",
    status: 200,
    retryable: true,
  });
}

function authorityHasFailed(authority) {
  return (
    authority?.draft?.status === "failed" ||
    latestTurn(authority)?.status === "failed"
  );
}

function draftIsConfirmationReady(draft) {
  const ambiguities = draft?.unresolvedAmbiguities;
  return Boolean(
    draft?.status === "clarifying" &&
    draft.initialStatus === "clarifying" &&
    draft.businessContract &&
    Array.isArray(ambiguities) &&
    ambiguities.length === 1 &&
    ambiguities[0]?.code === CONFIRM_CONTRACT_AMBIGUITY &&
    ambiguities[0]?.required === true &&
    draft.generatedFormula === null &&
    draft.generatedExplanation === null &&
    Array.isArray(draft.generatedTestCases) &&
    draft.generatedTestCases.length === 0 &&
    draft.formulaHash === null &&
    SHA256_PATTERN.test(draft.contractHash) &&
    SHA256_PATTERN.test(draft.variableCatalogVersion),
  );
}

function visibleBusinessAmbiguities(draft) {
  return (draft?.unresolvedAmbiguities ?? []).filter(
    (ambiguity) => ambiguity.code !== CONFIRM_CONTRACT_AMBIGUITY,
  );
}

function focusTargetForAuthority(authority) {
  if (authorityHasFailed(authority)) return "error";
  const draft = authority?.draft;
  if (draft?.status === "clarifying" && !draftIsConfirmationReady(draft)) {
    return "question";
  }
  return "result";
}

function completionAnnouncement(authority) {
  if (authorityHasFailed(authority)) return "AI 草案生成失败";
  const draft = authority?.draft;
  if (draftIsConfirmationReady(draft)) return "业务规则草案已就绪";
  if (draft?.status === "clarifying") return "AI 已提出新的待确认问题";
  if (draft?.status === "simulated") return "内部试算已完成";
  return "结算规则会话已更新";
}

function waitForRetryDelay(milliseconds, signal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function safeWorkspaceError(error) {
  if (error instanceof CustomSettlementRuleApiError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    code: "CUSTOM_RULE_WORKSPACE_ERROR",
    message: "结算规则服务暂时不可用，请稍后重试",
    retryable: true,
  };
}

function recoveryKindForError(code, hasSession) {
  if (!hasSession) return null;
  if (CATALOG_SYNC_ERROR_CODES.has(code)) return "catalog_session";
  if (SESSION_SYNC_ERROR_CODES.has(code)) return "session";
  return null;
}

function scopeLabel(scope) {
  if (scope === "external_cost") return "项目成本";
  return scope === "receivable" ? "客户应收" : "主播应付";
}

function targetLabel(target, scope) {
  if (scope === "external_cost") return "当前项目成本";
  if (scope === "receivable" || target?.targetType === "project") {
    return scope === "receivable" ? "当前项目客户" : "当前项目主播";
  }
  return target?.targetType === "streamer_group" ? "当前主播分组" : "当前主播";
}

function executionGrainLabel(value) {
  const labels = {
    report: "按直播报告逐条计算",
    project_streamer_period: "按主播和周期汇总计算",
    batch: "按结算批次计算",
    project_period: "按项目周期汇总计算",
  };
  return labels[value] ?? "按业务周期计算";
}

function compositionModeLabel(value) {
  const labels = {
    replace: "替换现有基础规则",
    add: "在现有金额上增加",
    multiply: "按比例调整现有金额",
    clamp: "设置金额上下限",
    emit_items: "生成结算明细",
    check: "仅执行校验",
  };
  return labels[value] ?? "按已确认方式组合";
}

function missingDataLabel(policy) {
  if (policy?.action === "block_batch") return "阻断本批结算";
  if (policy?.action === "use_explicit_default") {
    return `使用明确默认值 ${formatTypedValue(policy.defaultValue)}`;
  }
  return "转人工复核";
}

function formatDate(value) {
  if (!value) return "长期有效";
  const date = String(value).slice(0, 10);
  return date || "未设置";
}

function formatYuan(value, nullLabel = "无历史数据") {
  if (value === undefined || value === "") return "服务端未提供";
  if (value === null) return nullLabel;
  const decimal =
    typeof value === "string" && /^-?(?:0|[1-9]\d*)\.\d{2}$/u.test(value)
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? value.toFixed(2)
        : null;
  if (!decimal) return "金额不可用";
  const negative = decimal.startsWith("-");
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole, fraction] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${negative ? "-" : ""}¥${grouped}.${fraction}`;
}

function formatSafeHundredths(value) {
  if (!Number.isSafeInteger(value)) return null;
  const integer = BigInt(value);
  const negative = integer < 0;
  const absolute = negative ? -integer : integer;
  const whole = absolute / BigInt(100);
  const fraction = String(absolute % BigInt(100)).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function safeBusinessText(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  if (
    text.length === 0 ||
    !/[\u3400-\u9fff]/u.test(text) ||
    /[A-Za-z_(){}]/u.test(text) ||
    text.includes("[") ||
    text.includes("]")
  ) {
    return fallback;
  }
  return text;
}

function safeBusinessQuestion(value) {
  const question = safeBusinessText(value, "请确认这项业务条件？");
  return /[?？]$/u.test(question) ? question : `${question}？`;
}

function safeBusinessUnit(value) {
  const units = new Set([
    "%",
    "个",
    "份",
    "元",
    "元/小时",
    "分钟",
    "天",
    "小时",
    "条",
    "次",
    "百分比",
  ]);
  return units.has(value) ? value : "业务单位";
}

function formatTypedValue(value) {
  if (!value || typeof value !== "object") return "未设置";
  if (value.type === "money_cents") {
    const yuan = formatSafeHundredths(value.amountCents);
    return yuan === null ? "金额不可用" : formatYuan(yuan);
  }
  if (value.type === "rate_bps") {
    const percent = formatSafeHundredths(value.rateBps);
    return percent === null ? "比例不可用" : `${percent}%`;
  }
  if (value.type === "boolean") return value.value ? "是" : "否";
  if (value.type === "timestamp") return formatDate(value.value);
  if (value.type === "array") return `${value.items.length} 项`;
  if (value.type === "object")
    return `${Object.keys(value.fields).length} 项组合值`;
  if (value.type === "string") return "已设置文本值";
  return String(value.value ?? "未设置");
}

function ambiguityFieldKeys(ambiguities) {
  const keys = new Set();
  for (const ambiguity of ambiguities ?? []) {
    const code = String(ambiguity.code ?? "").toLowerCase();
    if (code === CONFIRM_CONTRACT_AMBIGUITY) continue;
    let matched = false;
    if (/scope/u.test(code)) {
      keys.add("scope");
      matched = true;
    }
    if (/target|streamer|group/u.test(code)) {
      keys.add("target");
      matched = true;
    }
    if (/grain|frequency|unit/u.test(code)) {
      keys.add("executionGrain");
      matched = true;
    }
    if (/rate|price|amount|parameter|bonus|tier|floor|cap/u.test(code)) {
      keys.add("parameters");
      matched = true;
    }
    if (/input|source|evidence|data/u.test(code)) {
      keys.add("requiredInputs");
      matched = true;
    }
    if (/effective|period|date|start|end/u.test(code)) {
      keys.add("effectiveStartAt");
      keys.add("effectiveEndAt");
      matched = true;
    }
    if (/missing/u.test(code)) {
      keys.add("missingDataPolicy");
      matched = true;
    }
    if (/rule|definition|summary/u.test(code)) {
      keys.add("summary");
      matched = true;
    }
    if (!matched) keys.add("summary");
  }
  return keys;
}

function contractRows(contract) {
  return [
    { key: "scope", value: scopeLabel(contract.scope) },
    { key: "target", value: targetLabel(contract.target, contract.scope) },
    {
      key: "executionGrain",
      value: executionGrainLabel(contract.executionGrain),
    },
    {
      key: "compositionMode",
      value: compositionModeLabel(contract.compositionMode),
    },
    {
      key: "title",
      value: safeBusinessText(contract.title, "已确认业务规则"),
    },
    {
      key: "summary",
      value: safeBusinessText(contract.summary, "按已确认的业务条件计算"),
    },
    {
      key: "calculationComponents",
      value: contract.calculationComponents
        .map((item) =>
          safeBusinessText(item.description, "按已确认的业务条件计算"),
        )
        .join("；"),
    },
    {
      key: "requiredInputs",
      value: contract.requiredInputs
        .map(
          (item) =>
            `${safeBusinessText(item.description, "已确认业务输入")}（${safeBusinessText(item.source, "已授权业务数据")}，${safeBusinessUnit(item.userFacingUnit)}）`,
        )
        .join("；"),
    },
    {
      key: "parameters",
      value: contract.parameters
        .map(
          (item) =>
            `${safeBusinessText(item.description, "已确认业务参数")} ${formatTypedValue(item.defaultValue)}`,
        )
        .join("；"),
    },
    { key: "effectiveStartAt", value: formatDate(contract.effectiveStartAt) },
    { key: "effectiveEndAt", value: formatDate(contract.effectiveEndAt) },
    {
      key: "missingDataPolicy",
      value: missingDataLabel(contract.missingDataPolicy),
    },
    {
      key: "compositionDescription",
      value: safeBusinessText(
        contract.compositionDescription,
        "按已确认方式与现有规则组合",
      ),
    },
    { key: "businessTimezone", value: "已确认业务时区" },
    { key: "examples", value: `${contract.examples.length} 个已校验业务样例` },
  ];
}

function formatDiffValue(field, value) {
  if (field === "scope") return scopeLabel(value);
  if (field === "target") return targetLabel(value, "payable");
  if (field === "executionGrain") return executionGrainLabel(value);
  if (field === "compositionMode") return compositionModeLabel(value);
  if (field === "effectiveStartAt" || field === "effectiveEndAt") {
    return formatDate(value);
  }
  if (field === "businessTimezone") return "业务时区已调整";
  if (field === "missingDataPolicy") return missingDataLabel(value);
  if (field === "parameters" && Array.isArray(value)) {
    return value
      .map(
        (item) =>
          `${safeBusinessText(item.description, "已确认业务参数")} ${formatTypedValue(item.defaultValue)}`,
      )
      .join("；");
  }
  if (Array.isArray(value)) return `${value.length} 项`;
  if (value && typeof value === "object") return "业务对象已调整";
  return safeBusinessText(value, value == null ? "未设置" : "业务内容已调整");
}

function deterministicExplanation(contract) {
  const descriptions = contract.calculationComponents.map((component) =>
    safeBusinessText(component.description, "按已确认的业务条件计算"),
  );
  return `${descriptions.join("；")}。缺少数据时${missingDataLabel(contract.missingDataPolicy)}。`;
}

function businessChangeLabel(value) {
  const match = /^authorized_ordinal:(\d+)$/u.exec(String(value));
  if (match) {
    const ordinal = Number(match[1]);
    if (Number.isSafeInteger(ordinal) && ordinal > 0) {
      return `第 ${ordinal} 条变更`;
    }
  }
  return safeBusinessText(value, "一项业务变更");
}

function safeRiskMessage(message, kind) {
  return safeBusinessText(
    message,
    kind === "risk" ? "一项业务风险需复核" : "一项试算提醒需复核",
  );
}

function ContractView({ draft }) {
  const unresolved = ambiguityFieldKeys(draft.unresolvedAmbiguities);
  const contract = draft.businessContract;

  return (
    <div data-testid="business-contract" className="crw-contract-grid">
      {contractRows(contract).map((row) => {
        const isUnresolved = unresolved.has(row.key);
        return (
          <div
            key={row.key}
            data-testid={`contract-field-${row.key}`}
            data-unresolved={isUnresolved ? "true" : "false"}
            aria-label={`${CONTRACT_FIELD_LABELS[row.key]}${
              isUnresolved ? "，待确认" : ""
            }`}
            className={`crw-contract-field${isUnresolved ? " is-unresolved" : ""}`}
          >
            <div className="crw-field-label">
              <span>{CONTRACT_FIELD_LABELS[row.key]}</span>
              {isUnresolved ? (
                <span className="crw-pending">待确认</span>
              ) : null}
            </div>
            <div className="crw-field-value">{row.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function ExternalCostCatalogPanel({ catalog }) {
  const variables = Array.isArray(catalog?.variables) ? catalog.variables : [];
  if (!variables.length) return null;
  return (
    <section className="crw-band" aria-label="可用导入字段">
      <div className="crw-source-label">
        <Calculator size={15} aria-hidden="true" />
        可用导入字段
      </div>
      <div className="crw-import-fields">
        {variables.map((variable) => (
          <span key={variable.id} className="crw-chip">
            <span>{variable.id}</span>
            {variable.label ? <span> · {variable.label}</span> : null}
          </span>
        ))}
      </div>
      <p className="crw-muted">生成待审核项目成本</p>
    </section>
  );
}

function RevisionDiff({ diff }) {
  if (!diff?.length) return null;
  const changed = new Set(diff.map((item) => item.field));
  const unchanged = CONTRACT_FIELD_ORDER.filter((field) => !changed.has(field));

  return (
    <section className="crw-band crw-diff" role="region" aria-label="本轮修改">
      <h3>本轮修改</h3>
      <div className="crw-diff-list">
        {diff.map((item) => {
          const label = CONTRACT_FIELD_LABELS[item.field];
          const before = formatDiffValue(item.field, item.before);
          const after = formatDiffValue(item.field, item.after);
          return (
            <div
              key={item.field}
              className="crw-diff-row"
              role="group"
              aria-label={`${label}变更`}
            >
              <strong>{label}</strong>
              <span
                className="crw-before"
                role="group"
                aria-label={`修改前：${before}`}
              >
                {before}
              </span>
              <span aria-hidden="true">→</span>
              <span
                className="crw-after"
                role="group"
                aria-label={`修改后：${after}`}
              >
                {after}
              </span>
            </div>
          );
        })}
      </div>
      <p className="crw-preserved">
        保持不变：
        {unchanged.map((field) => CONTRACT_FIELD_LABELS[field]).join("、")}
      </p>
    </section>
  );
}

function previewAmountLabel(value) {
  if (value?.amountYuan !== undefined) return formatYuan(value.amountYuan);
  if (Number.isSafeInteger(value?.amountCents)) {
    return formatYuan(formatSafeHundredths(value.amountCents));
  }
  if (value?.amount !== undefined) return formatYuan(value.amount);
  return formatYuan(undefined);
}

function formatEvidenceRef(ref) {
  if (typeof ref === "string") {
    return ref.trim() || "evidence_ref";
  }
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
    return "evidence_ref";
  }
  const kind = typeof ref.kind === "string" && ref.kind.trim()
    ? ref.kind.trim()
    : "evidence_ref";
  const value =
    typeof ref.liveReportId === "string" && ref.liveReportId.trim()
      ? ref.liveReportId.trim()
      : typeof ref.reference === "string" && ref.reference.trim()
        ? ref.reference.trim()
        : typeof ref.level === "string" && ref.level.trim()
          ? ref.level.trim()
        : typeof ref.id === "string" && ref.id.trim()
          ? ref.id.trim()
          : null;
  return value ? `${kind}: ${value}` : kind;
}

function externalPreviewFrom(authority) {
  return (
    authority.summary?.externalCostPreview ??
    authority.simulation?.externalCostPreview ??
    authority.simulation?.summary?.externalCostPreview ??
    null
  );
}

function ExternalCostSimulationView({ authority, headingRef }) {
  const preview = externalPreviewFrom(authority);
  if (!preview) {
    return (
      <section
        className="crw-band crw-simulation"
        role="region"
        aria-label="内部试算"
      >
        <div className="crw-band-heading">
          <div>
            <h2 ref={headingRef} tabIndex={-1} data-focus-heading="result">
              内部试算结果
            </h2>
            <span className="crw-preview-status">项目成本预览</span>
          </div>
        </div>
        <p>项目成本预览暂不可用，请重新试算。</p>
      </section>
    );
  }

  const categoryEntries = Object.entries(preview.categoryTotals ?? {});
  const coverage = preview.sourceCoverage ?? {};
  const sampleRows = Array.isArray(preview.sampleRows) ? preview.sampleRows : [];
  const missingData = Array.isArray(preview.missingDataOutcomes)
    ? preview.missingDataOutcomes
    : [];
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  const sourceRule = preview.ruleSource ?? {};
  const totalCents = categoryEntries.reduce(
    (sum, [, total]) =>
      Number.isSafeInteger(total?.amountCents) ? sum + total.amountCents : sum,
    0,
  );
  const totalLabel = totalCents
    ? formatYuan(formatSafeHundredths(totalCents))
    : categoryEntries.length === 1
      ? previewAmountLabel(categoryEntries[0][1])
      : formatYuan(undefined);
  const ruleVersionLabel =
    sourceRule.ruleVersionId ??
    (sourceRule.versionNumber ? `v${sourceRule.versionNumber}` : "未提供");

  return (
    <section
      className="crw-band crw-simulation"
      role="region"
      aria-label="内部试算"
    >
      <div className="crw-band-heading">
        <div>
          <h2 ref={headingRef} tabIndex={-1} data-focus-heading="result">
            内部试算结果
          </h2>
          <span className="crw-preview-status">项目成本预览</span>
        </div>
        {preview.pendingReview ? (
          <span className="crw-no-history">待审核项目成本</span>
        ) : null}
      </div>

      <div className="crw-metrics">
        <div>
          <span>待审核项目成本</span>
          <strong>{preview.itemCount ?? 0} 项</strong>
        </div>
        <div>
          <span>发生成本合计</span>
          <strong>{totalLabel}</strong>
        </div>
        <div>
          <span>导入批次</span>
          <strong>{preview.importBatchId ?? "未提供"}</strong>
        </div>
        <div>
          <span>规则版本</span>
          <strong>{ruleVersionLabel}</strong>
        </div>
        <div>
          <span>覆盖行</span>
          <strong>
            {coverage.evaluatedRows ?? 0}/{coverage.totalRows ?? 0} 行
          </strong>
        </div>
        <div>
          <span>转复核行</span>
          <strong>{coverage.reviewRows ?? 0} 行</strong>
        </div>
      </div>

      <div className="crw-change-columns">
        <div>
          <h3>类别合计</h3>
          <ul>
            {categoryEntries.length ? (
              categoryEntries.map(([category, total]) => (
                <li key={category}>
                  <span>{category}</span>
                  <strong>{previewAmountLabel(total)}</strong>
                  <small>{total?.itemCount ?? 0} 项</small>
                </li>
              ))
            ) : (
              <li>暂无发生成本类别</li>
            )}
          </ul>
        </div>
        <div>
          <h3>来源与证据</h3>
          <ul>
            <li>
              <span>预览指纹</span>
              <strong>{preview.previewHash ?? "未提供"}</strong>
            </li>
            <li>
              <span>规则来源</span>
              <strong>{sourceRule.kind ?? "未提供"}</strong>
            </li>
            <li>
              <span>已发生成本行</span>
              <strong>{coverage.emittedRows ?? preview.itemCount ?? 0} 行</strong>
            </li>
          </ul>
        </div>
      </div>

      <div className="crw-risk-columns">
        <div>
          <h3>样本行</h3>
          {sampleRows.length ? (
            <ul>
              {sampleRows.map((row) => (
                <li key={`${row.rowIndex}-${row.status}`}>
                  第 {(row.rowIndex ?? 0) + 1} 行 · {row.status ?? "待审核"}
                  {(row.items ?? []).map((item, index) => (
                    <div key={`${item.category}-${index}`}>
                      <span>{item.category}</span>
                      <strong>{previewAmountLabel(item)}</strong>
                      <small>
                        {item.status ?? "pending_review"} ·{" "}
                        {item.evidenceLevel ?? "evidence"} ·{" "}
                        {item.ruleVersionId ?? ruleVersionLabel}
                      </small>
                      {item.sourceRefs ? (
                        <small>
                          {item.sourceRefs.sourceExecutionKey ?? "无执行引用"} ·{" "}
                          {item.sourceRefs.sourceInputHash ?? "无输入指纹"} ·{" "}
                          {item.sourceRefs.explanation ?? "无解释"}
                        </small>
                      ) : null}
                    </div>
                  ))}
                  {row.evidenceRefs?.length ? (
                    <small>
                      {row.evidenceRefs.map(formatEvidenceRef).join(" · ")}
                    </small>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>暂无样本行</p>
          )}
        </div>
        <div>
          <h3>待复核输入</h3>
          {missingData.length ? (
            <ul>
              {missingData.map((item, index) => (
                <li key={`${item.variableName}-${index}`}>
                  第 {(item.rowIndex ?? 0) + 1} 行 · {item.variableName} ·{" "}
                  {item.policy ?? "route_item_to_review"} ·{" "}
                  {item.outcome ?? "pending_review"}
                </li>
              ))}
            </ul>
          ) : warnings.length ? (
            <ul>
              {warnings.map((item, index) => (
                <li key={`${item.code}-${index}`}>
                  {item.code}: {safeRiskMessage(item.message, "warning")}
                </li>
              ))}
            </ul>
          ) : (
            <p>暂无待复核输入</p>
          )}
        </div>
      </div>
    </section>
  );
}

function SimulationView({ authority, headingRef }) {
  const scope = authority.draft.businessContract.scope;
  const summary = authority.summary;
  const persisted = authority.simulation;
  if (!summary && !persisted) return null;
  if (persisted?.version === 1 && !persisted.complete) {
    return (
      <section
        className="crw-band crw-simulation"
        role="region"
        aria-label="内部试算"
      >
        <div className="crw-band-heading">
          <div>
            <h2 ref={headingRef} tabIndex={-1} data-focus-heading="result">
              内部试算结果
            </h2>
            <span className="crw-preview-status">需要重新试算</span>
          </div>
        </div>
        <p>{persisted.message}</p>
      </section>
    );
  }
  if (scope === "external_cost") {
    return (
      <ExternalCostSimulationView authority={authority} headingRef={headingRef} />
    );
  }

  const currentAmount = summary
    ? summary.totalOldYuan
    : scope === "receivable"
      ? persisted.historicalTotals.receivableAmountYuan
      : persisted.historicalTotals.payableAmountYuan;
  const noHistory = summary
    ? summary.historicalVerification.status === "unverified"
    : currentAmount === null;
  const newAmount = summary?.totalNewYuan;
  const deltaAmount = summary
    ? summary.totalDeltaYuan
    : scope === "receivable"
      ? persisted.deltas.receivableAmountYuan
      : persisted.deltas.payableAmountYuan;
  const coverage = summary
    ? {
        totalCount: summary.coverage.totalCount,
        evaluatedCount: summary.coverage.evaluatedCount,
        ratePercent: summary.coverage.ratePercent,
      }
    : {
        totalCount: persisted.coverage.totalRecords,
        evaluatedCount: persisted.coverage.evaluatedRecords,
        ratePercent: null,
      };
  const increases = summary
    ? summary.largestIncreases
    : persisted.largestChanges
        .filter((item) => item.direction === "increase")
        .map((item) => ({
          bucket: item.key,
          deltaYuan: item.deltaAmountYuan,
        }));
  const decreases = summary
    ? summary.largestDecreases
    : persisted.largestChanges
        .filter((item) => item.direction === "decrease")
        .map((item) => ({
          bucket: item.key,
          deltaYuan: item.deltaAmountYuan,
        }));
  const warnings = summary?.warnings ?? persisted?.warnings ?? [];
  const verifiedHistoryLabel = noHistory
    ? null
    : summary?.historicalVerification.label;
  const countValue = (value) =>
    value === null || value === undefined ? "服务端未提供" : `${value} 条`;
  const largest = (items, emptyLabel) =>
    items?.length
      ? items.map((item, index) => (
          <li key={`${index}-${item.deltaYuan}`}>
            <span>{businessChangeLabel(item.bucket)}</span>
            <strong>{formatYuan(item.deltaYuan)}</strong>
          </li>
        ))
      : [<li key="empty">{emptyLabel}</li>];

  return (
    <section
      className="crw-band crw-simulation"
      role="region"
      aria-label="内部试算"
    >
      <div className="crw-band-heading">
        <div>
          <h2 ref={headingRef} tabIndex={-1} data-focus-heading="result">
            内部试算结果
          </h2>
          <span className="crw-preview-status">内部预览</span>
        </div>
        {noHistory ? (
          <span className="crw-no-history">无历史数据</span>
        ) : verifiedHistoryLabel ? (
          <span className="crw-history-verified">{verifiedHistoryLabel}</span>
        ) : null}
      </div>

      <div className="crw-metrics">
        <div>
          <span>当前金额</span>
          <strong>{formatYuan(currentAmount)}</strong>
        </div>
        <div>
          <span>新规则金额</span>
          <strong>{formatYuan(newAmount)}</strong>
        </div>
        <div>
          <span>差额</span>
          <strong>{noHistory ? "无历史对照" : formatYuan(deltaAmount)}</strong>
        </div>
        <div>
          <span>覆盖率</span>
          <strong>
            {coverage.ratePercent === null
              ? "服务端未提供"
              : `${coverage.ratePercent}%`}
          </strong>
          <small>
            {coverage.evaluatedCount}/{coverage.totalCount} 条
          </small>
        </div>
        <div>
          <span>零金额</span>
          <strong>{countValue(summary?.zeroPayCount)}</strong>
        </div>
        <div>
          <span>转人工复核</span>
          <strong>{countValue(summary?.reviewRoutedCount)}</strong>
        </div>
        <div>
          <span>阻止执行</span>
          <strong>{countValue(summary?.blockedCount)}</strong>
        </div>
      </div>

      <div className="crw-change-columns">
        <div>
          <h3>
            <TrendingUp size={15} aria-hidden="true" />
            最大增加
          </h3>
          <ul>{largest(increases, "无增加项")}</ul>
        </div>
        <div>
          <h3>
            <TrendingDown size={15} aria-hidden="true" />
            最大减少
          </h3>
          <ul>{largest(decreases, "无减少项")}</ul>
        </div>
      </div>

      <div className="crw-risk-columns">
        <div>
          <h3>风险</h3>
          {summary?.riskFlags?.length ? (
            <ul>
              {summary.riskFlags.map((item, index) => (
                <li key={index}>{safeRiskMessage(item.message, "risk")}</li>
              ))}
            </ul>
          ) : summary ? (
            <p>无新增风险</p>
          ) : (
            <p>服务端未提供</p>
          )}
        </div>
        <div>
          <h3>提醒</h3>
          {warnings.length ? (
            <ul>
              {warnings.map((item, index) => (
                <li key={index}>{safeRiskMessage(item.message, "warning")}</li>
              ))}
            </ul>
          ) : (
            <p>无新增提醒</p>
          )}
        </div>
      </div>
    </section>
  );
}

function WorkspaceStyles() {
  return (
    <style>{`
      .crw { width: 100%; min-width: 0; color: var(--ink-900, #172033); letter-spacing: 0; }
      .crw *, .crw *::before, .crw *::after { box-sizing: border-box; letter-spacing: 0; }
      .crw-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 0 14px; border-bottom: 1px solid var(--line, #e2e8f0); }
      .crw-title { margin: 0; font-size: 16px; line-height: 1.35; font-weight: 700; color: var(--ink-900, #172033); text-wrap: balance; }
      .crw-context { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 5px; font-size: 12px; color: var(--ink-500, #64748b); }
      .crw-refresh { width: 32px; height: 32px; flex: 0 0 32px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line-strong, #cbd5e1); border-radius: 6px; background: #fff; color: var(--ink-700, #334155); cursor: pointer; }
      .crw-refresh:hover { background: var(--ink-50, #f8fafc); }
      .crw-refresh:focus-visible, .crw button:focus-visible, .crw textarea:focus-visible, .crw summary:focus-visible { outline: 2px solid var(--blue-600, #2563eb); outline-offset: 2px; }
      .crw-refresh:disabled { cursor: not-allowed; opacity: .5; }
      .crw-scope { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--line, #e2e8f0); }
      .crw-scope-label { font-size: 12px; font-weight: 600; color: var(--ink-600, #475569); }
      .crw-segments { display: inline-flex; align-items: center; gap: 4px; padding: 3px; border-radius: 7px; background: var(--ink-50, #f1f5f9); }
      .crw-segments button { min-height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 11px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--ink-600, #475569); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
      .crw-segments button[aria-pressed="true"] { border-color: var(--line-strong, #cbd5e1); background: #fff; color: var(--blue-700, #1d4ed8); }
      .crw-history { font-size: 12px; color: var(--ink-500, #64748b); }
      .crw-history.no-history { color: var(--amber-700, #a16207); font-weight: 600; }
      .crw-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 0 0; border-bottom: 1px solid var(--line, #e2e8f0); }
      .crw-tabs button { min-height: 34px; padding: 0 12px; border: 1px solid transparent; border-bottom: 0; border-radius: 6px 6px 0 0; background: transparent; color: var(--ink-600, #475569); font-size: 12px; font-weight: 700; cursor: pointer; }
      .crw-tabs button[aria-selected="true"] { border-color: var(--line, #e2e8f0); background: #fff; color: var(--blue-700, #1d4ed8); }
      .crw-band { padding: 18px 0; border-bottom: 1px solid var(--line, #e2e8f0); }
      .crw-band h2, .crw-band h3 { margin: 0; color: var(--ink-900, #172033); text-wrap: balance; }
      .crw-band h2 { font-size: 15px; line-height: 1.4; }
      .crw-band h3 { font-size: 13px; line-height: 1.4; }
      .crw-ai { display: grid; grid-template-columns: minmax(0, .9fr) minmax(280px, 1.6fr); gap: 18px; align-items: start; }
      .crw-ai-copy { max-width: 70ch; font-size: 13px; line-height: 1.7; color: var(--ink-700, #334155); }
      .crw-source-label { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 12px; font-weight: 700; color: var(--blue-700, #1d4ed8); }
      .crw-question { padding: 14px; border-radius: 7px; background: var(--blue-50, #eff6ff); }
      .crw-question h2 { font-size: 16px; }
      .crw-contract-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; min-width: 0; }
      .crw-contract-field { min-width: 0; min-height: 74px; padding: 10px 12px; border-radius: 6px; background: var(--ink-50, #f8fafc); }
      .crw-contract-field.is-unresolved { background: var(--amber-50, #fffbeb); box-shadow: inset 0 0 0 1px var(--amber-300, #fcd34d); }
      .crw-field-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; font-size: 11px; font-weight: 600; color: var(--ink-500, #64748b); }
      .crw-field-value { overflow-wrap: anywhere; font-size: 12.5px; line-height: 1.55; color: var(--ink-800, #1e293b); }
      .crw-pending { flex: 0 0 auto; color: var(--amber-800, #92400e); }
      .crw-engine { padding: 14px; border-radius: 7px; background: var(--green-50, #ecfdf5); color: var(--green-900, #14532d); }
      .crw-engine .crw-source-label { color: var(--green-800, #166534); }
      .crw-engine p { margin: 0; max-width: 75ch; font-size: 13px; line-height: 1.7; }
      .crw-advanced { margin-top: 12px; border-top: 1px dashed var(--line-strong, #cbd5e1); }
      .crw-advanced summary { display: flex; align-items: center; gap: 7px; width: max-content; max-width: 100%; padding: 11px 0 0; color: var(--ink-600, #475569); font-size: 12px; font-weight: 600; cursor: pointer; }
      .crw-advanced pre { max-width: 100%; overflow: auto; margin: 10px 0 0; padding: 12px; border-radius: 6px; background: #111827; color: #e5e7eb; font-size: 11px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
      .crw-diff { background: var(--ink-50, #f8fafc); padding-left: 14px; padding-right: 14px; }
      .crw-diff-list { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
      .crw-diff-row { display: grid; grid-template-columns: minmax(100px, .55fr) minmax(0, 1fr) auto minmax(0, 1fr); gap: 9px; align-items: start; font-size: 12px; line-height: 1.55; }
      .crw-before { color: var(--ink-500, #64748b); text-decoration: line-through; overflow-wrap: anywhere; }
      .crw-after { color: var(--ink-900, #172033); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
      .crw-preserved { margin: 10px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--ink-500, #64748b); }
      .crw-band-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .crw-band-heading > div { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
      .crw-preview-status, .crw-no-history, .crw-history-verified { display: inline-flex; align-items: center; min-height: 22px; padding: 1px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; }
      .crw-preview-status { background: var(--blue-50, #eff6ff); color: var(--blue-700, #1d4ed8); }
      .crw-no-history { background: var(--amber-50, #fffbeb); color: var(--amber-800, #92400e); }
      .crw-history-verified { background: var(--green-50, #ecfdf5); color: var(--green-800, #166534); }
      .crw-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin-top: 14px; background: var(--line, #e2e8f0); }
      .crw-metrics > div { min-width: 0; min-height: 78px; display: flex; flex-direction: column; justify-content: center; gap: 3px; padding: 10px 12px; background: #fff; }
      .crw-metrics span, .crw-metrics small { font-size: 11px; color: var(--ink-500, #64748b); }
      .crw-metrics strong { overflow-wrap: anywhere; font-size: 15px; line-height: 1.35; color: var(--ink-900, #172033); }
      .crw-change-columns, .crw-risk-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 16px; }
      .crw-change-columns h3 { display: flex; align-items: center; gap: 6px; }
      .crw-change-columns ul, .crw-risk-columns ul { list-style: none; margin: 8px 0 0; padding: 0; }
      .crw-change-columns li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--line, #e2e8f0); font-size: 12px; color: var(--ink-700, #334155); }
      .crw-risk-columns li, .crw-risk-columns p { margin: 7px 0 0; font-size: 12px; line-height: 1.55; color: var(--ink-600, #475569); }
      .crw-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--line, #e2e8f0); }
      .crw-panel-heading.compact { padding: 14px 0 8px; }
      .crw-panel-heading h2, .crw-submit-state h2 { margin: 0; font-size: 15px; line-height: 1.4; color: var(--ink-900, #172033); }
      .crw-panel-heading h3 { margin: 0; font-size: 13px; line-height: 1.4; }
      .crw-panel-heading p, .crw-muted { margin: 4px 0 0; font-size: 12px; line-height: 1.55; color: var(--ink-500, #64748b); }
      .crw-submit-state { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--line, #e2e8f0); }
      .crw-version-list, .crw-template-list, .crw-group-list { display: grid; gap: 1px; margin: 12px 0; background: var(--line, #e2e8f0); }
      .crw-version-row, .crw-template-row, .crw-group-row { min-width: 0; display: grid; gap: 8px; padding: 12px; background: #fff; }
      .crw-version-row { grid-template-columns: minmax(120px, .35fr) minmax(0, 1fr); align-items: center; }
      .crw-version-row > div { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .crw-version-row strong, .crw-template-row strong, .crw-group-row strong { color: var(--ink-900, #172033); font-size: 13px; line-height: 1.4; }
      .crw-version-row span, .crw-chip { display: inline-flex; align-items: center; width: max-content; max-width: 100%; min-height: 22px; padding: 1px 7px; border-radius: 6px; background: var(--ink-50, #f8fafc); color: var(--ink-600, #475569); font-size: 11px; font-weight: 700; }
      .crw-version-row p, .crw-template-row p, .crw-group-row p { margin: 0; font-size: 12px; line-height: 1.55; color: var(--ink-600, #475569); overflow-wrap: anywhere; }
      .crw-template-row { grid-template-columns: minmax(180px, 1fr) minmax(180px, .65fr) auto; align-items: center; }
      .crw-template-row dl, .crw-group-row dl, .crw-review-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 10px; margin: 0; font-size: 12px; line-height: 1.45; }
      .crw-template-row dt, .crw-group-row dt, .crw-review-facts dt { color: var(--ink-500, #64748b); }
      .crw-template-row dd, .crw-group-row dd, .crw-review-facts dd { margin: 0; color: var(--ink-800, #1e293b); overflow-wrap: anywhere; }
      .crw-template-row button, .crw-group-form button, .crw-action-row button, .crw-force-review button { min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 11px; border: 1px solid var(--line-strong, #cbd5e1); border-radius: 6px; background: #fff; color: var(--ink-700, #334155); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
      .crw-template-row button:disabled, .crw-group-form button:disabled, .crw-action-row button:disabled, .crw-force-review button:disabled { cursor: not-allowed; opacity: .55; }
      .crw-reuse details { margin: 0 0 10px; border-bottom: 1px dashed var(--line-strong, #cbd5e1); }
      .crw-reuse summary { width: max-content; max-width: 100%; padding: 8px 0; color: var(--ink-600, #475569); font-size: 12px; font-weight: 700; cursor: pointer; }
      .crw-reuse pre { max-width: 100%; overflow: auto; margin: 0 0 10px; padding: 10px; border-radius: 6px; background: #111827; color: #e5e7eb; font-size: 11px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
      .crw-draft-result { padding: 12px 0; border-top: 1px solid var(--line, #e2e8f0); }
      .crw-draft-result h2 { margin: 0; font-size: 14px; }
      .crw-draft-result p { margin: 4px 0 0; font-size: 12px; color: var(--ink-600, #475569); }
      .crw-inline-alert { display: flex; align-items: flex-start; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--line, #e2e8f0); color: var(--danger-700, #b91c1c); font-size: 12px; line-height: 1.5; }
      .crw-group-row { grid-template-columns: minmax(180px, 1fr) minmax(240px, .8fr); align-items: start; }
      .crw-group-row strong { display: inline-flex; align-items: center; gap: 6px; }
      .crw-group-form { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; align-items: end; padding: 14px 0; border-top: 1px solid var(--line, #e2e8f0); }
      .crw-group-form label, .crw-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 12px; font-weight: 700; color: var(--ink-700, #334155); }
      .crw-group-form input, .crw-group-form select, .crw-field input, .crw-field textarea { width: 100%; min-height: 34px; padding: 7px 9px; border: 1px solid var(--line-strong, #cbd5e1); border-radius: 6px; background: #fff; color: var(--ink-900, #172033); font: inherit; font-size: 12px; line-height: 1.45; }
      .crw-field textarea { min-height: 72px; resize: vertical; }
      .crw-review-dialog { padding: 0; color: var(--ink-900, #172033); }
      .crw-review-facts { padding: 12px 0; border-bottom: 1px solid var(--line, #e2e8f0); }
      .crw-action-row { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 0; }
      .crw-force-review { padding: 12px 0; border-top: 1px solid var(--danger-200, #fecaca); }
      .crw-force-review h3 { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--danger-700, #b91c1c); font-size: 13px; }
      .crw-force-review p { margin: 5px 0 10px; font-size: 12px; color: var(--danger-700, #b91c1c); }
      .crw-empty, .crw-error { display: flex; align-items: flex-start; gap: 10px; padding: 16px 0; border-bottom: 1px solid var(--line, #e2e8f0); }
      .crw-empty h2, .crw-error h2 { margin: 0; font-size: 14px; }
      .crw-empty p, .crw-error p { margin: 4px 0 0; font-size: 12px; color: var(--ink-600, #475569); }
      .crw-error { color: var(--danger-700, #b91c1c); }
      .crw-processing { display: flex; align-items: flex-start; gap: 10px; padding: 16px 0; border-bottom: 1px solid var(--line, #e2e8f0); color: var(--blue-700, #1d4ed8); }
      .crw-processing h2 { margin: 0; font-size: 14px; color: var(--ink-900, #172033); }
      .crw-processing p { margin: 4px 0 0; font-size: 12px; color: var(--ink-600, #475569); }
      .crw-loading { display: grid; gap: 8px; padding: 16px 0; border-bottom: 1px solid var(--line, #e2e8f0); }
      .crw-loading span { height: 10px; border-radius: 4px; background: var(--ink-100, #e2e8f0); animation: crw-pulse 1.2s ease-in-out infinite; }
      .crw-loading span:nth-child(2) { width: 72%; }
      .crw-loading span:nth-child(3) { width: 48%; }
      .crw-compose { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; padding: 16px 0 2px; }
      .crw-compose label { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 12px; font-weight: 600; color: var(--ink-700, #334155); }
      .crw-compose textarea { width: 100%; min-height: 78px; max-height: 180px; resize: vertical; padding: 9px 10px; border: 1px solid var(--line-strong, #cbd5e1); border-radius: 6px; background: #fff; color: var(--ink-900, #172033); font: inherit; font-size: 13px; line-height: 1.5; }
      .crw-primary { min-width: 152px; height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 14px; border: 1px solid var(--blue-600, #2563eb); border-radius: 6px; background: var(--blue-600, #2563eb); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
      .crw-primary:hover:not(:disabled) { background: var(--blue-700, #1d4ed8); }
      .crw-primary:disabled { cursor: not-allowed; opacity: .55; }
      .crw-status { min-height: 18px; margin-top: 6px; font-size: 11px; color: var(--ink-500, #64748b); }
      @keyframes crw-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
      @media (max-width: 760px) {
        .crw-header, .crw-scope { align-items: stretch; flex-direction: column; }
        .crw-header { position: relative; padding-right: 42px; }
        .crw-refresh { position: absolute; top: 16px; right: 0; }
        .crw-segments { width: 100%; }
        .crw-segments button { flex: 1 1 0; min-width: 0; }
        .crw-ai, .crw-change-columns, .crw-risk-columns { grid-template-columns: minmax(0, 1fr); }
        .crw-contract-grid { grid-template-columns: minmax(0, 1fr); }
        .crw-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .crw-version-row, .crw-template-row, .crw-group-row, .crw-group-form { grid-template-columns: minmax(0, 1fr); }
        .crw-diff-row { grid-template-columns: minmax(90px, .55fr) minmax(0, 1fr); }
        .crw-diff-row > span[aria-hidden="true"] { display: none; }
        .crw-after { grid-column: 2; }
        .crw-compose { grid-template-columns: minmax(0, 1fr); }
        .crw-primary { width: 100%; }
      }
      @media (prefers-reduced-motion: reduce) {
        .crw-loading span { animation: none; opacity: .75; }
      }
    `}</style>
  );
}

export default function CustomSettlementRuleWorkspace({
  project,
  period,
  target,
  api,
  currentUser = { id: null, role: "operator_business" },
  templates: providedTemplates = EMPTY_TEMPLATES,
  createUuid = defaultUuid,
  createRequestId = defaultRequestId,
  retryPollDelayMs = 250,
  retryPollMaxAttempts = 3,
}) {
  const templates = providedTemplates ?? EMPTY_TEMPLATES;
  const apiClient = React.useMemo(
    () => api ?? createCustomSettlementRuleApi(),
    [api],
  );
  const metadataApiClient = React.useMemo(
    () => api ?? createCustomSettlementRuleApi(),
    [api],
  );
  const projectId = project?.id ?? "";
  const projectName = project?.name ?? "";
  const periodStart = period?.start ?? "";
  const periodEnd = period?.end ?? "";
  const [draftInputState, setDraftInputState] = React.useState({
    contextKey: null,
    value: "",
  });
  const [selectedScope, setSelectedScope] = React.useState("receivable");
  const [selectedTarget, setSelectedTarget] = React.useState(() =>
    normalizeTarget(target),
  );
  const [activeSession, setActiveSession] = React.useState({
    contextKey: null,
    id: null,
  });
  const [activePane, setActivePane] = React.useState("build");
  const [requestState, setRequestState] = React.useState(freshRequestState);
  const [governanceState, setGovernanceState] = React.useState(
    INITIAL_GOVERNANCE_STATE,
  );
  const [reviewDialog, setReviewDialog] = React.useState({
    open: false,
    rule: null,
    error: null,
  });
  const requestSequenceRef = React.useRef(0);
  const requestControllerRef = React.useRef(null);
  const governanceSequenceRef = React.useRef(0);
  const statusHeadingRef = React.useRef(null);
  const questionHeadingRef = React.useRef(null);
  const resultHeadingRef = React.useRef(null);
  const errorHeadingRef = React.useRef(null);
  const progressHeadingRef = React.useRef(null);

  const validContext = contextIsValid(
    { id: projectId },
    { start: periodStart, end: periodEnd },
  );
  const executionGrain = scopeOption(selectedScope).executionGrain;
  const workspaceContextKey = JSON.stringify([
    projectId,
    periodStart,
    periodEnd,
    selectedScope,
    selectedTarget.targetType,
    selectedTarget.targetId,
  ]);
  const contextMatches = requestState.contextKey === workspaceContextKey;
  const viewState = contextMatches
    ? requestState
    : {
        ...INITIAL_REQUEST_STATE,
        catalogStatus: validContext ? "loading" : "idle",
      };
  const governanceView =
    governanceState.contextKey === workspaceContextKey
      ? governanceState
      : INITIAL_GOVERNANCE_STATE;
  const draftInput =
    draftInputState.contextKey === workspaceContextKey
      ? draftInputState.value
      : "";
  const activeSessionId =
    activeSession.contextKey === workspaceContextKey ? activeSession.id : null;
  const maximumPollAttempts =
    Number.isSafeInteger(retryPollMaxAttempts) && retryPollMaxAttempts > 0
      ? Math.min(retryPollMaxAttempts, 10)
      : 3;
  const pollDelay =
    Number.isFinite(retryPollDelayMs) && retryPollDelayMs >= 0
      ? Math.min(retryPollDelayMs, 5_000)
      : 250;

  const loadCatalog = React.useCallback(() => {
    const sequence = ++requestSequenceRef.current;
    requestControllerRef.current?.abort();
    apiClient.abortActive?.();

    if (!validContext) return null;

    const controller = new AbortController();
    requestControllerRef.current = controller;

    apiClient
      .getVariableCatalog({
        projectId,
        scope: selectedScope,
        executionGrain,
        signal: controller.signal,
      })
      .then((payload) => {
        if (sequence !== requestSequenceRef.current) return;
        if (
          payload.catalog.scope !== selectedScope ||
          payload.catalog.executionGrain !== executionGrain
        ) {
          throw new CustomSettlementRuleApiError({
            code: "CUSTOM_RULE_RESPONSE_INVALID",
            status: 200,
            retryable: true,
            message: "结算规则服务返回了无法识别的响应",
          });
        }
        if (!catalogTimezoneReady(payload.catalog)) {
          setRequestState({
            ...freshRequestState(),
            contextKey: workspaceContextKey,
            catalogStatus: "timezone_error",
            catalog: payload.catalog,
            error: {
              code: "CUSTOM_RULE_TIMEZONE_UNRESOLVED",
              message: "请先确认项目业务时区后再开始",
              retryable: true,
            },
            announcement: "业务时区待确认",
            focusTarget: "error",
          });
          return;
        }
        setRequestState({
          ...freshRequestState(),
          contextKey: workspaceContextKey,
          catalogStatus: "ready",
          catalog: payload.catalog,
          announcement: "业务范围已就绪",
        });
      })
      .catch((error) => {
        if (
          error?.name === "AbortError" ||
          sequence !== requestSequenceRef.current
        ) {
          return;
        }
        const safeError = safeWorkspaceError(error);
        setRequestState({
          ...freshRequestState(),
          contextKey: workspaceContextKey,
          catalogStatus: "error",
          catalog: null,
          error: safeError,
          announcement: "业务范围读取失败",
          focusTarget: "error",
        });
      });

    return controller;
  }, [
    apiClient,
    executionGrain,
    projectId,
    selectedScope,
    validContext,
    workspaceContextKey,
  ]);

  React.useEffect(() => {
    const controller = loadCatalog();
    return () => controller?.abort();
  }, [loadCatalog]);

  React.useEffect(
    () => () => {
      requestSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      apiClient.abortActive?.();
    },
    [apiClient],
  );

  React.useLayoutEffect(() => {
    const targetRef =
      viewState.focusTarget === "status"
        ? statusHeadingRef
        : viewState.focusTarget === "question"
        ? questionHeadingRef
        : viewState.focusTarget === "error"
          ? errorHeadingRef
          : viewState.focusTarget === "progress"
            ? progressHeadingRef
            : viewState.focusTarget === "result"
              ? resultHeadingRef
              : null;
    targetRef?.current?.focus();
  }, [
    viewState.focusTarget,
    viewState.announcement,
    viewState.authoritative?.draft?.id,
    viewState.authoritative?.draft?.revisionNumber,
    viewState.status,
  ]);

  React.useEffect(() => {
    const sequence = ++governanceSequenceRef.current;
    if (!validContext) {
      return undefined;
    }
    const controller = new AbortController();
    const canLoadVersions = typeof metadataApiClient.listRuleVersions === "function";
    const canLoadReviews =
      typeof metadataApiClient.listRuleReviewEvents === "function";
    const canLoadGroups =
      typeof metadataApiClient.listSettlementRuleGroups === "function";
    const canLoadTemplates =
      typeof metadataApiClient.listRuleTemplates === "function";
    const canLoadLatestSession =
      typeof metadataApiClient.getLatestProjectRuleSession === "function";
    if (
      !canLoadVersions &&
      !canLoadReviews &&
      !canLoadGroups &&
      !canLoadTemplates &&
      !canLoadLatestSession
    ) {
      return () => controller.abort();
    }
    const optionalGovernanceCall = (promise, fallback) =>
      promise.catch((error) => {
        if (error?.name === "AbortError") throw error;
        return { ...fallback, [OPTIONAL_GOVERNANCE_FAILURE]: true };
      });
    const versionsRequest = canLoadVersions
      ? metadataApiClient.listRuleVersions({
          projectId,
          signal: controller.signal,
        })
      : Promise.resolve({ rules: [] });
    const reviewsRequest = canLoadReviews
      ? versionsRequest.then((rulesPayload) =>
          Promise.all(
            rulesPayload.rules.map((rule) =>
              optionalGovernanceCall(
                metadataApiClient.listRuleReviewEvents({
                  projectId,
                  ruleVersionId: rule.id,
                  signal: controller.signal,
                }),
                { events: [] },
              ),
            ),
          ).then((reviewPayloads) => ({
            events: reviewPayloads.flatMap((payload) => payload.events),
          })),
        )
      : Promise.resolve({ events: [] });
    Promise.all([
      versionsRequest,
      canLoadGroups
        ? metadataApiClient.listSettlementRuleGroups({
            projectId,
            signal: controller.signal,
          })
        : Promise.resolve({ groups: [] }),
      reviewsRequest,
      canLoadTemplates
        ? metadataApiClient.listRuleTemplates({ signal: controller.signal })
        : Promise.resolve({ templates }),
      canLoadLatestSession
        ? optionalGovernanceCall(
            metadataApiClient.getLatestProjectRuleSession({
              projectId,
              scope: selectedScope,
              target: selectedTarget,
              signal: controller.signal,
            }),
            { session: null },
          )
        : Promise.resolve({ session: null }),
    ])
      .then(([rulesPayload, groupsPayload, reviewsPayload, templatesPayload, sessionPayload]) => {
        if (sequence !== governanceSequenceRef.current) return;
        const safeGroupsPayload = Array.isArray(groupsPayload?.groups)
          ? groupsPayload
          : { groups: [] };
        if (sessionPayload.session) {
          setActiveSession({
            contextKey: workspaceContextKey,
            id: sessionPayload.session.conversation.id,
          });
          setRequestState((current) => ({
            ...(current.contextKey === workspaceContextKey
              ? current
              : freshRequestState()),
            contextKey: workspaceContextKey,
            status: "ready",
            operation: null,
            lastOperation: null,
            authoritative: authorityFromSession(sessionPayload.session),
            announcement: "规则会话已恢复",
            focusTarget: null,
          }));
        }
        setGovernanceState((current) => ({
          contextKey: workspaceContextKey,
          status: "ready",
          versions:
            rulesPayload.rules.length > 0 ||
            current.contextKey !== workspaceContextKey
              ? rulesPayload.rules
              : current.versions,
          reviews: reviewsPayload.events,
          groups:
            safeGroupsPayload.groups.length > 0 ||
            current.contextKey !== workspaceContextKey
              ? safeGroupsPayload.groups
              : current.groups,
          templates: templatesPayload.templates,
          announcement: "版本与分组已同步",
          error: null,
        }));
      })
      .catch((error) => {
        if (
          error?.name === "AbortError" ||
          sequence !== governanceSequenceRef.current
        ) {
          return;
        }
        setGovernanceState({
          contextKey: workspaceContextKey,
          status: "error",
          versions: [],
          reviews: [],
          groups: [],
          templates: [],
          announcement: "版本与分组同步失败",
          error: safeWorkspaceError(error),
        });
      });
    return () => controller.abort();
  }, [
    metadataApiClient,
    projectId,
    selectedScope,
    selectedTarget,
    templates,
    validContext,
    workspaceContextKey,
  ]);

  const performOperation = async (operation, { retry = false } = {}) => {
    if (!validContext || viewState.catalogStatus !== "ready") return;
    const currentDraft = viewState.authoritative?.draft ?? null;
    const sessionId = activeSessionId ?? currentDraft?.conversationId ?? null;
    if (operation !== "start" && !sessionId) return;

    requestControllerRef.current?.abort();
    apiClient.abortActive?.();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    const clientRequestId =
      retry && viewState.requestId
        ? viewState.requestId
        : createRequestId(operation);
    let recoverySessionId = sessionId;

    const showProcessing = (authority, nextSessionId) => {
      const visibleAuthority =
        authority?.draft?.status === "superseded" ? null : authority;
      setActiveSession({ contextKey: workspaceContextKey, id: nextSessionId });
      setRequestState((current) => ({
        ...(current.contextKey === workspaceContextKey
          ? current
          : freshRequestState()),
        contextKey: workspaceContextKey,
        status: "processing",
        operation: "refresh",
        lastOperation: "refresh",
        authoritative:
          visibleAuthority ??
          (current.authoritative?.draft?.status === "superseded"
            ? null
            : current.authoritative) ??
          null,
        error: null,
        recovery: null,
        announcement: "AI 正在处理",
        focusTarget: "progress",
      }));
    };

    const resolveAuthoritativeSession = async (
      nextSessionId,
      firstSession = null,
    ) => {
      let session = firstSession;
      let refreshesUsed = firstSession ? 1 : 0;

      while (true) {
        const authority = session ? authorityFromSession(session) : null;
        if (authority && !authorityHasValidTerminalShape(authority)) {
          throw invalidAuthorityError();
        }
        if (authority && !authorityNeedsRefresh(authority)) return authority;
        if (refreshesUsed >= maximumPollAttempts) {
          throw new CustomSettlementRuleApiError({
            code: "CUSTOM_RULE_PROCESSING_TIMEOUT",
            status: 0,
            retryable: true,
            message: "处理尚未完成，请刷新查看最新状态",
          });
        }

        showProcessing(authority, nextSessionId);
        await waitForRetryDelay(
          refreshesUsed === 0 ? 0 : pollDelay * refreshesUsed,
          controller.signal,
        );
        const refreshed = await apiClient.refreshSession({
          projectId,
          sessionId: nextSessionId,
          signal: controller.signal,
        });
        if (sequence !== requestSequenceRef.current) return null;
        session = refreshed.session;
        refreshesUsed += 1;
      }
    };

    setRequestState((current) => ({
      ...(current.contextKey === workspaceContextKey
        ? current
        : freshRequestState()),
      contextKey: workspaceContextKey,
      status: "loading",
      operation,
      lastOperation: operation,
      requestId: clientRequestId,
      error: null,
      recovery: null,
      announcement:
        operation === "confirm" ? "正在运行内部试算" : "正在更新业务规则",
      focusTarget: null,
    }));

    try {
      let payload;
      if (operation === "start") {
        const businessTimezone = viewState.catalog.businessTimezone;
        const effectiveStartAt = businessDateBoundary(
          periodStart,
          businessTimezone,
        );
        payload = await apiClient.startSession({
          projectId,
          body: {
            title: `${projectName || "当前项目"}${scopeLabel(selectedScope)}规则`,
            clientRequestId,
            promptText: draftInput.trim(),
            seedContract: createSeedContract({
              scope: selectedScope,
              target: selectedTarget,
              projectName,
              effectiveStartAt,
              businessTimezone,
            }),
            initialAmbiguities: [
              {
                code: "rule_definition",
                question: "这条规则最主要的计算条件是什么？",
                required: true,
              },
            ],
          },
          signal: controller.signal,
        });
      } else if (operation === "answer") {
        payload = await apiClient.answerOrRevise({
          projectId,
          sessionId,
          body: {
            expectedDraftId: currentDraft.id,
            expectedRevisionNumber: currentDraft.revisionNumber,
            clientRequestId,
            promptText: draftInput.trim(),
          },
          signal: controller.signal,
        });
      } else if (operation === "confirm") {
        payload = await apiClient.confirmAndSimulate({
          projectId,
          sessionId,
          body: {
            expectedDraftId: currentDraft.id,
            expectedRevisionNumber: currentDraft.revisionNumber,
            clientRequestId,
            promptText: "确认当前业务规则并进行内部试算",
            contractConfirmed: true,
            expectedContractHash: currentDraft.contractHash,
            expectedCatalogVersion: currentDraft.variableCatalogVersion,
            ...(currentDraft.formulaHash
              ? { expectedFormulaHash: currentDraft.formulaHash }
              : {}),
            simulationSelection: {
              periodStart,
              periodEnd,
              criteriaCodes: [
                "approved_reports",
                "period_overlap",
                "complete_evidence",
                "project_scope",
              ],
            },
          },
          signal: controller.signal,
        });
      } else {
        payload = await apiClient.refreshSession({
          projectId,
          sessionId,
          signal: controller.signal,
        });
      }

      if (sequence !== requestSequenceRef.current) return;

      let authority;
      let nextSessionId = sessionId;
      if (operation === "refresh") {
        nextSessionId = payload.session.conversation.id;
        recoverySessionId = nextSessionId;
        authority = await resolveAuthoritativeSession(
          nextSessionId,
          payload.session,
        );
      } else {
        const result = payload.result;
        nextSessionId = result.conversationId;
        recoverySessionId = nextSessionId;
        if (result.kind === "retry_in_progress") {
          authority = await resolveAuthoritativeSession(nextSessionId);
        } else if (result.draft?.status === "superseded") {
          authority = await resolveAuthoritativeSession(nextSessionId);
        } else {
          authority = authorityFromResult(
            result,
            operation === "start" ? payload.session : null,
          );
        }
      }

      if (sequence !== requestSequenceRef.current || !authority) return;
      if (!authorityHasValidTerminalShape(authority))
        throw invalidAuthorityError();

      setActiveSession({ contextKey: workspaceContextKey, id: nextSessionId });
      if (operation !== "refresh") {
        setDraftInputState({ contextKey: workspaceContextKey, value: "" });
      }
      setRequestState((current) => ({
        ...(current.contextKey === workspaceContextKey
          ? current
          : freshRequestState()),
        contextKey: workspaceContextKey,
        status: "ready",
        operation: null,
        lastOperation: null,
        requestId: null,
        authoritative: authority,
        error: null,
        recovery: null,
        announcement: completionAnnouncement(authority),
        focusTarget: focusTargetForAuthority(authority),
      }));
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        sequence !== requestSequenceRef.current
      ) {
        return;
      }
      const safeError = safeWorkspaceError(error);
      const recovery = recoveryKindForError(
        safeError.code,
        Boolean(recoverySessionId),
      );
      const retryOperation =
        safeError.code === "CUSTOM_RULE_PROCESSING_TIMEOUT"
          ? "refresh"
          : recovery
            ? null
            : operation;
      if (recovery && recoverySessionId) {
        setActiveSession({
          contextKey: workspaceContextKey,
          id: recoverySessionId,
        });
      }
      setRequestState((current) => ({
        ...(current.contextKey === workspaceContextKey
          ? current
          : freshRequestState()),
        contextKey: workspaceContextKey,
        status: "error",
        operation: null,
        lastOperation: retryOperation,
        error: safeError,
        recovery,
        announcement:
          safeError.code === "CUSTOM_RULE_PROCESSING_TIMEOUT"
            ? "AI 仍在处理"
            : "请求未完成",
        focusTarget: "error",
      }));
    }
  };

  const submitCurrentSimulationForReview = async (sourceRule = null) => {
    if (
      !validContext ||
      viewState.catalogStatus !== "ready" ||
      typeof apiClient.applyAndSubmitRule !== "function"
    ) {
      return;
    }
    const savedDraft =
      sourceRule?.status === "draft" &&
      sourceRule?.primaryAction?.action === "apply_and_submit"
        ? sourceRule
        : null;
    const currentDraft = viewState.authoritative?.draft ?? null;
    const currentSimulation = viewState.authoritative?.simulation ?? null;
    if (!savedDraft && (currentDraft?.status !== "simulated" || !currentSimulation?.id)) {
      return;
    }
    if (savedDraft && !savedDraft.simulationId) return;

    requestControllerRef.current?.abort();
    apiClient.abortActive?.();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    const clientRequestId = createRequestId("submit_review");
    const destinationVersionId = createUuid();
    const destinationSimulationId = createUuid();

    setRequestState((current) => ({
      ...(current.contextKey === workspaceContextKey
        ? current
        : freshRequestState()),
      contextKey: workspaceContextKey,
      status: "loading",
      operation: "submit_review",
      lastOperation: "submit_review",
      requestId: clientRequestId,
      error: null,
      recovery: null,
      announcement: "正在提交审核",
      focusTarget: null,
    }));

    try {
      const contract = savedDraft
        ? { scope: savedDraft.scope, target: savedDraft.target }
        : currentDraft.businessContract;
      const source = savedDraft
        ? { kind: "saved_draft", id: savedDraft.id }
        : { kind: "ai_draft", id: currentDraft.id };
      const sourceSimulationId = savedDraft
        ? savedDraft.simulationId
        : currentSimulation.id;
      const payload = await apiClient.applyAndSubmitRule({
        projectId,
        body: {
          source,
          sourceSimulationId,
          destinationVersionId,
          destinationSimulationId,
          scope: contract.scope,
          target: contract.target,
          effectiveFrom: savedDraft
            ? savedDraft.effectiveFrom
            : contract.effectiveStartAt,
          reason:
            currentUser.role === "operator_business"
              ? "保存并请求审核"
              : "提交审核",
          clientRequestId,
        },
        signal: controller.signal,
      });
      if (!payload?.rule || !payload?.simulation || !payload?.event) {
        throw invalidSubmitLifecycleError();
      }
      if (sequence !== requestSequenceRef.current) return;
      setGovernanceState((current) => ({
        ...(current.contextKey === workspaceContextKey
          ? current
          : INITIAL_GOVERNANCE_STATE),
        contextKey: workspaceContextKey,
        status: "ready",
        versions: [
          payload.rule,
          ...(current.contextKey === workspaceContextKey
            ? current.versions.filter((rule) => rule.id !== payload.rule.id)
            : []),
        ],
        reviews:
          current.contextKey === workspaceContextKey ? current.reviews : [],
        groups:
          current.contextKey === workspaceContextKey ? current.groups : [],
        templates:
          current.contextKey === workspaceContextKey ? current.templates : templates,
        announcement: "规则已提交审核",
        error: null,
      }));
      setRequestState((current) => ({
        ...(current.contextKey === workspaceContextKey
          ? current
          : freshRequestState()),
        contextKey: workspaceContextKey,
        status: "ready",
        operation: null,
        lastOperation: null,
        requestId: null,
        error: null,
        recovery: null,
        announcement: "规则已提交审核",
        focusTarget: "status",
      }));
      setActivePane("versions");
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        sequence !== requestSequenceRef.current
      ) {
        return;
      }
      const safeError = safeWorkspaceError(error);
      setRequestState((current) => ({
        ...(current.contextKey === workspaceContextKey
          ? current
          : freshRequestState()),
        contextKey: workspaceContextKey,
        status: "error",
        operation: null,
        lastOperation: "submit_review",
        error: safeError,
        recovery: null,
        announcement: "提交审核失败",
        focusTarget: "error",
      }));
    }
  };

  const mergeGovernanceRule = (rule, announcement) => {
    setGovernanceState((current) => ({
      ...(current.contextKey === workspaceContextKey
        ? current
        : INITIAL_GOVERNANCE_STATE),
      contextKey: workspaceContextKey,
      status: "ready",
      versions: [
        rule,
        ...(current.contextKey === workspaceContextKey
          ? current.versions.filter((version) => version.id !== rule.id)
          : []),
      ],
      reviews: current.contextKey === workspaceContextKey ? current.reviews : [],
      groups: current.contextKey === workspaceContextKey ? current.groups : [],
      templates:
        current.contextKey === workspaceContextKey ? current.templates : templates,
      announcement,
      error: null,
    }));
    setRequestState((current) => ({
      ...(current.contextKey === workspaceContextKey
        ? current
        : freshRequestState()),
      contextKey: workspaceContextKey,
      status: "ready",
      operation: null,
      lastOperation: null,
      error: null,
      recovery: null,
      announcement,
      focusTarget: "status",
    }));
  };

  const reviewSummaryFor = (rule) => ({
    contractDiff: [
      {
        field: "status",
        before: "当前版本",
        after: rule.status === "pending_review" ? "待审核版本" : "已保存版本",
      },
    ],
    largestDelta: { label: "最大影响项", amountYuan: "0.00" },
    missingDataBehavior: "缺少数据时转人工复核",
    risk: "按服务端审核记录复核",
    creatorName: rule.createdBy,
    simulationFreshness: rule.simulationId ? "fresh" : "unknown",
  });

  const handleReviewTransition = async (operation, payload) => {
    const clientRequestId = createRequestId(operation);
    setReviewDialog((current) => ({ ...current, error: null }));
    try {
      let result;
      if (operation === "approve_rule") {
        result = await apiClient.approveRule({
          projectId,
          ruleVersionId: payload.ruleVersionId,
          body: {
            effectiveFrom: payload.effectiveFrom,
            reason: payload.reason,
            force: payload.force,
            acknowledgment: payload.acknowledgment,
            clientRequestId,
          },
        });
      } else if (operation === "request_changes") {
        result = await apiClient.requestRuleChanges({
          projectId,
          ruleVersionId: payload.ruleVersionId,
          body: {
            reason: payload.reason,
            comment: payload.comment,
            clientRequestId,
          },
        });
      } else {
        result = await apiClient.archiveRule({
          projectId,
          ruleVersionId: payload.ruleVersionId,
          body: {
            effectiveUntil:
              payload.effectiveUntil ??
              new Date(Date.now()).toISOString().replace("Z", "+00:00"),
            fallbackProof: payload.fallbackProof ?? "owner_reviewed_archive",
            reason: payload.reason,
            clientRequestId,
          },
        });
      }
      const announcement =
        operation === "approve_rule"
          ? "规则已确认生效"
          : operation === "request_changes"
            ? "已要求修改"
            : "规则已归档";
      setReviewDialog({ open: false, rule: null, error: null });
      mergeGovernanceRule(result.rule, announcement);
    } catch (error) {
      setReviewDialog((current) => ({
        ...current,
        error: safeWorkspaceError(error).message,
      }));
    }
  };

  const reopenRequestedChangesVersion = async (ruleId) => {
    if (typeof apiClient.reopenRuleDraft !== "function") {
      setRequestState((current) => ({
        ...(current.contextKey === workspaceContextKey
          ? current
          : freshRequestState()),
        contextKey: workspaceContextKey,
        status: "ready",
        operation: null,
        lastOperation: null,
        error: null,
        recovery: null,
        announcement: "需要后端重开接口",
        focusTarget: "status",
      }));
      return;
    }
    const payload = await apiClient.reopenRuleDraft({
      projectId,
      ruleVersionId: ruleId,
      body: {
        reason: "按审核意见修改",
        clientRequestId: createRequestId("reopen_rule"),
      },
    });
    mergeGovernanceRule(payload.rule, "规则已重新打开为草稿");
    if (payload.session) {
      const authority = reopenedRevisionAuthority(payload.session);
      setActiveSession({
        contextKey: workspaceContextKey,
        id: payload.session.conversation.id,
      });
      setRequestState((current) => ({
        ...(current.contextKey === workspaceContextKey
          ? current
          : freshRequestState()),
        contextKey: workspaceContextKey,
        status: "ready",
        operation: null,
        lastOperation: null,
        requestId: null,
        authoritative: authority,
        error: null,
        recovery: null,
        announcement: "规则已重新打开为草稿",
        focusTarget: "status",
      }));
    }
    setActivePane("build");
  };

  const cloneVersionAsDraft = async (ruleOrTemplate) => {
    if (typeof apiClient.cloneRule !== "function") return null;
    const ruleVersionId =
      typeof ruleOrTemplate === "string"
        ? governanceView.templates.find((template) => template.id === ruleOrTemplate)
            ?.sourceRuleVersionId
        : ruleOrTemplate?.id;
    const templateName =
      typeof ruleOrTemplate === "string"
        ? governanceView.templates.find((template) => template.id === ruleOrTemplate)
            ?.name
        : null;
    if (!ruleVersionId) return null;
    const result = await apiClient.cloneRule({
      projectId,
      ruleVersionId,
      body: {
        targetProjectId: projectId,
        targetVariableCatalogVersion: viewState.catalog?.version ?? "a".repeat(64),
        targetAvailableVariableIds:
          viewState.catalog?.variables?.map((variable) => variable.id) ?? [],
        newVersionId: createUuid(),
        reason: templateName ? `复用${templateName}` : "创建新版本",
        clientRequestId: createRequestId("clone_rule"),
      },
    });
    mergeGovernanceRule(result.rule, "可编辑草稿已创建");
    return result;
  };

  const recoverCatalogAndSession = async () => {
    const sessionId =
      activeSessionId ?? viewState.authoritative?.draft?.conversationId ?? null;
    if (!validContext || !sessionId) return;

    requestControllerRef.current?.abort();
    apiClient.abortActive?.();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    setRequestState((current) => ({
      ...(current.contextKey === workspaceContextKey
        ? current
        : freshRequestState()),
      contextKey: workspaceContextKey,
      status: "loading",
      operation: "catalog_recovery",
      lastOperation: null,
      catalogStatus: "loading",
      error: null,
      recovery: null,
      announcement: "正在同步业务范围",
      focusTarget: null,
    }));

    try {
      const payload = await apiClient.getVariableCatalog({
        projectId,
        scope: selectedScope,
        executionGrain,
        signal: controller.signal,
      });
      if (sequence !== requestSequenceRef.current) return;
      if (
        payload.catalog.scope !== selectedScope ||
        payload.catalog.executionGrain !== executionGrain
      ) {
        throw invalidAuthorityError();
      }
      if (!catalogTimezoneReady(payload.catalog)) {
        setRequestState((current) => ({
          ...(current.contextKey === workspaceContextKey
            ? current
            : freshRequestState()),
          contextKey: workspaceContextKey,
          status: "idle",
          operation: null,
          catalogStatus: "timezone_error",
          catalog: payload.catalog,
          error: {
            code: "CUSTOM_RULE_TIMEZONE_UNRESOLVED",
            message: "请先确认项目业务时区后再开始",
            retryable: true,
          },
          recovery: null,
          announcement: "业务时区待确认",
          focusTarget: "error",
        }));
        return;
      }
      setRequestState((current) => ({
        ...(current.contextKey === workspaceContextKey
          ? current
          : freshRequestState()),
        contextKey: workspaceContextKey,
        catalogStatus: "ready",
        catalog: payload.catalog,
      }));
      await performOperation("refresh");
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        sequence !== requestSequenceRef.current
      ) {
        return;
      }
      const safeError = safeWorkspaceError(error);
      setRequestState((current) => ({
        ...(current.contextKey === workspaceContextKey
          ? current
          : freshRequestState()),
        contextKey: workspaceContextKey,
        status: "error",
        operation: null,
        lastOperation: null,
        catalogStatus: "ready",
        error: safeError,
        recovery: "catalog_session",
        announcement: "业务范围同步失败",
        focusTarget: "error",
      }));
    }
  };

  const restartWorkspace = () => {
    requestControllerRef.current?.abort();
    apiClient.abortActive?.();
    requestSequenceRef.current += 1;
    setActiveSession({ contextKey: workspaceContextKey, id: null });
    setDraftInputState({ contextKey: workspaceContextKey, value: "" });
    setRequestState({
      ...freshRequestState(),
      contextKey: workspaceContextKey,
      catalogStatus: viewState.catalogStatus,
      catalog: viewState.catalog,
      announcement: "可以重新开始业务规则澄清",
    });
  };

  const draft = viewState.authoritative?.draft ?? null;
  const firstQuestion = visibleBusinessAmbiguities(draft)[0] ?? null;
  const reopenedForRevision = Boolean(draft?.reopenedForRevision);
  const simulated = draft?.status === "simulated" && !reopenedForRevision;
  const contractReady = !reopenedForRevision && draftIsConfirmationReady(draft);
  const clarifying =
    reopenedForRevision || (draft?.status === "clarifying" && !contractReady);
  const isLoading = viewState.status === "loading";
  const isProcessing = viewState.status === "processing";
  const requestHasError = viewState.status === "error";
  const failedAuthority = authorityHasFailed(viewState.authoritative);
  const catalogIsLoading = viewState.catalogStatus === "loading";
  const catalogHasError = viewState.catalogStatus === "error";
  const timezoneHasError = viewState.catalogStatus === "timezone_error";
  const catalogReady = viewState.catalogStatus === "ready";
  const errorVisible =
    requestHasError || failedAuthority || catalogHasError || timezoneHasError;
  const timeoutError =
    requestHasError &&
    viewState.error?.code === "CUSTOM_RULE_PROCESSING_TIMEOUT";
  const businessDateError =
    requestHasError &&
    viewState.error?.code === "CUSTOM_RULE_BUSINESS_DATE_UNAVAILABLE";
  const sessionRecovery = requestHasError && viewState.recovery === "session";
  const catalogSessionRecovery =
    requestHasError && viewState.recovery === "catalog_session";

  let errorHeading = "无法继续处理";
  let errorMessage = viewState.error?.message ?? "结算规则服务暂时不可用";
  if (catalogHasError) errorHeading = "无法读取业务范围";
  if (timezoneHasError) errorHeading = "业务时区待确认";
  if (sessionRecovery) errorHeading = "规则状态需要同步";
  if (catalogSessionRecovery) errorHeading = "业务范围需要同步";
  if (businessDateError) errorHeading = "业务日期不可用";
  if (viewState.lastOperation === "assign_group") errorHeading = "分组更新失败";
  if (failedAuthority) {
    errorHeading = "AI 草案生成失败";
    errorMessage = "AI 未能生成可用草案，请重新开始";
  }
  if (timeoutError) errorHeading = "AI 仍在处理";

  let actionLabel = "开始澄清";
  let actionOperation = "start";
  let ActionIcon = Send;
  let inputLabel = "规则说明";
  let needsInput = true;
  let showInput = true;

  if (catalogIsLoading) {
    actionLabel = "正在读取范围…";
    actionOperation = "catalog_wait";
    ActionIcon = RefreshCw;
  } else if (catalogHasError || timezoneHasError) {
    actionLabel = timezoneHasError ? "重新读取时区" : "重新读取范围";
    actionOperation = "catalog";
    ActionIcon = RefreshCw;
    needsInput = false;
  } else if (isProcessing) {
    actionLabel = "正在处理…";
    actionOperation = "processing";
    ActionIcon = RefreshCw;
    needsInput = false;
    showInput = false;
  } else if (requestHasError) {
    actionLabel = sessionRecovery
      ? "同步最新规则"
      : catalogSessionRecovery
        ? "同步业务范围"
        : businessDateError
          ? "重新校验日期"
          : timeoutError
            ? "刷新处理状态"
            : viewState.error?.retryable
              ? "重试"
              : "重新开始";
    actionOperation = sessionRecovery
      ? "recover_session"
      : catalogSessionRecovery
        ? "recover_catalog_session"
        : businessDateError
          ? "business_date"
          : timeoutError
            ? "refresh"
            : viewState.error?.retryable
              ? (viewState.lastOperation ?? "start")
              : "restart";
    ActionIcon = RefreshCw;
    needsInput = false;
    showInput = false;
  } else if (failedAuthority) {
    actionLabel = "重新开始";
    actionOperation = "restart";
    ActionIcon = RefreshCw;
    needsInput = false;
    showInput = false;
  } else if (simulated) {
    actionLabel =
      currentUser.role === "operator_business"
        ? "保存并请求审核"
        : "应用并提交审核";
    actionOperation = "submit_review";
    ActionIcon = Send;
    needsInput = false;
    showInput = false;
  } else if (contractReady) {
    actionLabel = "确认业务规则并试算";
    actionOperation = "confirm";
    ActionIcon = CheckCircle2;
    needsInput = false;
    showInput = false;
  } else if (clarifying) {
    actionLabel = "回复 AI";
    actionOperation = "answer";
    ActionIcon = Send;
    inputLabel = "回复 AI";
  }

  if (isLoading) {
    actionLabel =
      viewState.operation === "submit_review"
        ? "正在提交审核…"
        : viewState.operation === "confirm"
          ? "正在试算…"
          : "正在生成…";
    needsInput = false;
  }

  const actionDisabled =
    !validContext ||
    catalogIsLoading ||
    isLoading ||
    isProcessing ||
    (actionOperation !== "catalog" &&
      actionOperation !== "restart" &&
      !catalogReady) ||
    (needsInput && draftInput.trim().length === 0);

  const handlePrimaryAction = () => {
    if (actionOperation === "catalog") {
      setRequestState({
        ...freshRequestState(),
        contextKey: workspaceContextKey,
        catalogStatus: "loading",
        announcement: "正在读取业务范围",
      });
      loadCatalog();
      return;
    }
    if (actionOperation === "restart") {
      restartWorkspace();
      return;
    }
    if (actionOperation === "recover_session") {
      performOperation("refresh");
      return;
    }
    if (actionOperation === "recover_catalog_session") {
      recoverCatalogAndSession();
      return;
    }
    if (actionOperation === "business_date") {
      performOperation("start");
      return;
    }
    if (actionOperation === "submit_review") {
      submitCurrentSimulationForReview();
      return;
    }
    if (requestHasError) {
      performOperation(actionOperation, { retry: !timeoutError });
      return;
    }
    performOperation(actionOperation);
  };

  return (
    <section
      className="crw"
      data-testid="custom-rule-workspace"
      data-layout="full-width"
      aria-label="AI 自定义结算规则"
    >
      <WorkspaceStyles />
      <header className="crw-header">
        <div>
          <h2 className="crw-title">AI 自定义结算规则</h2>
          <div className="crw-context">
            <span>{projectName || "未选择项目"}</span>
            <span>
              {periodStart && periodEnd
                ? `${periodStart} 至 ${periodEnd}`
                : "未设置周期"}
            </span>
            <span>{targetLabel(selectedTarget, selectedScope)}</span>
          </div>
        </div>
        {activeSessionId && !errorVisible && !isProcessing ? (
          <button
            type="button"
            className="crw-refresh"
            aria-label="刷新会话"
            title="刷新会话"
            disabled={isLoading}
            onClick={() => performOperation("refresh")}
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className="crw-scope">
        <div>
          <div className="crw-scope-label">结算对象</div>
          <div
            className={`crw-history${viewState.catalog?.hasHistory === false ? " no-history" : ""}`}
          >
            {catalogIsLoading
              ? "正在读取历史数据"
              : catalogHasError
                ? "历史数据状态不可用"
                : viewState.catalog?.hasHistory === false
                  ? "无历史数据"
                  : viewState.catalog?.hasHistory
                    ? "历史数据可用"
                    : "等待选择范围"}
          </div>
        </div>
        <div className="crw-segments" aria-label="选择结算对象">
          {SCOPE_OPTIONS.map((option) => {
            const ScopeIcon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selectedScope === option.value}
                onClick={() => {
                  if (selectedScope === option.value) return;
                  requestSequenceRef.current += 1;
                  requestControllerRef.current?.abort();
                  apiClient.abortActive?.();
                  setSelectedScope(option.value);
                  setSelectedTarget({ targetType: "project", targetId: null });
                  setDraftInputState({ contextKey: null, value: "" });
                }}
              >
                <ScopeIcon size={14} aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {selectedScope === "external_cost" && viewState.catalogStatus === "ready" ? (
        <ExternalCostCatalogPanel catalog={viewState.catalog} />
      ) : null}

      <div className="crw-tabs" role="tablist" aria-label="自定义结算规则视图">
        {[
          ["build", "搭建"],
          ["versions", "版本与审核"],
          ["groups", "结算分组"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={activePane === value}
            aria-controls={`crw-pane-${value}`}
            onClick={() => setActivePane(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {activePane === "build" ? (
        <div id="crw-pane-build" role="tabpanel" aria-label="搭建">
          {[
            "规则已重新打开为草稿",
            "可编辑草稿已创建",
          ].includes(viewState.announcement) ? (
            <div className="crw-submit-state">
              <h2 ref={statusHeadingRef} tabIndex={-1}>
                {viewState.announcement}
              </h2>
            </div>
          ) : null}
          {!validContext ? (
        <div className="crw-empty">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <h2>尚未选择结算范围</h2>
            <p>请先选择项目和有效结算周期</p>
          </div>
        </div>
          ) : null}

          {errorVisible ? (
        <div className="crw-error">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <h2 ref={errorHeadingRef} tabIndex={-1}>
              {errorHeading}
            </h2>
            <p>{errorMessage}</p>
          </div>
        </div>
          ) : null}

          {isProcessing ? (
        <div className="crw-processing">
          <RefreshCw size={18} aria-hidden="true" />
          <div>
            <h2 ref={progressHeadingRef} tabIndex={-1}>
              AI 正在处理
            </h2>
            <p>正在读取最新业务草案</p>
          </div>
        </div>
          ) : null}

          {isLoading ? (
        <div className="crw-loading" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
          ) : null}

          {!errorVisible && !isProcessing && !isLoading && draft ? (
        <>
          {clarifying && firstQuestion ? (
            <section className="crw-band crw-ai">
              <div
                className="crw-ai-copy"
                role="region"
                aria-label="AI 业务草案"
                data-source="ai"
              >
                <div className="crw-source-label">
                  <Bot size={15} aria-hidden="true" />
                  AI 业务草案
                </div>
                <p>
                  {safeBusinessText(
                    draft.businessContract.summary,
                    "按已确认的业务条件计算",
                  )}
                </p>
              </div>
              <div className="crw-question">
                <div className="crw-source-label">
                  <Bot size={15} aria-hidden="true" />
                  当前问题
                </div>
                <h2 ref={questionHeadingRef} tabIndex={-1}>
                  {safeBusinessQuestion(firstQuestion.question)}
                </h2>
              </div>
            </section>
          ) : (
            <section
              className="crw-band"
              role="region"
              aria-label="AI 业务草案"
              data-source="ai"
            >
              <div className="crw-source-label">
                <Bot size={15} aria-hidden="true" />
                AI 业务草案
              </div>
              {!simulated ? (
                <h2 ref={resultHeadingRef} tabIndex={-1}>
                  业务规则草案
                </h2>
              ) : null}
              <p className="crw-ai-copy">
                {safeBusinessText(
                  draft.businessContract.summary,
                  "按已确认的业务条件计算",
                )}
              </p>
            </section>
          )}

          <section className="crw-band" aria-label="业务合同字段">
            <ContractView draft={draft} />
          </section>

          {draft.generatedFormula ? (
            <section
              className="crw-band crw-engine"
              role="region"
              aria-label="确定性引擎解释"
              data-source="deterministic-engine"
            >
              <div className="crw-source-label">
                <ShieldCheck size={15} aria-hidden="true" />
                确定性引擎解释
              </div>
              <p>{deterministicExplanation(draft.businessContract)}</p>
            </section>
          ) : null}

          {draft.generatedFormula ? (
            <details className="crw-advanced" data-testid="advanced-formula">
              <summary>
                <Calculator size={14} aria-hidden="true" />
                高级公式
              </summary>
              <pre aria-label="高级公式内容">
                {draft.generatedFormula.expression}
              </pre>
            </details>
          ) : null}

          <RevisionDiff diff={viewState.authoritative.diff} />
          {simulated ? (
            <SimulationView
              authority={viewState.authoritative}
              headingRef={resultHeadingRef}
            />
          ) : null}
        </>
          ) : null}

          <div className="crw-compose">
        {showInput ? (
          <label>
            {inputLabel}
            <textarea
              aria-label={inputLabel}
              value={draftInput}
              maxLength={4000}
              disabled={
                !validContext || !catalogReady || isLoading || isProcessing
              }
              onChange={(event) =>
                setDraftInputState({
                  contextKey: workspaceContextKey,
                  value: event.target.value,
                })
              }
            />
          </label>
        ) : (
          <div />
        )}
        <button
          type="button"
          className="crw-primary"
          data-primary-action="true"
          disabled={actionDisabled}
          onClick={handlePrimaryAction}
        >
          <ActionIcon size={15} aria-hidden="true" />
          {actionLabel}
        </button>
          </div>
        </div>
      ) : null}

      {activePane === "versions" ? (
        <div id="crw-pane-versions" role="tabpanel" aria-label="版本与审核">
          {[
            "规则已提交审核",
            "规则已确认生效",
            "已要求修改",
            "规则已归档",
            "规则已重新打开为草稿",
            "可编辑草稿已创建",
            "需要后端重开接口",
          ].includes(viewState.announcement) ? (
            <div className="crw-submit-state">
              <h2 ref={statusHeadingRef} tabIndex={-1}>
                {viewState.announcement}
              </h2>
            </div>
          ) : null}
          <CustomSettlementRuleVersionPanel
            buildState={
              simulated
                ? { kind: "simulated", role: currentUser.role }
                : contractReady
                  ? { kind: "contract_ready" }
                  : clarifying
                    ? { kind: "unresolved" }
                    : null
            }
            versions={governanceView.versions}
            currentUser={currentUser}
            suppressPrimary={reviewDialog.open}
            templates={
              governanceView.templates.length ? governanceView.templates : templates
            }
            onPrimaryAction={(type, rule) => {
              if (type === "submit") submitCurrentSimulationForReview(rule);
              if (type === "approve" && governanceView.versions[0]) {
                setReviewDialog({
                  open: true,
                  rule: governanceView.versions[0],
                  error: null,
                });
              }
              if (type === "new_version" && governanceView.versions[0]) {
                cloneVersionAsDraft(governanceView.versions[0]);
              }
            }}
            onReopenDraft={reopenRequestedChangesVersion}
            onCloneTemplate={cloneVersionAsDraft}
            onOpenReview={(rule) =>
              setReviewDialog({ open: true, rule, error: null })
            }
          />
          <CustomSettlementRuleReviewDialog
            open={reviewDialog.open}
            rule={reviewDialog.rule}
            summary={
              reviewDialog.rule ? reviewSummaryFor(reviewDialog.rule) : null
            }
            currentUser={currentUser}
            eligibleApproverId={reviewDialog.rule?.eligibleApproverId ?? null}
            error={reviewDialog.error}
            onApprove={(payload) => handleReviewTransition("approve_rule", payload)}
            onRequestChanges={(payload) =>
              handleReviewTransition("request_changes", payload)
            }
            onArchive={(payload) => handleReviewTransition("archive_rule", payload)}
            onClose={() =>
              setReviewDialog({ open: false, rule: null, error: null })
            }
          />
        </div>
      ) : null}

      {activePane === "groups" ? (
        <div id="crw-pane-groups" role="tabpanel" aria-label="结算分组">
          {viewState.announcement === "分组已更新" ? (
            <div className="crw-submit-state">
              <h2 ref={statusHeadingRef} tabIndex={-1}>
                分组已更新
              </h2>
            </div>
          ) : null}
          {viewState.status === "error" &&
          viewState.lastOperation === "assign_group" ? (
            <div className="crw-error">
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <h2 ref={errorHeadingRef} tabIndex={-1}>
                  分组更新失败
                </h2>
                <p>{errorMessage}</p>
              </div>
            </div>
          ) : null}
          <CustomSettlementRuleGroupPanel
            groups={governanceView.groups}
            streamers={governanceView.groups.flatMap(
              (group) => group.unassignedProjectStreamers ?? [],
            )}
            onAssign={async (assignment) => {
              if (
                typeof apiClient.changeSettlementGroupAssignment !== "function"
              ) {
                return;
              }
              try {
                await apiClient.changeSettlementGroupAssignment({
                  projectId,
                  groupId: assignment.groupId,
                  body: {
                    projectStreamerId: assignment.projectStreamerId,
                    effectiveFrom: assignment.effectiveFrom,
                    reason: assignment.reason,
                    clientRequestId: createRequestId("assign_group"),
                  },
                });
                if (typeof apiClient.listSettlementRuleGroups === "function") {
                  const groupsPayload = await apiClient.listSettlementRuleGroups({
                    projectId,
                    includeArchived: true,
                  });
                  setGovernanceState((current) => ({
                    ...(current.contextKey === workspaceContextKey
                      ? current
                      : INITIAL_GOVERNANCE_STATE),
                    contextKey: workspaceContextKey,
                    status: "ready",
                    groups: groupsPayload.groups,
                    versions:
                      current.contextKey === workspaceContextKey
                        ? current.versions
                        : [],
                    reviews:
                      current.contextKey === workspaceContextKey
                        ? current.reviews
                        : [],
                    templates:
                      current.contextKey === workspaceContextKey
                        ? current.templates
                        : templates,
                    announcement: "分组已更新",
                    error: null,
                  }));
                }
                setRequestState((current) => ({
                  ...(current.contextKey === workspaceContextKey
                    ? current
                    : freshRequestState()),
                  contextKey: workspaceContextKey,
                  status: "ready",
                  operation: null,
                  lastOperation: null,
                  error: null,
                  recovery: null,
                  announcement: "分组已更新",
                  focusTarget: "status",
                }));
              } catch (error) {
                const safeError = safeWorkspaceError(error);
                setRequestState((current) => ({
                  ...(current.contextKey === workspaceContextKey
                    ? current
                    : freshRequestState()),
                  contextKey: workspaceContextKey,
                  status: "error",
                  operation: null,
                  lastOperation: "assign_group",
                  error: safeError,
                  recovery: null,
                  announcement: "分组更新失败",
                  focusTarget: "error",
                }));
              }
            }}
          />
        </div>
      ) : null}

      <div
        className="crw-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {viewState.announcement}
      </div>
    </section>
  );
}
