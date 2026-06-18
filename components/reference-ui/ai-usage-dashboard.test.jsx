import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AiUsageDashboard from "./ai-usage-dashboard";

const usage = {
  rangeDays: 30,
  generatedAt: "2026-06-18T12:00:00.000Z",
  totals: {
    invocations: 12,
    succeeded: 10,
    failed: 1,
    degraded: 1,
    successRateBps: 8333,
    promptTokens: 4000,
    completionTokens: 2000,
    totalTokens: 6000,
    costCents: 345,
    avgLatencyMs: 820,
  },
  byScene: [
    {
      scene: "business_analysis",
      invocations: 7,
      succeeded: 6,
      failed: 1,
      totalTokens: 4000,
      costCents: 240,
    },
    {
      scene: "streamer_diagnosis",
      invocations: 5,
      succeeded: 4,
      failed: 0,
      totalTokens: 2000,
      costCents: 105,
    },
  ],
  byProvider: [
    { provider: "hunyuan", invocations: 11, totalTokens: 5800, costCents: 340 },
    {
      provider: "deterministic",
      invocations: 1,
      totalTokens: 200,
      costCents: 5,
    },
  ],
  byStatus: [
    { status: "succeeded", count: 10 },
    { status: "failed", count: 1 },
    { status: "degraded", count: 1 },
  ],
  dailyTrend: [
    { date: "2026-06-17", invocations: 5, totalTokens: 3000, costCents: 145 },
    { date: "2026-06-18", invocations: 7, totalTokens: 3000, costCents: 200 },
  ],
  recent: [
    {
      id: "inv-1",
      scene: "business_analysis",
      provider: "hunyuan",
      status: "succeeded",
      totalTokens: 600,
      costCents: 30,
      latencyMs: 900,
      actorName: "Ops Manager",
      createdAt: "2026-06-18T10:00:00.000Z",
    },
  ],
};

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

describe("AiUsageDashboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the aggregated KPIs, breakdowns and recent table", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ usage }));
    render(<AiUsageDashboard fetcher={fetcher} />);

    await waitFor(() => expect(screen.getByText("成功率")).toBeInTheDocument());

    // total cost ¥3.45 from 345 cents
    expect(screen.getByText("¥3.45")).toBeInTheDocument();
    // success rate 8333 bps → 83.3%
    expect(screen.getByText("83.3%")).toBeInTheDocument();
    // scene label localized (appears in the breakdown and the recent table)
    expect(screen.getAllByText("经营分析").length).toBeGreaterThan(0);
    // provider label localized
    expect(screen.getAllByText("混元 Hunyuan").length).toBeGreaterThan(0);
    // recent table actor
    expect(screen.getByText("Ops Manager")).toBeInTheDocument();

    expect(fetcher).toHaveBeenCalledWith("/api/ai/usage?rangeDays=30");
  });

  it("refetches when the range is changed", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ usage }));
    render(<AiUsageDashboard fetcher={fetcher} />);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("近 7 天"));

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith("/api/ai/usage?rangeDays=7"),
    );
  });

  it("shows an error state when the request fails", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: "Only MCN staff can view AI usage" }, false),
    );
    render(<AiUsageDashboard fetcher={fetcher} />);

    await waitFor(() =>
      expect(
        screen.getByText("Only MCN staff can view AI usage"),
      ).toBeInTheDocument(),
    );
  });
});
