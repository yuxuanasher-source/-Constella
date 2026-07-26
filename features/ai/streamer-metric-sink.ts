import type { LiveReportOcrMetricKey } from "./ocr-template-parser";

const OCR_METRIC_KEYS = new Set<LiveReportOcrMetricKey>([
  "viewers",
  "pcu",
  "acu",
  "exposure",
  "clicks",
  "interactions",
  "comments",
  "likes",
  "shares",
  "follows",
  "gmv",
]);

const OCR_METRIC_CONFLICT_KEY =
  "organization_id,streamer_id,metric_key,metric_window,source_report_id";

export type StreamerMetricSinkClient = {
  from(table: "streamer_metrics"): {
    upsert(
      payload: Record<string, unknown>[],
      options: { onConflict: string },
    ): PromiseLike<{ error: Error | null }>;
  };
};

export type OcrStreamerMetricAttribution = {
  organizationId?: string | null;
  streamerId?: string | null;
  projectId?: string | null;
  sourceReportId?: string | null;
  reportDate?: string | null;
  sourceInvocationId?: string | null;
};

type RuntimeMetricCandidate = {
  key?: unknown;
  value?: unknown;
  confidence?: unknown;
};

export async function writeStreamerMetricsFromOcr({
  client,
  attribution,
  metricCandidates,
}: {
  client: StreamerMetricSinkClient;
  attribution: OcrStreamerMetricAttribution;
  metricCandidates: readonly unknown[];
}): Promise<{ written: number }> {
  const organizationId = nonEmptyString(attribution.organizationId);
  const streamerId = nonEmptyString(attribution.streamerId);
  const sourceReportId = nonEmptyString(attribution.sourceReportId);
  const reportDate = normalizeIsoDate(attribution.reportDate);
  if (!organizationId || !streamerId || !sourceReportId || !reportDate) {
    return { written: 0 };
  }

  const byKey = new Map<
    LiveReportOcrMetricKey,
    { value: number; confidence: number }
  >();
  for (const candidate of metricCandidates) {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) continue;
    const previous = byKey.get(normalized.key);
    if (!previous || normalized.confidence >= previous.confidence) {
      byKey.set(normalized.key, {
        value: normalized.value,
        confidence: normalized.confidence,
      });
    }
  }

  if (byKey.size === 0) {
    return { written: 0 };
  }

  const sourceInvocationId =
    nonEmptyString(attribution.sourceInvocationId) ?? null;
  const rows = [...byKey].map(([metricKey, metric]) => ({
    organization_id: organizationId,
    streamer_id: streamerId,
    metric_key: metricKey,
    metric_value: metric.value,
    metric_window: reportDate,
    source_report_id: sourceReportId,
    source_invocation_id: sourceInvocationId,
  }));
  const { error } = await client.from("streamer_metrics").upsert(rows, {
    onConflict: OCR_METRIC_CONFLICT_KEY,
  });
  if (error) {
    throw error;
  }

  return { written: rows.length };
}

function normalizeCandidate(
  candidate: unknown,
): { key: LiveReportOcrMetricKey; value: number; confidence: number } | null {
  if (!candidate || typeof candidate !== "object") return null;
  const runtimeCandidate = candidate as RuntimeMetricCandidate;
  if (
    typeof runtimeCandidate.key !== "string" ||
    !OCR_METRIC_KEYS.has(runtimeCandidate.key as LiveReportOcrMetricKey) ||
    typeof runtimeCandidate.value !== "number" ||
    !Number.isFinite(runtimeCandidate.value) ||
    runtimeCandidate.value < 0
  ) {
    return null;
  }

  const confidence =
    typeof runtimeCandidate.confidence === "number" &&
    Number.isFinite(runtimeCandidate.confidence)
      ? runtimeCandidate.confidence
      : 0;
  return {
    key: runtimeCandidate.key as LiveReportOcrMetricKey,
    value: Math.round(runtimeCandidate.value),
    confidence,
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}
