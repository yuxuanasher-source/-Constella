import type {
  ShiftChangeQueueItem,
  StreamerLifecycleEventItem,
  StreamerLifecycleOverviewRow,
} from "@/features/streamer-lifecycle/streamer-lifecycle-queries";

const STAGE_LABELS: Record<string, string> = {
  recruited: "招募",
  trial: "试播",
  training: "培训",
  regular: "已转正",
  paused: "暂停合作",
  eliminated: "已淘汰",
};

const TIER_LABELS: Record<string, string> = {
  unassigned: "未分层",
  core: "核心",
  potential: "潜力",
  regular: "常规",
  observation: "观察",
};

const EVENT_LABELS: Record<string, string> = {
  stage_change: "阶段变更",
  rating_change: "评级调整",
  tier_change: "分层调整",
  contract_change: "合同变更",
  assessment_concluded: "考核出结果",
  shift_change_applied: "调班生效",
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  reschedule: "调班",
  substitute: "替班",
};

export function StreamerLifecyclePanel({
  streamers,
  shiftChangeQueue,
  recentEvents,
}: {
  streamers: StreamerLifecycleOverviewRow[];
  shiftChangeQueue: ShiftChangeQueueItem[];
  recentEvents: StreamerLifecycleEventItem[];
}) {
  const stageCounts = new Map<string, number>();
  for (const streamer of streamers) {
    stageCounts.set(
      streamer.lifecycleStage,
      (stageCounts.get(streamer.lifecycleStage) ?? 0) + 1,
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {Object.entries(STAGE_LABELS).map(([stage, label]) => (
          <div
            key={stage}
            className="rounded-lg border border-[var(--line)] bg-white p-4"
          >
            <div className="text-xs text-[var(--ink-300)]">{label}</div>
            <div className="mt-1 text-2xl font-semibold">
              {stageCounts.get(stage) ?? 0}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-white">
        <div className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
          主播档案与绩效分层（{streamers.length}）
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="text-xs text-[var(--ink-300)]">
              <tr>
                <th className="px-4 py-2">主播</th>
                <th className="px-4 py-2">阶段</th>
                <th className="px-4 py-2">评级</th>
                <th className="px-4 py-2">运营分层</th>
                <th className="px-4 py-2">合同期限</th>
                <th className="px-4 py-2">分成</th>
                <th className="px-4 py-2">开播率</th>
                <th className="px-4 py-2">场均流水</th>
                <th className="px-4 py-2">迟到/缺勤</th>
                <th className="px-4 py-2">待考核</th>
              </tr>
            </thead>
            <tbody>
              {streamers.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-8 text-center text-[var(--ink-300)]"
                  >
                    暂无主播档案。
                  </td>
                </tr>
              ) : (
                streamers.map((streamer) => (
                  <tr
                    key={streamer.streamerId}
                    className="border-t border-[var(--line)]"
                  >
                    <td className="px-4 py-2 font-medium">
                      {streamer.displayName}
                      {streamer.operationTags.length > 0 ? (
                        <span className="ml-2 text-xs text-[var(--ink-300)]">
                          {streamer.operationTags.join(" · ")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      {STAGE_LABELS[streamer.lifecycleStage] ??
                        streamer.lifecycleStage}
                    </td>
                    <td className="px-4 py-2 uppercase">
                      {streamer.rating === "unrated" ? "—" : streamer.rating}
                    </td>
                    <td className="px-4 py-2">
                      {TIER_LABELS[streamer.operationTier] ??
                        streamer.operationTier}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {streamer.contractStartDate || streamer.contractEndDate
                        ? `${streamer.contractStartDate ?? "—"} ~ ${streamer.contractEndDate ?? "—"}`
                        : "未登记"}
                    </td>
                    <td className="px-4 py-2">
                      {streamer.revenueShareBps != null
                        ? `${(streamer.revenueShareBps / 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {streamer.broadcastRateBps != null
                        ? `${(streamer.broadcastRateBps / 100).toFixed(1)}%`
                        : "待同步"}
                    </td>
                    <td className="px-4 py-2">
                      {streamer.avgSessionRevenueAmount != null
                        ? `¥${streamer.avgSessionRevenueAmount.toFixed(0)}`
                        : "待同步"}
                    </td>
                    <td className="px-4 py-2">
                      {streamer.lateCount} / {streamer.absentCount}
                    </td>
                    <td className="px-4 py-2">{streamer.pendingAssessments}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-[var(--line)] bg-white">
          <div className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
            待审批调班/替班（{shiftChangeQueue.length}）
          </div>
          {shiftChangeQueue.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-300)]">
              暂无待审批申请。
            </div>
          ) : (
            <ul>
              {shiftChangeQueue.map((item) => (
                <li
                  key={item.requestId}
                  className="border-t border-[var(--line)] px-4 py-3 text-sm first:border-t-0"
                >
                  <div className="font-medium">
                    {item.streamerName} ·{" "}
                    {REQUEST_TYPE_LABELS[item.requestType] ?? item.requestType}
                    {item.substituteStreamerName
                      ? ` → ${item.substituteStreamerName}`
                      : ""}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ink-300)]">
                    {item.proposedStartAt
                      ? `建议时段 ${formatTime(item.proposedStartAt)} ~ ${formatTime(item.proposedEndAt)} · `
                      : ""}
                    {item.reason}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[var(--line)] bg-white">
          <div className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
            最近生命周期事件
          </div>
          {recentEvents.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-300)]">
              暂无事件。
            </div>
          ) : (
            <ul>
              {recentEvents.map((event) => (
                <li
                  key={event.eventId}
                  className="border-t border-[var(--line)] px-4 py-3 text-sm first:border-t-0"
                >
                  <div className="font-medium">
                    {event.streamerName} ·{" "}
                    {EVENT_LABELS[event.eventType] ?? event.eventType}
                    {event.fromValue || event.toValue
                      ? `（${event.fromValue ?? "—"} → ${event.toValue ?? "—"}）`
                      : ""}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ink-300)]">
                    {formatTime(event.createdAt)}
                    {event.reason ? ` · ${event.reason}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function formatTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}
