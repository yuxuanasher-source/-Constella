import type { SupabaseClient } from "@supabase/supabase-js";

export type AiInvocationUsageRow = {
  id: string;
  scene: string | null;
  provider_name: string | null;
  status: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_cents: number | null;
  latency_ms: number | null;
  actor_name: string | null;
  created_at: string;
};

export type AiUsageTotals = {
  invocations: number;
  succeeded: number;
  failed: number;
  degraded: number;
  successRateBps: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCents: number;
  avgLatencyMs: number | null;
};

export type AiUsageSceneBreakdown = {
  scene: string;
  invocations: number;
  succeeded: number;
  failed: number;
  totalTokens: number;
  costCents: number;
};

export type AiUsageProviderBreakdown = {
  provider: string;
  invocations: number;
  totalTokens: number;
  costCents: number;
};

export type AiUsageStatusBreakdown = {
  status: string;
  count: number;
};

export type AiUsageDailyPoint = {
  date: string;
  invocations: number;
  totalTokens: number;
  costCents: number;
};

export type AiUsageRecentInvocation = {
  id: string;
  scene: string;
  provider: string;
  status: string;
  totalTokens: number;
  costCents: number;
  latencyMs: number | null;
  actorName: string;
  createdAt: string;
};

export type AiUsageOverview = {
  rangeDays: number;
  generatedAt: string;
  totals: AiUsageTotals;
  byScene: AiUsageSceneBreakdown[];
  byProvider: AiUsageProviderBreakdown[];
  byStatus: AiUsageStatusBreakdown[];
  dailyTrend: AiUsageDailyPoint[];
  recent: AiUsageRecentInvocation[];
};

const DEFAULT_RANGE_DAYS = 30;
const DEFAULT_RECENT_LIMIT = 20;

export function summarizeAiInvocations(
  rows: AiInvocationUsageRow[],
  {
    now = new Date(),
    rangeDays = DEFAULT_RANGE_DAYS,
    recentLimit = DEFAULT_RECENT_LIMIT,
  }: { now?: Date; rangeDays?: number; recentLimit?: number } = {},
): AiUsageOverview {
  const days = clampInt(rangeDays, 1, 365, DEFAULT_RANGE_DAYS);
  const totals: AiUsageTotals = {
    invocations: 0,
    succeeded: 0,
    failed: 0,
    degraded: 0,
    successRateBps: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costCents: 0,
    avgLatencyMs: null,
  };

  const sceneMap = new Map<string, AiUsageSceneBreakdown>();
  const providerMap = new Map<string, AiUsageProviderBreakdown>();
  const statusMap = new Map<string, number>();
  const dailyMap = buildDailyBuckets(now, days);

  let latencySum = 0;
  let latencyCount = 0;

  for (const row of rows) {
    const promptTokens = nonnegative(row.prompt_tokens);
    const completionTokens = nonnegative(row.completion_tokens);
    const totalTokens = nonnegative(
      row.total_tokens ?? promptTokens + completionTokens,
    );
    const costCents = nonnegative(row.cost_cents);
    const status = (row.status ?? "started").trim() || "started";
    const scene = (row.scene ?? "unknown").trim() || "unknown";
    const provider = (row.provider_name ?? "unknown").trim() || "unknown";

    totals.invocations += 1;
    totals.promptTokens += promptTokens;
    totals.completionTokens += completionTokens;
    totals.totalTokens += totalTokens;
    totals.costCents += costCents;
    if (status === "succeeded") totals.succeeded += 1;
    else if (status === "failed") totals.failed += 1;
    else if (status === "degraded") totals.degraded += 1;

    if (row.latency_ms != null && Number.isFinite(row.latency_ms)) {
      latencySum += Math.max(0, Math.trunc(row.latency_ms));
      latencyCount += 1;
    }

    const sceneEntry = sceneMap.get(scene) ?? {
      scene,
      invocations: 0,
      succeeded: 0,
      failed: 0,
      totalTokens: 0,
      costCents: 0,
    };
    sceneEntry.invocations += 1;
    sceneEntry.totalTokens += totalTokens;
    sceneEntry.costCents += costCents;
    if (status === "succeeded") sceneEntry.succeeded += 1;
    else if (status === "failed") sceneEntry.failed += 1;
    sceneMap.set(scene, sceneEntry);

    const providerEntry = providerMap.get(provider) ?? {
      provider,
      invocations: 0,
      totalTokens: 0,
      costCents: 0,
    };
    providerEntry.invocations += 1;
    providerEntry.totalTokens += totalTokens;
    providerEntry.costCents += costCents;
    providerMap.set(provider, providerEntry);

    statusMap.set(status, (statusMap.get(status) ?? 0) + 1);

    const dayKey = toDateKey(row.created_at);
    const dayPoint = dailyMap.get(dayKey);
    if (dayPoint) {
      dayPoint.invocations += 1;
      dayPoint.totalTokens += totalTokens;
      dayPoint.costCents += costCents;
    }
  }

  totals.successRateBps =
    totals.invocations > 0
      ? Math.round((totals.succeeded / totals.invocations) * 10000)
      : 0;
  totals.avgLatencyMs =
    latencyCount > 0 ? Math.round(latencySum / latencyCount) : null;

  const byScene = [...sceneMap.values()].sort(
    (a, b) => b.costCents - a.costCents || b.invocations - a.invocations,
  );
  const byProvider = [...providerMap.values()].sort(
    (a, b) => b.invocations - a.invocations || b.costCents - a.costCents,
  );
  const byStatus = [...statusMap.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
  const dailyTrend = [...dailyMap.values()];

  const recent = [...rows]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, clampInt(recentLimit, 1, 100, DEFAULT_RECENT_LIMIT))
    .map((row) => ({
      id: row.id,
      scene: (row.scene ?? "unknown").trim() || "unknown",
      provider: (row.provider_name ?? "unknown").trim() || "unknown",
      status: (row.status ?? "started").trim() || "started",
      totalTokens: nonnegative(
        row.total_tokens ??
          nonnegative(row.prompt_tokens) + nonnegative(row.completion_tokens),
      ),
      costCents: nonnegative(row.cost_cents),
      latencyMs:
        row.latency_ms != null && Number.isFinite(row.latency_ms)
          ? Math.max(0, Math.trunc(row.latency_ms))
          : null,
      actorName: (row.actor_name ?? "—").trim() || "—",
      createdAt: row.created_at,
    }));

  return {
    rangeDays: days,
    generatedAt: now.toISOString(),
    totals,
    byScene,
    byProvider,
    byStatus,
    dailyTrend,
    recent,
  };
}

export async function getAiUsageOverview({
  client,
  organizationId,
  rangeDays = DEFAULT_RANGE_DAYS,
  now = new Date(),
}: {
  client: SupabaseClient;
  organizationId: string;
  rangeDays?: number;
  now?: Date;
}): Promise<AiUsageOverview> {
  const days = clampInt(rangeDays, 1, 365, DEFAULT_RANGE_DAYS);
  const since = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await client
    .from("ai_invocations")
    .select(
      "id, scene, provider_name, status, prompt_tokens, completion_tokens, total_tokens, cost_cents, latency_ms, actor_name, created_at",
    )
    .eq("organization_id", organizationId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .returns<AiInvocationUsageRow[]>();

  if (error) {
    throw error;
  }

  return summarizeAiInvocations(data ?? [], { now, rangeDays: days });
}

function buildDailyBuckets(
  now: Date,
  days: number,
): Map<string, AiUsageDailyPoint> {
  const map = new Map<string, AiUsageDailyPoint>();
  const base = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(base.getTime() - i * 24 * 60 * 60 * 1000);
    const key = day.toISOString().slice(0, 10);
    map.set(key, { date: key, invocations: 0, totalTokens: 0, costCents: 0 });
  }
  return map;
}

function toDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function nonnegative(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function clampInt(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
