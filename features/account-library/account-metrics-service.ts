import {
  assertCanManageAccounts,
  type AccountLibraryActor,
  type AccountLibraryAuditWriter,
  type PlatformAccountRecord,
} from "./account-library-service";

// 平台开放接口回传的单账号日指标：粉丝量、场观、流水
export type AccountMetricsPayload = {
  metricDate: string;
  followerCount: number;
  liveViewCount: number;
  gmvAmount: number;
  liveDurationMinutes?: number;
};

export type PlatformMetricsFetcher = (
  account: Pick<PlatformAccountRecord, "id" | "platform" | "accountUid">,
) => Promise<AccountMetricsPayload | null>;

export type AccountMetricsUpsertInput = {
  organizationId: string;
  accountId: string;
  metricDate: string;
  followerCount: number;
  liveViewCount: number;
  gmvAmount: number;
  liveDurationMinutes: number;
  source: "platform_api" | "manual";
  syncedAt: string;
};

export type AccountMetricsRepository = {
  listSyncableAccounts(
    organizationId: string,
  ): Promise<PlatformAccountRecord[]>;
  upsertMetrics(input: AccountMetricsUpsertInput): Promise<void>;
  updateAccount(
    accountId: string,
    patch: Record<string, unknown>,
  ): Promise<PlatformAccountRecord>;
};

export type MetricsSyncResult = {
  scannedCount: number;
  syncedCount: number;
  skippedCount: number;
  failures: Array<{ accountId: string; error: string }>;
};

const METRIC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeMetricsPayload(
  payload: AccountMetricsPayload,
): AccountMetricsPayload {
  if (!METRIC_DATE_PATTERN.test(payload.metricDate)) {
    throw new Error("metricDate must be an ISO date (YYYY-MM-DD)");
  }
  for (const [field, value] of [
    ["followerCount", payload.followerCount],
    ["liveViewCount", payload.liveViewCount],
    ["gmvAmount", payload.gmvAmount],
    ["liveDurationMinutes", payload.liveDurationMinutes ?? 0],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${field} must be a non-negative number`);
    }
  }
  return {
    metricDate: payload.metricDate,
    followerCount: Math.floor(payload.followerCount),
    liveViewCount: Math.floor(payload.liveViewCount),
    gmvAmount: payload.gmvAmount,
    liveDurationMinutes: Math.floor(payload.liveDurationMinutes ?? 0),
  };
}

// 自动同步：拉取在库账号（frozen/retired 除外）的平台指标，
// 落日指标表并回写账号粉丝量、最近直播/同步时间。
export async function syncPlatformAccountMetrics({
  repo,
  audit,
  actor,
  fetcher,
  now = new Date().toISOString(),
}: {
  repo: AccountMetricsRepository;
  audit: AccountLibraryAuditWriter;
  actor: AccountLibraryActor;
  fetcher: PlatformMetricsFetcher;
  now?: string;
}): Promise<MetricsSyncResult> {
  assertCanManageAccounts(actor.role);

  const accounts = await repo.listSyncableAccounts(actor.organizationId);

  let syncedCount = 0;
  let skippedCount = 0;
  const failures: MetricsSyncResult["failures"] = [];

  for (const account of accounts) {
    let payload: AccountMetricsPayload | null;
    try {
      const fetched = await fetcher({
        id: account.id,
        platform: account.platform,
        accountUid: account.accountUid,
      });
      payload = fetched ? normalizeMetricsPayload(fetched) : null;
    } catch (error) {
      failures.push({
        accountId: account.id,
        error: error instanceof Error ? error.message : "fetch failed",
      });
      continue;
    }

    if (!payload) {
      skippedCount += 1;
      continue;
    }

    await repo.upsertMetrics({
      organizationId: actor.organizationId,
      accountId: account.id,
      metricDate: payload.metricDate,
      followerCount: payload.followerCount,
      liveViewCount: payload.liveViewCount,
      gmvAmount: payload.gmvAmount,
      liveDurationMinutes: payload.liveDurationMinutes ?? 0,
      source: "platform_api",
      syncedAt: now,
    });

    const patch: Record<string, unknown> = {
      follower_count: payload.followerCount,
      last_synced_at: now,
    };
    const hasLiveActivity =
      payload.liveViewCount > 0 || (payload.liveDurationMinutes ?? 0) > 0;
    if (hasLiveActivity) {
      const liveAt = `${payload.metricDate}T00:00:00.000Z`;
      if (!account.lastLiveAt || liveAt > account.lastLiveAt) {
        patch.last_live_at = liveAt;
      }
    }
    await repo.updateAccount(account.id, patch);
    syncedCount += 1;
  }

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "account_library",
    objectType: "account_metrics_sync",
    after: {
      scannedCount: accounts.length,
      syncedCount,
      skippedCount,
      failedCount: failures.length,
    },
    changedFields: ["follower_count", "last_synced_at"],
    result: failures.length > 0 && syncedCount === 0 ? "failure" : "success",
  });

  return {
    scannedCount: accounts.length,
    syncedCount,
    skippedCount,
    failures,
  };
}

// 推送模式：外部集成一次性送入多账号指标时，用映射表构造 fetcher
export function createPushedMetricsFetcher(
  metricsByAccount: Map<string, AccountMetricsPayload>,
): PlatformMetricsFetcher {
  return async (account) => metricsByAccount.get(account.id) ?? null;
}

// 拉取模式：对接平台开放接口网关，按账号逐个请求指标
export function createHttpMetricsFetcher({
  endpoint,
  token,
  fetchImpl = fetch,
}: {
  endpoint: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): PlatformMetricsFetcher {
  return async (account) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        platform: account.platform,
        accountUid: account.accountUid,
      }),
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Metrics endpoint responded with ${response.status}`);
    }

    const payload = (await response.json()) as AccountMetricsPayload | null;
    return payload ?? null;
  };
}
