"use client";

import React from "react";
import { AlertTriangle, Users } from "lucide-react";

function localDateTimeToOffset(value) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(
      value,
    );
  if (!match) return value;
  const [, year, month, day, hour, minute, second = "00", fraction = "0"] =
    match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, "0")),
  );
  if (Number.isNaN(date.getTime())) return value;
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${String(second).padStart(2, "0")}.${String(date.getMilliseconds()).padStart(3, "0")}${sign}${offsetHours}:${offsetRemainder}`;
}

export default function CustomSettlementRuleGroupPanel({
  groups = [],
  streamers = [],
  conflict = null,
  onAssign,
}) {
  const blockingConflict =
    conflict ??
    groups.find((group) => group.assignmentConflict?.blocking)
      ?.assignmentConflict ??
    null;
  const [projectStreamerId, setProjectStreamerId] = React.useState("");
  const [groupId, setGroupId] = React.useState("");
  const [effectiveFrom, setEffectiveFrom] = React.useState("");
  const [reason, setReason] = React.useState("");
  const canSubmit =
    !blockingConflict &&
    projectStreamerId &&
    groupId &&
    effectiveFrom &&
    reason.trim().length > 0;

  const unassigned = groups.flatMap((group) =>
    group.unassignedProjectStreamers ?? [],
  );

  const submit = (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    onAssign?.({
      projectStreamerId,
      groupId,
      effectiveFrom: localDateTimeToOffset(effectiveFrom),
      reason: reason.trim(),
    });
  };

  return (
    <section className="crw-group-panel" role="region" aria-label="结算分组">
      <div className="crw-panel-heading">
        <div>
          <h2>结算分组</h2>
          <p>手动分配，非自动归类。分组只按明确成员关系生效。</p>
        </div>
      </div>

      {blockingConflict ? (
        <div className="crw-inline-alert" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          {blockingConflict.message ??
            `分组规则存在冲突：${blockingConflict.blockingCodes.join("、")}`}
        </div>
      ) : null}

      <div className="crw-group-list" aria-label="显式结算分组">
        {groups.map((group) => (
          <div className="crw-group-row" key={group.id}>
            <div>
              <strong>
                <Users size={15} aria-hidden="true" />
                {group.name}
              </strong>
              <p>{group.description ?? "无分组说明"}</p>
            </div>
            <dl>
              <dt>成员</dt>
              <dd>成员 {group.assignmentCount} 人</dd>
              <dt>生效规则</dt>
              <dd>生效规则 {group.activeRuleCount} 条</dd>
              <dt>待审规则</dt>
              <dd>待审规则 {group.pendingRuleCount} 条</dd>
              <dt>未来分配</dt>
              <dd>未来分配 {group.futureAssignmentCount} 条</dd>
            </dl>
          </div>
        ))}
      </div>

      <p className="crw-muted">
        {unassigned.length
          ? `未分组主播：${unassigned
              .map((streamer) => streamer.displayName ?? streamer.projectStreamerId)
              .join("、")}`
          : "暂无未分组主播"}
      </p>

      <form className="crw-group-form" aria-label="调整分组" onSubmit={submit}>
        <label>
          主播
          <select
            aria-label="主播"
            value={projectStreamerId}
            onChange={(event) => setProjectStreamerId(event.target.value)}
          >
            <option value="">选择主播</option>
            {streamers.map((streamer) => (
              <option
                key={streamer.projectStreamerId}
                value={streamer.projectStreamerId}
              >
                {streamer.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          分组
          <select
            aria-label="分组"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">选择分组</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          生效时间
          <input
            aria-label="生效时间"
            type="datetime-local"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </label>
        <label>
          分配原因
          <input
            aria-label="分配原因"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!canSubmit}>
          更新分组
        </button>
      </form>
    </section>
  );
}
