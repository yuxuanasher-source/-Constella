import { describe, expect, it } from "vitest";

import {
  buildAnnotatedTranscript,
  formatTranscriptTimestamp,
  loadRecordingTranscriptContext,
} from "./recording-transcript";
import type { RecordingRiskLexicon } from "./recording-risk-detection";

const lexicon: RecordingRiskLexicon = {
  sensitiveWords: [
    { term: "赌博", severity: "high" },
    { term: "加我微信", severity: "medium" },
    { term: "微信", severity: "medium" },
    { term: "ABC", severity: "medium" },
  ],
  bannedContent: [{ term: "返现", reason: "平台禁止站外返现引流" }],
  violationOperations: [],
};

describe("buildAnnotatedTranscript", () => {
  it("annotates a single high-severity hit as violation and keeps surrounding text", () => {
    const { utterances, summary } = buildAnnotatedTranscript({
      utterances: [
        { text: "今晚聊聊赌博的事", startSeconds: 5, endSeconds: 8 },
      ],
      lexicon,
    });

    expect(utterances).toHaveLength(1);
    expect(utterances[0]).toMatchObject({
      index: 0,
      startSeconds: 5,
      endSeconds: 8,
      text: "今晚聊聊赌博的事",
    });
    expect(utterances[0].segments).toEqual([
      { text: "今晚聊聊", tone: null },
      {
        text: "赌博",
        tone: "violation",
        keyword: "赌博",
        category: "sensitive_word",
      },
      { text: "的事", tone: null },
    ]);
    expect(summary.violationCount).toBe(1);
    expect(summary.warningCount).toBe(0);
  });

  it("annotates multiple keywords inside one utterance", () => {
    const { utterances, summary } = buildAnnotatedTranscript({
      utterances: [
        { text: "想赌博的加我微信聊返现", startSeconds: 0, endSeconds: 4 },
      ],
      lexicon,
    });

    const tones = utterances[0].segments.map((segment) => [
      segment.text,
      segment.tone,
    ]);
    expect(tones).toEqual([
      ["想", null],
      ["赌博", "violation"],
      ["的", null],
      ["加我微信", "warning"],
      ["聊", null],
      ["返现", "violation"],
    ]);
    // 禁播内容按 high → violation，与 detectRecordingRisks 的口径一致。
    expect(
      utterances[0].segments.find((segment) => segment.text === "返现"),
    ).toMatchObject({ category: "banned_content", tone: "violation" });
    expect(summary.violationCount).toBe(2);
    expect(summary.warningCount).toBe(1);
  });

  it("matches keywords case-insensitively while keeping the original casing", () => {
    const { utterances, summary } = buildAnnotatedTranscript({
      utterances: [
        { text: "输入abc和AbC均命中", startSeconds: 0, endSeconds: 2 },
      ],
      lexicon,
    });

    expect(utterances[0].segments).toEqual([
      { text: "输入", tone: null },
      {
        text: "abc",
        tone: "warning",
        keyword: "ABC",
        category: "sensitive_word",
      },
      { text: "和", tone: null },
      {
        text: "AbC",
        tone: "warning",
        keyword: "ABC",
        category: "sensitive_word",
      },
      { text: "均命中", tone: null },
    ]);
    expect(summary.keywords).toEqual([
      { keyword: "ABC", tone: "warning", category: "sensitive_word", count: 2 },
    ]);
  });

  it("keeps the higher severity keyword when matches overlap", () => {
    const overlapLexicon: RecordingRiskLexicon = {
      sensitiveWords: [
        { term: "外围", severity: "high" },
        { term: "围观", severity: "medium" },
      ],
      bannedContent: [],
      violationOperations: [],
    };

    const { utterances, summary } = buildAnnotatedTranscript({
      utterances: [{ text: "带你外围观比赛", startSeconds: 0, endSeconds: 3 }],
      lexicon: overlapLexicon,
    });

    // 「外围」(high) 与「围观」(medium) 在“围”字上重叠 → 只保留更高严重度。
    expect(utterances[0].segments).toEqual([
      { text: "带你", tone: null },
      {
        text: "外围",
        tone: "violation",
        keyword: "外围",
        category: "sensitive_word",
      },
      { text: "观比赛", tone: null },
    ]);
    expect(summary.violationCount).toBe(1);
    expect(summary.warningCount).toBe(0);
  });

  it("prefers the longer keyword when same-severity matches overlap", () => {
    const { utterances } = buildAnnotatedTranscript({
      utterances: [{ text: "私聊加我微信吧", startSeconds: 0, endSeconds: 3 }],
      lexicon,
    });

    // 「加我微信」与「微信」重叠且同为 medium → 保留更长的词。
    expect(utterances[0].segments).toEqual([
      { text: "私聊", tone: null },
      {
        text: "加我微信",
        tone: "warning",
        keyword: "加我微信",
        category: "sensitive_word",
      },
      { text: "吧", tone: null },
    ]);
  });

  it("aggregates keyword counts across utterances, violations first", () => {
    const { summary } = buildAnnotatedTranscript({
      utterances: [
        { text: "别聊赌博", startSeconds: 0, endSeconds: 1 },
        { text: "赌博不行，加我微信也不行", startSeconds: 1, endSeconds: 3 },
      ],
      lexicon,
    });

    expect(summary).toEqual({
      violationCount: 2,
      warningCount: 1,
      keywords: [
        {
          keyword: "赌博",
          tone: "violation",
          category: "sensitive_word",
          count: 2,
        },
        {
          keyword: "加我微信",
          tone: "warning",
          category: "sensitive_word",
          count: 1,
        },
      ],
    });
  });

  it("returns a single plain segment when nothing matches", () => {
    const { utterances, summary } = buildAnnotatedTranscript({
      utterances: [{ text: "欢迎来到直播间", startSeconds: 0, endSeconds: 2 }],
      lexicon,
    });

    expect(utterances[0].segments).toEqual([
      { text: "欢迎来到直播间", tone: null },
    ]);
    expect(summary).toEqual({
      violationCount: 0,
      warningCount: 0,
      keywords: [],
    });
  });

  it("uses the default recording risk lexicon when none is provided", () => {
    const { summary } = buildAnnotatedTranscript({
      utterances: [
        { text: "这波稳赚不赔，还能返现", startSeconds: 0, endSeconds: 2 },
      ],
    });

    expect(summary.violationCount).toBe(1); // 返现（禁播内容）
    expect(summary.warningCount).toBe(1); // 稳赚不赔（medium 敏感词）
  });
});

describe("formatTranscriptTimestamp", () => {
  it("formats sub-hour timestamps as MM:SS", () => {
    expect(formatTranscriptTimestamp(0)).toBe("00:00");
    expect(formatTranscriptTimestamp(7)).toBe("00:07");
    expect(formatTranscriptTimestamp(75.6)).toBe("01:15");
    expect(formatTranscriptTimestamp(3599)).toBe("59:59");
  });

  it("formats timestamps of one hour and above as H:MM:SS", () => {
    expect(formatTranscriptTimestamp(3600)).toBe("1:00:00");
    expect(formatTranscriptTimestamp(3661)).toBe("1:01:01");
    expect(formatTranscriptTimestamp(10 * 3600 + 62)).toBe("10:01:02");
  });

  it("clamps invalid values to zero", () => {
    expect(formatTranscriptTimestamp(-5)).toBe("00:00");
    expect(formatTranscriptTimestamp(Number.NaN)).toBe("00:00");
  });
});

describe("loadRecordingTranscriptContext", () => {
  function fakeClient({
    asset,
    analyses,
  }: {
    asset: { id: string; title: string | null } | null;
    analyses: Array<Record<string, unknown>>;
  }) {
    const assetChain = {
      select: () => assetChain,
      eq: () => assetChain,
      maybeSingle: async () => ({ data: asset, error: null }),
    };
    const analysesChain = {
      select: () => analysesChain,
      eq: () => analysesChain,
      order: () => analysesChain,
      limit: async () => ({ data: analyses, error: null }),
    };
    return {
      from: (table: string) =>
        table === "recording_assets" ? assetChain : analysesChain,
    };
  }

  it("returns a null asset when it does not belong to the organization", async () => {
    const context = await loadRecordingTranscriptContext({
      client: fakeClient({ asset: null, analyses: [] }) as never,
      organizationId: "org-1",
      assetId: "asset-x",
    });

    expect(context).toEqual({ asset: null, transcript: null });
  });

  it("returns the newest succeeded analysis that has utterances", async () => {
    const context = await loadRecordingTranscriptContext({
      client: fakeClient({
        asset: { id: "asset-1", title: "0701 大场" },
        analyses: [
          {
            id: "analysis-empty",
            asr_provider: null,
            transcript_text: null,
            transcript_utterances: [],
            completed_at: "2026-07-02T10:00:00.000Z",
          },
          {
            id: "analysis-2",
            asr_provider: "doubao_asr",
            transcript_text: "全文",
            transcript_utterances: [
              { text: "开场了", startSeconds: 1.2, endSeconds: 3.4 },
              { text: "", startSeconds: 4, endSeconds: 5 },
            ],
            completed_at: "2026-07-01T10:00:00.000Z",
          },
        ],
      }) as never,
      organizationId: "org-1",
      assetId: "asset-1",
    });

    expect(context.asset).toEqual({ id: "asset-1", title: "0701 大场" });
    expect(context.transcript).toEqual({
      analysisId: "analysis-2",
      asrProvider: "doubao_asr",
      completedAt: "2026-07-01T10:00:00.000Z",
      utterances: [{ text: "开场了", startSeconds: 1.2, endSeconds: 3.4 }],
    });
  });

  it("falls back to transcript_text lines when utterances are missing", async () => {
    const context = await loadRecordingTranscriptContext({
      client: fakeClient({
        asset: { id: "asset-1", title: null },
        analyses: [
          {
            id: "analysis-3",
            asr_provider: "doubao_asr",
            transcript_text: "第一句\n第二句\n",
            transcript_utterances: null,
            completed_at: null,
          },
        ],
      }) as never,
      organizationId: "org-1",
      assetId: "asset-1",
    });

    expect(context.asset).toEqual({ id: "asset-1", title: "未命名录屏" });
    expect(context.transcript?.utterances).toEqual([
      { text: "第一句", startSeconds: 0, endSeconds: 0 },
      { text: "第二句", startSeconds: 0, endSeconds: 0 },
    ]);
  });

  it("reports no transcript when succeeded analyses have no ASR output", async () => {
    const context = await loadRecordingTranscriptContext({
      client: fakeClient({
        asset: { id: "asset-1", title: "标题" },
        analyses: [
          {
            id: "analysis-4",
            asr_provider: null,
            transcript_text: "  ",
            transcript_utterances: [],
            completed_at: null,
          },
        ],
      }) as never,
      organizationId: "org-1",
      assetId: "asset-1",
    });

    expect(context.asset).not.toBeNull();
    expect(context.transcript).toBeNull();
  });
});
