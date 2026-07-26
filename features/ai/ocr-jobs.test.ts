import { describe, expect, it, vi } from "vitest";

import {
  claimRunnableOcrJobs,
  confirmOcrJob,
  createOcrJob,
  listRunnableOcrJobs,
  retryOcrJob,
  runOcrJobOnce,
  type OcrJobRecord,
} from "./ocr-jobs";

function createClient(
  fixtures: {
    jobs?: OcrJobRecord[];
    liveReports?: Array<{
      id: string;
      organization_id: string;
      project_id: string;
      streamer_id?: string;
      created_at?: string;
      status?: string;
      system_duration?: number | null;
      claimed_duration?: number | null;
      risk_flags?: string[] | null;
    }>;
    ocrResults?: Array<{
      live_report_id: string;
      background_job_id: string | null;
    }>;
    rpcErrors?: Record<string, Error>;
    insertErrors?: Record<string, Error>;
  } = {},
) {
  const ocrResults = [...(fixtures.ocrResults ?? [])];
  const inserts: Record<string, Record<string, unknown>[]> = {};
  const updates: Record<string, Record<string, unknown>[]> = {};
  const jobs = [...(fixtures.jobs ?? [])];
  const liveReports = [
    ...(fixtures.liveReports ?? []).map((report) => ({
      streamer_id: "streamer-1",
      created_at: "2026-07-16T08:00:00.000Z",
      status: "ocr_ing",
      ...report,
    })),
    ...(fixtures.liveReports
      ? []
      : jobs.map((job) => ({
          id: job.payload.liveReportId,
          organization_id: job.organizationId,
          project_id: "project-1",
          streamer_id: "streamer-1",
          created_at: "2026-07-16T08:00:00.000Z",
          status: "ocr_ing",
        }))),
  ];
  type TestUpdateResult = { error: null; count: number };
  type TestUpdateFilter = PromiseLike<TestUpdateResult> & {
    eq(column: string, value: string): TestUpdateFilter;
  };
  const createUpdateFilter = (
    table: string,
    payload: Record<string, unknown>,
  ): TestUpdateFilter => {
    const filters: Array<{ column: string; value: string }> = [];
    let executed = false;
    const execute = async (): Promise<TestUpdateResult> => {
      if (!executed) {
        executed = true;
        const first = filters[0] ?? { column: "", value: "" };
        updates[table] = [
          ...(updates[table] ?? []),
          {
            payload,
            column: first.column,
            value: first.value,
            filters: [...filters],
          },
        ];
        if (table === "background_jobs" && first.column === "id") {
          const index = jobs.findIndex((job) => job.id === first.value);
          if (index >= 0) {
            jobs[index] = { ...jobs[index], ...toJobPatch(payload) };
          }
        }
      }
      return { error: null, count: 1 };
    };
    const builder = {
      eq: vi.fn((column: string, value: string): TestUpdateFilter => {
        filters.push({ column, value });
        return builder;
      }),
      then<TResult1 = TestUpdateResult, TResult2 = never>(
        onfulfilled?:
          | ((value: TestUpdateResult) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ): PromiseLike<TResult1 | TResult2> {
        return execute().then(onfulfilled, onrejected);
      },
    } as TestUpdateFilter;
    return builder;
  };
  const client = {
    rpc: vi.fn(
      async (
        name: string,
        args: Record<string, unknown>,
      ): Promise<{
        data: Record<string, unknown> | Record<string, unknown>[] | number;
        error: Error | null;
      }> => {
        const metrics = Array.isArray(args.p_metrics) ? args.p_metrics : [];
        return {
          data:
            name === "upsert_ocr_streamer_metrics"
              ? 2
              : name === "confirm_ocr_job_metrics"
                ? { confirmed: true, metricsWritten: metrics.length }
                : [],
          error: fixtures.rpcErrors?.[name] ?? null,
        };
      },
    ),
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (payload: Record<string, unknown>) => {
        inserts[table] = [...(inserts[table] ?? []), payload];
        if (table === "background_jobs") {
          jobs.push(toJobRecord(payload));
        }
        return { error: fixtures.insertErrors?.[table] ?? null };
      }),
      update: vi.fn((payload: Record<string, unknown>) =>
        createUpdateFilter(table, payload),
      ),
      select: vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => ({
          maybeSingle: vi.fn(async () => {
            if (table === "live_reports" && column === "id") {
              return {
                data: liveReports.find((report) => report.id === value) ?? null,
                error: null,
              };
            }
            if (table === "ocr_results" && column === "live_report_id") {
              return {
                data:
                  ocrResults.find((row) => row.live_report_id === value) ??
                  null,
                error: null,
              };
            }
            if (table !== "background_jobs" || column !== "id") {
              return { data: null, error: null };
            }
            return {
              data: jobs.find((job) => job.id === value) ?? null,
              error: null,
            };
          }),
          order: vi.fn(async () => {
            if (table !== "background_jobs" || column !== "organization_id") {
              return { data: [], error: null };
            }
            return {
              data: jobs.filter((job) => job.organizationId === value),
              error: null,
            };
          }),
        })),
      })),
    })),
  };

  return { client, inserts, updates, jobs };
}

const actor = {
  userId: "user-ops",
  name: "Ops Manager",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

describe("OCR jobs", () => {
  it("blocks OCR job creation when the live report is not visible to the actor", async () => {
    const { client, inserts } = createClient();

    await expect(
      createOcrJob({
        client,
        actor,
        input: {
          id: "job-denied",
          invocationId: "invocation-denied",
          liveReportId: "report-missing",
          imageBase64: "ZmFrZQ==",
        },
      }),
    ).rejects.toThrow("Live report not found or inaccessible");

    expect(inserts.background_jobs).toBeUndefined();
    expect(inserts.ocr_results).toBeUndefined();
  });

  it("creates a queued OCR job and pending OCR result", async () => {
    const { client, inserts } = createClient({
      liveReports: [
        {
          id: "report-1",
          organization_id: "org-1",
          project_id: "project-1",
        },
      ],
    });

    const job = await createOcrJob({
      client,
      actor,
      input: {
        id: "job-1",
        invocationId: "invocation-1",
        liveReportId: "report-1",
        screenshotId: "screenshot-1",
        imageBase64: "ZmFrZQ==",
        expectedDuration: 80,
      },
    });

    expect(job).toMatchObject({
      id: "job-1",
      status: "queued",
      aiInvocationId: "invocation-1",
    });
    expect(inserts.background_jobs).toEqual([
      expect.objectContaining({
        id: "job-1",
        organization_id: "org-1",
        job_type: "ocr.extract_live_report",
        payload: expect.objectContaining({
          screenshotId: "screenshot-1",
        }),
        status: "queued",
        ai_invocation_id: "invocation-1",
      }),
    ]);
    expect(inserts.ai_invocations).toEqual([
      expect.objectContaining({
        id: "invocation-1",
        metadata: {
          jobId: "job-1",
          screenshotId: "screenshot-1",
        },
      }),
    ]);
    expect(inserts.ocr_results).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        live_report_id: "report-1",
        screenshot_id: "screenshot-1",
        status: "pending",
        ai_invocation_id: "invocation-1",
        background_job_id: "job-1",
      }),
    ]);
    expect(inserts.ocr_results?.[0]).not.toHaveProperty("streamer_id");
    expect(inserts.ocr_results?.[0]).not.toHaveProperty("project_id");
    expect(inserts.ocr_results?.[0]).not.toHaveProperty("report_date");
  });

  it("creates an OCR job with only storage image path input", async () => {
    const { client, inserts } = createClient({
      liveReports: [
        {
          id: "report-path",
          organization_id: "org-1",
          project_id: "project-1",
        },
      ],
    });

    const job = await createOcrJob({
      client,
      actor,
      input: {
        id: "job-path",
        invocationId: "invocation-path",
        liveReportId: "report-path",
        screenshotId: "screenshot-path",
        imageBucket: "evidence-private",
        imagePath: "org/report-screenshots/task-1/end.png",
      },
    });

    expect(job.payload).toMatchObject({
      liveReportId: "report-path",
      screenshotId: "screenshot-path",
      imageBucket: "evidence-private",
      imagePath: "org/report-screenshots/task-1/end.png",
    });
    expect(inserts.background_jobs).toEqual([
      expect.objectContaining({
        id: "job-path",
        payload: expect.objectContaining({
          imageBucket: "evidence-private",
          imagePath: "org/report-screenshots/task-1/end.png",
        }),
      }),
    ]);
  });

  it("runs OCR successfully, stores parsed fields, and records OCR usage", async () => {
    const { client, inserts, updates } = createClient({
      jobs: [
        {
          id: "job-1",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          aiInvocationId: "invocation-1",
          payload: {
            liveReportId: "report-1",
            screenshotId: "screenshot-1",
            imageBase64: "ZmFrZQ==",
            expectedDuration: 80,
          },
        },
      ],
    });

    const result = await runOcrJobOnce({
      client,
      metricClient: null,
      actor,
      jobId: "job-1",
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "succeeded" as const,
          textLines: ["直播时长 80分钟", "观看人数 320"],
          textItems: [],
          confidence: 96,
          requestId: "request-1",
          rawResponse: { Response: { RequestId: "request-1" } },
        })),
      },
    });

    expect(result.status).toBe("succeeded");
    expect(updates.ocr_results).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "succeeded",
          extracted_duration: 80,
          extracted_viewers: 320,
          confidence: 96,
          needs_confirmation: false,
        }),
      }),
    ]);
    expect(inserts.usage_events).toEqual([
      expect.objectContaining({
        metric: "ocr",
        quantity: 1,
        source: "ocr_job",
        object_type: "background_job",
        object_id: "job-1",
      }),
    ]);
  });

  it("stores operational metric candidates in raw OCR result without writing them to live reports", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-metrics",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          aiInvocationId: "invocation-metrics",
          payload: {
            liveReportId: "report-metrics",
            imageBase64: "ZmFrZQ==",
            expectedDuration: 181,
          },
        },
      ],
    });

    await runOcrJobOnce({
      client,
      metricClient: client as never,
      actor,
      jobId: "job-metrics",
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "succeeded" as const,
          textLines: [
            "直播日期 2026-07-16",
            "开播时间 09:29",
            "下播时间 12:30",
            "场观 2,488",
            "PCU 320",
            "ACU 86",
          ],
          textItems: [],
          confidence: 96,
          requestId: "request-metrics",
          rawResponse: { Response: { RequestId: "request-metrics" } },
        })),
      },
    });

    expect(updates.ocr_results).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          raw_result: expect.objectContaining({
            extractedDate: "2026-07-16",
            extractedStartedAt: "09:29",
            extractedEndedAt: "12:30",
            metricCandidates: expect.arrayContaining([
              expect.objectContaining({ key: "pcu", value: 320 }),
              expect.objectContaining({ key: "acu", value: 86 }),
            ]),
          }),
        }),
      }),
    ]);
    expect(updates.live_reports.at(-1)?.payload).not.toHaveProperty("pcu");
    expect(updates.live_reports.at(-1)?.payload).not.toHaveProperty("acu");
  });

  it("writes GMV and follower growth into streamer metrics using live report attribution", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-streamer-metrics",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          aiInvocationId: "invocation-streamer-metrics",
          payload: {
            liveReportId: "report-streamer-metrics",
            imageBase64: "ZmFrZQ==",
          },
        },
      ],
      liveReports: [
        {
          id: "report-streamer-metrics",
          organization_id: "org-1",
          project_id: "project-metrics",
          streamer_id: "streamer-metrics",
          created_at: "2026-07-15T23:30:00.000Z",
          status: "ocr_ing",
        },
      ],
    });

    await runOcrJobOnce({
      client,
      metricClient: client as never,
      actor,
      jobId: "job-streamer-metrics",
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "succeeded" as const,
          textLines: ["直播时长 80分钟", "GMV 12,345", "涨粉 67"],
          textItems: [],
          confidence: 96,
          requestId: "request-streamer-metrics",
          rawResponse: {},
        })),
      },
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "upsert_ocr_streamer_metrics",
      expect.objectContaining({
        p_live_report_id: "report-streamer-metrics",
        p_metrics: [
          { key: "gmv", value: 12345 },
          { key: "follows", value: 67 },
        ],
        p_source_invocation_id: "invocation-streamer-metrics",
      }),
    );
    expect(updates.ocr_results).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "succeeded",
        }),
      }),
    ]);
    expect(updates.ocr_results?.[0]?.payload).not.toHaveProperty("streamer_id");
    expect(updates.ocr_results?.[0]?.payload).not.toHaveProperty("project_id");
    expect(updates.ocr_results?.[0]?.payload).not.toHaveProperty("report_date");
  });

  it("continues advancing the report when the metric sink fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-metric-failure",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          aiInvocationId: "invocation-metric-failure",
          payload: {
            liveReportId: "report-metric-failure",
            imageBase64: "ZmFrZQ==",
          },
        },
      ],
      liveReports: [
        {
          id: "report-metric-failure",
          organization_id: "org-1",
          project_id: "project-1",
          streamer_id: "streamer-1",
          created_at: "2026-07-16T08:00:00.000Z",
          status: "ocr_ing",
        },
      ],
      rpcErrors: {
        upsert_ocr_streamer_metrics: new Error("metric write failed"),
      },
    });

    const result = await runOcrJobOnce({
      client,
      metricClient: client as never,
      actor,
      jobId: "job-metric-failure",
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "succeeded" as const,
          textLines: ["直播时长 80分钟", "GMV 100"],
          textItems: [],
          confidence: 96,
          requestId: "request-metric-failure",
          rawResponse: {},
        })),
      },
    });

    expect(result.status).toBe("succeeded");
    expect(updates.live_reports).toEqual([
      expect.objectContaining({
        value: "report-metric-failure",
        payload: expect.objectContaining({ status: "pending_review" }),
      }),
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      "[ocr] streamer metric sink failed for report report-metric-failure",
      expect.objectContaining({ message: "metric write failed" }),
    );
    consoleError.mockRestore();
  });

  it("uses an injected image resolver before calling the OCR provider", async () => {
    const { client } = createClient({
      jobs: [
        {
          id: "job-storage",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          aiInvocationId: "invocation-storage",
          payload: {
            liveReportId: "report-storage",
            screenshotId: "screenshot-storage",
            imageBucket: "evidence-private",
            imagePath: "org/report-screenshots/task-1/end.png",
          },
        },
      ],
    });
    const runGeneralBasicOcr = vi.fn(async () => ({
      status: "succeeded" as const,
      textLines: [],
      textItems: [],
      confidence: 96,
      requestId: "request-storage",
      rawResponse: {},
    }));
    const imageResolver = vi.fn(async () => ({ imageBase64: "AQID" }));

    await runOcrJobOnce({
      client,
      metricClient: null,
      actor,
      jobId: "job-storage",
      provider: { runGeneralBasicOcr },
      imageResolver,
    });

    expect(imageResolver).toHaveBeenCalledWith({
      liveReportId: "report-storage",
      screenshotId: "screenshot-storage",
      imageBucket: "evidence-private",
      imagePath: "org/report-screenshots/task-1/end.png",
    });
    expect(runGeneralBasicOcr).toHaveBeenCalledWith({ imageBase64: "AQID" });
  });

  it("requeues and unlocks OCR jobs when image resolution fails before provider call", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-image-error",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          maxAttempts: 3,
          runAfter: "2026-06-05T01:00:00.000Z",
          payload: {
            liveReportId: "report-image-error",
            imagePath: "org/report-screenshots/task-1/missing.png",
          },
        },
      ],
    });
    const runGeneralBasicOcr = vi.fn(async () => ({
      status: "succeeded" as const,
      textLines: [],
      textItems: [],
      confidence: 100,
    }));
    const imageResolver = vi.fn(async () => {
      throw new Error("download failed with secret=abc\nstack trace");
    });

    const result = await runOcrJobOnce({
      client,
      metricClient: null,
      actor,
      jobId: "job-image-error",
      runnerId: "runner-1",
      now: () => new Date("2026-06-05T02:00:00.000Z"),
      provider: { runGeneralBasicOcr },
      imageResolver,
    });

    expect(result).toMatchObject({
      status: "queued",
      attempt: 1,
      errorCode: "image_source_failed",
    });
    expect(runGeneralBasicOcr).not.toHaveBeenCalled();
    expect(updates.ocr_results).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "pending",
          error_code: "image_source_failed",
          error_message: expect.stringContaining("download failed"),
          needs_confirmation: false,
        }),
      }),
    ]);
    expect(updates.background_jobs.at(-1)).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "queued",
          attempt: 1,
          error_code: "image_source_failed",
          error_message: expect.stringContaining("download failed"),
          locked_at: null,
          locked_by: null,
        }),
      }),
    );
    const lastBackgroundUpdate = updates.background_jobs.at(-1) as
      | { payload: { error_message?: unknown } }
      | undefined;
    expect(String(lastBackgroundUpdate?.payload.error_message)).not.toContain(
      "secret=abc",
    );
  });

  it("releases the lock and requeues when the provider throws unexpectedly", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-runner-error",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          maxAttempts: 3,
          runAfter: "2026-06-05T01:00:00.000Z",
          payload: {
            liveReportId: "report-runner-error",
            imageBase64: "AQID",
          },
        },
      ],
    });
    const runGeneralBasicOcr = vi.fn(async () => {
      throw new Error("tencent network blew up");
    });

    const result = await runOcrJobOnce({
      client,
      metricClient: null,
      actor,
      jobId: "job-runner-error",
      runnerId: "runner-1",
      now: () => new Date("2026-06-05T02:00:00.000Z"),
      provider: { runGeneralBasicOcr },
      imageResolver: vi.fn(async () => ({ imageBase64: "AQID" })),
    });

    // Unexpected throw after the lock was taken: the job is requeued and the
    // lock cleared rather than left stuck in `running`.
    expect(result).toMatchObject({ status: "queued", attempt: 1 });
    expect(updates.background_jobs.at(-1)).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "queued",
          attempt: 1,
          error_code: "runner_error",
          locked_at: null,
          locked_by: null,
        }),
      }),
    );
  });

  it("is idempotent: returns the existing job instead of enqueueing a duplicate", async () => {
    const existingJob: OcrJobRecord = {
      id: "job-existing",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "queued",
      attempt: 0,
      maxAttempts: 3,
      payload: { liveReportId: "report-dup", imagePath: "org/x.png" },
    };
    const { client, inserts } = createClient({
      jobs: [existingJob],
      liveReports: [
        { id: "report-dup", organization_id: "org-1", project_id: "project-1" },
      ],
      ocrResults: [
        { live_report_id: "report-dup", background_job_id: "job-existing" },
      ],
    });

    const job = await createOcrJob({
      client,
      actor,
      input: { liveReportId: "report-dup", imagePath: "org/x.png" },
    });

    expect(job.id).toBe("job-existing");
    // No duplicate background job or ocr_results row inserted.
    expect(inserts.background_jobs).toBeUndefined();
    expect(inserts.ocr_results).toBeUndefined();
  });

  it("marks low-confidence OCR as needs confirmation instead of trusted", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-2",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          aiInvocationId: "invocation-2",
          payload: {
            liveReportId: "report-2",
            screenshotId: "screenshot-2",
            imageBase64: "ZmFrZQ==",
            expectedDuration: 120,
          },
        },
      ],
    });

    const result = await runOcrJobOnce({
      client,
      metricClient: null,
      actor,
      jobId: "job-2",
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "succeeded" as const,
          textLines: ["时长 20分钟"],
          textItems: [],
          confidence: 55,
          requestId: "request-2",
          rawResponse: {},
        })),
      },
    });

    expect(result.status).toBe("needs_confirmation");
    expect(updates.ocr_results).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "needs_confirmation",
          needs_confirmation: true,
          error_message: expect.stringContaining("duration_conflict"),
        }),
      }),
    ]);
    const ocrUpdate = updates.ocr_results[0] as {
      payload: { error_message?: unknown };
    };
    expect(String(ocrUpdate.payload.error_message)).toContain(
      "low_provider_confidence",
    );
    expect(client.rpc).not.toHaveBeenCalledWith(
      "upsert_ocr_streamer_metrics",
      expect.anything(),
    );
  });

  it("requeues a failed job for manual retry without incrementing attempts", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-3",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "failed",
          attempt: 1,
          aiInvocationId: "invocation-3",
          payload: { liveReportId: "report-3", imageBase64: "ZmFrZQ==" },
        },
      ],
    });

    const job = await retryOcrJob({ client, actor, jobId: "job-3" });

    expect(job).toMatchObject({ status: "queued", attempt: 1 });
    expect(updates.background_jobs).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "queued",
          locked_at: null,
          locked_by: null,
        }),
      }),
    ]);
  });

  it("claims runnable OCR jobs through the database lock primitive", async () => {
    const { client } = createClient();
    vi.mocked(client.rpc).mockResolvedValueOnce({
      data: [
        {
          id: "job-claim",
          organization_id: "org-1",
          job_type: "ocr.extract_live_report",
          status: "running",
          attempt: 1,
          max_attempts: 3,
          locked_at: "2026-06-05T02:00:00.000Z",
          locked_by: "runner-1",
          payload: { liveReportId: "report-claim", imageBase64: "ZmFrZQ==" },
        },
      ],
      error: null,
    });

    const jobs = await claimRunnableOcrJobs({
      client,
      organizationId: "org-1",
      runnerId: "runner-1",
      now: new Date("2026-06-05T02:00:00.000Z"),
      lockTimeoutMs: 10 * 60 * 1000,
      limit: 1,
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "claim_ocr_jobs",
      expect.objectContaining({
        p_organization_id: "org-1",
        p_runner_id: "runner-1",
        p_limit: 1,
        p_lock_timeout_seconds: 600,
        p_now: "2026-06-05T02:00:00.000Z",
      }),
    );
    expect(jobs).toEqual([
      expect.objectContaining({
        id: "job-claim",
        lockedBy: "runner-1",
      }),
    ]);
  });

  it("lets manual retry override a final failed job without clearing attempts", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-max",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "failed",
          attempt: 3,
          maxAttempts: 3,
          aiInvocationId: "invocation-max",
          errorCode: "provider_failed",
          errorMessage: "Tencent OCR HTTP 500",
          payload: { liveReportId: "report-max", imageBase64: "ZmFrZQ==" },
        },
      ],
    });

    const job = await retryOcrJob({ client, actor, jobId: "job-max" });

    expect(job).toMatchObject({
      status: "queued",
      attempt: 3,
      maxAttempts: 4,
      errorCode: "provider_failed",
    });
    expect(updates.background_jobs).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "queued",
          max_attempts: 4,
          locked_at: null,
          locked_by: null,
        }),
      }),
    ]);
  });

  it("lists only runnable due OCR jobs and skips active locks until timeout", async () => {
    const { client } = createClient({
      jobs: [
        {
          id: "job-due",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          maxAttempts: 3,
          runAfter: "2026-06-05T01:00:00.000Z",
          payload: { liveReportId: "report-due", imageBase64: "ZmFrZQ==" },
        },
        {
          id: "job-future",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          maxAttempts: 3,
          runAfter: "2026-06-05T03:00:00.000Z",
          payload: { liveReportId: "report-future", imageBase64: "ZmFrZQ==" },
        },
        {
          id: "job-locked",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "running",
          attempt: 1,
          maxAttempts: 3,
          lockedAt: "2026-06-05T01:59:30.000Z",
          payload: { liveReportId: "report-locked", imageBase64: "ZmFrZQ==" },
        },
        {
          id: "job-expired-lock",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "running",
          attempt: 1,
          maxAttempts: 3,
          lockedAt: "2026-06-05T01:45:00.000Z",
          payload: { liveReportId: "report-expired", imageBase64: "ZmFrZQ==" },
        },
      ],
    });

    const jobs = await listRunnableOcrJobs({
      client,
      organizationId: "org-1",
      now: new Date("2026-06-05T02:00:00.000Z"),
      lockTimeoutMs: 10 * 60 * 1000,
    });

    expect(jobs.map((job) => job.id)).toEqual(["job-due", "job-expired-lock"]);
  });

  it("does not process a fresh locked OCR job owned by another runner", async () => {
    const { client } = createClient({
      jobs: [
        {
          id: "job-locked",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "processing",
          attempt: 1,
          maxAttempts: 3,
          lockedAt: "2026-06-05T01:59:30.000Z",
          lockedBy: "runner-other",
          payload: { liveReportId: "report-locked", imageBase64: "ZmFrZQ==" },
        },
      ],
    });

    await expect(
      runOcrJobOnce({
        client,
        metricClient: null,
        actor,
        jobId: "job-locked",
        runnerId: "runner-1",
        now: () => new Date("2026-06-05T02:00:00.000Z"),
        lockTimeoutMs: 10 * 60 * 1000,
        provider: {
          runGeneralBasicOcr: vi.fn(async () => ({
            status: "succeeded" as const,
            textLines: [],
            textItems: [],
            confidence: 100,
          })),
        },
      }),
    ).rejects.toThrow("OCR job is locked by another runner");
  });

  it("queues provider failures for retry before max attempts", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-retry",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          maxAttempts: 3,
          runAfter: "2026-06-05T01:00:00.000Z",
          payload: { liveReportId: "report-retry", imageBase64: "ZmFrZQ==" },
        },
      ],
    });

    const result = await runOcrJobOnce({
      client,
      metricClient: null,
      actor,
      jobId: "job-retry",
      runnerId: "runner-1",
      now: () => new Date("2026-06-05T02:00:00.000Z"),
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "failed" as const,
          textLines: [],
          textItems: [],
          confidence: 0,
          errorSummary: "upstream stack trace with secret=abc",
        })),
      },
    });

    expect(result).toMatchObject({
      status: "queued",
      attempt: 1,
      errorCode: "provider_failed",
    });
    expect(updates.background_jobs.at(-1)).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "queued",
          attempt: 1,
          error_code: "provider_failed",
          error_message: expect.stringContaining("upstream"),
          locked_at: null,
          locked_by: null,
        }),
      }),
    );
    const lastBackgroundUpdate = updates.background_jobs.at(-1) as
      | { payload: { error_message?: unknown } }
      | undefined;
    expect(String(lastBackgroundUpdate?.payload.error_message)).not.toContain(
      "secret=abc",
    );
  });

  it("stops automatic retry after max attempts", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-final",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 2,
          maxAttempts: 3,
          runAfter: "2026-06-05T01:00:00.000Z",
          payload: { liveReportId: "report-final", imageBase64: "ZmFrZQ==" },
        },
      ],
    });

    const result = await runOcrJobOnce({
      client,
      metricClient: null,
      actor,
      jobId: "job-final",
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "failed" as const,
          textLines: [],
          textItems: [],
          confidence: 0,
          errorSummary: "Tencent OCR HTTP 500",
        })),
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      attempt: 3,
      errorCode: "provider_failed",
    });
    expect(updates.background_jobs.at(-1)).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "failed",
          attempt: 3,
          error_code: "provider_failed",
        }),
      }),
    );
  });

  it("confirms a needs-review OCR job with manual corrected result", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-confirm",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "needs_confirmation",
          attempt: 1,
          maxAttempts: 3,
          aiInvocationId: "invocation-confirm",
          payload: { liveReportId: "report-confirm", imageBase64: "ZmFrZQ==" },
          result: {
            extractedDuration: 78,
            extractedViewers: 300,
            metricCandidates: [
              {
                key: "gmv",
                label: "GMV",
                value: 100,
                sourceText: "GMV 100",
                confidence: 90,
              },
            ],
          },
        },
      ],
      liveReports: [
        {
          id: "report-confirm",
          organization_id: "org-1",
          project_id: "project-1",
          status: "pending_review",
        },
      ],
    });

    const job = await confirmOcrJob({
      client,
      confirmationClient: client as never,
      actor,
      jobId: "job-confirm",
      manualResult: { duration: 80, viewers: 320 },
      now: () => new Date("2026-06-05T02:30:00.000Z"),
    });

    expect(job).toMatchObject({
      status: "succeeded",
      reviewedBy: "user-ops",
      reviewedAt: "2026-06-05T02:30:00.000Z",
    });
    expect(client.rpc).toHaveBeenCalledWith("confirm_ocr_job_metrics", {
      p_job_id: "job-confirm",
      p_reviewed_by: "user-ops",
      p_reviewed_at: "2026-06-05T02:30:00.000Z",
      p_manual_result: { duration: 80, viewers: 320 },
      p_metrics: [],
      p_confirmed_duration: 80,
      p_confirmed_viewers: 320,
    });
    expect(updates.ocr_results).toBeUndefined();
  });

  it("uses manually confirmed metric candidates instead of the original OCR candidates", async () => {
    const { client } = createClient({
      jobs: [
        {
          id: "job-confirm-metrics",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "needs_confirmation",
          attempt: 1,
          maxAttempts: 3,
          aiInvocationId: "invocation-confirm-metrics",
          payload: {
            liveReportId: "report-confirm-metrics",
            imageBase64: "ZmFrZQ==",
          },
          result: {
            metricCandidates: [
              {
                key: "gmv",
                label: "GMV",
                value: 100,
                sourceText: "GMV 100",
                confidence: 90,
              },
            ],
          },
        },
      ],
      liveReports: [
        {
          id: "report-confirm-metrics",
          organization_id: "org-1",
          project_id: "project-1",
          status: "pending_review",
        },
      ],
    });

    await confirmOcrJob({
      client,
      confirmationClient: client as never,
      actor,
      jobId: "job-confirm-metrics",
      manualResult: {
        viewers: 500,
        metricCandidates: [
          {
            key: "viewers",
            label: "场观",
            value: 999,
            sourceText: "不应绕过确认人数",
            confidence: 100,
          },
          {
            key: "gmv",
            label: "GMV",
            value: 250,
            sourceText: "人工确认 GMV 250",
            confidence: 100,
          },
          {
            key: "follows",
            label: "涨粉",
            value: 20,
            sourceText: "人工确认 涨粉 20",
            confidence: 100,
          },
        ],
      },
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "confirm_ocr_job_metrics",
      expect.objectContaining({
        p_confirmed_viewers: 500,
        p_metrics: [
          { key: "gmv", value: 250 },
          { key: "follows", value: 20 },
        ],
      }),
    );
  });

  it("does not fall back to OCR candidates when a manual metric override is malformed", async () => {
    const { client } = createClient({
      jobs: [
        {
          id: "job-confirm-malformed-metrics",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "needs_confirmation",
          attempt: 1,
          maxAttempts: 3,
          payload: {
            liveReportId: "report-confirm-malformed-metrics",
            imageBase64: "ZmFrZQ==",
          },
          result: {
            metricCandidates: [
              {
                key: "gmv",
                label: "GMV",
                value: 100,
                sourceText: "GMV 100",
                confidence: 90,
              },
            ],
          },
        },
      ],
      liveReports: [
        {
          id: "report-confirm-malformed-metrics",
          organization_id: "org-1",
          project_id: "project-1",
          status: "pending_review",
        },
      ],
    });

    await confirmOcrJob({
      client,
      confirmationClient: client as never,
      actor,
      jobId: "job-confirm-malformed-metrics",
      manualResult: { metricCandidates: "invalid" },
    });

    expect(client.rpc).not.toHaveBeenCalledWith(
      "upsert_ocr_streamer_metrics",
      expect.anything(),
    );
    expect(client.rpc).toHaveBeenCalledWith(
      "confirm_ocr_job_metrics",
      expect.objectContaining({ p_metrics: [] }),
    );
  });

  it("does not fall back to OCR candidates when manual confirmation omits metricCandidates", async () => {
    const { client } = createClient({
      jobs: [
        {
          id: "job-confirm-no-metrics",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "needs_confirmation",
          attempt: 1,
          aiInvocationId: "invocation-confirm-no-metrics",
          payload: { liveReportId: "report-confirm-no-metrics" },
          result: {
            metricCandidates: [
              { key: "gmv", label: "GMV", value: 999, confidence: 90 },
            ],
          },
        },
      ],
    });

    await confirmOcrJob({
      client,
      confirmationClient: client as never,
      actor,
      jobId: "job-confirm-no-metrics",
      manualResult: {},
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "confirm_ocr_job_metrics",
      expect.objectContaining({ p_metrics: [] }),
    );
  });

  it("surfaces atomic confirmation RPC errors without applying report evidence", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-confirm-rpc-failure",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "needs_confirmation",
          attempt: 1,
          aiInvocationId: "invocation-confirm-rpc-failure",
          payload: { liveReportId: "report-confirm-rpc-failure" },
        },
      ],
      rpcErrors: {
        confirm_ocr_job_metrics: new Error("atomic confirmation failed"),
      },
    });

    await expect(
      confirmOcrJob({
        client,
        confirmationClient: client as never,
        actor,
        jobId: "job-confirm-rpc-failure",
        manualResult: { metricCandidates: [] },
      }),
    ).rejects.toThrow("atomic confirmation failed");

    expect(updates.live_reports).toBeUndefined();
    expect(updates.ocr_results).toBeUndefined();
    expect(updates.background_jobs).toBeUndefined();
  });

  it("rejects duplicate or terminal confirmations before using the privileged RPC", async () => {
    const { client } = createClient({
      jobs: [
        {
          id: "job-confirmed",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "succeeded",
          attempt: 1,
          payload: { liveReportId: "report-confirmed" },
        },
      ],
    });

    await expect(
      confirmOcrJob({
        client,
        confirmationClient: client as never,
        actor,
        jobId: "job-confirmed",
        manualResult: { metricCandidates: [] },
      }),
    ).rejects.toThrow("OCR job is not awaiting confirmation");

    expect(client.rpc).not.toHaveBeenCalledWith(
      "confirm_ocr_job_metrics",
      expect.anything(),
    );
  });

  it("allows a background job marked needs_review to complete through atomic confirmation", async () => {
    const { client } = createClient({
      jobs: [
        {
          id: "job-needs-review-confirm",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "needs_review",
          attempt: 1,
          aiInvocationId: "invocation-needs-review-confirm",
          payload: { liveReportId: "report-needs-review-confirm" },
        },
      ],
    });

    await confirmOcrJob({
      client,
      confirmationClient: client as never,
      actor,
      jobId: "job-needs-review-confirm",
      manualResult: { duration: 80, viewers: 320, metricCandidates: [] },
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "confirm_ocr_job_metrics",
      expect.objectContaining({ p_job_id: "job-needs-review-confirm" }),
    );
  });

  it.each([
    {
      name: "aligned system and screenshot duration",
      systemDuration: 180,
      confirmedDuration: 180,
    },
    {
      name: "divergent system and screenshot duration",
      systemDuration: 180,
      confirmedDuration: 120,
    },
    {
      name: "missing system duration",
      systemDuration: null,
      confirmedDuration: 180,
    },
  ])(
    "delegates $name evidence calculation to the locked RPC without a follow-up report write",
    async ({ systemDuration, confirmedDuration }) => {
      const { client, updates } = createClient({
        jobs: [
          {
            id: `job-evidence-${confirmedDuration}-${String(systemDuration)}`,
            organizationId: "org-1",
            jobType: "ocr.extract_live_report",
            status: "needs_confirmation",
            attempt: 1,
            aiInvocationId: `invocation-evidence-${confirmedDuration}-${String(systemDuration)}`,
            payload: {
              liveReportId: `report-evidence-${confirmedDuration}-${String(systemDuration)}`,
            },
          },
        ],
        liveReports: [
          {
            id: `report-evidence-${confirmedDuration}-${String(systemDuration)}`,
            organization_id: "org-1",
            project_id: "project-1",
            status: "ocr_ing",
            system_duration: systemDuration,
            claimed_duration: 200,
            risk_flags: ["ocr_pending", "duration_divergence"],
          },
        ],
      });

      await confirmOcrJob({
        client,
        confirmationClient: client as never,
        actor,
        jobId: `job-evidence-${confirmedDuration}-${String(systemDuration)}`,
        manualResult: {
          duration: confirmedDuration,
          viewers: 2488,
          metricCandidates: [],
        },
      });

      expect(client.rpc).toHaveBeenCalledWith(
        "confirm_ocr_job_metrics",
        expect.objectContaining({
          p_confirmed_duration: confirmedDuration,
          p_confirmed_viewers: 2488,
        }),
      );
      expect(updates.live_reports).toBeUndefined();
    },
  );

  it("keeps OCR fallback values inside the atomic RPC when confirmation submits zero", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-confirm-zero",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "needs_confirmation",
          attempt: 1,
          maxAttempts: 3,
          payload: {
            liveReportId: "report-confirm-zero",
            imageBase64: "ZmFrZQ==",
          },
          result: { extractedDuration: 180, extractedViewers: 2488 },
        },
      ],
      liveReports: [
        {
          id: "report-confirm-zero",
          organization_id: "org-1",
          project_id: "project-1",
          status: "ocr_ing",
          system_duration: 180,
          risk_flags: ["ocr_pending"],
        },
      ],
    });

    await confirmOcrJob({
      client,
      confirmationClient: client as never,
      actor,
      jobId: "job-confirm-zero",
      // The confirm dialog defaults empty fields to 0; this must not wipe the
      // genuine OCR-extracted duration, otherwise the report is forced to
      // yellow evidence and never settles automatically.
      manualResult: { duration: 0, viewers: 0 },
      now: () => new Date("2026-06-05T02:30:00.000Z"),
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "confirm_ocr_job_metrics",
      expect.objectContaining({
        p_confirmed_duration: null,
        p_confirmed_viewers: null,
      }),
    );
    expect(updates.live_reports).toBeUndefined();
  });

  it("returns success when post-confirmation audit logging fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-confirm-audit-failure",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "needs_confirmation",
          attempt: 1,
          aiInvocationId: "invocation-confirm-audit-failure",
          payload: { liveReportId: "report-confirm-audit-failure" },
        },
      ],
      insertErrors: { audit_logs: new Error("audit unavailable") },
    });

    await expect(
      confirmOcrJob({
        client,
        confirmationClient: client as never,
        actor,
        jobId: "job-confirm-audit-failure",
        manualResult: { duration: 80, viewers: 320, metricCandidates: [] },
      }),
    ).resolves.toMatchObject({ status: "succeeded" });

    expect(updates.live_reports).toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "[ocr] audit log failed after atomic confirmation for job job-confirm-audit-failure",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("advances the live report into the review pool when OCR succeeds", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-advance",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          aiInvocationId: "invocation-advance",
          payload: {
            liveReportId: "report-advance",
            imageBase64: "ZmFrZQ==",
            expectedDuration: 180,
          },
        },
      ],
      liveReports: [
        {
          id: "report-advance",
          organization_id: "org-1",
          project_id: "project-1",
          status: "ocr_ing",
          system_duration: 180,
          risk_flags: ["ocr_pending"],
        },
      ],
    });

    const result = await runOcrJobOnce({
      client,
      metricClient: null,
      actor,
      jobId: "job-advance",
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "succeeded" as const,
          textLines: ["09:29~12:30 共3小时", "观看人数 2,488"],
          textItems: [],
          confidence: 96,
          requestId: "request-advance",
          rawResponse: {},
        })),
      },
    });

    expect(result.status).toBe("succeeded");
    expect(updates.live_reports).toEqual([
      expect.objectContaining({
        column: "id",
        value: "report-advance",
        payload: expect.objectContaining({
          status: "pending_review",
          screenshot_duration: 180,
          viewers: 2488,
          settlement_duration: 180,
          time_source: "system",
          evidence_level: "green",
        }),
      }),
    ]);
    const advancePayload = (
      updates.live_reports[0] as { payload: { risk_flags: string[] } }
    ).payload;
    expect(advancePayload.risk_flags).not.toContain("ocr_pending");
    expect(advancePayload.risk_flags).not.toContain("ocr_needs_review");
    expect(updates.live_reports[0]).toEqual(
      expect.objectContaining({
        filters: [
          { column: "id", value: "report-advance" },
          { column: "status", value: "ocr_ing" },
        ],
      }),
    );
  });

  it("flags conflicting OCR results in the review pool but still admits them", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-conflict",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          aiInvocationId: "invocation-conflict",
          payload: {
            liveReportId: "report-conflict",
            imageBase64: "ZmFrZQ==",
            expectedDuration: 180,
          },
        },
      ],
      liveReports: [
        {
          id: "report-conflict",
          organization_id: "org-1",
          project_id: "project-1",
          status: "ocr_ing",
          system_duration: 180,
          risk_flags: ["ocr_pending"],
        },
      ],
    });

    const result = await runOcrJobOnce({
      client,
      metricClient: null,
      actor,
      jobId: "job-conflict",
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "succeeded" as const,
          textLines: ["直播时长 20分钟", "观看人数 300"],
          textItems: [],
          confidence: 96,
          requestId: "request-conflict",
          rawResponse: {},
        })),
      },
    });

    expect(result.status).toBe("needs_confirmation");
    const conflictPayload = (
      updates.live_reports[0] as {
        payload: { status: string; risk_flags: string[] };
      }
    ).payload;
    expect(conflictPayload.status).toBe("pending_review");
    expect(conflictPayload.risk_flags).toContain("ocr_needs_review");
    expect(conflictPayload.risk_flags).toContain("ocr_duration_conflict");
  });

  it("does not regress a live report that already left the OCR stage", async () => {
    const { client, updates } = createClient({
      jobs: [
        {
          id: "job-late",
          organizationId: "org-1",
          jobType: "ocr.extract_live_report",
          status: "queued",
          attempt: 0,
          aiInvocationId: "invocation-late",
          payload: {
            liveReportId: "report-late",
            imageBase64: "ZmFrZQ==",
            expectedDuration: 180,
          },
        },
      ],
      liveReports: [
        {
          id: "report-late",
          organization_id: "org-1",
          project_id: "project-1",
          status: "approved",
          system_duration: 180,
        },
      ],
    });

    await runOcrJobOnce({
      client,
      metricClient: null,
      actor,
      jobId: "job-late",
      provider: {
        runGeneralBasicOcr: vi.fn(async () => ({
          status: "succeeded" as const,
          textLines: ["共3小时", "观看人数 2,488"],
          textItems: [],
          confidence: 96,
          requestId: "request-late",
          rawResponse: {},
        })),
      },
    });

    expect(updates.live_reports).toBeUndefined();
    expect(client.rpc).not.toHaveBeenCalledWith(
      "upsert_ocr_streamer_metrics",
      expect.anything(),
    );
  });
});

function toJobRecord(payload: Record<string, unknown>): OcrJobRecord {
  return {
    id: String(payload.id),
    organizationId: String(payload.organization_id),
    jobType: String(payload.job_type) as OcrJobRecord["jobType"],
    status: payload.status as OcrJobRecord["status"],
    attempt: Number(payload.attempt ?? 0),
    maxAttempts: Number(payload.max_attempts ?? payload.maxAttempts ?? 3),
    runAfter:
      typeof payload.run_after === "string"
        ? payload.run_after
        : typeof payload.runAfter === "string"
          ? payload.runAfter
          : undefined,
    lockedAt:
      typeof payload.locked_at === "string"
        ? payload.locked_at
        : typeof payload.lockedAt === "string"
          ? payload.lockedAt
          : undefined,
    lockedBy:
      typeof payload.locked_by === "string"
        ? payload.locked_by
        : typeof payload.lockedBy === "string"
          ? payload.lockedBy
          : undefined,
    errorCode:
      typeof payload.error_code === "string"
        ? payload.error_code
        : typeof payload.errorCode === "string"
          ? payload.errorCode
          : undefined,
    errorMessage:
      typeof payload.error_message === "string"
        ? payload.error_message
        : typeof payload.errorMessage === "string"
          ? payload.errorMessage
          : undefined,
    result:
      payload.result && typeof payload.result === "object"
        ? (payload.result as Record<string, unknown>)
        : undefined,
    reviewedBy:
      typeof payload.reviewed_by === "string"
        ? payload.reviewed_by
        : typeof payload.reviewedBy === "string"
          ? payload.reviewedBy
          : undefined,
    reviewedAt:
      typeof payload.reviewed_at === "string"
        ? payload.reviewed_at
        : typeof payload.reviewedAt === "string"
          ? payload.reviewedAt
          : undefined,
    aiInvocationId:
      typeof payload.ai_invocation_id === "string"
        ? payload.ai_invocation_id
        : undefined,
    payload: payload.payload as OcrJobRecord["payload"],
  };
}

function toJobPatch(payload: Record<string, unknown>): Partial<OcrJobRecord> {
  const patch: Partial<OcrJobRecord> = {};
  if (payload.status !== undefined)
    patch.status = payload.status as OcrJobRecord["status"];
  if (payload.attempt !== undefined) patch.attempt = Number(payload.attempt);
  if (payload.max_attempts !== undefined || payload.maxAttempts !== undefined) {
    patch.maxAttempts = Number(payload.max_attempts ?? payload.maxAttempts);
  }
  if (typeof payload.run_after === "string") patch.runAfter = payload.run_after;
  if (payload.locked_at === null) patch.lockedAt = undefined;
  if (typeof payload.locked_at === "string") patch.lockedAt = payload.locked_at;
  if (payload.locked_by === null) patch.lockedBy = undefined;
  if (typeof payload.locked_by === "string") patch.lockedBy = payload.locked_by;
  if (payload.error_code === null) patch.errorCode = undefined;
  if (typeof payload.error_code === "string")
    patch.errorCode = payload.error_code;
  if (payload.error_message === null) patch.errorMessage = undefined;
  if (typeof payload.error_message === "string") {
    patch.errorMessage = payload.error_message;
  }
  if (payload.result && typeof payload.result === "object") {
    patch.result = payload.result as Record<string, unknown>;
  }
  if (typeof payload.reviewed_by === "string")
    patch.reviewedBy = payload.reviewed_by;
  if (typeof payload.reviewed_at === "string")
    patch.reviewedAt = payload.reviewed_at;
  return patch;
}
