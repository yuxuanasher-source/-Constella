import type { OcrTextItem } from "./providers/tencent-ocr-provider";

export type LiveReportOcrParseStatus =
  | "trusted"
  | "needs_confirmation"
  | "failed";

export type LiveReportOcrParseResult = {
  status: LiveReportOcrParseStatus;
  extractedDuration: number | null;
  extractedViewers: number | null;
  extractedDate: string | null;
  extractedStartedAt: string | null;
  extractedEndedAt: string | null;
  metricCandidates: LiveReportOcrMetricCandidate[];
  confidence: number;
  reasons: string[];
};

export type LiveReportOcrMetricKey =
  | "viewers"
  | "pcu"
  | "acu"
  | "exposure"
  | "clicks"
  | "interactions"
  | "comments"
  | "likes"
  | "shares"
  | "follows"
  | "gmv";

export type LiveReportOcrMetricCandidate = {
  key: LiveReportOcrMetricKey;
  label: string;
  value: number;
  sourceText: string;
  confidence: number;
  x?: number;
  y?: number;
};

const DURATION_KEYWORDS = /(时长|直播|开播|有效)/;
const DURATION_HINT = /(小时|分钟)/;
const VIEWER_KEYWORDS = /(观看人数|观众|场观|人气|views?|viewer)/i;
const DATE_PATTERN =
  /(?:(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?|(\d{1,2})月(\d{1,2})日)/;
const START_TIME_KEYWORDS = /(开播|开始|上播|start)/i;
const END_TIME_KEYWORDS = /(下播|结束|停止|end)/i;

const METRIC_DEFINITIONS: Array<{
  key: LiveReportOcrMetricKey;
  label: string;
  pattern: RegExp;
}> = [
  { key: "viewers", label: "场观", pattern: VIEWER_KEYWORDS },
  {
    key: "pcu",
    label: "PCU",
    pattern: /(pcu|峰值在线|最高在线|最高人数|峰值人数)/i,
  },
  {
    key: "acu",
    label: "ACU",
    pattern: /(acu|平均在线|平均人数|平均在线人数)/i,
  },
  { key: "exposure", label: "曝光", pattern: /(曝光|展示|展现)/ },
  { key: "clicks", label: "点击", pattern: /(点击|进房|进入直播间)/ },
  { key: "interactions", label: "互动", pattern: /(互动|互动数|互动量)/ },
  { key: "comments", label: "评论", pattern: /(评论|弹幕)/ },
  { key: "likes", label: "点赞", pattern: /(点赞|赞)/ },
  { key: "shares", label: "分享", pattern: /(分享|转发)/ },
  { key: "follows", label: "关注", pattern: /(关注|涨粉|新增粉丝)/ },
  { key: "gmv", label: "GMV", pattern: /(gmv|成交额|销售额)/i },
];

export function parseLiveReportOcrText(
  lines: string[],
  options: {
    expectedDuration?: number;
    minConfidence?: number;
    items?: OcrTextItem[];
  } = {},
): LiveReportOcrParseResult {
  const normalized = lines.map((line) => line.trim()).filter(Boolean);
  const timeEvidence = extractTimeEvidence(normalized);
  const extractedDuration = extractDuration(normalized) ?? timeEvidence.duration;
  const extractedViewers =
    (options.items ? extractViewersFromItems(options.items) : null) ??
    extractViewers(normalized);
  const metricCandidates = extractMetricCandidates(normalized, options.items);
  const reasons: string[] = [];

  if (
    extractedDuration === null &&
    extractedViewers === null &&
    metricCandidates.length === 0
  ) {
    return {
      status: "failed",
      extractedDuration,
      extractedViewers,
      extractedDate: extractDate(normalized),
      extractedStartedAt: timeEvidence.startedAt,
      extractedEndedAt: timeEvidence.endedAt,
      metricCandidates,
      confidence: 0,
      reasons: ["no_live_report_fields"],
    };
  }

  const confidence = calculateConfidence({
    extractedDuration,
    extractedViewers,
    metricCandidateCount: metricCandidates.length,
    totalLines: normalized.length,
  });

  if (
    options.expectedDuration !== undefined &&
    extractedDuration !== null &&
    Math.abs(extractedDuration - options.expectedDuration) > 15
  ) {
    reasons.push("duration_conflict");
  }

  if (confidence < (options.minConfidence ?? 70)) {
    reasons.push("low_confidence");
  }

  return {
    status: reasons.length ? "needs_confirmation" : "trusted",
    extractedDuration,
    extractedViewers,
    extractedDate: extractDate(normalized),
    extractedStartedAt: timeEvidence.startedAt,
    extractedEndedAt: timeEvidence.endedAt,
    metricCandidates,
    confidence,
    reasons,
  };
}

function extractDuration(lines: string[]): number | null {
  // Pass 1: explicit hours/minutes, e.g. "直播时长 1小时20分钟", "共3小时", "95分钟".
  // Accept any line that mentions 小时/分钟 even without a leading label keyword,
  // since recap screenshots often render the value (共3小时) on its own line.
  for (const line of lines) {
    const compact = line.replace(/\s+/g, "");
    if (!DURATION_KEYWORDS.test(compact) && !DURATION_HINT.test(compact)) {
      continue;
    }
    const duration = parseHourMinuteDuration(compact);
    if (duration > 0) {
      return duration;
    }
  }

  // Pass 2: derive the duration from a start~end time range, e.g. "09:29~12:30".
  for (const line of lines) {
    const compact = line.replace(/\s+/g, "");
    const duration = parseTimeRangeDuration(compact);
    if (duration !== null && duration > 0) {
      return duration;
    }
  }

  return null;
}

function parseHourMinuteDuration(compact: string): number {
  const hourMatch = compact.match(/(\d+(?:\.\d+)?)(?:小时|时|h)/i);
  const minuteMatch = compact.match(/(\d+)(?:分钟|分|min|m)/i);
  const hours = hourMatch?.[1] ? Math.trunc(Number(hourMatch[1]) * 60) : 0;
  const minutes = minuteMatch?.[1] ? Number(minuteMatch[1]) : 0;
  return hours + minutes;
}

function parseTimeRangeDuration(compact: string): number | null {
  return parseTimeRangeEvidence(compact)?.duration ?? null;
}

function parseTimeRangeEvidence(
  compact: string,
): { startedAt: string; endedAt: string; duration: number } | null {
  const match = compact.match(
    /(\d{1,2})[:：](\d{2})[~～\-—至到](\d{1,2})[:：](\d{2})/,
  );
  if (!match) {
    return null;
  }
  const start = Number(match[1]) * 60 + Number(match[2]);
  let end = Number(match[3]) * 60 + Number(match[4]);
  if (end < start) {
    // The live session crossed midnight.
    end += 24 * 60;
  }
  const diff = end - start;
  return diff > 0
    ? {
        startedAt: formatClockTime(Number(match[1]), Number(match[2])),
        endedAt: formatClockTime(Number(match[3]), Number(match[4])),
        duration: diff,
      }
    : null;
}

function extractViewers(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    const compact = lines[i].replace(/\s+/g, "");
    const match = compact.match(VIEWER_KEYWORDS);
    if (!match) {
      continue;
    }

    // Inline layouts: "场观 1,280 人" / "观众1234.5". Only parse a number from
    // the text AFTER the matched keyword so that an unrelated leading number in
    // a sentence (e.g. "近7目观众评论率…") is not mistaken for a viewer count.
    const afterKeyword = compact.slice((match.index ?? 0) + match[0].length);
    const sameLine = parseViewerCount(afterKeyword);
    if (sameLine !== null) {
      return sameLine;
    }

    // Card/grid layouts render the label and its number on separate lines
    // ("观众人数" above "2,488"), so look at the next value-only line.
    const next = lines[i + 1]?.replace(/\s+/g, "");
    if (next && isViewerValueLine(next)) {
      const value = parseViewerCount(next);
      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

function extractViewersFromItems(items: OcrTextItem[]): number | null {
  const labelPattern = /(观众人数|观看人数|在线人数|场观|人气值?)/;
  const valuePattern = /^\d[\d,，]*(?:\.\d+)?万?$/;

  for (const label of items) {
    const labelText = label.text.replace(/\s+/g, "");
    if (!labelPattern.test(labelText)) {
      continue;
    }

    let best: { value: OcrTextItem; dy: number; dx: number } | null = null;
    for (const value of items) {
      const valueText = value.text.replace(/\s+/g, "");
      if (!valuePattern.test(valueText)) {
        continue;
      }
      const dy = value.y - label.y;
      const dx = Math.abs(value.x - label.x);
      if (dy <= 0 || dy >= 80 || dx >= 80) {
        continue;
      }
      if (!best || dy < best.dy || (dy === best.dy && dx < best.dx)) {
        best = { value, dy, dx };
      }
    }

    if (best) {
      const parsed = parseViewerCount(best.value.text.replace(/\s+/g, ""));
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

function extractDate(lines: string[]): string | null {
  for (const line of lines) {
    const compact = line.replace(/\s+/g, "");
    const match = compact.match(DATE_PATTERN);
    if (!match) continue;

    const year = match[1] ?? String(new Date().getFullYear());
    const month = Number(match[2] ?? match[4]);
    const day = Number(match[3] ?? match[5]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
        2,
        "0",
      )}`;
    }
  }
  return null;
}

function extractTimeEvidence(lines: string[]): {
  startedAt: string | null;
  endedAt: string | null;
  duration: number | null;
} {
  for (const line of lines) {
    const evidence = parseTimeRangeEvidence(line.replace(/\s+/g, ""));
    if (evidence) {
      return {
        startedAt: evidence.startedAt,
        endedAt: evidence.endedAt,
        duration: evidence.duration,
      };
    }
  }

  let startedAt: string | null = null;
  let endedAt: string | null = null;
  for (const line of lines) {
    const compact = line.replace(/\s+/g, "");
    const time = parseSingleClockTime(compact);
    if (!time) continue;
    if (START_TIME_KEYWORDS.test(compact)) {
      startedAt = time;
    }
    if (END_TIME_KEYWORDS.test(compact)) {
      endedAt = time;
    }
  }

  return {
    startedAt,
    endedAt,
    duration:
      startedAt && endedAt ? minutesBetweenClockTimes(startedAt, endedAt) : null,
  };
}

function parseSingleClockTime(compact: string): string | null {
  const match = compact.match(/(\d{1,2})[:：](\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return formatClockTime(hour, minute);
}

function minutesBetweenClockTimes(startedAt: string, endedAt: string): number {
  const [startHour, startMinute] = startedAt.split(":").map(Number);
  const [endHour, endMinute] = endedAt.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end < start) end += 24 * 60;
  return end - start;
}

function formatClockTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractMetricCandidates(
  lines: string[],
  items?: OcrTextItem[],
): LiveReportOcrMetricCandidate[] {
  const candidates: LiveReportOcrMetricCandidate[] = [];
  for (const line of lines) {
    const compact = line.replace(/\s+/g, "");
    for (const definition of METRIC_DEFINITIONS) {
      const match = compact.match(definition.pattern);
      if (!match) continue;
      const afterKeyword = compact.slice((match.index ?? 0) + match[0].length);
      const value = parseMetricCount(afterKeyword);
      if (value !== null) {
        candidates.push({
          key: definition.key,
          label: definition.label,
          value,
          sourceText: line,
          confidence: 90,
        });
      }
    }
  }

  if (items) {
    candidates.push(...extractMetricCandidatesFromItems(items));
  }

  return dedupeMetricCandidates(candidates);
}

function extractMetricCandidatesFromItems(
  items: OcrTextItem[],
): LiveReportOcrMetricCandidate[] {
  const candidates: LiveReportOcrMetricCandidate[] = [];
  const valuePattern = /^\d[\d,，\s]*(?:\.\d+)?万?(?:人|次)?$/;

  for (const label of items) {
    const labelText = label.text.replace(/\s+/g, "");
    const definition = METRIC_DEFINITIONS.find((item) =>
      item.pattern.test(labelText),
    );
    if (!definition) continue;

    let best: { value: OcrTextItem; dy: number; dx: number } | null = null;
    for (const value of items) {
      if (!valuePattern.test(value.text.trim())) continue;
      const dy = value.y - label.y;
      const dx = Math.abs(value.x - label.x);
      if (dy <= 0 || dy >= 90 || dx >= 100) continue;
      if (!best || dy < best.dy || (dy === best.dy && dx < best.dx)) {
        best = { value, dy, dx };
      }
    }

    if (best) {
      const parsed = parseMetricCount(best.value.text);
      if (parsed !== null) {
        candidates.push({
          key: definition.key,
          label: definition.label,
          value: parsed,
          sourceText: `${label.text} ${best.value.text}`,
          confidence: 80,
          x: best.value.x,
          y: best.value.y,
        });
      }
    }
  }

  return candidates;
}

function dedupeMetricCandidates(
  candidates: LiveReportOcrMetricCandidate[],
): LiveReportOcrMetricCandidate[] {
  const byKey = new Map<LiveReportOcrMetricKey, LiveReportOcrMetricCandidate>();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.value) || candidate.value < 0) continue;
    const existing = byKey.get(candidate.key);
    if (
      !existing ||
      candidate.confidence > existing.confidence ||
      (candidate.confidence === existing.confidence &&
        candidate.sourceText.length > existing.sourceText.length)
    ) {
      byKey.set(candidate.key, candidate);
    }
  }
  return [...byKey.values()];
}

function parseViewerCount(compact: string): number | null {
  return parseMetricCount(compact);
}

function parseMetricCount(compact: string): number | null {
  const match = compact.match(/(\d[\d,，\s]*(?:\.\d+)?)\s*(万)?\s*(?:人|次)?/);
  if (!match) {
    return null;
  }

  const unit = match[2];
  const parsed =
    Number(match[1].replace(/[，,\s]/g, "")) * (unit === "万" ? 10000 : 1);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.round(parsed);
  }

  return null;
}

function isViewerValueLine(compact: string): boolean {
  // A value-only line is essentially just the number (optionally 万/人/次),
  // which lets us pair "观众人数" with the "2,488" beneath it without
  // grabbing an adjacent label such as "送礼人数".
  return /^\d[\d,，]*(?:\.\d+)?万?(?:人|次)?$/.test(compact);
}

function calculateConfidence({
  extractedDuration,
  extractedViewers,
  metricCandidateCount,
  totalLines,
}: {
  extractedDuration: number | null;
  extractedViewers: number | null;
  metricCandidateCount: number;
  totalLines: number;
}): number {
  let confidence = 40;
  if (extractedDuration !== null) {
    confidence += 35;
  }
  if (extractedViewers !== null) {
    confidence += 25;
  }
  if (metricCandidateCount > 0) {
    confidence += Math.min(20, metricCandidateCount * 5);
  }
  if (totalLines <= 1) {
    confidence -= 10;
  }
  return Math.max(0, Math.min(100, confidence));
}
