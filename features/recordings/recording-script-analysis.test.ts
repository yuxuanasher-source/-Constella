import { describe, expect, it } from "vitest";

import {
  analyzeRecordingScript,
  classifyScriptLine,
  defaultScriptBenchmark,
  type RecordingTranscriptLine,
} from "./recording-script-analysis";

function line(atSeconds: number, text: string): RecordingTranscriptLine {
  return { atSeconds, text };
}

describe("classifyScriptLine", () => {
  it("classifies conversion, game explanation and interaction lines", () => {
    expect(classifyScriptLine("喜欢的家人们点关注不迷路")).toBe("conversion");
    expect(classifyScriptLine("这套出装打后期特别强")).toBe("game_explain");
    expect(classifyScriptLine("欢迎刚进直播间的老铁")).toBe("interaction");
    expect(classifyScriptLine("今天天气不错")).toBe("other");
  });

  it("prefers conversion when a line matches multiple lexicons", () => {
    expect(classifyScriptLine("扣个 1 领新人福利礼包")).toBe("conversion");
  });
});

describe("analyzeRecordingScript", () => {
  it("aggregates counts, ratios and per-hour density per category", () => {
    const insights = analyzeRecordingScript({
      durationSeconds: 3600,
      transcript: [
        line(10, "点关注领福袋"),
        line(60, "关注主播抽礼包"),
        line(120, "这个技能要留着反打"),
        line(180, "版本强势英雄推荐"),
        line(240, "阵容这样摆更稳"),
        line(300, "欢迎新进来的宝子"),
        line(360, "弹幕扣个 666"),
        line(420, "感谢老铁送的礼物"),
        line(480, "先喝口水"),
        line(540, "今天状态一般"),
      ],
    });

    expect(insights.totalLines).toBe(10);
    expect(insights.transcriptSource).toBe("uploaded");

    const byCategory = Object.fromEntries(
      insights.categoryStats.map((stat) => [stat.category, stat]),
    );
    // “感谢老铁送的礼物”命中转化词“礼物”，按优先级归入转化引导。
    expect(byCategory.conversion).toMatchObject({ count: 3, ratioBps: 3000 });
    expect(byCategory.game_explain).toMatchObject({ count: 3, ratioBps: 3000 });
    expect(byCategory.conversion.perHour).toBe(3);
    expect(byCategory.other.count).toBe(2);
  });

  it("compares against the high-ROI benchmark and suggests improvements", () => {
    const insights = analyzeRecordingScript({
      durationSeconds: 3600,
      transcript: [
        line(0, "这个副本的机制先讲一遍"),
        line(60, "出装顺序看这里"),
        line(120, "阵容站位注意后排"),
        line(180, "版本改动影响很大"),
        line(240, "这个角色的技能循环"),
        line(300, "普通闲聊"),
        line(360, "再来一把"),
        line(420, "今天网络有点卡"),
        line(480, "先整理一下状态"),
        line(540, "看看下一场"),
      ],
    });

    const conversionGap = insights.benchmarkGaps.find(
      (gap) => gap.category === "conversion",
    );
    expect(conversionGap).toMatchObject({
      actualBps: 0,
      benchmarkBps: defaultScriptBenchmark.conversionRatioBps,
      verdict: "below",
    });

    expect(
      insights.suggestions.some((item) => item.title.includes("转化引导")),
    ).toBe(true);
    expect(
      insights.suggestions.every((item) => item.requiresHumanApproval),
    ).toBe(true);
  });

  it("praises and asks to capture the script when all categories meet the benchmark", () => {
    const transcript = [
      ...Array.from({ length: 2 }, (_, i) => line(i, "点关注领福袋")),
      ...Array.from({ length: 4 }, (_, i) => line(100 + i, "技能循环讲解")),
      ...Array.from({ length: 3 }, (_, i) => line(200 + i, "欢迎新来的宝子")),
      line(300, "喝口水"),
    ];

    const insights = analyzeRecordingScript({
      durationSeconds: 3600,
      transcript,
    });

    expect(
      insights.benchmarkGaps.every((gap) => gap.verdict !== "below"),
    ).toBe(true);
    expect(insights.suggestions).toEqual([
      expect.objectContaining({ title: "保持话术结构" }),
    ]);
  });

  it("uses an org-calibrated benchmark when provided", () => {
    const insights = analyzeRecordingScript({
      durationSeconds: 3600,
      transcript: [line(0, "点关注"), line(10, "欢迎宝子")],
      benchmark: {
        conversionRatioBps: 4000,
        gameExplainRatioBps: 2000,
        interactionRatioBps: 3000,
        source: "org_calibrated",
        sampleSize: 18,
      },
    });

    const conversionGap = insights.benchmarkGaps.find(
      (gap) => gap.category === "conversion",
    );
    expect(conversionGap?.benchmarkBps).toBe(4000);
    expect(insights.benchmark.source).toBe("org_calibrated");
  });

  it("degrades gracefully when there is no transcript", () => {
    const insights = analyzeRecordingScript({
      durationSeconds: 3600,
      transcript: [],
    });

    expect(insights.totalLines).toBe(0);
    expect(insights.transcriptSource).toBe("none");
    expect(insights.suggestions).toEqual([
      expect.objectContaining({ title: "接入语音转写" }),
    ]);
  });
});
