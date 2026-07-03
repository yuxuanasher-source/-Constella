// 审核校准指标（确定性，零 token）：从对齐信号聚合出一致率/漏放/误拦/一审漏判，
// 并在样本量足够时生成阈值调整提案（L2 草稿，人工确认后才允许改校准配置）。

import type { AiDraftEnvelope } from "@/features/ai/drafts";

import type { AiVsMcnSignalPayload, McnVsVendorSignalPayload } from "./signals";

export const METRIC_AI_MCN_AGREEMENT = "ai_mcn_agreement";
export const METRIC_AI_FALSE_PASS = "ai_false_pass";
export const METRIC_AI_FALSE_BLOCK = "ai_false_block";
export const METRIC_MCN_MISS = "mcn_miss";
export const METRIC_VENDOR_REJECT_REASON = "vendor_reject_reason";

// 小样本不出提案（PRD 5.1：防过拟合）。
export const CALIBRATION_MIN_SAMPLE = 30;
export const CALIBRATION_FALSE_PASS_THRESHOLD = 0.05;

export type MetricRow = {
  metricKey: string;
  checkpointKey: string;
  numerator: number;
  denominator: number;
};

export type CalibrationProposal = {
  checkpointKey: string;
  falsePassRate: number;
  sampleSize: number;
  suggestion: string;
};

export type SignalRowInput = {
  signal_kind: string;
  payload: unknown;
};

function isAiVsMcnPayload(value: unknown): value is AiVsMcnSignalPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as AiVsMcnSignalPayload).checkpointDeltas) &&
      typeof (value as AiVsMcnSignalPayload).mcnDecision === "string",
  );
}

function isMcnVsVendorPayload(
  value: unknown,
): value is McnVsVendorSignalPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as McnVsVendorSignalPayload).mcnDecision === "string" &&
      typeof (value as McnVsVendorSignalPayload).vendorDecision === "string",
  );
}

export function computeAdmissionReviewMetrics(
  signals: SignalRowInput[],
): MetricRow[] {
  const aiVsMcn = signals
    .filter((signal) => signal.signal_kind === "ai_vs_mcn")
    .map((signal) => signal.payload as AiVsMcnSignalPayload)
    .filter(isAiVsMcnPayload);
  const mcnVsVendor = signals
    .filter((signal) => signal.signal_kind === "mcn_vs_vendor")
    .map((signal) => signal.payload as McnVsVendorSignalPayload)
    .filter(isMcnVsVendorPayload);

  const rows: MetricRow[] = [];

  // 整体一致率。
  if (aiVsMcn.length) {
    rows.push({
      metricKey: METRIC_AI_MCN_AGREEMENT,
      checkpointKey: "",
      numerator: aiVsMcn.filter((payload) => payload.overallAgreement).length,
      denominator: aiVsMcn.length,
    });
  }

  // 逐卡点：一致率 / 漏放（AI pass 人工 fail）/ 误拦（AI fail 人工 pass）。
  const perCheckpoint = new Map<
    string,
    { both: number; match: number; falsePass: number; falseBlock: number }
  >();
  for (const payload of aiVsMcn) {
    for (const delta of payload.checkpointDeltas) {
      if (delta.ai === null || delta.mcn === null) {
        continue;
      }
      const stats = perCheckpoint.get(delta.key) ?? {
        both: 0,
        match: 0,
        falsePass: 0,
        falseBlock: 0,
      };
      stats.both += 1;
      if (delta.match) {
        stats.match += 1;
      }
      if (delta.ai === "pass" && delta.mcn === "fail") {
        stats.falsePass += 1;
      }
      if (delta.ai === "fail" && delta.mcn === "pass") {
        stats.falseBlock += 1;
      }
      perCheckpoint.set(delta.key, stats);
    }
  }
  for (const [key, stats] of [...perCheckpoint.entries()].sort()) {
    rows.push(
      {
        metricKey: METRIC_AI_MCN_AGREEMENT,
        checkpointKey: key,
        numerator: stats.match,
        denominator: stats.both,
      },
      {
        metricKey: METRIC_AI_FALSE_PASS,
        checkpointKey: key,
        numerator: stats.falsePass,
        denominator: stats.both,
      },
      {
        metricKey: METRIC_AI_FALSE_BLOCK,
        checkpointKey: key,
        numerator: stats.falseBlock,
        denominator: stats.both,
      },
    );
  }

  // 一审漏判：分母 = 一审通过且有二审结论的件。
  const mcnApproved = mcnVsVendor.filter(
    (payload) => payload.mcnDecision === "approved",
  );
  if (mcnApproved.length) {
    rows.push({
      metricKey: METRIC_MCN_MISS,
      checkpointKey: "",
      numerator: mcnApproved.filter((payload) => payload.mcnMiss).length,
      denominator: mcnApproved.length,
    });
  }

  // 漏判理由码分布：帮助定位一审盲区。
  const misses = mcnApproved.filter((payload) => payload.mcnMiss);
  const reasonCounts = new Map<string, number>();
  for (const payload of misses) {
    for (const code of payload.vendorReasonCodes) {
      reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
    }
  }
  for (const [code, count] of [...reasonCounts.entries()].sort()) {
    rows.push({
      metricKey: METRIC_VENDOR_REJECT_REASON,
      checkpointKey: code,
      numerator: count,
      denominator: misses.length,
    });
  }

  return rows;
}

/**
 * 阈值调整提案：仅当逐卡点漏放率超阈且样本量达标。提案是 L2 草稿——
 * 人工确认后才允许写 admission_review_calibration，AI 永不自改阈值。
 */
export function buildCalibrationProposals(rows: MetricRow[]): CalibrationProposal[] {
  return rows
    .filter(
      (row) =>
        row.metricKey === METRIC_AI_FALSE_PASS &&
        row.checkpointKey &&
        row.denominator >= CALIBRATION_MIN_SAMPLE &&
        row.numerator / row.denominator > CALIBRATION_FALSE_PASS_THRESHOLD,
    )
    .map((row) => {
      const rate = row.numerator / row.denominator;
      return {
        checkpointKey: row.checkpointKey,
        falsePassRate: Math.round(rate * 1000) / 1000,
        sampleSize: row.denominator,
        suggestion: `卡点 ${row.checkpointKey} 近窗口漏放率 ${(rate * 100).toFixed(1)}%（n=${row.denominator}），建议提高该卡点的预审置信度门槛或分数 cutoff，并加强一审抽查。`,
      };
    });
}

/**
 * 校准提案 → L2 草稿信封（走 ai_drafts 的 pending -> 人工 confirm 流）。
 * 确认动作本身不自动改配置；由人工在校准配置接口上落实。
 */
export function buildAdmissionCalibrationDraft(
  proposal: CalibrationProposal,
  window: { periodStart: string; periodEnd: string },
): AiDraftEnvelope {
  return {
    draftType: "admission_calibration",
    status: "pending",
    targetStateMachine: "admission_review_calibration",
    targetState: "proposed",
    payload: {
      checkpointKey: proposal.checkpointKey,
      falsePassRate: proposal.falsePassRate,
      sampleSize: proposal.sampleSize,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      // createAiDraft 只持久化 payload，提案文案随 payload 存。
      suggestion: proposal.suggestion,
      requiresHumanApproval: true,
    },
    note: proposal.suggestion,
  };
}
