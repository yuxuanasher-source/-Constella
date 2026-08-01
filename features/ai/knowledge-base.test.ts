import { describe, expect, it } from "vitest";

import {
  assembleKnowledgeAnswer,
  normalizePassage,
  rankKnowledgePassages,
  tokenizeQuery,
  type KnowledgeDoc,
} from "./knowledge-base";

const docs: KnowledgeDoc[] = [
  {
    id: "doc-1",
    docType: "evidence_rule",
    title: "证据三轨规则",
    body: "系统计时优先；系统与截图偏差不超过 max(10%,15min) 判绿，否则判黄；无系统计时仅截图判黄，仅申报判红。",
    sourceRef: "SOP/证据三轨 v3",
    tags: ["证据", "三轨", "结算"],
  },
  {
    id: "doc-2",
    docType: "settlement_rule",
    title: "CPT 口径",
    body: "CPT 仅在绿灯且时间源为系统时支付；黄/红仅承载不计 CPT。",
    sourceRef: "SOP/结算口径 v2",
    tags: ["CPT", "结算"],
  },
  {
    id: "doc-3",
    docType: "retrospective",
    title: "某游戏复盘",
    body: "本期主播互动断层导致流量下滑，建议开场强化福利节点。",
    sourceRef: "review/2026-06",
    tags: ["复盘"],
  },
];

describe("tokenizeQuery", () => {
  it("splits on whitespace/punctuation and keeps 2+ char terms", () => {
    expect(tokenizeQuery("CPT 口径 是什么？")).toContain("cpt");
    expect(tokenizeQuery("CPT 口径 是什么？")).toContain("口径");
  });

  it("adds CJK bigrams for longer runs to improve recall", () => {
    expect(tokenizeQuery("证据三轨规则")).toContain("证据");
  });

  it("returns nothing for empty input", () => {
    expect(tokenizeQuery("   ")).toEqual([]);
  });
});

describe("rankKnowledgePassages", () => {
  it("ranks title/tag hits above body-only hits", () => {
    const ranked = rankKnowledgePassages("CPT 结算口径", docs);
    expect(ranked[0].id).toBe("doc-2");
    expect(ranked[0].sourceRef).toBe("SOP/结算口径 v2");
  });

  it("returns a snippet around the matched term", () => {
    const ranked = rankKnowledgePassages("互动断层", docs);
    expect(ranked[0].id).toBe("doc-3");
    expect(ranked[0].snippet).toContain("互动断层");
  });

  it("returns nothing when no term matches", () => {
    expect(rankKnowledgePassages("不存在的关键词xyz", docs)).toEqual([]);
  });

  it("boosts matching business context and recent retrospectives", () => {
    const now = new Date();
    const ranked = rankKnowledgePassages(
      "复盘",
      [
        {
          ...docs[2],
          id: "older",
          projectId: "project-other",
          updatedAt: new Date(now.getTime() - 90 * 86_400_000).toISOString(),
        },
        {
          ...docs[2],
          id: "contextual",
          projectId: "project-1",
          streamerId: "streamer-1",
          product: "product-1",
          platform: "douyin",
          updatedAt: now.toISOString(),
        },
      ],
      5,
      {
        projectId: "project-1",
        streamerId: "streamer-1",
        product: "product-1",
        platform: "douyin",
      },
    );

    expect(ranked.map((passage) => passage.id)).toEqual([
      "contextual",
      "older",
    ]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

describe("assembleKnowledgeAnswer (RAG hard constraints)", () => {
  it("answers 无数据 when nothing is retrieved (no hallucination)", () => {
    const r = assembleKnowledgeAnswer("随便问点啥", []);
    expect(r.hasData).toBe(false);
    expect(r.answer).toContain("无数据");
    expect(r.citations).toEqual([]);
  });

  it("attaches traceable citations and a numbers-from-structured-data disclaimer", () => {
    const passages = rankKnowledgePassages("CPT 口径", docs);
    const r = assembleKnowledgeAnswer("CPT 口径", passages);
    expect(r.hasData).toBe(true);
    expect(r.citations[0]).toMatchObject({
      index: 1,
      docId: "doc-2",
      sourceRef: "SOP/结算口径 v2",
    });
    expect(r.answer).toContain("以结构化数据查询为准");
    expect(r.answer).toContain("来源：");
  });
});

describe("normalizePassage", () => {
  it("accepts snake_case and camelCase, rejects malformed", () => {
    expect(
      normalizePassage({ id: "d1", title: "T", source_ref: "S" })?.sourceRef,
    ).toBe("S");
    expect(
      normalizePassage({ docId: "d2", title: "T", sourceRef: "S" })?.id,
    ).toBe("d2");
    expect(normalizePassage({ title: "missing id" })).toBeNull();
    expect(normalizePassage(null)).toBeNull();
  });

  it("normalizes optional fields and invalid numeric scores", () => {
    expect(
      normalizePassage({
        id: "d3",
        doc_type: "retrospective",
        title: "复盘",
        body: "正文",
        tags: ["one", 2],
        score: "not-a-number",
      }),
    ).toEqual({
      id: "d3",
      docId: undefined,
      docType: "retrospective",
      title: "复盘",
      snippet: "正文",
      sourceRef: "未标注来源",
      tags: ["one", "2"],
      score: 0,
    });
  });
});
