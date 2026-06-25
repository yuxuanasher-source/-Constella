// L1 感知（方案第 3.4 / 第 8 节）：截图 OCR 之后的「偏差计算」与「三轨颜色预判」。
// 关键：颜色「预判」复用规则引擎的权威裁决函数 resolveReportEvidence —— AI 只预判、
// 不落库；真实颜色仍由规则引擎裁决并写入后冻结（铁律 3）。这样预判与裁决天然同源，
// 便于度量「偏差预判准确率」，并在提交时引导主播重传、把打回率压在源头。

import {
  resolveReportEvidence,
  type EvidenceLevel,
  type TimeSource,
} from "@/features/live-operations/live-report-evidence";

const DEFAULT_THRESHOLD_PCT = 0.1;
const DEFAULT_THRESHOLD_MIN = 15;

export type DeviationResult = {
  systemMinutes: number | null;
  screenMinutes: number | null;
  absoluteDiffMinutes: number | null;
  divergencePct: number | null;
  allowedDiffMinutes: number | null;
  withinThreshold: boolean | null;
};

function toMinutes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

// 纯偏差计算（与规则引擎同口径：阈值 = max(系统×10%, 15min)）。
export function computeDeviation(
  systemMinutes: unknown,
  screenMinutes: unknown,
  thresholds?: { pct?: number; min?: number },
): DeviationResult {
  const pct = thresholds?.pct ?? DEFAULT_THRESHOLD_PCT;
  const min = thresholds?.min ?? DEFAULT_THRESHOLD_MIN;
  const s = toMinutes(systemMinutes);
  const c = toMinutes(screenMinutes);
  if (s === null || c === null) {
    return {
      systemMinutes: s,
      screenMinutes: c,
      absoluteDiffMinutes: null,
      divergencePct: null,
      allowedDiffMinutes: null,
      withinThreshold: null,
    };
  }
  const abs = Math.abs(s - c);
  const divergencePct = Math.round((abs / Math.max(s, 1)) * 10_000) / 10_000;
  const allowed = Math.max(s * pct, min);
  return {
    systemMinutes: s,
    screenMinutes: c,
    absoluteDiffMinutes: abs,
    divergencePct,
    allowedDiffMinutes: allowed,
    withinThreshold: abs <= allowed,
  };
}

export type EvidencePrediction = {
  evidenceLevel: EvidenceLevel | null;
  timeSource: TimeSource | null;
  settlementDuration: number | null;
  divergencePct: number | null;
  riskFlags: string[];
  cptEligible: boolean;
  rejected: boolean;
  guidance: string;
  note: string;
};

const NOTE = "AI 预判，仅供参考；最终颜色由规则引擎裁决并写入后冻结。";

const SOURCE_CN: Record<TimeSource, string> = {
  system: "系统",
  screenshot: "截图",
  claimed: "申报",
};
const COLOR_CN: Record<EvidenceLevel, string> = {
  green: "绿",
  yellow: "黄",
  red: "红",
};

function guidanceFor(level: EvidenceLevel, riskFlags: string[]): string {
  if (level === "green") return "证据齐全，大概率判绿（取系统时长，可计 CPT），可正常提交。";
  if (level === "yellow") {
    if (riskFlags.includes("missing_screenshot_duration")) {
      return "缺少下播截图时长，大概率判黄（仅承载、不计 CPT）。建议补传清晰的开/收播截图后重新提交。";
    }
    if (riskFlags.includes("duration_divergence")) {
      return "截图时长与系统计时偏差超阈值，大概率判黄（不计 CPT）。请核对截图是否为本场完整开收播，必要时重传更清晰的截图。";
    }
    return "大概率判黄（仅承载、不计 CPT），建议补充证据后重新提交。";
  }
  return "无系统计时且缺截图，大概率判红（仅承载、不计 CPT）。请尽快补传开/收播截图以提高结算等级。";
}

// 颜色预判：复用规则引擎裁决函数；无任何可用时长 → 预判会被拒绝入库。
export function predictEvidence(input: {
  systemMinutes?: unknown;
  screenMinutes?: unknown;
  declaredMinutes?: unknown;
  thresholdPct?: number;
  thresholdMin?: number;
}): EvidencePrediction {
  try {
    const snap = resolveReportEvidence({
      systemDuration: toMinutes(input.systemMinutes),
      screenshotDuration: toMinutes(input.screenMinutes),
      claimedDuration: toMinutes(input.declaredMinutes),
      divergenceThresholdPct: input.thresholdPct,
      divergenceThresholdMin: input.thresholdMin,
    });
    const cptEligible =
      snap.evidenceLevel === "green" && snap.timeSource === "system";
    return {
      evidenceLevel: snap.evidenceLevel,
      timeSource: snap.timeSource,
      settlementDuration: snap.settlementDuration,
      divergencePct: snap.divergencePct,
      riskFlags: snap.riskFlags,
      cptEligible,
      rejected: false,
      guidance: guidanceFor(snap.evidenceLevel, snap.riskFlags),
      note: NOTE,
    };
  } catch {
    return {
      evidenceLevel: null,
      timeSource: null,
      settlementDuration: null,
      divergencePct: null,
      riskFlags: ["missing_system_duration", "missing_screenshot_duration"],
      cptEligible: false,
      rejected: true,
      guidance:
        "无任何可用时长（系统计时 / 下播截图 / 申报均缺），将被拒绝入库。请至少补传一张开/收播截图。",
      note: NOTE,
    };
  }
}

export function predictionSummary(p: EvidencePrediction): string {
  if (p.rejected || !p.evidenceLevel) return `预判：拒绝入库。${p.guidance}`;
  const src = p.timeSource ? SOURCE_CN[p.timeSource] : "—";
  const cpt = p.cptEligible ? "可计 CPT" : "不计 CPT";
  return `预判：${COLOR_CN[p.evidenceLevel]}（取${src}时长 · ${cpt}）。${p.guidance}`;
}

export function deviationSummary(r: DeviationResult): string {
  if (r.withinThreshold === null) {
    return "缺少可比对的系统时长或截图时长，无法计算偏差。";
  }
  const pct = ((r.divergencePct ?? 0) * 100).toFixed(1);
  return `偏差 ${pct}%（${r.absoluteDiffMinutes} 分钟），阈值 ${r.allowedDiffMinutes} 分钟，${r.withinThreshold ? "在阈值内（大概率判绿）" : "超阈值（大概率判黄）"}。`;
}
