import { describe, expect, it, vi } from "vitest";

import { writeStreamerMetricsFromOcr } from "./streamer-metric-sink";

function createClient(error: Error | null = null, written = 2) {
  const rpc = vi.fn(
    async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ data: number; error: Error | null }> => {
      void name;
      void args;
      return { data: written, error };
    },
  );
  return { client: { rpc }, rpc };
}

const source = {
  sourceReportId: "report-1",
  sourceInvocationId: "invocation-1",
};

describe("writeStreamerMetricsFromOcr", () => {
  it("delegates attribution and atomic idempotency to the constrained RPC", async () => {
    const { client, rpc } = createClient();

    const result = await writeStreamerMetricsFromOcr({
      client,
      ...source,
      humanConfirmed: false,
      metricCandidates: [
        {
          key: "gmv",
          label: "GMV",
          value: 12345,
          sourceText: "GMV 12,345",
          confidence: 90,
        },
        {
          key: "follows",
          label: "涨粉",
          value: 67,
          sourceText: "涨粉 67",
          confidence: 90,
        },
      ],
    });

    expect(result).toEqual({ written: 2 });
    expect(rpc).toHaveBeenCalledWith("upsert_ocr_streamer_metrics", {
      p_live_report_id: "report-1",
      p_metrics: [
        { key: "gmv", value: 12345 },
        { key: "follows", value: 67 },
      ],
      p_source_invocation_id: "invocation-1",
      p_human_confirmed: false,
    });
    const rpcArgs = rpc.mock.calls[0]?.[1];
    expect(rpcArgs).not.toHaveProperty("organization_id");
    expect(rpcArgs).not.toHaveProperty("streamer_id");
    expect(rpcArgs).not.toHaveProperty("metric_window");
    expect(rpcArgs).not.toHaveProperty("report_date");
  });

  it("skips writes without a source report", async () => {
    const { client, rpc } = createClient();

    const result = await writeStreamerMetricsFromOcr({
      client,
      sourceReportId: null,
      metricCandidates: [
        {
          key: "gmv",
          label: "GMV",
          value: 100,
          sourceText: "GMV 100",
          confidence: 90,
        },
      ],
    });

    expect(result).toEqual({ written: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rounds GMV to whole yuan and independently filters invalid int4 values", async () => {
    const { client, rpc } = createClient(null, 2);

    await writeStreamerMetricsFromOcr({
      client,
      ...source,
      metricCandidates: [
        {
          key: "gmv",
          label: "GMV",
          value: 12.6,
          sourceText: "GMV 12.6",
          confidence: 90,
        },
        {
          key: "likes",
          label: "点赞",
          value: 2147483647,
          sourceText: "点赞 2147483647",
          confidence: 90,
        },
        {
          key: "clicks",
          label: "点击",
          value: 2147483648,
          sourceText: "点击 2147483648",
          confidence: 90,
        },
        {
          key: "not-a-metric",
          label: "bad",
          value: 10,
          sourceText: "bad",
          confidence: 90,
        },
        {
          key: "follows",
          label: "涨粉",
          value: -1,
          sourceText: "涨粉 -1",
          confidence: 90,
        },
        {
          key: "views",
          label: "bad",
          value: Number.POSITIVE_INFINITY,
          sourceText: "bad",
          confidence: 90,
        },
      ] as never,
    });

    expect(rpc).toHaveBeenCalledWith(
      "upsert_ocr_streamer_metrics",
      expect.objectContaining({
        p_metrics: [
          { key: "gmv", value: 13 },
          { key: "likes", value: 2147483647 },
        ],
      }),
    );
  });

  it("deterministically keeps the highest-confidence duplicate key", async () => {
    const { client, rpc } = createClient(null, 1);

    await writeStreamerMetricsFromOcr({
      client,
      ...source,
      humanConfirmed: true,
      metricCandidates: [
        {
          key: "gmv",
          label: "GMV",
          value: 100,
          sourceText: "GMV 100",
          confidence: 80,
        },
        {
          key: "gmv",
          label: "GMV",
          value: 200,
          sourceText: "GMV 200",
          confidence: 95,
        },
      ],
    });

    expect(rpc).toHaveBeenCalledWith(
      "upsert_ocr_streamer_metrics",
      expect.objectContaining({
        p_metrics: [{ key: "gmv", value: 200 }],
        p_human_confirmed: true,
      }),
    );
  });

  it("surfaces RPC errors for the OCR caller to isolate", async () => {
    const { client } = createClient(new Error("metric write failed"));

    await expect(
      writeStreamerMetricsFromOcr({
        client,
        ...source,
        metricCandidates: [
          {
            key: "gmv",
            label: "GMV",
            value: 100,
            sourceText: "GMV 100",
            confidence: 90,
          },
        ],
      }),
    ).rejects.toThrow("metric write failed");
  });
});
