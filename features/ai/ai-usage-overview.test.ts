import { describe, expect, it } from "vitest";

import {
  summarizeAiInvocations,
  type AiInvocationUsageRow,
} from "./ai-usage-overview";

const now = new Date("2026-06-18T12:00:00.000Z");

function row(overrides: Partial<AiInvocationUsageRow>): AiInvocationUsageRow {
  return {
    id: overrides.id ?? "inv-1",
    scene: overrides.scene ?? "business_analysis",
    provider_name: overrides.provider_name ?? "hunyuan",
    status: overrides.status ?? "succeeded",
    prompt_tokens: overrides.prompt_tokens ?? 100,
    completion_tokens: overrides.completion_tokens ?? 50,
    total_tokens: overrides.total_tokens ?? 150,
    cost_cents: overrides.cost_cents ?? 2,
    latency_ms: overrides.latency_ms ?? 400,
    actor_name: overrides.actor_name ?? "Ops",
    created_at: overrides.created_at ?? "2026-06-18T08:00:00.000Z",
  };
}

describe("summarizeAiInvocations", () => {
  it("aggregates totals, scenes, providers, status and latency", () => {
    const overview = summarizeAiInvocations(
      [
        row({
          id: "a",
          scene: "business_analysis",
          cost_cents: 3,
          latency_ms: 200,
        }),
        row({
          id: "b",
          scene: "business_analysis",
          status: "failed",
          cost_cents: 0,
          latency_ms: 600,
        }),
        row({
          id: "c",
          scene: "streamer_diagnosis",
          provider_name: "openai",
          cost_cents: 5,
          total_tokens: 300,
          latency_ms: null,
        }),
      ],
      { now, rangeDays: 30 },
    );

    expect(overview.totals.invocations).toBe(3);
    expect(overview.totals.succeeded).toBe(2);
    expect(overview.totals.failed).toBe(1);
    expect(overview.totals.costCents).toBe(8);
    expect(overview.totals.totalTokens).toBe(150 + 150 + 300);
    // success rate = 2/3 → 6667 bps (rounded)
    expect(overview.totals.successRateBps).toBe(6667);
    // latency average ignores the null entry: (200 + 600) / 2 = 400
    expect(overview.totals.avgLatencyMs).toBe(400);

    // scenes sorted by cost desc: streamer_diagnosis (5) before business_analysis (3)
    expect(overview.byScene.map((s) => s.scene)).toEqual([
      "streamer_diagnosis",
      "business_analysis",
    ]);
    const ba = overview.byScene.find((s) => s.scene === "business_analysis");
    expect(ba).toMatchObject({ invocations: 2, succeeded: 1, failed: 1 });

    expect(overview.byProvider.map((p) => p.provider)).toEqual([
      "hunyuan",
      "openai",
    ]);
    expect(overview.byStatus).toEqual(
      expect.arrayContaining([
        { status: "succeeded", count: 2 },
        { status: "failed", count: 1 },
      ]),
    );
  });

  it("buckets the daily trend across the requested range and ends on today", () => {
    const overview = summarizeAiInvocations(
      [
        row({
          id: "today",
          created_at: "2026-06-18T01:00:00.000Z",
          cost_cents: 4,
        }),
        row({
          id: "old",
          created_at: "2026-06-16T01:00:00.000Z",
          cost_cents: 1,
        }),
      ],
      { now, rangeDays: 7 },
    );

    expect(overview.dailyTrend).toHaveLength(7);
    expect(overview.dailyTrend[overview.dailyTrend.length - 1].date).toBe(
      "2026-06-18",
    );
    const today = overview.dailyTrend.find((d) => d.date === "2026-06-18");
    expect(today).toMatchObject({ invocations: 1, costCents: 4 });
    const old = overview.dailyTrend.find((d) => d.date === "2026-06-16");
    expect(old).toMatchObject({ invocations: 1, costCents: 1 });
  });

  it("returns recent invocations sorted newest first and respects the limit", () => {
    const overview = summarizeAiInvocations(
      [
        row({ id: "older", created_at: "2026-06-18T08:00:00.000Z" }),
        row({ id: "newer", created_at: "2026-06-18T10:00:00.000Z" }),
      ],
      { now, recentLimit: 1 },
    );

    expect(overview.recent).toHaveLength(1);
    expect(overview.recent[0].id).toBe("newer");
  });

  it("falls back to safe defaults for empty input", () => {
    const overview = summarizeAiInvocations([], { now });
    expect(overview.totals.invocations).toBe(0);
    expect(overview.totals.successRateBps).toBe(0);
    expect(overview.totals.avgLatencyMs).toBeNull();
    expect(overview.byScene).toEqual([]);
    expect(overview.recent).toEqual([]);
    expect(overview.dailyTrend).toHaveLength(30);
  });
});
