import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runOcrWorkerIteration } from "./ocr-worker";
import type { OcrJobRecord } from "./ocr-jobs";

vi.mock("@/features/ai/ocr-image-source", () => ({
  resolveOcrImageInput: vi.fn(async () => ({ imageBase64: "AQID" })),
}));

vi.mock("@/features/ai/providers/tencent-ocr-provider", () => ({
  createTencentOcrProvider: vi.fn(() => ({
    runGeneralBasicOcr: vi.fn(async () => ({
      status: "succeeded",
      textLines: ["直播时长 80分钟", "观看人数 320"],
      textItems: [],
      confidence: 96,
      requestId: "request-1",
      rawResponse: {},
    })),
  })),
  readTencentOcrConfigFromEnv: vi.fn(() => ({})),
}));

function createClient({ jobs = [] }: { jobs?: OcrJobRecord[] } = {}) {
  const claimed = [...jobs];
  const events: Record<string, unknown>[] = [];
  const updates: Record<string, Record<string, unknown>[]> = {};
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      if (name === "claim_async_ocr_jobs") {
        return { data: claimed.map(toRow), error: null };
      }
      if (name === "renew_async_task_lease") {
        return { data: true, error: null };
      }
      if (name === "finalize_async_task") {
        return { data: { id: 1, status: args.p_status }, error: null };
      }
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (payload: Record<string, unknown>) => {
        if (table === "async_task_events") {
          events.push(payload);
        }
        return { data: null, error: null };
      }),
      update: vi.fn((payload: Record<string, unknown>) => {
        const result = Object.assign(
          Promise.resolve({ data: null, error: null }),
          {
            eq: vi.fn(() => result),
          },
        );
        return {
          eq: vi.fn(() => {
            updates[table] = [...(updates[table] ?? []), payload];
            return result;
          }),
        };
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data:
              table === "live_reports"
                ? {
                    id: "report-1",
                    organization_id: "org-1",
                    status: "ocr_ing",
                  }
                : null,
            error: null,
          })),
        })),
      })),
      upsert: vi.fn(async () => ({ data: null, error: null })),
    })),
  };
  return { client, events, rpcs, updates };
}

const claimedJob = (id: string, organizationId = "org-1"): OcrJobRecord => ({
  id,
  organizationId,
  jobType: "ocr.extract_live_report",
  status: "running",
  attempt: 1,
  maxAttempts: 3,
  lockedBy: "worker-1",
  payload: {
    liveReportId: "report-1",
    imageBase64: "AQID",
    expectedDuration: 80,
  },
});

describe("runOcrWorkerIteration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T10:00:00.000Z"));
    vi.stubEnv("ASYNC_WORKERS_ENABLED", "true");
    vi.stubEnv("OCR_WORKER_ENABLED", "true");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not claim when the global or workload gate is disabled", async () => {
    vi.stubEnv("ASYNC_WORKERS_ENABLED", "false");
    vi.stubEnv("OCR_WORKER_ENABLED", "true");
    const { client } = createClient({ jobs: [claimedJob("job-1")] });

    await expect(
      runOcrWorkerIteration({
        client: client as never,
        workerId: "worker-1",
        limit: 2,
        leaseSeconds: 60,
      }),
    ).resolves.toMatchObject({ claimed: 0, succeeded: 0, failed: 0 });
    expect(client.rpc).not.toHaveBeenCalledWith(
      "claim_async_ocr_jobs",
      expect.anything(),
    );

    vi.stubEnv("ASYNC_WORKERS_ENABLED", "true");
    vi.stubEnv("OCR_WORKER_ENABLED", "false");

    await runOcrWorkerIteration({
      client: client as never,
      workerId: "worker-1",
      limit: 2,
      leaseSeconds: 60,
    });
    expect(client.rpc).not.toHaveBeenCalledWith(
      "claim_async_ocr_jobs",
      expect.anything(),
    );
  });

  it("does not claim while the tencent OCR breaker is open", async () => {
    const { client } = createClient({ jobs: [claimedJob("job-1")] });
    client.from = vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data:
              table === "provider_circuit_breakers"
                ? {
                    provider_key: "tencent_ocr",
                    state: "open",
                    consecutive_failures: 5,
                    opened_until: "2026-07-14T10:05:00.000Z",
                    probe_worker_id: null,
                    probe_lease_expires_at: null,
                    last_error_code: "provider_failed",
                    updated_at: "2026-07-14T10:00:00.000Z",
                  }
                : null,
            error: null,
          })),
        })),
      })),
      insert: vi.fn(async () => ({ data: null, error: null })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            or: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              })),
            })),
          })),
        })),
      })),
      upsert: vi.fn(async () => ({ data: null, error: null })),
    })) as never;

    const result = await runOcrWorkerIteration({
      client: client as never,
      workerId: "worker-1",
      limit: 2,
      leaseSeconds: 60,
    });

    expect(result).toMatchObject({ claimed: 0, succeeded: 0, failed: 0 });
    expect(client.rpc).not.toHaveBeenCalledWith(
      "claim_async_ocr_jobs",
      expect.anything(),
    );
  });

  it("claims, emits stages, renews leases, finalizes, and continues after a failure", async () => {
    const finalFailJob = { ...claimedJob("job-fail"), maxAttempts: 1 };
    const { client, events, rpcs } = createClient({
      jobs: [claimedJob("job-ok"), finalFailJob],
    });
    const provider = {
      runGeneralBasicOcr: vi
        .fn()
        .mockResolvedValueOnce({
          status: "succeeded" as const,
          textLines: ["直播时长 80分钟", "观看人数 320"],
          textItems: [],
          confidence: 96,
          requestId: "request-ok",
          rawResponse: {},
        })
        .mockRejectedValueOnce(new Error("provider failed")),
    };

    const result = await runOcrWorkerIteration({
      client: client as never,
      workerId: "worker-1",
      limit: 2,
      leaseSeconds: 60,
      provider,
      imageResolver: vi.fn(async () => ({ imageBase64: "AQID" })),
    });

    expect(result).toMatchObject({ claimed: 2, succeeded: 1, failed: 0 });
    expect(result.jobs).toEqual([
      { id: "job-ok", status: "succeeded", attempt: 1 },
      { id: "job-fail", status: "failed", attempt: 1 },
    ]);
    expect(result.failures).toEqual([]);
    expect(events.map((event) => event.stage)).toEqual([
      "resolving_image",
      "recognizing",
      "persisting",
      "resolving_image",
      "recognizing",
      "persisting",
    ]);
    expect(rpcs).toContainEqual(
      expect.objectContaining({
        name: "claim_async_ocr_jobs",
        args: expect.objectContaining({
          p_worker_id: "worker-1",
          p_limit: 2,
          p_lease_seconds: 60,
        }),
      }),
    );
    expect(rpcs).toContainEqual(
      expect.objectContaining({
        name: "finalize_async_task",
        args: expect.objectContaining({
          p_task_type: "ocr",
          p_task_id: "job-ok",
          p_worker_id: "worker-1",
          p_status: "succeeded",
        }),
      }),
    );
    expect(rpcs).toContainEqual(
      expect.objectContaining({
        name: "finalize_async_task",
        args: expect.objectContaining({
          p_task_id: "job-fail",
          p_status: "failed",
        }),
      }),
    );
  });

  it("renews the lease every 30 seconds while provider work is pending", async () => {
    const { client } = createClient({ jobs: [claimedJob("job-slow")] });
    const provider = {
      runGeneralBasicOcr: vi.fn(
        () =>
          new Promise<{
            status: "succeeded";
            textLines: string[];
            textItems: never[];
            confidence: number;
            requestId: string;
          }>((resolve) => {
            setTimeout(
              () =>
                resolve({
                  status: "succeeded" as const,
                  textLines: [],
                  textItems: [],
                  confidence: 100,
                  requestId: "request-slow",
                }),
              75_000,
            );
          }),
      ),
    };

    const running = runOcrWorkerIteration({
      client: client as never,
      workerId: "worker-1",
      limit: 1,
      leaseSeconds: 60,
      provider,
      imageResolver: vi.fn(async () => ({ imageBase64: "AQID" })),
    });

    await vi.advanceTimersByTimeAsync(75_000);
    await running;

    expect(client.rpc).toHaveBeenCalledWith(
      "renew_async_task_lease",
      expect.objectContaining({
        p_task_type: "ocr",
        p_task_id: "job-slow",
        p_worker_id: "worker-1",
        p_lease_seconds: 60,
      }),
    );
    expect(
      vi
        .mocked(client.rpc)
        .mock.calls.filter(([name]) => name === "renew_async_task_lease"),
    ).toHaveLength(2);
  });

  it("does not append a separate terminal event when finalization fails", async () => {
    const { client, events, updates } = createClient({ jobs: [claimedJob("job-1")] });
    vi.mocked(client.rpc).mockImplementation(async (name) => {
      if (name === "claim_async_ocr_jobs") {
        return { data: [toRow(claimedJob("job-1"))], error: null };
      }
      if (name === "finalize_async_task") {
        return { data: null, error: new Error("finalize failed") };
      }
      return { data: true, error: null };
    });

    const result = await runOcrWorkerIteration({
      client: client as never,
      workerId: "worker-1",
      limit: 1,
      leaseSeconds: 60,
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "succeeded" as const,
          textLines: [],
          textItems: [],
          confidence: 100,
        })),
      },
      imageResolver: vi.fn(async () => ({ imageBase64: "AQID" })),
    });

    expect(result).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
    expect(result.failures).toEqual([
      {
        jobId: "job-1",
        errorCode: "finalize_failed",
        errorMessage: "finalize failed",
      },
    ]);
    expect(events.map((event) => event.status)).toEqual([
      "running",
      "running",
      "running",
    ]);
    expect(updates.ocr_results).toBeUndefined();
    expect(updates.live_reports).toBeUndefined();
    expect(updates.usage_metering_events).toBeUndefined();
  });

  it("does not write terminal OCR failure side effects before finalization succeeds", async () => {
    const finalFailJob = { ...claimedJob("job-final-fail"), maxAttempts: 1 };
    const { client, updates } = createClient({ jobs: [finalFailJob] });
    vi.mocked(client.rpc).mockImplementation(async (name) => {
      if (name === "claim_async_ocr_jobs") {
        return { data: [toRow(finalFailJob)], error: null };
      }
      if (name === "finalize_async_task") {
        return { data: null, error: new Error("finalize failed") };
      }
      return { data: true, error: null };
    });

    const result = await runOcrWorkerIteration({
      client: client as never,
      workerId: "worker-1",
      limit: 1,
      leaseSeconds: 60,
      provider: {
        runGeneralBasicOcr: vi.fn(async () => {
          throw new Error("provider failed");
        }),
      },
      imageResolver: vi.fn(async () => ({ imageBase64: "AQID" })),
    });

    expect(result).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
    expect(result.failures).toEqual([
      {
        jobId: "job-final-fail",
        errorCode: "finalize_failed",
        errorMessage: "finalize failed",
      },
    ]);
    expect(updates.ocr_results).toBeUndefined();
  });

  it("returns retryable backoff jobs without marking them as route failures", async () => {
    const { client } = createClient({ jobs: [claimedJob("job-retry")] });
    const provider = {
      runGeneralBasicOcr: vi.fn(async () => {
        throw new Error("provider temporarily unavailable");
      }),
    };

    const result = await runOcrWorkerIteration({
      client: client as never,
      workerId: "worker-1",
      limit: 1,
      leaseSeconds: 60,
      provider,
      imageResolver: vi.fn(async () => ({ imageBase64: "AQID" })),
    });

    expect(result).toMatchObject({ claimed: 1, succeeded: 0, failed: 0 });
    expect(result.jobs).toEqual([
      { id: "job-retry", status: "queued", attempt: 1 },
    ]);
    expect(result.failures).toEqual([]);
  });
});

function toRow(job: OcrJobRecord) {
  return {
    id: job.id,
    organization_id: job.organizationId,
    job_type: job.jobType,
    status: job.status,
    attempt: job.attempt,
    max_attempts: job.maxAttempts,
    locked_by: job.lockedBy,
    payload: job.payload,
  };
}
