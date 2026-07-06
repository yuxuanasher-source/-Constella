import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

// 伪 admin client：head+count 计数按记录到的 status 过滤条件分流返回，
// oldest queued 窄查询走 maybeSingle。builder 本身是 thenable，
// 对齐 supabase-js「await 查询链」的用法。
function fakeQueueClient({
  queued = 0,
  running = 0,
  failed24h = 0,
  succeeded24h = 0,
  oldestQueuedCreatedAt = null,
  countError = null,
}: {
  queued?: number;
  running?: number;
  failed24h?: number;
  succeeded24h?: number;
  oldestQueuedCreatedAt?: string | null;
  countError?: Error | null;
}) {
  const gteCalls: Array<[string, string]> = [];
  const from = vi.fn((table: string) => {
    expect(table).toBe("recording_ai_analyses");
    const state = { status: "" };
    const countResult = () => {
      if (countError) {
        return { count: null, error: countError };
      }
      const count =
        state.status === "queued"
          ? queued
          : state.status === "running"
            ? running
            : state.status === "failed"
              ? failed24h
              : succeeded24h;
      return { count, error: null };
    };
    const builder = {
      select: () => builder,
      eq: (_column: string, value: string) => {
        state.status = value;
        return builder;
      },
      gte: (column: string, value: string) => {
        gteCalls.push([column, value]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({
        data: oldestQueuedCreatedAt
          ? { created_at: oldestQueuedCreatedAt }
          : null,
        error: null,
      }),
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected: (reason: unknown) => unknown,
      ) => Promise.resolve(countResult()).then(onFulfilled, onRejected),
    };
    return builder;
  });
  return { from, gteCalls };
}

function queueHealthRequest(token?: string) {
  return new Request(
    "http://localhost/api/internal/recording-ai/queue-health",
    {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    },
  );
}

describe("/api/internal/recording-ai/queue-health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RECORDING_AI_RUNNER_TOKEN", "runner-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("rejects missing or invalid runner tokens", async () => {
    const missing = await GET(queueHealthRequest());
    expect(missing.status).toBe(401);

    const wrong = await GET(queueHealthRequest("wrong-token"));
    expect(wrong.status).toBe(401);

    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("reports queue counts, 24h failure rate and oldest queued age", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    const client = fakeQueueClient({
      queued: 3,
      running: 1,
      failed24h: 2,
      succeeded24h: 6,
      // 最老 queued 于 90 分钟前入队。
      oldestQueuedCreatedAt: "2026-07-06T10:30:00.000Z",
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

    const response = await GET(queueHealthRequest("runner-token"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      queued: 3,
      running: 1,
      failed24h: 2,
      failureRate24h: 0.25,
      oldestQueuedMinutes: 90,
    });
    // 近 24h 完成数按 completed_at >= now-24h 统计（成功、失败各一次）。
    expect(client.gteCalls).toEqual([
      ["completed_at", "2026-07-05T12:00:00.000Z"],
      ["completed_at", "2026-07-05T12:00:00.000Z"],
    ]);
  });

  it("reports zeros for an empty queue", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      fakeQueueClient({}) as never,
    );

    const response = await GET(queueHealthRequest("runner-token"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      queued: 0,
      running: 0,
      failed24h: 0,
      failureRate24h: 0,
      oldestQueuedMinutes: 0,
    });
  });

  it("returns 500 when the admin client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await GET(queueHealthRequest("runner-token"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Supabase admin client is unavailable",
    });
  });

  it("returns a generic 500 without leaking details when counting fails", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      fakeQueueClient({
        countError: new Error("connection refused at 10.0.0.5:5432"),
      }) as never,
    );

    const response = await GET(queueHealthRequest("runner-token"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: "Recording AI queue health is unavailable",
    });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });
});
