import type { DoubaoAsrUtterance } from "@/features/ai/providers/doubao-asr-provider";

import {
  defaultRecordingRiskLexicon,
  type RecordingRiskCategory,
  type RecordingRiskLexicon,
} from "./recording-risk-detection";

/**
 * 直播录屏逐字稿：把 ASR 话语流切成带风险词标注的 segments，供经营舱
 * 逐字稿面板渲染与导出（知识库 / Word / PDF）复用。
 *
 * 词典完全复用 recording-risk-detection 的 defaultRecordingRiskLexicon：
 * - sensitiveWords 按自身 severity 映射（high → violation 红 / medium → warning 黄）；
 * - bannedContent 与 detectRecordingRisks 的口径一致，一律按 high（violation）处理。
 * violationOperations 属于操作事件流，不参与文本标注。
 */

export type TranscriptSegmentTone = "warning" | "violation";

export type TranscriptSegment = {
  text: string;
  tone: TranscriptSegmentTone | null;
  keyword?: string;
  category?: RecordingRiskCategory;
};

export type AnnotatedTranscriptUtterance = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  segments: TranscriptSegment[];
};

export type TranscriptKeywordSummary = {
  keyword: string;
  tone: TranscriptSegmentTone;
  category: RecordingRiskCategory;
  count: number;
};

export type TranscriptSummary = {
  violationCount: number;
  warningCount: number;
  keywords: TranscriptKeywordSummary[];
};

export type AnnotatedTranscript = {
  utterances: AnnotatedTranscriptUtterance[];
  summary: TranscriptSummary;
};

type LexiconEntry = {
  keyword: string;
  lowerKeyword: string;
  tone: TranscriptSegmentTone;
  category: RecordingRiskCategory;
};

type KeywordMatch = LexiconEntry & {
  start: number;
  end: number;
};

export function buildAnnotatedTranscript({
  utterances,
  lexicon = defaultRecordingRiskLexicon,
}: {
  utterances: DoubaoAsrUtterance[];
  lexicon?: RecordingRiskLexicon;
}): AnnotatedTranscript {
  const entries = lexiconEntries(lexicon);
  const keywordCounts = new Map<string, TranscriptKeywordSummary>();
  let violationCount = 0;
  let warningCount = 0;

  const annotated = utterances.map((utterance, index) => {
    const text = typeof utterance.text === "string" ? utterance.text : "";
    const matches = resolveMatches(text, entries);

    for (const match of matches) {
      if (match.tone === "violation") {
        violationCount += 1;
      } else {
        warningCount += 1;
      }
      const existing = keywordCounts.get(match.lowerKeyword);
      if (existing) {
        existing.count += 1;
      } else {
        keywordCounts.set(match.lowerKeyword, {
          keyword: match.keyword,
          tone: match.tone,
          category: match.category,
          count: 1,
        });
      }
    }

    return {
      index,
      startSeconds: normalizeSeconds(utterance.startSeconds),
      endSeconds: normalizeSeconds(utterance.endSeconds),
      text,
      segments: toSegments(text, matches),
    };
  });

  return {
    utterances: annotated,
    summary: {
      violationCount,
      warningCount,
      keywords: [...keywordCounts.values()].sort(
        (left, right) =>
          toneRank(right.tone) - toneRank(left.tone) ||
          right.count - left.count ||
          left.keyword.localeCompare(right.keyword),
      ),
    },
  };
}

/** 秒 → "MM:SS"，超过 1 小时 → "H:MM:SS"。 */
export function formatTranscriptTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(minutes)}:${pad(secs)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function lexiconEntries(lexicon: RecordingRiskLexicon): LexiconEntry[] {
  const entries: LexiconEntry[] = [];
  for (const item of lexicon.sensitiveWords) {
    const keyword = item.term.trim();
    if (!keyword) continue;
    entries.push({
      keyword,
      lowerKeyword: keyword.toLowerCase(),
      tone: item.severity === "high" ? "violation" : "warning",
      category: "sensitive_word",
    });
  }
  for (const item of lexicon.bannedContent) {
    const keyword = item.term.trim();
    if (!keyword) continue;
    // 与 detectRecordingRisks 一致：禁播内容一律按 high 严重度处理。
    entries.push({
      keyword,
      lowerKeyword: keyword.toLowerCase(),
      tone: "violation",
      category: "banned_content",
    });
  }
  return entries;
}

/**
 * 命中并消解重叠：大小写不敏感地找出所有词的所有出现位置，
 * 重叠时保留更高严重度（violation > warning），同严重度保留更长的词，
 * 再同则保留更靠前的。返回按 start 升序、互不重叠的命中区间。
 */
function resolveMatches(text: string, entries: LexiconEntry[]): KeywordMatch[] {
  if (!text) return [];
  const lowerText = text.toLowerCase();

  const candidates: KeywordMatch[] = [];
  for (const entry of entries) {
    let cursor = 0;
    while (cursor <= lowerText.length - entry.lowerKeyword.length) {
      const start = lowerText.indexOf(entry.lowerKeyword, cursor);
      if (start === -1) break;
      candidates.push({
        ...entry,
        start,
        end: start + entry.lowerKeyword.length,
      });
      cursor = start + 1;
    }
  }

  candidates.sort(
    (left, right) =>
      toneRank(right.tone) - toneRank(left.tone) ||
      right.end - right.start - (left.end - left.start) ||
      left.start - right.start,
  );

  const accepted: KeywordMatch[] = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some(
      (match) => candidate.start < match.end && candidate.end > match.start,
    );
    if (!overlaps) {
      accepted.push(candidate);
    }
  }

  return accepted.sort((left, right) => left.start - right.start);
}

function toSegments(
  text: string,
  matches: KeywordMatch[],
): TranscriptSegment[] {
  if (!text) {
    return [];
  }
  if (!matches.length) {
    return [{ text, tone: null }];
  }

  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start), tone: null });
    }
    segments.push({
      // 保留原文大小写（匹配是大小写不敏感的）。
      text: text.slice(match.start, match.end),
      tone: match.tone,
      keyword: match.keyword,
      category: match.category,
    });
    cursor = match.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), tone: null });
  }
  return segments;
}

function toneRank(tone: TranscriptSegmentTone): number {
  return tone === "violation" ? 2 : 1;
}

function normalizeSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// ---------------------------------------------------------------------------
// 逐字稿数据装载（供 GET /transcript 与 POST /transcript/export 两条路由复用）
// ---------------------------------------------------------------------------

export type RecordingTranscriptSource = {
  analysisId: string;
  asrProvider: string | null;
  completedAt: string | null;
  utterances: DoubaoAsrUtterance[];
};

export type RecordingTranscriptContext = {
  asset: { id: string; title: string } | null;
  transcript: RecordingTranscriptSource | null;
};

type TranscriptAnalysisRow = {
  id: string;
  asr_provider: string | null;
  transcript_text: string | null;
  transcript_utterances: unknown;
  completed_at: string | null;
};

type TranscriptAssetRow = {
  id: string;
  title: string | null;
};

type TranscriptLoaderClient = {
  from(table: "recording_assets"): {
    select(columns: string): {
      eq(
        column: "id",
        value: string,
      ): {
        eq(
          column: "organization_id",
          value: string,
        ): {
          maybeSingle(): PromiseLike<{
            data: TranscriptAssetRow | null;
            error: Error | null;
          }>;
        };
      };
    };
  };
  from(table: "recording_ai_analyses"): {
    select(columns: string): {
      eq(
        column: "organization_id",
        value: string,
      ): {
        eq(
          column: "asset_id",
          value: string,
        ): {
          eq(
            column: "status",
            value: "succeeded",
          ): {
            order(
              column: "created_at",
              options: { ascending: boolean },
            ): {
              limit(count: number): PromiseLike<{
                data: TranscriptAnalysisRow[] | null;
                error: Error | null;
              }>;
            };
          };
        };
      };
    };
  };
};

// 只在最近 N 条 succeeded 分析里找带转写的那条：旧分析可能没有 ASR 结果。
const TRANSCRIPT_ANALYSIS_LOOKBACK = 20;

/**
 * 校验资产归属并取该资产最新 succeeded 且带转写的分析。
 * asset 为 null → 资产不存在或不属于当前组织（路由应回 404）；
 * transcript 为 null → 资产存在但没有可用转写（GET 回 available:false）。
 */
export async function loadRecordingTranscriptContext({
  client,
  organizationId,
  assetId,
}: {
  client: TranscriptLoaderClient;
  organizationId: string;
  assetId: string;
}): Promise<RecordingTranscriptContext> {
  const { data: asset, error: assetError } = await client
    .from("recording_assets")
    .select("id, title")
    .eq("id", assetId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (assetError) {
    throw assetError;
  }
  if (!asset) {
    return { asset: null, transcript: null };
  }

  const { data: analyses, error: analysesError } = await client
    .from("recording_ai_analyses")
    .select(
      "id, asr_provider, transcript_text, transcript_utterances, completed_at",
    )
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(TRANSCRIPT_ANALYSIS_LOOKBACK);
  if (analysesError) {
    throw analysesError;
  }

  const assetResult = {
    id: asset.id,
    title: (asset.title ?? "").trim() || "未命名录屏",
  };

  for (const row of analyses ?? []) {
    const utterances = parseStoredUtterances(row.transcript_utterances);
    if (utterances.length) {
      return {
        asset: assetResult,
        transcript: {
          analysisId: row.id,
          asrProvider: row.asr_provider ?? null,
          completedAt: row.completed_at ?? null,
          utterances,
        },
      };
    }

    // 兜底：只有整段 transcript_text 而无话语时间轴时，按行拆成
    // 零时间戳话语，保证逐字稿与导出仍可用。
    const text = (row.transcript_text ?? "").trim();
    if (text) {
      return {
        asset: assetResult,
        transcript: {
          analysisId: row.id,
          asrProvider: row.asr_provider ?? null,
          completedAt: row.completed_at ?? null,
          utterances: text
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => ({ text: line, startSeconds: 0, endSeconds: 0 })),
        },
      };
    }
  }

  return { asset: assetResult, transcript: null };
}

function parseStoredUtterances(value: unknown): DoubaoAsrUtterance[] {
  if (!Array.isArray(value)) return [];
  const utterances: DoubaoAsrUtterance[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : "";
    if (!text.trim()) continue;
    utterances.push({
      text,
      startSeconds: numberValue(record.startSeconds),
      endSeconds: numberValue(record.endSeconds),
    });
  }
  return utterances;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
