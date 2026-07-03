// 快速通道资格（仅排序/抽检标记，不自动化任何决定）：
// AI 预审高置信通过、硬卡点全 pass，且各硬卡点最近校准窗口漏放率达标
// （n >= 100 且 < 5%）时，标记该件可进入「抽检队列」——审核员仍逐件人工
// 点通过，只是排序和批量化方式不同（PRD 5.4；上播决定为 L4 禁区）。

import {
  checkpointsForStage,
  type AdmissionRubric,
} from "./contracts";
import {
  CALIBRATION_FALSE_PASS_THRESHOLD,
  METRIC_AI_FALSE_PASS,
} from "./metrics";
import type { AdmissionPreReviewView } from "./pre-review";

export const FAST_LANE_MIN_SAMPLE = 100;

export type FastLaneMetricRow = {
  metricKey: string;
  checkpointKey: string | null;
  numerator: number;
  denominator: number;
};

export type FastLaneAssessment = {
  eligible: boolean;
  reasons: string[];
};

export function evaluateFastLaneEligibility({
  preReview,
  rubric,
  metrics,
}: {
  preReview: AdmissionPreReviewView;
  rubric: AdmissionRubric;
  metrics: FastLaneMetricRow[];
}): FastLaneAssessment {
  const reasons: string[] = [];

  if (preReview.decision !== "approved") {
    reasons.push("pre_review_not_approved");
  }
  if (preReview.confidence !== "high") {
    reasons.push("pre_review_confidence_not_high");
  }

  const verdictByKey = new Map(
    preReview.checkpoints.map((checkpoint) => [
      checkpoint.key,
      checkpoint.verdict,
    ]),
  );
  const hardBlocks = checkpointsForStage(rubric, "mcn_first").filter(
    (checkpoint) => checkpoint.severity === "hard_block",
  );

  for (const checkpoint of hardBlocks) {
    if (verdictByKey.get(checkpoint.key) !== "pass") {
      reasons.push(`hard_block_not_pass:${checkpoint.key}`);
      continue;
    }
    const metric = metrics.find(
      (row) =>
        row.metricKey === METRIC_AI_FALSE_PASS &&
        row.checkpointKey === checkpoint.key,
    );
    if (!metric || metric.denominator < FAST_LANE_MIN_SAMPLE) {
      reasons.push(`insufficient_calibration_sample:${checkpoint.key}`);
      continue;
    }
    if (
      metric.numerator / metric.denominator >
      CALIBRATION_FALSE_PASS_THRESHOLD
    ) {
      reasons.push(`false_pass_over_threshold:${checkpoint.key}`);
    }
  }

  return { eligible: reasons.length === 0, reasons };
}
