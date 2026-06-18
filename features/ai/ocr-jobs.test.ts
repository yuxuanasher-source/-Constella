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
    }>;
  } = {},
) {
  const inserts: Record<string, Record<string, unknown>[]> = {};
  const updates: Record<string, Record<string, unknown>[]> = {};
  const jobs = [...(fixtures.jobs ?? [])];
  const liveReports = [
    ...(fixtures.liveReports ?? []),
    ...(fixtures.liveReports
      ? []
      : jobs.map((job) => ({
          id: job.payload.liveReportId,
          organization_id: job.organizationId,
          project_id: "project-1",
        }))),
  ];
  const client = {
    rpc: vi.fn(
      async (): Promise<{ data: Record<string, unknown>[]; error: null }> => ({
        data: [],
        error: null,
      }),
    ),
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (payload: Record<string, unknown>) => {
        inserts[table] = [...(inserts[table] ?? []), payload];
        if (table === "background_jobs") {
          jobs.push(toJobRecord(payload));
        }
        return { error: null };
      }),
      update: vi.fn((payload: Record<string, unknown>) => ({
        eq: vi.fn(async (column: string, value: string) => {
          updates[table] = [
            ...(updates[table] ?? []),
            { payload, column, value },
          ];
          if (table === "background_jobs" && column === "id") {
            const index = jobs.findIndex((job) => job.id === value);
            if (index >= 0) {
              jobs[index] = { ...jobs[index], ...toJobPatch(payload) };
            }
          }
          return { error: null };
        }),
      })),
      select: vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => ({
          maybeSingle: vi.fn(async () => {
            if (table === "live_reports" && column === "id") {
              return {
                data: liveReports.find((report) => report.id === value) ?? null,
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
        status: "queued",
        ai_invocation_id: "invocation-1",
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
          payload: { liveReportId: "report-confirm", imageBase64: "ZmFrZQ==" },
          result: { extractedDuration: 78, extractedViewers: 300 },
        },
      ],
    });

    const job = await confirmOcrJob({
      client,
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
    expect(updates.ocr_results).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "succeeded",
          needs_confirmation: false,
          manual_result: { duration: 80, viewers: 320 },
          reviewed_by: "user-ops",
          reviewed_at: "2026-06-05T02:30:00.000Z",
        }),
      }),
    ]);
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
