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

const INT4_MAX = 2_147_483_647;

export type StreamerMetricSinkClient = {
  rpc(
    name: "upsert_ocr_streamer_metrics",
    args: {
      p_live_report_id: string;
      p_metrics: Array<{ key: LiveReportOcrMetricKey; value: number }>;
      p_source_invocation_id: string;
    },
  ): PromiseLike<{ data: number | null; error: Error | null }>;
};

type RuntimeMetricCandidate = {
  key?: unknown;
  value?: unknown;
  confidence?: unknown;
};

export async function writeStreamerMetricsFromOcr({
  client,
  sourceReportId,
  sourceInvocationId,
  metricCandidates,
}: {
  client: StreamerMetricSinkClient;
  sourceReportId?: string | null;
  sourceInvocationId?: string | null;
  metricCandidates: readonly unknown[];
}): Promise<{ written: number }> {
  const reportId = nonEmptyString(sourceReportId);
  const invocationId = nonEmptyString(sourceInvocationId);
  if (!reportId || !invocationId) {
    return { written: 0 };
  }

  const metrics = normalizeOcrMetricCandidates(metricCandidates);
  if (metrics.length === 0) {
    return { written: 0 };
  }

  const { data, error } = await client.rpc("upsert_ocr_streamer_metrics", {
    p_live_report_id: reportId,
    p_metrics: metrics,
    p_source_invocation_id: invocationId,
  });
  if (error) {
    throw error;
  }
  if (typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) {
    throw new Error("OCR metric RPC returned an invalid write count");
  }

  return { written: data };
}

export function normalizeOcrMetricCandidates(
  metricCandidates: readonly unknown[],
): Array<{ key: LiveReportOcrMetricKey; value: number }> {
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

  return [...byKey].map(([key, metric]) => ({
    key,
    value: metric.value,
  }));
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
    runtimeCandidate.value < 0 ||
    runtimeCandidate.value > INT4_MAX
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
    // metric_value is int4. GMV uses whole CNY yuan, matching the parser's
    // existing rounding convention.
    value: Math.round(runtimeCandidate.value),
    confidence,
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
