// 星耀 AI 助手 · 自我学习与迭代闭环。
// 两条学习通道，均为确定性算法、可复算、可审计：
// 1) 特征权重校准：用「预测 vs 实际结果」的历史样本做有界感知机式更新，
//    持续校准「高 ROI 主播的核心特征」「账号封禁的前置信号」等权重，
//    校准结果经 xingyao-weight-repository 持久化到 scoring_weights；
// 2) 策略验证沉淀：优化建议落地后对比基线指标，验证有效的策略蒸馏成
//    标准化 playbook 写入知识库（复用 knowledge-asset-index 通道），
//    反哺后续诊断与运营流程。

import {
  upsertKnowledgeAssetDocument,
  type KnowledgeAssetIndexClient,
} from "./knowledge-asset-index";
import {
  DEFAULT_XINGYAO_RISK_WEIGHTS,
  scoreRiskSignals,
  XINGYAO_RISK_MODELS,
  type XingyaoRiskModel,
  type XingyaoRiskWeights,
} from "./xingyao-risk-radar";
import { BPS_FLAT, clampBps } from "./xingyao-feature-store";

// —— 通道一：特征权重校准 ————————————————————————————————

export type XingyaoOutcomeSample = {
  model: XingyaoRiskModel;
  // 预测时刻的信号值快照（bps）。
  signals: Record<string, number>;
  // 风险是否真实发生（如账号确实被封、回款确实逾期、主播确实流失）。
  outcomeOccurred: boolean;
};

export type XingyaoCalibrationReport = {
  sampleCount: number;
  hitRateBeforeBps: number;
  hitRateAfterBps: number;
  improved: boolean;
  adjustedWeightKeys: string[];
};

export type XingyaoCalibrationResult = {
  weights: XingyaoRiskWeights;
  report: XingyaoCalibrationReport;
};

const DEFAULT_LEARNING_RATE_BPS = 600;
const HIT_THRESHOLD_BPS = 5_000;

function cloneWeights(weights: XingyaoRiskWeights): XingyaoRiskWeights {
  const cloned = {} as XingyaoRiskWeights;
  for (const model of XINGYAO_RISK_MODELS) {
    cloned[model] = { ...weights[model] };
  }
  return cloned;
}

function hitRateBps(
  samples: XingyaoOutcomeSample[],
  weights: XingyaoRiskWeights,
): number {
  if (samples.length === 0) return 0;
  let hits = 0;
  for (const sample of samples) {
    const { scoreBps } = scoreRiskSignals(
      sample.signals,
      weights[sample.model],
    );
    const predictedOccurred = scoreBps >= HIT_THRESHOLD_BPS;
    if (predictedOccurred === sample.outcomeOccurred) hits += 1;
  }
  return Math.round((hits / samples.length) * BPS_FLAT);
}

// 有界感知机更新：误差 =（实际 − 预测），各信号按「信号强度 × 学习率」
// 分摊误差方向调整权重；权重恒被夹在 0-10000 内（与 scoring_weights 的
// 数据库约束同口径），保证任何样本序列都不会把模型推出安全区间。
export function calibrateXingyaoWeights({
  weights = DEFAULT_XINGYAO_RISK_WEIGHTS,
  samples,
  learningRateBps = DEFAULT_LEARNING_RATE_BPS,
}: {
  weights?: XingyaoRiskWeights;
  samples: XingyaoOutcomeSample[];
  learningRateBps?: number;
}): XingyaoCalibrationResult {
  const next = cloneWeights(weights);
  const hitRateBefore = hitRateBps(samples, weights);
  const adjustedKeys = new Set<string>();

  for (const sample of samples) {
    const modelWeights = next[sample.model];
    const { scoreBps } = scoreRiskSignals(sample.signals, modelWeights);
    const target = sample.outcomeOccurred ? BPS_FLAT : 0;
    const error = target - scoreBps;
    if (error === 0) continue;
    for (const key of Object.keys(sample.signals).sort()) {
      if (!(key in modelWeights)) continue;
      const signalStrength = clampBps(sample.signals[key]) / BPS_FLAT;
      const delta = Math.round(
        (error * signalStrength * learningRateBps) / BPS_FLAT,
      );
      if (delta === 0) continue;
      const updated = clampBps(modelWeights[key] + delta);
      if (updated !== modelWeights[key]) {
        modelWeights[key] = updated;
        adjustedKeys.add(`${sample.model}.${key}`);
      }
    }
  }

  const hitRateAfter = hitRateBps(samples, next);

  return {
    weights: next,
    report: {
      sampleCount: samples.length,
      hitRateBeforeBps: hitRateBefore,
      hitRateAfterBps: hitRateAfter,
      improved: hitRateAfter > hitRateBefore,
      adjustedWeightKeys: [...adjustedKeys].sort(),
    },
  };
}

// —— 通道二：策略验证与沉淀 ————————————————————————————————

export type XingyaoStrategyTrial = {
  id: string;
  title: string;
  hypothesis: string;
  // 干预对象描述，如 "project:xxx" / "streamer:yyy"。
  appliedTo: string;
  metricKey: string;
  baselineBps: number;
  observedBps: number;
  minimumLiftBps: number;
  sampleSize: number;
  minimumSampleSize: number;
};

export type XingyaoStrategyEvaluation = {
  trial: XingyaoStrategyTrial;
  liftBps: number;
  validated: boolean;
  reason: string;
};

export function evaluateStrategyTrials(
  trials: XingyaoStrategyTrial[],
): XingyaoStrategyEvaluation[] {
  return trials.map((trial) => {
    const liftBps = trial.observedBps - trial.baselineBps;
    if (trial.sampleSize < trial.minimumSampleSize) {
      return {
        trial,
        liftBps,
        validated: false,
        reason: "样本量不足，继续观察后再判定",
      };
    }
    if (liftBps < trial.minimumLiftBps) {
      return {
        trial,
        liftBps,
        validated: false,
        reason: "指标提升未达到最小有效阈值",
      };
    }
    return {
      trial,
      liftBps,
      validated: true,
      reason: "指标提升达到阈值且样本量充分，策略验证有效",
    };
  });
}

export type XingyaoPlaybookDocument = {
  organizationId: string;
  docType: "playbook";
  title: string;
  body: string;
  sourceRef: string;
  tags: string[];
  createdBy: string;
};

// 把验证有效的策略蒸馏成标准化 playbook 文档。数字结论全部随 source_ref
// 留痕，知识库内容用于复用方法论而非替代结构化数据查询。
export function buildValidatedStrategyKnowledgeDocument({
  evaluation,
  organizationId,
  createdBy,
}: {
  evaluation: XingyaoStrategyEvaluation;
  organizationId: string;
  createdBy: string;
}): XingyaoPlaybookDocument {
  const { trial } = evaluation;
  const sourceRef = `xingyao_strategy:${trial.id}`;
  const body = [
    `# 星耀策略沉淀：${trial.title}`,
    "",
    `Source: ${sourceRef}`,
    `Applied to: ${trial.appliedTo}`,
    "",
    "## 策略假设",
    trial.hypothesis,
    "",
    "## 验证结果",
    `- 指标：${trial.metricKey}`,
    `- 基线：${trial.baselineBps} bps`,
    `- 观测：${trial.observedBps} bps`,
    `- 提升：${evaluation.liftBps} bps（阈值 ${trial.minimumLiftBps} bps）`,
    `- 样本量：${trial.sampleSize}（下限 ${trial.minimumSampleSize}）`,
    `- 判定：${evaluation.reason}`,
    "",
    "## 复用指引",
    "该策略已通过业务验证，可作为同类卡点的标准化处理方案；",
    "落地前仍需结合当期数据复核适用性，高风险动作必须人工确认。",
    "",
    "Note: numeric facts in this knowledge document remain tied to the source_ref above; operational analysis should still prefer live structured business data.",
  ].join("\n");

  return {
    organizationId,
    docType: "playbook",
    title: `星耀策略沉淀：${trial.title}`,
    body: `${body}\n`,
    sourceRef,
    tags: ["xingyao", "playbook", "validated_strategy", trial.metricKey],
    createdBy,
  };
}

export type XingyaoStrategyCaptureResult = {
  capturedIds: string[];
  skippedCount: number;
};

// 只沉淀验证有效的策略；未通过验证的留在观察池，不污染知识库。
export async function captureValidatedStrategyPlaybooks(
  client: KnowledgeAssetIndexClient,
  {
    organizationId,
    createdBy,
    evaluations,
  }: {
    organizationId: string;
    createdBy: string;
    evaluations: XingyaoStrategyEvaluation[];
  },
): Promise<XingyaoStrategyCaptureResult> {
  const capturedIds: string[] = [];
  let skippedCount = 0;
  for (const evaluation of evaluations) {
    if (!evaluation.validated) {
      skippedCount += 1;
      continue;
    }
    const doc = buildValidatedStrategyKnowledgeDocument({
      evaluation,
      organizationId,
      createdBy,
    });
    const { id } = await upsertKnowledgeAssetDocument(client, {
      organizationId: doc.organizationId,
      docType: doc.docType,
      title: doc.title,
      body: doc.body,
      sourceRef: doc.sourceRef,
      tags: doc.tags,
      createdBy: doc.createdBy,
      metadata: { source: "ai_draft" },
    });
    capturedIds.push(id);
  }
  return { capturedIds, skippedCount };
}

// 校准摘要（供 grounding / 报告展示；数字仅进入 facts 时引用）。
export function calibrationSummaryFacts(
  report: XingyaoCalibrationReport,
): Array<{ statement: string; sourceTool: string; sourceId: string }> {
  return [
    {
      statement: `本轮校准样本量为 ${report.sampleCount}`,
      sourceTool: "xingyao_learning_loop",
      sourceId: "calibration:sampleCount",
    },
    {
      statement: `校准前命中率为 ${report.hitRateBeforeBps} bps`,
      sourceTool: "xingyao_learning_loop",
      sourceId: "calibration:hitRateBeforeBps",
    },
    {
      statement: `校准后命中率为 ${report.hitRateAfterBps} bps`,
      sourceTool: "xingyao_learning_loop",
      sourceId: "calibration:hitRateAfterBps",
    },
  ];
}
