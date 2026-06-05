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
  for (const line of lines) {
    const compact = line.replace(/\s+/g, "");
    if (!/(时长|直播|开播|有效)/.test(compact)) {
      continue;
    }

    const hourMatch = compact.match(/(\d+(?:\.\d+)?)(?:小时|时|h)/i);
    const minuteMatch = compact.match(/(\d+)(?:分钟|分|min|m)/i);
    const hours = hourMatch?.[1]
      ? Math.trunc(Number(hourMatch[1]) * 60)
      : 0;
    const minutes = minuteMatch?.[1] ? Number(minuteMatch[1]) : 0;
    const duration = hours + minutes;
    if (duration > 0) {
      return duration;
    }
  }

  return null;
}

function extractViewers(lines: string[]): number | null {
  for (const line of lines) {
    const compact = line.replace(/\s+/g, "");
    if (!/(观看人数|观众|场观|人气|views?|viewer)/i.test(compact)) {
      continue;
    }

    const viewerMatch = compact.match(/(\d[\d,，.]*)\s*(?:人|次)?/);
    if (!viewerMatch) {
      continue;
    }

    const parsed = Number(viewerMatch[1].replace(/[，,]/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }

  return null;
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
