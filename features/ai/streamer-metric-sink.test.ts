import { describe, expect, it, vi } from "vitest";

import { writeStreamerMetricsFromOcr } from "./streamer-metric-sink";

function createClient(error: Error | null = null) {
  const rows = new Map<string, Record<string, unknown>>();
  const upsert = vi.fn(async (payload: Record<string, unknown>[]) => {
    for (const row of payload) {
      const key = [
        row.organization_id,
        row.streamer_id,
        row.metric_key,
        row.metric_window,
        row.source_report_id,
      ].join(":");
      rows.set(key, row);
    }
    return { error };
  });
  const client = {
    from: vi.fn((table: string) => {
      expect(table).toBe("streamer_metrics");
      return { upsert };
    }),
  };
  return { client, rows, upsert };
}

const attribution = {
  organizationId: "org-1",
  streamerId: "streamer-1",
  projectId: "project-1",
  sourceReportId: "report-1",
  reportDate: "2026-07-16",
  sourceInvocationId: "invocation-1",
};

describe("writeStreamerMetricsFromOcr", () => {
  it("upserts valid metrics with a report-scoped idempotency key", async () => {
    const { client, rows, upsert } = createClient();
    const candidates = [
      {
        key: "gmv" as const,
        label: "GMV",
        value: 12345,
        sourceText: "GMV 12,345",
        confidence: 90,
      },
      {
        key: "follows" as const,
        label: "涨粉",
        value: 67,
        sourceText: "涨粉 67",
        confidence: 90,
      },
    ];

    await writeStreamerMetricsFromOcr({
      client,
      attribution,
      metricCandidates: candidates,
    });
    await writeStreamerMetricsFromOcr({
      client,
      attribution,
      metricCandidates: candidates,
    });

    expect(rows).toHaveLength(2);
    expect([...rows.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organization_id: "org-1",
          streamer_id: "streamer-1",
          metric_key: "gmv",
          metric_value: 12345,
          metric_window: "2026-07-16",
          source_report_id: "report-1",
          source_invocation_id: "invocation-1",
        }),
        expect.objectContaining({
          metric_key: "follows",
          metric_value: 67,
        }),
      ]),
    );
    expect(upsert).toHaveBeenCalledWith(expect.any(Array), {
      onConflict:
        "organization_id,streamer_id,metric_key,metric_window,source_report_id",
    });
  });

  it("skips writes without complete server-side attribution", async () => {
    const { client, upsert } = createClient();

    const result = await writeStreamerMetricsFromOcr({
      client,
      attribution: { ...attribution, streamerId: null },
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
    expect(upsert).not.toHaveBeenCalled();
  });

  it("filters invalid candidates and maps finite decimals to integer storage", async () => {
    const { client, upsert } = createClient();

    await writeStreamerMetricsFromOcr({
      client,
      attribution,
      metricCandidates: [
        {
          key: "gmv",
          label: "GMV",
          value: 12.6,
          sourceText: "GMV 12.6",
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
      ] as never,
    });

    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          metric_key: "gmv",
          metric_value: 13,
        }),
      ],
      expect.any(Object),
    );
  });

  it("surfaces database errors for the OCR caller to isolate", async () => {
    const { client } = createClient(new Error("metric write failed"));

    await expect(
      writeStreamerMetricsFromOcr({
        client,
        attribution,
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
