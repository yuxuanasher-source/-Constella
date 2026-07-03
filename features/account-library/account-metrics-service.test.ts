import { describe, expect, it, vi } from "vitest";

import type { PlatformAccountRecord } from "./account-library-service";
import {
  createPushedMetricsFetcher,
  normalizeMetricsPayload,
  syncPlatformAccountMetrics,
  type AccountMetricsPayload,
} from "./account-metrics-service";

const actor = {
  userId: "33333333-3333-3333-3333-333333333333",
  name: "同步任务",
  role: "ops_manager" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

function accountRecord(
  overrides: Partial<PlatformAccountRecord> = {},
): PlatformAccountRecord {
  return {
    id: "ACC-1",
    organizationId: actor.organizationId,
    platform: "抖音",
    accountUid: "douyin-001",
    accountType: "self_incubated",
    status: "active",
    boundStreamerId: null,
    realNameHolder: null,
    realNamePhone: null,
    lastLiveAt: null,
    ...overrides,
  };
}

function metricsRepo(overrides: Record<string, unknown> = {}) {
  return {
    listSyncableAccounts: vi.fn().mockResolvedValue([accountRecord()]),
    upsertMetrics: vi.fn().mockResolvedValue(undefined),
    updateAccount: vi.fn().mockResolvedValue(accountRecord()),
    ...overrides,
  };
}

const payload: AccountMetricsPayload = {
  metricDate: "2026-07-02",
  followerCount: 15200,
  liveViewCount: 4300,
  gmvAmount: 8888.5,
  liveDurationMinutes: 240,
};

describe("metrics payload validation", () => {
  it("rejects malformed metric dates", () => {
    expect(() =>
      normalizeMetricsPayload({ ...payload, metricDate: "07/02/2026" }),
    ).toThrow("metricDate must be an ISO date (YYYY-MM-DD)");
  });

  it("rejects negative counters", () => {
    expect(() =>
      normalizeMetricsPayload({ ...payload, liveViewCount: -1 }),
    ).toThrow("liveViewCount must be a non-negative number");
  });
});

describe("platform metrics sync", () => {
  it("upserts daily metrics and refreshes account counters", async () => {
    const repo = metricsRepo();
    const audit = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn().mockResolvedValue(payload);

    const result = await syncPlatformAccountMetrics({
      repo,
      audit,
      actor,
      fetcher,
      now: "2026-07-03T02:00:00.000Z",
    });

    expect(result).toEqual({
      scannedCount: 1,
      syncedCount: 1,
      skippedCount: 0,
      failures: [],
    });
    expect(repo.upsertMetrics).toHaveBeenCalledWith({
      organizationId: actor.organizationId,
      accountId: "ACC-1",
      metricDate: "2026-07-02",
      followerCount: 15200,
      liveViewCount: 4300,
      gmvAmount: 8888.5,
      liveDurationMinutes: 240,
      source: "platform_api",
      syncedAt: "2026-07-03T02:00:00.000Z",
    });
    expect(repo.updateAccount).toHaveBeenCalledWith("ACC-1", {
      follower_count: 15200,
      last_synced_at: "2026-07-03T02:00:00.000Z",
      last_live_at: "2026-07-02T00:00:00.000Z",
    });
  });

  it("does not rewind last_live_at for older metric dates", async () => {
    const repo = metricsRepo({
      listSyncableAccounts: vi
        .fn()
        .mockResolvedValue([
          accountRecord({ lastLiveAt: "2026-07-02T12:00:00.000Z" }),
        ]),
    });
    const audit = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ...payload, metricDate: "2026-06-20" });

    await syncPlatformAccountMetrics({
      repo,
      audit,
      actor,
      fetcher,
      now: "2026-07-03T02:00:00.000Z",
    });

    expect(repo.updateAccount).toHaveBeenCalledWith("ACC-1", {
      follower_count: 15200,
      last_synced_at: "2026-07-03T02:00:00.000Z",
    });
  });

  it("keeps syncing other accounts when one fetch fails", async () => {
    const repo = metricsRepo({
      listSyncableAccounts: vi
        .fn()
        .mockResolvedValue([
          accountRecord({ id: "ACC-1" }),
          accountRecord({ id: "ACC-2", accountUid: "douyin-002" }),
        ]),
    });
    const audit = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("platform timeout"))
      .mockResolvedValueOnce(payload);

    const result = await syncPlatformAccountMetrics({
      repo,
      audit,
      actor,
      fetcher,
    });

    expect(result.syncedCount).toBe(1);
    expect(result.failures).toEqual([
      { accountId: "ACC-1", error: "platform timeout" },
    ]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        objectType: "account_metrics_sync",
        result: "success",
      }),
    );
  });

  it("skips accounts the platform has no data for", async () => {
    const repo = metricsRepo();
    const audit = vi.fn().mockResolvedValue(undefined);
    const fetcher = createPushedMetricsFetcher(new Map());

    const result = await syncPlatformAccountMetrics({
      repo,
      audit,
      actor,
      fetcher,
    });

    expect(result).toEqual({
      scannedCount: 1,
      syncedCount: 0,
      skippedCount: 1,
      failures: [],
    });
    expect(repo.upsertMetrics).not.toHaveBeenCalled();
  });
});
