// L3 受限执行的确定性动作构建器（方案第 3.4 / 7.3 节）。这些是纯函数：报数初筛
// 排序、打回理由生成 —— 不改状态、不写库，输出供运营参考 / 喂给确认网关。
// 真正改状态的 L3 动作（异常工单、通知）经 bounded-gateway 的网关兜底。

export type ReportQueueItem = {
  id: string;
  streamerName?: string | null;
  projectName?: string | null;
  evidenceLevel?: "green" | "yellow" | "red" | null;
  deviationPct?: number | null;
  riskLevel?: string | null;
  submittedAt?: string | null;
};

export type RankedReport = ReportQueueItem & {
  lane: "review" | "normal" | "fast";
  priority: number; // 越小越靠前
  reason: string;
};

// 绿灯快速通道、可疑顶前：弱证据 / 高偏差 / 高风险主播置于复核队列最前。
function laneFor(item: ReportQueueItem): {
  lane: RankedReport["lane"];
  weight: number;
  reason: string;
} {
  const risk = String(item.riskLevel ?? "").toLowerCase();
  const deviation = Math.abs(Number(item.deviationPct ?? 0));
  if (risk === "blacklisted") {
    return { lane: "review", weight: 0, reason: "高风险主播：优先复核" };
  }
  if (item.evidenceLevel === "red") {
    return { lane: "review", weight: 1, reason: "红灯证据：仅申报，优先复核" };
  }
  if (item.evidenceLevel === "yellow" || deviation >= 10) {
    return { lane: "review", weight: 2, reason: "弱证据 / 偏差超阈值：优先复核" };
  }
  if (risk === "high") {
    return { lane: "review", weight: 3, reason: "高风险主播：建议复核" };
  }
  if (item.evidenceLevel === "green") {
    return { lane: "fast", weight: 8, reason: "绿灯证据：可快速通过" };
  }
  return { lane: "normal", weight: 5, reason: "常规复核" };
}

export function rankReportQueue(items: ReportQueueItem[]): RankedReport[] {
  return (items ?? [])
    .map((item) => {
      const { lane, weight, reason } = laneFor(item);
      return { item, lane, weight, reason };
    })
    .sort(
      (a, b) =>
        a.weight - b.weight ||
        String(a.item.submittedAt ?? "").localeCompare(
          String(b.item.submittedAt ?? ""),
        ) ||
        String(a.item.id).localeCompare(String(b.item.id)),
    )
    .map(({ item, lane, weight, reason }, index) => ({
      ...item,
      lane,
      priority: index + 1,
      reason: `${reason}（权重 ${weight}）`,
    }));
}

// 打回理由：由确定性证据标记生成结构化理由，不依赖自由文本。
export type RejectionReason = {
  codes: string[];
  reasons: string[];
  suggestion: string;
};

const REASON_TEXT: Record<string, string> = {
  missing_system_duration: "无系统计时，仅凭主播填报无法可信结算",
  missing_screenshot_duration: "缺少下播截图时长，证据不足",
  duration_divergence: "系统计时与截图时长偏差超过阈值",
};

export function generateRejectionReason(report: {
  evidenceLevel?: "green" | "yellow" | "red" | null;
  riskFlags?: string[];
  deviationPct?: number | null;
}): RejectionReason {
  const codes = new Set<string>(report.riskFlags ?? []);
  const deviation = Math.abs(Number(report.deviationPct ?? 0));
  if (deviation >= 10) codes.add("duration_divergence");
  if (report.evidenceLevel === "red") codes.add("missing_system_duration");

  const codeList = [...codes];
  const reasons = codeList
    .map((code) => REASON_TEXT[code])
    .filter((text): text is string => Boolean(text));

  const suggestion = codes.has("missing_screenshot_duration")
    ? "请补传清晰的开/收播截图后重新提交。"
    : codes.has("duration_divergence")
      ? "请核对截图是否为本场完整开收播，必要时重传。"
      : "请补充可信证据后重新提交。";

  return {
    codes: codeList,
    reasons: reasons.length ? reasons : ["证据不足，无法通过"],
    suggestion,
  };
}
