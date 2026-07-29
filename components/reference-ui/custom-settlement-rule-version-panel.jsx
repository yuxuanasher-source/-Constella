"use client";

import React from "react";
import { Copy, FilePenLine, GitBranch, Send, ShieldCheck } from "lucide-react";

function formatYuan(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `¥${numeric.toFixed(2)}` : "金额不可用";
}

function formatPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : "比例不可用";
}

function normalizeParameters(parameters) {
  if (Array.isArray(parameters)) return parameters;
  return Object.entries(parameters ?? {}).map(([key, value]) => {
    if (value?.type === "money_cents") {
      return {
        key,
        labelZh: key,
        type: "money_yuan",
        value: Number(value.amountCents) / 100,
      };
    }
    if (value?.type === "rate_bps") {
      return {
        key,
        labelZh: key,
        type: "percent",
        value: Number(value.rateBps) / 100,
      };
    }
    return { key, labelZh: key, type: "text", value: value?.value ?? value };
  });
}

function normalizeTemplateParameters(template) {
  const explicit = normalizeParameters(template?.parameters);
  if (explicit.length) return explicit;
  return (template?.contract?.parameters ?? []).map((parameter) => ({
    key: parameter.name,
    labelZh: parameter.description || parameter.name,
    ...typedValueToUiParameter(parameter.defaultValue),
  }));
}

function typedValueToUiParameter(value) {
  if (value?.type === "money_cents") {
    return {
      type: "money_yuan",
      value: Number(value.amountCents) / 100,
    };
  }
  if (value?.type === "rate_bps") {
    return {
      type: "percent",
      value: Number(value.rateBps) / 100,
    };
  }
  if (value?.type === "integer") {
    return {
      type: "number",
      value: value.value,
    };
  }
  return { type: "text", value: value?.value ?? value };
}

function formatParameter(parameter) {
  if (parameter.type === "money_yuan") return formatYuan(parameter.value);
  if (parameter.type === "percent") return formatPercent(parameter.value);
  return String(parameter.value ?? "未设置");
}

function statusLabel(status) {
  const labels = {
    draft: "草稿",
    pending_review: "待审核",
    changes_requested: "需修改",
    active: "生效中",
    archived: "已归档",
  };
  return labels[status] ?? "未知状态";
}

function canApprove(rule, currentUser) {
  if (rule.eligibleApproverId && rule.eligibleApproverId !== currentUser?.id) {
    return false;
  }
  if (rule.eligibleApproverRole && rule.eligibleApproverRole !== currentUser?.role) {
    return false;
  }
  if (rule.requiresDifferentApprover && rule.createdBy === currentUser?.id) {
    return false;
  }
  return true;
}

function actionFor({ buildState, versions, currentUser }) {
  if (buildState?.kind === "unresolved") {
    return { label: "回复 AI", icon: Send, type: "build" };
  }
  if (buildState?.kind === "contract_ready") {
    return { label: "确认业务规则并试算", icon: ShieldCheck, type: "build" };
  }
  if (buildState?.kind === "simulated") {
    return {
      label:
        buildState.role === "operator_business"
          ? "保存并请求审核"
          : "应用并提交审核",
      icon: Send,
      type: "submit",
    };
  }
  const current = versions?.[0] ?? null;
  if (!current) return null;
  const serverAction = current.primaryAction?.action ?? "none";
  if (current.status === "draft" && serverAction === "apply_and_submit") {
    return {
      label:
        currentUser.role === "operator_business"
          ? "保存并请求审核"
          : "应用并提交审核",
      icon: Send,
      type: "submit",
    };
  }
  if (
    current.status === "pending_review" &&
    serverAction === "approve" &&
    canApprove(current, currentUser)
  ) {
    return { label: "确认生效", icon: ShieldCheck, type: "approve" };
  }
  if (
    current.status === "changes_requested" &&
    (serverAction === "revise" || serverAction === "revise_and_resimulate")
  ) {
    return { label: "修改并重新试算", icon: FilePenLine, type: "revise" };
  }
  if (current.status === "active" && serverAction === "create_new_version") {
    return { label: "创建新版本", icon: GitBranch, type: "new_version" };
  }
  return null;
}

function templateKindLabel(kind) {
  return kind === "system" ? "系统模板" : "机构模板";
}

export default function CustomSettlementRuleVersionPanel({
  buildState = null,
  versions = [],
  templates = [],
  currentUser = { id: null, role: "operator_business" },
  suppressPrimary = false,
  onPrimaryAction,
  onReopenDraft,
  onCloneTemplate,
  onOpenReview,
}) {
  const [cloneResult, setCloneResult] = React.useState(null);
  const primary = suppressPrimary
    ? null
    : actionFor({ buildState, versions, currentUser });
  const PrimaryIcon = primary?.icon ?? Send;
  const currentRule = versions[0] ?? null;

  const handlePrimary = () => {
    if (primary?.type === "revise" && currentRule) {
      onReopenDraft?.(currentRule.id);
      return;
    }
    onPrimaryAction?.(primary?.type, currentRule);
  };

  const handleClone = (template) => {
    const result = onCloneTemplate?.(template);
    if (typeof result?.then === "function") {
      result.then((payload) => {
        if (payload) setCloneResult(payload);
      });
      return;
    }
    if (result) setCloneResult(result);
  };

  return (
    <section className="crw-version-panel" aria-label="版本与审核">
      <div className="crw-panel-heading">
        <div>
          <h2>版本与审核</h2>
          <p>按版本状态处理提交、审核、生效与复用。</p>
        </div>
        {primary ? (
          <button
            type="button"
            className="crw-primary"
            data-primary-action="true"
            onClick={handlePrimary}
          >
            <PrimaryIcon size={15} aria-hidden="true" />
            {primary.label}
          </button>
        ) : null}
      </div>

      {versions.length ? (
        <div className="crw-version-list" aria-label="规则版本">
          {versions.map((version) => (
            <div key={version.id} className="crw-version-row">
              <div>
                <strong>V{version.versionNumber}</strong>
                <span>{statusLabel(version.status)}</span>
              </div>
              <p>
                {version.reason ?? "无备注"} · 优先级 {version.priority}
              </p>
              {version.status === "pending_review" || version.status === "active" ? (
                <button type="button" onClick={() => onOpenReview?.(version)}>
                  查看审核
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="crw-muted">暂无已保存版本。</p>
      )}

      <section className="crw-reuse" aria-label="规则复用">
        <div className="crw-panel-heading compact">
          <div>
            <h3>规则复用</h3>
            <p>选择系统模板或机构沉淀模板，克隆后再按目标项目补齐数据。</p>
          </div>
        </div>
        <details id="reuse-advanced-formula" data-testid="reuse-advanced-formula">
          <summary>高级公式</summary>
          <pre>克隆后在草稿中保留公式，默认不展示实现细节。</pre>
        </details>
        <div className="crw-template-list">
          {templates.map((template) => (
            <div
              key={template.id}
              role="group"
              aria-label={template.name}
              className="crw-template-row"
            >
              <div>
                <span className="crw-chip">{templateKindLabel(template.kind)}</span>
                <strong>{template.name}</strong>
                <p>{template.description}</p>
              </div>
              {normalizeTemplateParameters(template).length ? (
                <dl>
                  {normalizeTemplateParameters(template).map((parameter) => (
                    <React.Fragment key={parameter.key}>
                      <dt>{parameter.labelZh}</dt>
                      <dd>{formatParameter(parameter)}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              ) : null}
              {template.kind === "organization" ? (
                <button type="button" onClick={() => handleClone(template)}>
                  <Copy size={14} aria-hidden="true" />
                  克隆为草稿
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => handleClone(template)}>
                    <FilePenLine size={14} aria-hidden="true" />
                    用模板起草
                  </button>
                  <span className="crw-muted">只读</span>
                </>
              )}
            </div>
          ))}
        </div>
        {cloneResult ? (
          <div className="crw-draft-result" role="status">
            <h2>可编辑草稿</h2>
            <p>
              {cloneResult.missingTargetVariables?.length
                ? `缺少目标数据：${cloneResult.missingTargetVariables.join("、")}`
                : "目标数据已满足模板要求"}
            </p>
          </div>
        ) : null}
      </section>
    </section>
  );
}
