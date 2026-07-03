import type { RecordingAssetDto } from "./recording-assets";

/**
 * 直播质量结构化分析：把录屏帧级信号聚合成可量化指标——有效开播时长、
 * 挂机时长、游戏画面占比、主播露脸占比，并给出有效度与合规性判定。
 * 输入信号可以来自上游抽帧识别结果（uploaded），也可以在缺少原始信号时
 * 由资产元数据推导出保守的兜底信号（derived），两种来源都会显式标注。
 */

export type RecordingFrameSignal = {
  atSeconds: number;
  isGameScreen: boolean;
  isFaceVisible: boolean;
  isIdle: boolean;
};

export type RecordingQualitySignalSource = "derived" | "uploaded";

export type RecordingQualitySignals = {
  durationSeconds: number;
  sampleIntervalSeconds: number;
  frames: RecordingFrameSignal[];
  source: RecordingQualitySignalSource;
};

export type RecordingEffectivenessVerdict =
  | "effective"
  | "below_standard"
  | "invalid";

export type RecordingComplianceVerdict = "pass" | "needs_review" | "violation";

export type RecordingQualityThresholds = {
  /** 有效时长占比达到该值判定为有效直播。 */
  minEffectiveRatioBps: number;
  /** 挂机占比超过该值直接拉低有效度判定。 */
  maxIdleRatioBps: number;
  /** 游戏直播场景下游戏画面占比的达标线。 */
  minGameScreenRatioBps: number;
  /** 露脸占比达标线，低于该值提示复核开播状态。 */
  minFaceVisibleRatioBps: number;
  /** 有效开播时长绝对下限（秒），低于该值判定无效。 */
  minEffectiveSeconds: number;
};

export type RecordingQualityMetrics = {
  durationSeconds: number;
  effectiveSeconds: number;
  idleSeconds: number;
  gameScreenRatioBps: number;
  faceVisibleRatioBps: number;
  effectiveRatioBps: number;
  effectivenessVerdict: RecordingEffectivenessVerdict;
  complianceVerdict: RecordingComplianceVerdict;
  findings: string[];
  signalSource: RecordingQualitySignalSource;
};

export const defaultRecordingQualityThresholds: RecordingQualityThresholds = {
  minEffectiveRatioBps: 7000,
  maxIdleRatioBps: 1500,
  minGameScreenRatioBps: 6000,
  minFaceVisibleRatioBps: 3000,
  minEffectiveSeconds: 1200,
};

export function analyzeRecordingQuality({
  signals,
  thresholds = defaultRecordingQualityThresholds,
  hasComplianceRiskSignal = false,
}: {
  signals: RecordingQualitySignals;
  thresholds?: RecordingQualityThresholds;
  /** 上游风险检测发现高危告警时传入，用于给出违规判定。 */
  hasComplianceRiskSignal?: boolean;
}): RecordingQualityMetrics {
  const durationSeconds = Math.max(0, Math.trunc(signals.durationSeconds));
  const interval = Math.max(1, Math.trunc(signals.sampleIntervalSeconds));
  const frames = [...signals.frames].sort(
    (left, right) => left.atSeconds - right.atSeconds,
  );

  let idleSampled = 0;
  let gameSampled = 0;
  let faceSampled = 0;
  for (const frame of frames) {
    if (frame.isIdle) {
      idleSampled += 1;
    }
    if (frame.isGameScreen) {
      gameSampled += 1;
    }
    if (frame.isFaceVisible) {
      faceSampled += 1;
    }
  }

  const sampledSeconds = frames.length * interval;
  const coverage = sampledSeconds > 0 ? frames.length : 0;
  const idleSeconds = clampSeconds(
    coverage > 0 ? Math.round((idleSampled / coverage) * durationSeconds) : 0,
    durationSeconds,
  );
  const effectiveSeconds = clampSeconds(
    durationSeconds - idleSeconds,
    durationSeconds,
  );
  const gameScreenRatioBps = ratioBps(gameSampled, coverage);
  const faceVisibleRatioBps = ratioBps(faceSampled, coverage);
  const effectiveRatioBps = ratioBps(effectiveSeconds, durationSeconds);
  const idleRatioBps = ratioBps(idleSeconds, durationSeconds);

  const findings: string[] = [];
  if (signals.source === "derived") {
    findings.push(
      "本次指标基于资产元数据推导的兜底信号，接入抽帧识别结果后会自动替换。",
    );
  }
  if (coverage === 0) {
    findings.push("缺少帧级采样信号，时长类指标不可用，需人工复核原片。");
  }
  if (idleRatioBps > thresholds.maxIdleRatioBps) {
    findings.push(
      `挂机占比 ${formatBps(idleRatioBps)} 超过阈值 ${formatBps(
        thresholds.maxIdleRatioBps,
      )}，建议核对挂机时间段。`,
    );
  }
  if (gameScreenRatioBps < thresholds.minGameScreenRatioBps) {
    findings.push(
      `游戏画面占比 ${formatBps(gameScreenRatioBps)} 低于达标线 ${formatBps(
        thresholds.minGameScreenRatioBps,
      )}，需确认是否偏离项目内容要求。`,
    );
  }
  if (faceVisibleRatioBps < thresholds.minFaceVisibleRatioBps) {
    findings.push(
      `露脸占比 ${formatBps(faceVisibleRatioBps)} 低于达标线 ${formatBps(
        thresholds.minFaceVisibleRatioBps,
      )}，请复核是否符合项目开播要求。`,
    );
  }

  const effectivenessVerdict = resolveEffectiveness({
    durationSeconds,
    effectiveSeconds,
    effectiveRatioBps,
    idleRatioBps,
    coverage,
    thresholds,
  });
  const complianceVerdict: RecordingComplianceVerdict = hasComplianceRiskSignal
    ? "violation"
    : effectivenessVerdict === "invalid" || coverage === 0
      ? "needs_review"
      : gameScreenRatioBps < thresholds.minGameScreenRatioBps
        ? "needs_review"
        : "pass";

  if (effectivenessVerdict === "effective" && findings.length === 0) {
    findings.push("有效时长、画面占比与露脸占比均达标。");
  }

  return {
    durationSeconds,
    effectiveSeconds,
    idleSeconds,
    gameScreenRatioBps,
    faceVisibleRatioBps,
    effectiveRatioBps,
    effectivenessVerdict,
    complianceVerdict,
    findings,
    signalSource: signals.source,
  };
}

/**
 * 缺少抽帧识别结果时，从资产元数据推导保守的兜底信号：按每分钟一帧采样，
 * 默认游戏画面在线、开场与结尾露脸、无挂机；被驳回的资产标记中段挂机
 * 样本，促使指标进入人工复核而不是给出虚高结论。
 */
export function deriveQualitySignalsFromAsset(
  asset: Pick<RecordingAssetDto, "durationSeconds" | "reviewStatus">,
): RecordingQualitySignals {
  const durationSeconds = Math.max(
    0,
    Math.trunc(asset.durationSeconds ?? 0),
  );
  const interval = 60;
  const frameCount = Math.floor(durationSeconds / interval);
  const rejected = asset.reviewStatus === "rejected";

  const frames: RecordingFrameSignal[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const atSeconds = index * interval;
    const progress = frameCount > 1 ? index / (frameCount - 1) : 0;
    frames.push({
      atSeconds,
      isGameScreen: true,
      isFaceVisible: progress <= 0.2 || progress >= 0.8,
      isIdle: rejected && progress > 0.4 && progress < 0.6,
    });
  }

  return {
    durationSeconds,
    sampleIntervalSeconds: interval,
    frames,
    source: "derived",
  };
}

function resolveEffectiveness({
  durationSeconds,
  effectiveSeconds,
  effectiveRatioBps,
  idleRatioBps,
  coverage,
  thresholds,
}: {
  durationSeconds: number;
  effectiveSeconds: number;
  effectiveRatioBps: number;
  idleRatioBps: number;
  coverage: number;
  thresholds: RecordingQualityThresholds;
}): RecordingEffectivenessVerdict {
  if (durationSeconds === 0 || coverage === 0) {
    return "invalid";
  }
  if (effectiveSeconds < thresholds.minEffectiveSeconds) {
    return "invalid";
  }
  if (
    effectiveRatioBps < thresholds.minEffectiveRatioBps ||
    idleRatioBps > thresholds.maxIdleRatioBps
  ) {
    return "below_standard";
  }
  return "effective";
}

function ratioBps(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(10000, Math.round((part / whole) * 10000)));
}

function clampSeconds(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}
