"use client";

import React from "react";
import {
  AlertCircle,
  Bot,
  Building2,
  Calculator,
  CheckCircle2,
  Pencil,
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
};

function freshRequestState() {
  return { ...INITIAL_REQUEST_STATE };
}

function defaultRequestId(operation) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
  return `task9:${operation}:${suffix}`;
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

function createSeedContract({ scope, target, projectName, periodStart }) {
  const payable = scope === "payable";
  const inputName = payable ? "system_minutes" : "period_report_count";
  const inputDescription = payable ? "系统直播时长" : "周期内已审核报告数";
  const inputSource = payable ? "直播报告系统计时" : "周期内已审核直播报告";
  const inputUnit = payable ? "分钟" : "份";
  const title = payable
    ? `${projectName || "当前项目"}主播应付规则草案`
    : `${projectName || "当前项目"}客户应收规则草案`;
  const summary = payable
    ? "按项目直播报告计算主播应付金额。"
    : "按项目结算周期计算客户应收金额。";
  const description = payable ? "计算最终主播应付金额" : "计算最终客户应收金额";

  const example = (name, kind, descriptionText, value, amountCents) => ({
    name,
    kind,
    description: descriptionText,
    inputs: { [inputName]: { type: "integer", value } },
    expectedResult: { type: "money_cents", amountCents },
  });

  return {
    schemaVersion: 1,
    scope,
    target:
      scope === "receivable"
        ? { targetType: "project", targetId: null }
        : target,
    executionGrain: payable ? "report" : "project_period",
    compositionMode: "replace",
    title,
    summary,
    calculationComponents: [
      {
        name: "final",
        description,
        expression: "按确认后的业务条件计算最终金额",
        resultType: { kind: "scalar", scalarType: "money_cents" },
      },
    ],
    requiredInputs: [
      {
        name: inputName,
        description: inputDescription,
        source: inputSource,
        valueType: { kind: "scalar", scalarType: "integer" },
        userFacingUnit: inputUnit,
      },
    ],
    parameters: [
      {
        name: "unit_price",
        description: payable ? "基础结算单价" : "基础应收单价",
        valueType: { kind: "scalar", scalarType: "money_cents" },
        userFacingUnit: "元",
        defaultValue: { type: "money_cents", amountCents: 0 },
      },
    ],
    effectiveStartAt: `${periodStart}T00:00:00+08:00`,
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    compositionDescription: payable
      ? "替换当前项目的主播应付基础规则。"
      : "替换当前项目的客户应收基础规则。",
    businessTimezone: "Asia/Shanghai",
    examples: [
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
    summary: null,
  };
}

function focusTargetForDraft(draft) {
  if (draft?.status === "clarifying") return "question";
  if (draft?.status === "failed") return "error";
  return "result";
}

function completionAnnouncement(draft) {
  if (draft?.status === "clarifying") return "AI 已提出新的待确认问题";
  if (draft?.status === "contract_ready") return "业务规则草案已就绪";
  if (draft?.status === "simulated") return "内部试算已完成";
  return "结算规则会话已更新";
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

function scopeLabel(scope) {
  return scope === "receivable" ? "客户应收" : "主播应付";
}

function targetLabel(target, scope) {
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

function formatYuan(value) {
  if (value === null || value === undefined || value === "")
    return "无历史数据";
  const number = Number(value);
  if (!Number.isFinite(number)) return "金额不可用";
  return `¥${number.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTypedValue(value) {
  if (!value || typeof value !== "object") return "未设置";
  if (value.type === "money_cents") return formatYuan(value.amountCents / 100);
  if (value.type === "rate_bps") return `${(value.rateBps / 100).toFixed(2)}%`;
  if (value.type === "boolean") return value.value ? "是" : "否";
  if (value.type === "timestamp") return formatDate(value.value);
  if (value.type === "array") return `${value.items.length} 项`;
  if (value.type === "object")
    return `${Object.keys(value.fields).length} 项组合值`;
  return String(value.value ?? "未设置");
}

function ambiguityFieldKeys(ambiguities) {
  const keys = new Set();
  for (const ambiguity of ambiguities ?? []) {
    const code = String(ambiguity.code ?? "").toLowerCase();
    if (/scope/u.test(code)) keys.add("scope");
    if (/target|streamer|group/u.test(code)) keys.add("target");
    if (/grain|frequency|unit/u.test(code)) keys.add("executionGrain");
    if (/rate|price|amount|parameter|bonus|tier|floor|cap/u.test(code)) {
      keys.add("parameters");
    }
    if (/input|source|evidence|data/u.test(code)) keys.add("requiredInputs");
    if (/effective|period|date|start|end/u.test(code)) {
      keys.add("effectiveStartAt");
      keys.add("effectiveEndAt");
    }
    if (/missing/u.test(code)) keys.add("missingDataPolicy");
    if (keys.size === 0 || /rule|definition|summary/u.test(code))
      keys.add("summary");
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
    { key: "title", value: contract.title },
    { key: "summary", value: contract.summary },
    {
      key: "calculationComponents",
      value: contract.calculationComponents
        .map((item) => item.description)
        .join("；"),
    },
    {
      key: "requiredInputs",
      value: contract.requiredInputs
        .map(
          (item) =>
            `${item.description}（${item.source}，${item.userFacingUnit}）`,
        )
        .join("；"),
    },
    {
      key: "parameters",
      value: contract.parameters
        .map(
          (item) =>
            `${item.description} ${formatTypedValue(item.defaultValue)}`,
        )
        .join("；"),
    },
    { key: "effectiveStartAt", value: formatDate(contract.effectiveStartAt) },
    { key: "effectiveEndAt", value: formatDate(contract.effectiveEndAt) },
    {
      key: "missingDataPolicy",
      value: missingDataLabel(contract.missingDataPolicy),
    },
    { key: "compositionDescription", value: contract.compositionDescription },
    { key: "businessTimezone", value: contract.businessTimezone },
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
  if (field === "missingDataPolicy") return missingDataLabel(value);
  if (field === "parameters" && Array.isArray(value)) {
    return value
      .map(
        (item) => `${item.description} ${formatTypedValue(item.defaultValue)}`,
      )
      .join("；");
  }
  if (Array.isArray(value)) return `${value.length} 项`;
  if (value && typeof value === "object") return "业务对象已调整";
  return String(value ?? "未设置");
}

function summaryFromPersistedSimulation(simulation, scope) {
  if (!simulation) return null;
  const current =
    scope === "receivable"
      ? simulation.historicalTotals.receivableAmountYuan
      : simulation.historicalTotals.payableAmountYuan;
  const delta =
    scope === "receivable"
      ? simulation.deltas.receivableAmountYuan
      : simulation.deltas.payableAmountYuan;
  const increases = simulation.largestChanges
    .filter((item) => item.direction === "increase")
    .map((item) => ({ bucket: item.key, deltaYuan: item.deltaAmountYuan }));
  const decreases = simulation.largestChanges
    .filter((item) => item.direction === "decrease")
    .map((item) => ({ bucket: item.key, deltaYuan: item.deltaAmountYuan }));

  return {
    coverage: {
      totalCount: simulation.coverage.totalRecords,
      evaluatedCount: simulation.coverage.evaluatedRecords,
      ratePercent:
        simulation.coverage.totalRecords > 0
          ? (
              (simulation.coverage.evaluatedRecords /
                simulation.coverage.totalRecords) *
              100
            ).toFixed(2)
          : "0.00",
    },
    zeroPayCount: null,
    reviewRoutedCount: null,
    blockedCount: null,
    totalOldYuan: current,
    totalNewYuan: null,
    totalDeltaYuan: delta,
    historicalVerification: {
      status: current === null ? "unverified" : "verified",
      label: current === null ? "未经过历史数据验证" : "历史结果已载入",
    },
    largestIncreases: increases,
    largestDecreases: decreases,
    riskFlags: [],
    warnings: simulation.warnings,
  };
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

function RevisionDiff({ diff }) {
  if (!diff?.length) return null;
  const changed = new Set(diff.map((item) => item.field));
  const unchanged = CONTRACT_FIELD_ORDER.filter((field) => !changed.has(field));

  return (
    <section className="crw-band crw-diff" role="region" aria-label="本轮修改">
      <h3>本轮修改</h3>
      <div className="crw-diff-list">
        {diff.map((item) => (
          <div key={item.field} className="crw-diff-row">
            <strong>{CONTRACT_FIELD_LABELS[item.field]}</strong>
            <span className="crw-before">
              {formatDiffValue(item.field, item.before)}
            </span>
            <span aria-hidden="true">→</span>
            <span className="crw-after">
              {formatDiffValue(item.field, item.after)}
            </span>
          </div>
        ))}
      </div>
      <p className="crw-preserved">
        保持不变：
        {unchanged.map((field) => CONTRACT_FIELD_LABELS[field]).join("、")}
      </p>
    </section>
  );
}

function SimulationView({ authority, headingRef }) {
  const scope = authority.draft.businessContract.scope;
  const summary =
    authority.summary ??
    summaryFromPersistedSimulation(authority.simulation, scope);
  if (!summary) return null;

  const noHistory =
    summary.historicalVerification?.status === "unverified" ||
    summary.totalOldYuan === null;
  const countValue = (value) =>
    value === null ? "服务端未提供" : `${value} 条`;
  const largest = (items, emptyLabel) =>
    items?.length
      ? items.map((item) => (
          <li key={`${item.bucket}-${item.deltaYuan}`}>
            <span>{item.bucket}</span>
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
        {noHistory ? <span className="crw-no-history">无历史数据</span> : null}
      </div>

      <div className="crw-metrics">
        <div>
          <span>当前金额</span>
          <strong>{formatYuan(summary.totalOldYuan)}</strong>
        </div>
        <div>
          <span>新规则金额</span>
          <strong>{formatYuan(summary.totalNewYuan)}</strong>
        </div>
        <div>
          <span>差额</span>
          <strong>{formatYuan(summary.totalDeltaYuan)}</strong>
        </div>
        <div>
          <span>覆盖率</span>
          <strong>{summary.coverage.ratePercent}%</strong>
          <small>
            {summary.coverage.evaluatedCount}/{summary.coverage.totalCount} 条
          </small>
        </div>
        <div>
          <span>零金额</span>
          <strong>{countValue(summary.zeroPayCount)}</strong>
        </div>
        <div>
          <span>转人工复核</span>
          <strong>{countValue(summary.reviewRoutedCount)}</strong>
        </div>
      </div>

      <div className="crw-change-columns">
        <div>
          <h3>
            <TrendingUp size={15} aria-hidden="true" />
            最大增加
          </h3>
          <ul>{largest(summary.largestIncreases, "无增加项")}</ul>
        </div>
        <div>
          <h3>
            <TrendingDown size={15} aria-hidden="true" />
            最大减少
          </h3>
          <ul>{largest(summary.largestDecreases, "无减少项")}</ul>
        </div>
      </div>

      <div className="crw-risk-columns">
        <div>
          <h3>风险</h3>
          {summary.riskFlags?.length ? (
            <ul>
              {summary.riskFlags.map((item) => (
                <li key={item.code}>{item.message}</li>
              ))}
            </ul>
          ) : (
            <p>无新增风险</p>
          )}
        </div>
        <div>
          <h3>提醒</h3>
          {summary.warnings?.length ? (
            <ul>
              {summary.warnings.map((item) => (
                <li key={item.code}>{item.message}</li>
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
      .crw-after { color: var(--ink-900, #172033); font-weight: 600; overflow-wrap: anywhere; }
      .crw-preserved { margin: 10px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--ink-500, #64748b); }
      .crw-band-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .crw-band-heading > div { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
      .crw-preview-status, .crw-no-history { display: inline-flex; align-items: center; min-height: 22px; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; }
      .crw-preview-status { background: var(--blue-50, #eff6ff); color: var(--blue-700, #1d4ed8); }
      .crw-no-history { background: var(--amber-50, #fffbeb); color: var(--amber-800, #92400e); }
      .crw-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin-top: 14px; background: var(--line, #e2e8f0); }
      .crw-metrics > div { min-width: 0; min-height: 78px; display: flex; flex-direction: column; justify-content: center; gap: 3px; padding: 10px 12px; background: #fff; }
      .crw-metrics span, .crw-metrics small { font-size: 11px; color: var(--ink-500, #64748b); }
      .crw-metrics strong { overflow-wrap: anywhere; font-size: 15px; line-height: 1.35; color: var(--ink-900, #172033); }
      .crw-change-columns, .crw-risk-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 16px; }
      .crw-change-columns h3 { display: flex; align-items: center; gap: 6px; }
      .crw-change-columns ul, .crw-risk-columns ul { list-style: none; margin: 8px 0 0; padding: 0; }
      .crw-change-columns li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--line, #e2e8f0); font-size: 12px; color: var(--ink-700, #334155); }
      .crw-risk-columns li, .crw-risk-columns p { margin: 7px 0 0; font-size: 12px; line-height: 1.55; color: var(--ink-600, #475569); }
      .crw-empty, .crw-error { display: flex; align-items: flex-start; gap: 10px; padding: 16px 0; border-bottom: 1px solid var(--line, #e2e8f0); }
      .crw-empty h2, .crw-error h2 { margin: 0; font-size: 14px; }
      .crw-empty p, .crw-error p { margin: 4px 0 0; font-size: 12px; color: var(--ink-600, #475569); }
      .crw-error { color: var(--danger-700, #b91c1c); }
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
  createRequestId = defaultRequestId,
}) {
  const apiClient = React.useMemo(
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
  const [requestState, setRequestState] = React.useState(freshRequestState);
  const requestSequenceRef = React.useRef(0);
  const requestControllerRef = React.useRef(null);
  const questionHeadingRef = React.useRef(null);
  const resultHeadingRef = React.useRef(null);
  const errorHeadingRef = React.useRef(null);

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
  const draftInput =
    draftInputState.contextKey === workspaceContextKey
      ? draftInputState.value
      : "";
  const activeSessionId =
    activeSession.contextKey === workspaceContextKey ? activeSession.id : null;

  React.useEffect(() => {
    requestSequenceRef.current += 1;
    requestControllerRef.current?.abort();
    apiClient.abortActive?.();

    if (!validContext) return undefined;

    const sequence = requestSequenceRef.current;
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
        setRequestState({
          ...freshRequestState(),
          contextKey: workspaceContextKey,
          catalogStatus: "ready",
          catalog: payload.catalog,
        });
      })
      .catch((error) => {
        if (
          error?.name === "AbortError" ||
          sequence !== requestSequenceRef.current
        ) {
          return;
        }
        setRequestState({
          ...freshRequestState(),
          contextKey: workspaceContextKey,
          catalogStatus: "error",
          catalog: null,
        });
      });

    return () => controller.abort();
  }, [
    apiClient,
    executionGrain,
    projectId,
    selectedScope,
    selectedTarget.targetId,
    selectedTarget.targetType,
    validContext,
    workspaceContextKey,
  ]);

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
      viewState.focusTarget === "question"
        ? questionHeadingRef
        : viewState.focusTarget === "error"
          ? errorHeadingRef
          : viewState.focusTarget === "result"
            ? resultHeadingRef
            : null;
    targetRef?.current?.focus();
  }, [
    viewState.focusTarget,
    viewState.authoritative?.draft?.id,
    viewState.authoritative?.draft?.revisionNumber,
    viewState.status,
  ]);

  const performOperation = async (operation, { retry = false } = {}) => {
    if (!validContext) return;
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
      announcement:
        operation === "confirm" ? "正在运行内部试算" : "正在更新业务规则",
      focusTarget: null,
    }));

    try {
      let payload;
      if (operation === "start") {
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
              periodStart,
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
        authority = authorityFromSession(payload.session);
        nextSessionId = payload.session.conversation.id;
      } else {
        let result = payload.result;
        nextSessionId = result.conversationId;
        if (result.kind === "retry_in_progress") {
          const refreshed = await apiClient.refreshSession({
            projectId,
            sessionId: nextSessionId,
            signal: controller.signal,
          });
          if (sequence !== requestSequenceRef.current) return;
          authority = authorityFromSession(refreshed.session);
        } else {
          authority = authorityFromResult(
            result,
            operation === "start" ? payload.session : null,
          );
        }
      }

      if (!authority?.draft) {
        throw new CustomSettlementRuleApiError({
          code: "CUSTOM_RULE_RESPONSE_INVALID",
          status: 200,
          retryable: true,
          message: "结算规则服务返回了无法识别的响应",
        });
      }

      setActiveSession({ contextKey: workspaceContextKey, id: nextSessionId });
      setDraftInputState({ contextKey: workspaceContextKey, value: "" });
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
        announcement: completionAnnouncement(authority.draft),
        focusTarget: focusTargetForDraft(authority.draft),
      }));
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
        error: safeError,
        announcement: "请求未完成",
        focusTarget: "error",
      }));
    }
  };

  const draft = viewState.authoritative?.draft ?? null;
  const firstQuestion = draft?.unresolvedAmbiguities?.[0] ?? null;
  const simulated = draft?.status === "simulated";
  const contractReady = draft?.status === "contract_ready";
  const clarifying = draft?.status === "clarifying";
  const isLoading = viewState.status === "loading";
  const hasError = viewState.status === "error";

  let actionLabel = "开始澄清";
  let actionOperation = "start";
  let ActionIcon = Send;
  let inputLabel = "规则说明";
  let needsInput = true;

  if (hasError) {
    actionLabel = viewState.error?.retryable ? "重试" : "重新开始";
    actionOperation = viewState.error?.retryable
      ? (viewState.lastOperation ?? "start")
      : "start";
    ActionIcon = RefreshCw;
    needsInput = false;
  } else if (simulated) {
    actionLabel = "修改规则";
    actionOperation = "answer";
    ActionIcon = Pencil;
    inputLabel = "修改说明";
  } else if (contractReady) {
    actionLabel = "确认业务规则并试算";
    actionOperation = "confirm";
    ActionIcon = CheckCircle2;
    needsInput = false;
  } else if (clarifying) {
    actionLabel = "回复 AI";
    actionOperation = "answer";
    ActionIcon = Send;
    inputLabel = "回复 AI";
  }

  if (isLoading) {
    actionLabel = viewState.operation === "confirm" ? "正在试算…" : "正在生成…";
    needsInput = false;
  }

  const actionDisabled =
    !validContext ||
    isLoading ||
    (needsInput && draftInput.trim().length === 0);

  const handlePrimaryAction = () => {
    if (hasError) {
      performOperation(actionOperation, { retry: viewState.error?.retryable });
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
        {activeSessionId ? (
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
            {viewState.catalogStatus === "loading"
              ? "正在读取历史数据"
              : viewState.catalogStatus === "error"
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

      {!validContext ? (
        <div className="crw-empty">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <h2>尚未选择结算范围</h2>
            <p>请先选择项目和有效结算周期</p>
          </div>
        </div>
      ) : null}

      {hasError ? (
        <div className="crw-error">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <h2 ref={errorHeadingRef} tabIndex={-1}>
              无法继续处理
            </h2>
            <p>{viewState.error.message}</p>
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

      {!hasError && draft ? (
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
                <p>{draft.businessContract.summary}</p>
              </div>
              <div className="crw-question">
                <div className="crw-source-label">
                  <Bot size={15} aria-hidden="true" />
                  当前问题
                </div>
                <h2 ref={questionHeadingRef} tabIndex={-1}>
                  {firstQuestion.question}
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
              <p className="crw-ai-copy">{draft.businessContract.summary}</p>
            </section>
          )}

          <section className="crw-band" aria-label="业务合同字段">
            <ContractView draft={draft} />
          </section>

          {draft.generatedExplanation ? (
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
              <p>{draft.generatedExplanation}</p>
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
        {needsInput ? (
          <label>
            {inputLabel}
            <textarea
              aria-label={inputLabel}
              value={draftInput}
              maxLength={4000}
              disabled={!validContext || isLoading}
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
