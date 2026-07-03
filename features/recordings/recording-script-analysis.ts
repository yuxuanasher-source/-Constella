/**
 * 话术与转化分析：对直播语音转写文本逐句分类（转化引导 / 游戏讲解 / 互动 /
 * 其他），统计出现频次与占比，对标高 ROI 主播的话术结构基线，产出可执行的
 * 话术优化建议。所有建议都要求人工确认后才能落到主播培训或画像。
 */

export type RecordingTranscriptLine = {
  atSeconds: number;
  text: string;
};

export type ScriptCategory =
  | "conversion"
  | "game_explain"
  | "interaction"
  | "other";

export type ScriptCategoryStat = {
  category: ScriptCategory;
  label: string;
  count: number;
  ratioBps: number;
  perHour: number;
};

export type ScriptBenchmark = {
  /** 转化引导话术占比基线（bps）。 */
  conversionRatioBps: number;
  /** 游戏讲解话术占比基线（bps）。 */
  gameExplainRatioBps: number;
  /** 互动话术占比基线（bps）。 */
  interactionRatioBps: number;
  source: "default_high_roi" | "org_calibrated";
  sampleSize: number;
};

export type ScriptBenchmarkGap = {
  category: Exclude<ScriptCategory, "other">;
  label: string;
  actualBps: number;
  benchmarkBps: number;
  gapBps: number;
  verdict: "above" | "on_par" | "below";
};

export type ScriptSuggestion = {
  title: string;
  detail: string;
  requiresHumanApproval: true;
};

export type RecordingScriptInsights = {
  totalLines: number;
  categoryStats: ScriptCategoryStat[];
  benchmark: ScriptBenchmark;
  benchmarkGaps: ScriptBenchmarkGap[];
  suggestions: ScriptSuggestion[];
  transcriptSource: "none" | "uploaded";
};

export const scriptCategoryLabels: Record<ScriptCategory, string> = {
  conversion: "转化引导",
  game_explain: "游戏讲解",
  interaction: "互动话术",
  other: "其他",
};

/** 高 ROI 主播话术结构默认基线，组织校准后会被 learned 版本替换。 */
export const defaultScriptBenchmark: ScriptBenchmark = {
  conversionRatioBps: 1800,
  gameExplainRatioBps: 3500,
  interactionRatioBps: 3000,
  source: "default_high_roi",
  sampleSize: 0,
};

const conversionKeywords = [
  "下载",
  "下单",
  "礼物",
  "关注",
  "点关注",
  "粉丝团",
  "福袋",
  "口令",
  "礼包",
  "充值",
  "首充",
  "新人福利",
  "链接",
  "小风车",
  "预约",
];

const gameExplainKeywords = [
  "技能",
  "装备",
  "出装",
  "阵容",
  "操作",
  "攻略",
  "玩法",
  "副本",
  "关卡",
  "角色",
  "英雄",
  "抽卡",
  "养成",
  "版本",
  "节奏点",
];

const interactionKeywords = [
  "弹幕",
  "评论",
  "欢迎",
  "感谢",
  "谢谢",
  "老铁",
  "家人们",
  "宝子",
  "问一下",
  "大家觉得",
  "扣个",
  "刷个",
  "回答",
  "点歌",
];

/**
 * 逐句分类：转化引导优先级最高（直接影响 ROI），其次游戏讲解，再次互动；
 * 同一句可能命中多个词库时按该优先级归类，保证统计口径稳定。
 */
export function classifyScriptLine(text: string): ScriptCategory {
  const normalized = text.trim();
  if (!normalized) {
    return "other";
  }
  if (matchesAny(normalized, conversionKeywords)) {
    return "conversion";
  }
  if (matchesAny(normalized, gameExplainKeywords)) {
    return "game_explain";
  }
  if (matchesAny(normalized, interactionKeywords)) {
    return "interaction";
  }
  return "other";
}

export function analyzeRecordingScript({
  transcript,
  durationSeconds,
  benchmark = defaultScriptBenchmark,
}: {
  transcript: RecordingTranscriptLine[];
  durationSeconds: number;
  benchmark?: ScriptBenchmark;
}): RecordingScriptInsights {
  const lines = transcript.filter((line) => line.text.trim().length > 0);
  const totalLines = lines.length;

  if (totalLines === 0) {
    return {
      totalLines: 0,
      categoryStats: [],
      benchmark,
      benchmarkGaps: [],
      suggestions: [
        {
          title: "接入语音转写",
          detail:
            "本场录屏没有可用的语音转写文本，无法进行话术与转化分析；请开启 ASR 转写或补传字幕文件。",
          requiresHumanApproval: true,
        },
      ],
      transcriptSource: "none",
    };
  }

  const counts: Record<ScriptCategory, number> = {
    conversion: 0,
    game_explain: 0,
    interaction: 0,
    other: 0,
  };
  for (const line of lines) {
    counts[classifyScriptLine(line.text)] += 1;
  }

  const hours = Math.max(durationSeconds, 1) / 3600;
  const categoryStats = (
    ["conversion", "game_explain", "interaction", "other"] as ScriptCategory[]
  ).map((category) => ({
    category,
    label: scriptCategoryLabels[category],
    count: counts[category],
    ratioBps: ratioBps(counts[category], totalLines),
    perHour: Math.round((counts[category] / hours) * 10) / 10,
  }));

  const benchmarkGaps = buildBenchmarkGaps(categoryStats, benchmark);
  const suggestions = buildSuggestions(benchmarkGaps, benchmark);

  return {
    totalLines,
    categoryStats,
    benchmark,
    benchmarkGaps,
    suggestions,
    transcriptSource: "uploaded",
  };
}

const ON_PAR_TOLERANCE_BPS = 500;

function buildBenchmarkGaps(
  stats: ScriptCategoryStat[],
  benchmark: ScriptBenchmark,
): ScriptBenchmarkGap[] {
  const benchmarkByCategory: Record<
    Exclude<ScriptCategory, "other">,
    number
  > = {
    conversion: benchmark.conversionRatioBps,
    game_explain: benchmark.gameExplainRatioBps,
    interaction: benchmark.interactionRatioBps,
  };

  return stats
    .filter(
      (stat): stat is ScriptCategoryStat & {
        category: Exclude<ScriptCategory, "other">;
      } => stat.category !== "other",
    )
    .map((stat) => {
      const benchmarkBps = benchmarkByCategory[stat.category];
      const gapBps = stat.ratioBps - benchmarkBps;
      return {
        category: stat.category,
        label: stat.label,
        actualBps: stat.ratioBps,
        benchmarkBps,
        gapBps,
        verdict:
          gapBps > ON_PAR_TOLERANCE_BPS
            ? ("above" as const)
            : gapBps < -ON_PAR_TOLERANCE_BPS
              ? ("below" as const)
              : ("on_par" as const),
      };
    });
}

const improvementAdvice: Record<Exclude<ScriptCategory, "other">, string> = {
  conversion:
    "转化引导话术密度低于高 ROI 基线，建议在固定节奏点（开场、福利节点、下播前）加入下载/关注/礼物引导，并复用组织内高转化话术模板。",
  game_explain:
    "游戏讲解占比低于基线，观众留存依赖内容深度，建议围绕版本玩法、出装或阵容做结构化讲解段落。",
  interaction:
    "互动话术占比低于基线，建议增加弹幕点名、提问和欢迎话术，把单向讲解改为双向互动。",
};

function buildSuggestions(
  gaps: ScriptBenchmarkGap[],
  benchmark: ScriptBenchmark,
): ScriptSuggestion[] {
  const suggestions: ScriptSuggestion[] = gaps
    .filter((gap) => gap.verdict === "below")
    .map((gap) => ({
      title: `提升${gap.label}密度`,
      detail: `${improvementAdvice[gap.category]}（当前 ${formatBps(
        gap.actualBps,
      )}，基线 ${formatBps(gap.benchmarkBps)}）`,
      requiresHumanApproval: true as const,
    }));

  if (suggestions.length === 0) {
    suggestions.push({
      title: "保持话术结构",
      detail: `话术结构已达到${
        benchmark.source === "org_calibrated"
          ? "组织校准后的高 ROI"
          : "默认高 ROI"
      }基线，建议沉淀本场话术为组织话术模板。`,
      requiresHumanApproval: true,
    });
  }

  return suggestions;
}

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function ratioBps(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(10000, Math.round((part / whole) * 10000)));
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}
