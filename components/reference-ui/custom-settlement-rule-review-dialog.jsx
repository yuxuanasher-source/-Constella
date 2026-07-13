"use client";

import React from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

const FORCE_ACKNOWLEDGMENT = "I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK";

function scopeLabel(scope) {
  return scope === "payable" ? "主播应付" : "客户应收";
}

function targetLabel(target) {
  if (target?.targetType === "streamer_group") return "主播分组";
  if (target?.targetType === "project_streamer") return "单个主播";
  return "当前项目";
}

function freshnessLabel(value) {
  if (value === "fresh") return "试算新鲜";
  if (value === "stale") return "试算已过期";
  return "试算状态待确认";
}

function lifecycleLabel(rule) {
  if (rule.status === "archived") return "已结束归档";
  if (rule.status === "active" && rule.effectiveUntil) {
    return "当前生效，已设置结束区间";
  }
  if (rule.effectiveFrom && Date.parse(rule.effectiveFrom) > Date.now()) {
    return "未来生效";
  }
  if (rule.status === "pending_review") return "待审核";
  return "当前版本";
}

export default function CustomSettlementRuleReviewDialog({
  open = false,
  rule,
  summary,
  currentUser = { id: null, role: "operator_business" },
  eligibleApproverId = null,
  error = null,
  onApprove,
  onRequestChanges,
  onArchive,
}) {
  const [reason, setReason] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [acknowledgment, setAcknowledgment] = React.useState("");
  const errorRef = React.useRef(null);
  React.useLayoutEffect(() => {
    if (open && error) errorRef.current?.focus();
  }, [error, open]);
  if (!open || !rule) return null;

  const isCreator = currentUser.id && currentUser.id === rule.createdBy;
  const eligibleByUser =
    !eligibleApproverId || eligibleApproverId === currentUser.id;
  const canStandardApprove =
    rule.status === "pending_review" && eligibleByUser && !isCreator;
  const reasonReady = reason.trim().length > 0;
  const changeReady = reasonReady && comment.trim().length > 0;
  const canForceApprove =
    currentUser.role === "owner" &&
    reasonReady &&
    acknowledgment === FORCE_ACKNOWLEDGMENT;

  const submitStandardApprove = () => {
    if (!canStandardApprove || !reasonReady) return;
    onApprove?.({
      ruleVersionId: rule.id,
      effectiveFrom: rule.effectiveFrom,
      reason: reason.trim(),
      force: false,
    });
  };
  const submitRequestChanges = () => {
    if (!changeReady) return;
    onRequestChanges?.({
      ruleVersionId: rule.id,
      reason: reason.trim(),
      comment: comment.trim(),
    });
  };
  const submitForceApprove = () => {
    if (!canForceApprove) return;
    onApprove?.({
      ruleVersionId: rule.id,
      effectiveFrom: rule.effectiveFrom,
      reason: reason.trim(),
      force: true,
      acknowledgment,
    });
  };
  const submitArchive = () => {
    if (!reasonReady) return;
    onArchive?.({ ruleVersionId: rule.id, reason: reason.trim() });
  };

  return (
    <div role="dialog" aria-label="规则审核" className="crw-review-dialog">
      <div className="crw-panel-heading">
        <div>
          <h2>规则审核</h2>
          <p>
            {scopeLabel(rule.scope)} · {targetLabel(rule.target)} ·{" "}
            <span>{lifecycleLabel(rule)}</span>
          </p>
        </div>
      </div>

      <dl className="crw-review-facts">
        <dt>合同变更</dt>
        <dd>
          {summary.contractDiff?.map((item, index) => (
            <span key={`${item.field}-${index}`}>
              {item.before} → {item.after}
            </span>
          ))}
        </dd>
        <dt>最大差异</dt>
        <dd>
          最大差异：{summary.largestDelta?.label} ¥
          {summary.largestDelta?.amountYuan}
        </dd>
        <dt>缺数处理</dt>
        <dd>{summary.missingDataBehavior}</dd>
        <dt>风险</dt>
        <dd>{summary.risk}</dd>
        <dt>创建人</dt>
        <dd>创建人：{summary.creatorName}</dd>
        <dt>试算状态</dt>
        <dd>{freshnessLabel(summary.simulationFreshness)}</dd>
      </dl>

      {error ? (
        <div className="crw-inline-alert" role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </div>
      ) : null}

      {!canStandardApprove && rule.status === "pending_review" ? (
        <p className="crw-muted">需由其他审核人确认生效</p>
      ) : null}

      <label className="crw-field">
        审核原因
        <input
          aria-label="审核原因"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <label className="crw-field">
        修改意见
        <textarea
          aria-label="修改意见"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>

      <div className="crw-action-row">
        {canStandardApprove ? (
          <button
            type="button"
            className="crw-primary"
            data-primary-action="true"
            disabled={!reasonReady}
            onClick={submitStandardApprove}
          >
            <ShieldCheck size={15} aria-hidden="true" />
            确认生效
          </button>
        ) : null}
        <button
          type="button"
          disabled={!changeReady}
          onClick={submitRequestChanges}
        >
          要求修改
        </button>
        {rule.status === "active" ? (
          <button type="button" disabled={!reasonReady} onClick={submitArchive}>
            归档版本
          </button>
        ) : null}
      </div>

      {currentUser.role === "owner" ? (
        <section
          className="crw-force-review"
          role="region"
          aria-label="强制确认"
          data-force-review="true"
        >
          <h3>
            <AlertTriangle size={15} aria-hidden="true" />
            强制确认
          </h3>
          <p>仅负责人可用，会记录单负责人财务风险确认。</p>
          <label className="crw-field">
            强制确认口令
            <input
              aria-label="强制确认口令"
              value={acknowledgment}
              onChange={(event) => setAcknowledgment(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!canForceApprove}
            onClick={submitForceApprove}
          >
            强制确认生效
          </button>
        </section>
      ) : null}
    </div>
  );
}
