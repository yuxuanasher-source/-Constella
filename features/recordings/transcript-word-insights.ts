/**
 * 直播录屏逐字稿：高频词洞察（纯词频统计，确定性、不调用 LLM）。
 *
 * 两条统计通路：
 * 1. 词典命中——有效词（转化引导 / 互动 / 游戏讲解）与无效水词（filler），
 *    与 recording-transcript.ts 同款 indexOf 匹配思路，对全部话语文本做
 *    非重叠全量计数；同一词出现在多个类别时按 conversion → interaction →
 *    explanation → filler 的优先级归入一类。
 * 2. 未分类高频词（neutral）——对文本做 2-4 字 n-gram 计数，经一组
 *    确定性过滤规则（低频、纯数字 / 字母、重复字符归并、停用词边界、
 *    词典命中词去重、互为子串归并）后取 top 10。
 *
 * 词典为模块级导出常量；后续如需组织级配置，可把 organizations 表里的
 * 自定义词典透传给 buildTranscriptWordInsights 的 dictionaries 参数，
 * 计算口径保持不变。
 */

export type TranscriptEffectiveWordCategory =
  | "conversion"
  | "interaction"
  | "explanation";

/** 有效词类别 → 中文展示名（随契约返回给前端，导出侧也复用）。 */
export const transcriptWordCategoryLabels: Record<
  TranscriptEffectiveWordCategory,
  string
> = {
  conversion: "转化引导",
  interaction: "互动",
  explanation: "游戏讲解",
};

export type TranscriptWordDictionaries = {
  conversion: string[];
  interaction: string[];
  explanation: string[];
  filler: string[];
};

/**
 * 默认词典：取直播（游戏直播为主）话术里的常用词。
 * 每类 10-20 个；可后续替换为组织级配置（见模块头注释）。
 */
export const defaultTranscriptWordDictionaries: TranscriptWordDictionaries = {
  // 转化引导：促下载 / 关注 / 送礼 / 促单话术。
  conversion: [
    "下载",
    "注册",
    "点关注",
    "加个关注",
    "关注一下",
    "礼物",
    "福利",
    "优惠",
    "上车",
    "冲一波",
    "安排",
    "专属",
    "限时",
    "领取",
    "抽奖",
    "秒杀",
  ],
  // 互动：招呼语 / 弹幕引导 / 点赞引导。
  interaction: [
    "兄弟们",
    "家人们",
    "宝子们",
    "老铁们",
    "弹幕",
    "评论区",
    "点赞",
    "刷个",
    "扣个",
    "扣1",
    "告诉我",
    "公屏",
    "来一波",
    "互动",
  ],
  // 游戏讲解：技战术 / 版本 / 复盘用语。
  explanation: [
    "技能",
    "装备",
    "操作",
    "攻略",
    "版本",
    "阵容",
    "连招",
    "细节",
    "节奏",
    "走位",
    "意识",
    "输出",
    "团战",
    "视野",
    "经济",
    "铭文",
  ],
  // 无效水词：口头禅 / 语气填充词。
  filler: [
    "嗯",
    "啊",
    "呃",
    "那个",
    "就是",
    "然后",
    "其实",
    "对吧",
    "这个",
    "怎么说",
    "反正",
    "可能",
    "差不多",
    "大概",
  ],
};

export type TranscriptEffectiveWordInsight = {
  word: string;
  category: TranscriptEffectiveWordCategory;
  categoryLabel: string;
  count: number;
};

export type TranscriptIneffectiveWordInsight = {
  word: string;
  count: number;
};

export type TranscriptNeutralWordInsight = {
  word: string;
  count: number;
};

export type TranscriptWordInsightsMetrics = {
  /** 有效词命中总次数（三类合计）。 */
  effectiveCount: number;
  /** 无效水词命中总次数。 */
  ineffectiveCount: number;
  utteranceCount: number;
  /** 每句话平均水词个数，保留 1 位小数；无话语时为 0。 */
  fillerPerUtterance: number;
  /** 有效 / (有效 + 无效)，0-1，保留 3 位小数；两者皆 0 时为 null。 */
  effectiveShare: number | null;
};

export type TranscriptWordInsights = {
  effective: TranscriptEffectiveWordInsight[];
  ineffective: TranscriptIneffectiveWordInsight[];
  neutral: TranscriptNeutralWordInsight[];
  metrics: TranscriptWordInsightsMetrics;
};

/** 同词多类时的归类优先级（下标越小优先级越高），filler 垫底。 */
const EFFECTIVE_CATEGORY_PRIORITY: TranscriptEffectiveWordCategory[] = [
  "conversion",
  "interaction",
  "explanation",
];

// 未分类 n-gram 的过滤参数。
const NEUTRAL_GRAM_MIN_LENGTH = 2;
const NEUTRAL_GRAM_MAX_LENGTH = 4;
const NEUTRAL_MIN_COUNT = 3;
const NEUTRAL_TOP_LIMIT = 10;
/** 互为子串时判定「频次相近」的阈值：短词频次 ≤ 长词频次 × 1.5 则并入长词。 */
const NEUTRAL_MERGE_FREQUENCY_RATIO = 1.5;

/**
 * 中文停用词小表（模块内置）：n-gram 以这些字开头 / 结尾（或全由其组成）
 * 视为无信息量组合，直接过滤。
 */
const NEUTRAL_STOPWORD_CHARS = new Set([
  ..."的了呢吗吧在是我你他她它这那有和就都被也要不没很去来会能还把给跟们么呀啦哦",
]);

const HAN_CHAR_PATTERN = /\p{Script=Han}/u;
/** 分词单元：连续的文字 / 数字段（标点、空白天然成为 n-gram 边界）。 */
const TOKEN_RUN_PATTERN = /[\p{L}\p{N}]+/gu;

type DictionaryEntry = {
  word: string;
  lowerWord: string;
  category: TranscriptEffectiveWordCategory | "filler";
};

export function buildTranscriptWordInsights({
  utterances,
  dictionaries = defaultTranscriptWordDictionaries,
}: {
  utterances: ReadonlyArray<{ text: string }>;
  dictionaries?: TranscriptWordDictionaries;
}): TranscriptWordInsights {
  const lowerTexts = utterances.map((utterance) =>
    (typeof utterance.text === "string" ? utterance.text : "").toLowerCase(),
  );

  const entries = dictionaryEntries(dictionaries);
  const effective: TranscriptEffectiveWordInsight[] = [];
  const ineffective: TranscriptIneffectiveWordInsight[] = [];
  /** 命中（count > 0）的词典词，供 neutral n-gram 去重。 */
  const hitWords: string[] = [];

  for (const entry of entries) {
    const count = countOccurrences(lowerTexts, entry.lowerWord);
    if (count === 0) continue;
    hitWords.push(entry.lowerWord);
    if (entry.category === "filler") {
      ineffective.push({ word: entry.word, count });
    } else {
      effective.push({
        word: entry.word,
        category: entry.category,
        categoryLabel: transcriptWordCategoryLabels[entry.category],
        count,
      });
    }
  }

  effective.sort(
    (left, right) =>
      right.count - left.count ||
      categoryRank(left.category) - categoryRank(right.category) ||
      compareWords(left.word, right.word),
  );
  ineffective.sort(
    (left, right) =>
      right.count - left.count || compareWords(left.word, right.word),
  );

  const effectiveCount = effective.reduce((sum, item) => sum + item.count, 0);
  const ineffectiveCount = ineffective.reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const utteranceCount = utterances.length;
  const categorizedTotal = effectiveCount + ineffectiveCount;

  return {
    effective,
    ineffective,
    neutral: buildNeutralWords(lowerTexts, hitWords),
    metrics: {
      effectiveCount,
      ineffectiveCount,
      utteranceCount,
      fillerPerUtterance:
        utteranceCount === 0 ? 0 : round1(ineffectiveCount / utteranceCount),
      effectiveShare:
        categorizedTotal === 0 ? null : round3(effectiveCount / categorizedTotal),
    },
  };
}

/** 按优先级展开词典并按词去重：先出现的类别（优先级更高）拿走该词。 */
function dictionaryEntries(
  dictionaries: TranscriptWordDictionaries,
): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  const seen = new Set<string>();
  const groups: Array<
    [TranscriptEffectiveWordCategory | "filler", string[]]
  > = [
    ...EFFECTIVE_CATEGORY_PRIORITY.map(
      (category): [TranscriptEffectiveWordCategory | "filler", string[]] => [
        category,
        dictionaries[category],
      ],
    ),
    ["filler", dictionaries.filler],
  ];

  for (const [category, words] of groups) {
    for (const raw of words) {
      const word = raw.trim();
      if (!word) continue;
      const lowerWord = word.toLowerCase();
      if (seen.has(lowerWord)) continue;
      seen.add(lowerWord);
      entries.push({ word, lowerWord, category });
    }
  }
  return entries;
}

/**
 * indexOf 全量计数（与 recording-transcript.ts 的匹配思路一致），
 * 游标按词长推进 → 非重叠计数（"嗯嗯" 里 "嗯" 计 2 次）。
 */
function countOccurrences(lowerTexts: string[], lowerWord: string): number {
  let count = 0;
  for (const text of lowerTexts) {
    let cursor = 0;
    while (cursor <= text.length - lowerWord.length) {
      const start = text.indexOf(lowerWord, cursor);
      if (start === -1) break;
      count += 1;
      cursor = start + lowerWord.length;
    }
  }
  return count;
}

/**
 * 未分类高频词：2-4 字 n-gram 计数 + 过滤。
 * - 先对连续重复字符做压缩归并（"哈哈哈…" → "哈哈"，"哈哈" 本身保留），
 *   压缩后不可能出现三字以上的同字连排；
 * - 分词单元内滑窗，天然排除跨标点的组合；纯数字 / 字母（不含汉字）的
 *   gram 丢弃；
 * - 出现次数 < NEUTRAL_MIN_COUNT 丢弃；
 * - 与任何词典命中词互为子串的丢弃（避免与有效 / 无效列表重复报告）；
 * - 以停用词开头 / 结尾的丢弃；
 * - 幸存者里互为子串且频次相近的归并给更长者；按 count 降序取 top 10。
 */
function buildNeutralWords(
  lowerTexts: string[],
  hitWords: string[],
): TranscriptNeutralWordInsight[] {
  const counts = new Map<string, number>();

  for (const text of lowerTexts) {
    const compressed = compressRepeatedChars(text);
    for (const run of compressed.match(TOKEN_RUN_PATTERN) ?? []) {
      const chars = [...run];
      for (
        let length = NEUTRAL_GRAM_MIN_LENGTH;
        length <= NEUTRAL_GRAM_MAX_LENGTH;
        length += 1
      ) {
        for (let start = 0; start + length <= chars.length; start += 1) {
          const gramChars = chars.slice(start, start + length);
          const gram = gramChars.join("");
          if (!HAN_CHAR_PATTERN.test(gram)) continue;
          if (
            NEUTRAL_STOPWORD_CHARS.has(gramChars[0]) ||
            NEUTRAL_STOPWORD_CHARS.has(gramChars[gramChars.length - 1])
          ) {
            continue;
          }
          counts.set(gram, (counts.get(gram) ?? 0) + 1);
        }
      }
    }
  }

  const survivors: TranscriptNeutralWordInsight[] = [];
  for (const [word, count] of counts) {
    if (count < NEUTRAL_MIN_COUNT) continue;
    if (
      hitWords.some((hit) => word.includes(hit) || hit.includes(word))
    ) {
      continue;
    }
    survivors.push({ word, count });
  }

  // 长词优先入选；短词若被已入选的长词包含且频次相近，则视为长词的碎片归并掉。
  survivors.sort(
    (left, right) =>
      charLength(right.word) - charLength(left.word) ||
      right.count - left.count ||
      compareWords(left.word, right.word),
  );
  const kept: TranscriptNeutralWordInsight[] = [];
  for (const candidate of survivors) {
    const mergedIntoLonger = kept.some(
      (longer) =>
        longer.word.length > candidate.word.length &&
        longer.word.includes(candidate.word) &&
        candidate.count <= longer.count * NEUTRAL_MERGE_FREQUENCY_RATIO,
    );
    if (!mergedIntoLonger) {
      kept.push(candidate);
    }
  }

  return kept
    .sort(
      (left, right) =>
        right.count - left.count ||
        charLength(right.word) - charLength(left.word) ||
        compareWords(left.word, right.word),
    )
    .slice(0, NEUTRAL_TOP_LIMIT);
}

/** 连续 3 个及以上的同一字符压缩为 2 个："哈哈哈哈" → "哈哈"。 */
function compressRepeatedChars(text: string): string {
  return text.replace(/(.)\1{2,}/gu, "$1$1");
}

function categoryRank(category: TranscriptEffectiveWordCategory): number {
  return EFFECTIVE_CATEGORY_PRIORITY.indexOf(category);
}

/** 码点序比较：不依赖 ICU 排序规则，保证跨环境结果确定。 */
function compareWords(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function charLength(word: string): number {
  return [...word].length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
