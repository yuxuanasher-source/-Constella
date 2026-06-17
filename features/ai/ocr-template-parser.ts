export type LiveReportOcrParseStatus =
  | "trusted"
  | "needs_confirmation"
  | "failed";

export type LiveReportOcrParseResult = {
  status: LiveReportOcrParseStatus;
  extractedDuration: number | null;
  extractedViewers: number | null;
  confidence: number;
  reasons: string[];
};

const DURATION_KEYWORDS = /(时长|直播|开播|有效)/;
const DURATION_HINT = /(小时|分钟)/;
const VIEWER_KEYWORDS = /(观看人数|观众|场观|人气|views?|viewer)/i;

export function parseLiveReportOcrText(
  lines: string[],
  options: {
    expectedDuration?: number;
    minConfidence?: number;
  } = {},
): LiveReportOcrParseResult {
  const normalized = lines.map((line) => line.trim()).filter(Boolean);
  const extractedDuration = extractDuration(normalized);
  const extractedViewers = extractViewers(normalized);
  const reasons: string[] = [];

  if (extractedDuration === null && extractedViewers === null) {
    return {
      status: "failed",
      extractedDuration,
      extractedViewers,
      confidence: 0,
      reasons: ["no_live_report_fields"],
    };
  }

  const confidence = calculateConfidence({
    extractedDuration,
    extractedViewers,
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
  return diff > 0 ? diff : null;
}

function extractViewers(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    const compact = lines[i].replace(/\s+/g, "");
    if (!VIEWER_KEYWORDS.test(compact)) {
      continue;
    }

    // Inline layouts: "场观 1,280 人".
    const sameLine = parseViewerCount(compact);
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

function parseViewerCount(compact: string): number | null {
  const match = compact.match(/(\d[\d,，]*(?:\.\d+)?)\s*(万)?\s*(?:人|次)?/);
  if (!match) {
    return null;
  }

  const unit = match[2];
  const parsed =
    Number(match[1].replace(/[，,]/g, "")) * (unit === "万" ? 10000 : 1);
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
  totalLines,
}: {
  extractedDuration: number | null;
  extractedViewers: number | null;
  totalLines: number;
}): number {
  let confidence = 40;
  if (extractedDuration !== null) {
    confidence += 35;
  }
  if (extractedViewers !== null) {
    confidence += 25;
  }
  if (totalLines <= 1) {
    confidence -= 10;
  }
  return Math.max(0, Math.min(100, confidence));
}
