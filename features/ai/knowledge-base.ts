// AI 知识库 / RAG 确定性核心（方案第 6 节）。纯函数，便于单测；DB 检索见
// knowledge-repository.ts（走 RLS）。硬约束（6.3）在此强制：
// - 引用可追溯：每条结论附 source_ref + docId。
// - 数字必溯源：本层只回传语料原文与来源，绝不从语料生成金额/时长/ROI；
//   答案显式提示「数字以结构化数据为准」。
// - 拒绝幻觉：无命中语料一律答「无数据」。

export type KnowledgeDoc = {
  id: string;
  docId?: string;
  docType: string;
  title: string;
  body: string;
  sourceRef: string;
  tags?: string[];
  projectId?: string | null;
  streamerId?: string | null;
  product?: string | null;
  platform?: string | null;
  updatedAt?: string | null;
};

export type KnowledgePassage = {
  id: string;
  docId?: string;
  docType: string;
  title: string;
  snippet: string;
  sourceRef: string;
  tags: string[];
  score: number;
};

export type KnowledgeRankContext = {
  projectId?: string;
  streamerId?: string;
  product?: string;
  platform?: string;
};

// 查询分词：按空白/标点切分；对较长中文连续串补二元组以提升召回。
export function tokenizeQuery(query: string): string[] {
  const raw = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return [];
  const parts = raw
    .split(/[\s,，。、；;：:？?！!（）()【】[\]"'`/\\|]+/)
    .filter(Boolean);
  const terms = new Set<string>();
  for (const part of parts) {
    if (part.length >= 2) terms.add(part);
    if (/[一-鿿]/.test(part) && part.length >= 4) {
      for (let i = 0; i + 2 <= part.length; i += 1) {
        terms.add(part.slice(i, i + 2));
      }
    }
  }
  return [...terms];
}

function snippetAround(body: string, term: string, radius = 40): string {
  const text = body.replace(/\s+/g, " ").trim();
  const idx = term ? text.toLowerCase().indexOf(term) : -1;
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

// 确定性检索打分：标题命中权重最高，正文/标签次之；返回 top-N 段落。
export function rankKnowledgePassages(
  query: string,
  docs: KnowledgeDoc[],
  limit = 5,
  context: KnowledgeRankContext = {},
): KnowledgePassage[] {
  const terms = tokenizeQuery(query);
  if (!terms.length) return [];
  const scored: KnowledgePassage[] = [];
  for (const doc of docs) {
    const title = String(doc.title ?? "").toLowerCase();
    const body = String(doc.body ?? "").toLowerCase();
    const tags = (doc.tags ?? []).map((t) => String(t).toLowerCase());
    let score = 0;
    let firstHit = "";
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inBody = body.includes(term);
      const inTag = tags.some((t) => t.includes(term));
      if (inTitle) score += 3;
      if (inBody) score += 1;
      if (inTag) score += 2;
      if (!firstHit && (inTitle || inBody)) firstHit = term;
    }
    if (score > 0) {
      score += businessContextScore(doc, context);
      score += recencyScore(doc.updatedAt);
      scored.push({
        id: doc.id,
        docId: doc.docId,
        docType: doc.docType,
        title: doc.title,
        snippet: snippetAround(doc.body, firstHit),
        sourceRef: doc.sourceRef,
        tags: doc.tags ?? [],
        score,
      });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, Math.max(0, limit));
}

function businessContextScore(
  doc: KnowledgeDoc,
  context: KnowledgeRankContext,
): number {
  let score = 0;
  if (context.projectId && doc.projectId === context.projectId) score += 8;
  if (context.streamerId && doc.streamerId === context.streamerId) score += 5;
  if (context.product && doc.product === context.product) score += 4;
  if (context.platform && doc.platform === context.platform) score += 2;
  if (doc.docType === "retrospective") score += 1;
  return score;
}

function recencyScore(updatedAt?: string | null): number {
  if (!updatedAt) return 0;
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return 0;
  const ageDays = (Date.now() - updated) / 86_400_000;
  if (ageDays <= 14) return 2;
  if (ageDays <= 60) return 1;
  return 0;
}

export type KnowledgeCitation = {
  index: number;
  title: string;
  sourceRef: string;
  docId: string;
};

export type KnowledgeAnswer = {
  hasData: boolean;
  answer: string;
  citations: KnowledgeCitation[];
};

const NUMBER_DISCLAIMER =
  "注：以上语料仅用于解释 / 归因；具体金额、时长、ROI 以结构化数据查询为准，AI 不从语料生成数字。";

// 组装带引用的答案；无命中 → 「无数据」（拒绝幻觉）。
export function assembleKnowledgeAnswer(
  query: string,
  passages: KnowledgePassage[],
): KnowledgeAnswer {
  const q = String(query ?? "").trim();
  if (!passages.length) {
    return {
      hasData: false,
      answer: `无数据：知识库中未检索到与「${q || "该问题"}」相关的语料。若涉及具体数字，请改用结构化数据查询。`,
      citations: [],
    };
  }
  const citations = passages.map((p, i) => ({
    index: i + 1,
    title: p.title,
    sourceRef: p.sourceRef,
    docId: p.docId ?? p.id,
  }));
  const lines = passages.map(
    (p, i) => `[${i + 1}] ${p.title}：${p.snippet}（来源：${p.sourceRef}）`,
  );
  return {
    hasData: true,
    answer: `检索到 ${passages.length} 条相关语料：\n${lines.join("\n")}\n${NUMBER_DISCLAIMER}`,
    citations,
  };
}

// 把工具入参里的原始 passage 规整为 KnowledgePassage（容错 camelCase/snake_case）。
export function normalizePassage(raw: unknown): KnowledgePassage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? r.docId ?? "");
  const title = String(r.title ?? "");
  if (!id || !title) return null;
  return {
    id,
    docId: typeof r.docId === "string" ? r.docId : undefined,
    docType: String(r.docType ?? r.doc_type ?? "manual"),
    title,
    snippet: String(r.snippet ?? r.body ?? ""),
    sourceRef: String(r.sourceRef ?? r.source_ref ?? "未标注来源"),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    score: Number(r.score) || 0,
  };
}
