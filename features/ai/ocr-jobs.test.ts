import { describe, expect, it, vi } from "vitest";

import {
  createOcrJob,
  retryOcrJob,
  runOcrJobOnce,
  type OcrJobRecord,
} from "./ocr-jobs";

function createClient(fixtures: { jobs?: OcrJobRecord[] } = {}) {
  const inserts: Record<string, Record<string, unknown>[]> = {};
  const updates: Record<string, Record<string, unknown>[]> = {};
  const jobs = [...(fixtures.jobs ?? [])];
  const client = {
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
          updates[table] = [...(updates[table] ?? []), { payload, column, value }];
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
            if (table !== "background_jobs" || column !== "id") {
              return { data: null, error: null };
            }
            return {
              data: jobs.find((job) => job.id === value) ?? null,
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
  it("creates a queued OCR job and pending OCR result", async () => {
    const { client, inserts } = createClient();

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

  it("increments attempt when retrying a failed job", async () => {
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

    expect(job.status).toBe("queued");
    expect(updates.background_jobs).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "queued",
          attempt: 2,
          error_summary: null,
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
    aiInvocationId:
      typeof payload.ai_invocation_id === "string"
        ? payload.ai_invocation_id
        : undefined,
    payload: payload.payload as OcrJobRecord["payload"],
  };
}

function toJobPatch(payload: Record<string, unknown>): Partial<OcrJobRecord> {
  return {
    status: payload.status as OcrJobRecord["status"],
    attempt: Number(payload.attempt ?? 0),
  };
}
