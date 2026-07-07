import { describe, expect, it } from "vitest";

import {
  buildTranscriptWordInsights,
  defaultTranscriptWordDictionaries,
  transcriptWordCategoryLabels,
  type TranscriptWordDictionaries,
} from "./transcript-word-insights";

function texts(...items: string[]): Array<{ text: string }> {
  return items.map((text) => ({ text }));
}

describe("buildTranscriptWordInsights", () => {
  it("exposes 10-20 words per dictionary bucket", () => {
    for (const bucket of [
      "conversion",
      "interaction",
      "explanation",
      "filler",
    ] as const) {
      const words = defaultTranscriptWordDictionaries[bucket];
      expect(words.length).toBeGreaterThanOrEqual(10);
      expect(words.length).toBeLessThanOrEqual(20);
      // 词典内不允许重复词。
      expect(new Set(words).size).toBe(words.length);
    }
  });

  it("classifies dictionary hits into effective categories and fillers", () => {
    const insights = buildTranscriptWordInsights({
      utterances: texts(
        "家人们把点赞点起来",
        "点关注领福利",
        "这波连招细节拉满",
        "嗯那个就是今天状态一般",
      ),
    });

    const byWord = Object.fromEntries(
      insights.effective.map((item) => [item.word, item]),
    );
    expect(byWord["点关注"]).toEqual({
      word: "点关注",
      category: "conversion",
      categoryLabel: "转化引导",
      count: 1,
    });
    expect(byWord["福利"]).toMatchObject({ category: "conversion", count: 1 });
    expect(byWord["家人们"]).toMatchObject({
      category: "interaction",
      categoryLabel: transcriptWordCategoryLabels.interaction,
      count: 1,
    });
    expect(byWord["点赞"]).toMatchObject({ category: "interaction", count: 1 });
    expect(byWord["连招"]).toMatchObject({
      category: "explanation",
      categoryLabel: "游戏讲解",
      count: 1,
    });
    expect(byWord["细节"]).toMatchObject({ category: "explanation", count: 1 });
    expect(insights.effective).toHaveLength(6);

    expect(insights.ineffective).toEqual([
      { word: "嗯", count: 1 },
      { word: "就是", count: 1 },
      { word: "那个", count: 1 },
    ]);
  });

  it("sorts effective words by count before category", () => {
    const insights = buildTranscriptWordInsights({
      utterances: texts("点赞点赞点赞，福利来了"),
    });

    // 点赞(互动)×3 要排在 福利(转化引导)×1 之前：count 优先于类别。
    expect(
      insights.effective.map((item) => [item.word, item.count]),
    ).toEqual([
      ["点赞", 3],
      ["福利", 1],
    ]);
  });

  it("resolves multi-category words with conversion > interaction > explanation > filler priority", () => {
    const shared: TranscriptWordDictionaries = {
      conversion: ["安排"],
      interaction: ["安排"],
      explanation: ["安排"],
      filler: ["安排"],
    };
    const conversionFirst = buildTranscriptWordInsights({
      utterances: texts("上号安排一下，安排"),
      dictionaries: shared,
    });
    expect(conversionFirst.effective).toEqual([
      {
        word: "安排",
        category: "conversion",
        categoryLabel: "转化引导",
        count: 2,
      },
    ]);
    expect(conversionFirst.ineffective).toEqual([]);

    const interactionFirst = buildTranscriptWordInsights({
      utterances: texts("节奏拉起来，节奏节奏"),
      dictionaries: {
        conversion: [],
        interaction: ["节奏"],
        explanation: ["节奏"],
        filler: [],
      },
    });
    expect(interactionFirst.effective).toEqual([
      { word: "节奏", category: "interaction", categoryLabel: "互动", count: 3 },
    ]);
  });

  it("collapses repeated characters before neutral n-gram counting", () => {
    const insights = buildTranscriptWordInsights({
      utterances: texts("哈哈哈哈", "哈哈哈", "哈哈"),
    });

    // 「哈哈哈…」压缩归并成「哈哈」：每句只计 1 次，共 3 次。
    expect(insights.neutral).toEqual([{ word: "哈哈", count: 3 }]);
  });

  it("drops neutral n-grams below the minimum count", () => {
    const insights = buildTranscriptWordInsights({
      utterances: texts("绝活时刻", "绝活时刻"),
    });

    expect(insights.neutral).toEqual([]);
  });

  it("excludes neutral n-grams overlapping dictionary hits or stopword boundaries", () => {
    const insights = buildTranscriptWordInsights({
      utterances: texts("把点赞点起来", "把点赞点起来", "把点赞点起来"),
    });

    const neutralWords = insights.neutral.map((item) => item.word);
    // 与命中词「点赞」互为子串的 gram 不进 neutral。
    expect(neutralWords).not.toContain("点赞");
    expect(neutralWords.some((word) => word.includes("点赞"))).toBe(false);
    // 以停用词开头 / 结尾的 gram（把点、起来、点起来…）被过滤。
    expect(neutralWords).toEqual(["赞点起"]);

    const stopword = buildTranscriptWordInsights({
      utterances: texts("今晚偷分了", "今晚偷分了", "今晚偷分了"),
    });
    const stopwordNeutral = stopword.neutral.map((item) => item.word);
    expect(stopwordNeutral).not.toContain("分了");
    expect(stopwordNeutral).not.toContain("偷分了");
    // 互为子串且频次相近（此处全部 ×3）时归并给最长的 gram。
    expect(stopwordNeutral).toEqual(["今晚偷分"]);
  });

  it("keeps a shorter neutral n-gram when it is much more frequent than the longer one", () => {
    const insights = buildTranscriptWordInsights({
      utterances: texts(
        "上分大法",
        "上分大法",
        "上分大法",
        "猛上分冲",
        "再上分走",
        "狂上分飞",
        "夜上分稳",
        "晨上分拼",
        "快上分赢",
        "先上分赛",
      ),
    });

    // 上分×10 明显高于 上分大法×3（10 > 3×1.5），两者都保留；
    // 上分大 / 分大法 / 大法 等碎片与 上分大法 频次相近，被归并。
    expect(insights.neutral).toEqual([
      { word: "上分", count: 10 },
      { word: "上分大法", count: 3 },
    ]);
  });

  it("computes metrics with one-decimal filler density and three-decimal effective share", () => {
    const insights = buildTranscriptWordInsights({
      utterances: texts("家人们点赞", "嗯嗯那个", "就是"),
    });

    // 有效：家人们×1 + 点赞×1 = 2；无效：嗯×2 + 那个×1 + 就是×1 = 4。
    expect(insights.metrics).toEqual({
      effectiveCount: 2,
      ineffectiveCount: 4,
      utteranceCount: 3,
      fillerPerUtterance: 1.3,
      effectiveShare: 0.333,
    });
    expect(insights.ineffective).toEqual([
      { word: "嗯", count: 2 },
      { word: "就是", count: 1 },
      { word: "那个", count: 1 },
    ]);
  });

  it("returns a null effective share when nothing is categorized", () => {
    const insights = buildTranscriptWordInsights({
      utterances: texts("风景不错"),
    });

    expect(insights.effective).toEqual([]);
    expect(insights.ineffective).toEqual([]);
    expect(insights.metrics).toEqual({
      effectiveCount: 0,
      ineffectiveCount: 0,
      utteranceCount: 1,
      fillerPerUtterance: 0,
      effectiveShare: null,
    });
  });

  it("handles an empty transcript", () => {
    const insights = buildTranscriptWordInsights({ utterances: [] });

    expect(insights).toEqual({
      effective: [],
      ineffective: [],
      neutral: [],
      metrics: {
        effectiveCount: 0,
        ineffectiveCount: 0,
        utteranceCount: 0,
        fillerPerUtterance: 0,
        effectiveShare: null,
      },
    });
  });
});
