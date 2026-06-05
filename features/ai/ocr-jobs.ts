import { randomUUID } from "node:crypto";

import { writeAuditLog } from "@/lib/audit/audit";
import { recordUsageEvent } from "@/features/billing/usage-metering";

import type { AiActor } from "./contracts";
import { recordAiInvocation } from "./invocation-ledger";
import { parseLiveReportOcrText } from "./ocr-template-parser";
import type { TencentOcrProvider } from "./providers/tencent-ocr-provider";

export type OcrJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "needs_confirmation"
  | "cancelled";

export type OcrJobPayload = {
  liveReportId: string;
  screenshotId?: string;
  imageBase64?: string;
  imageUrl?: string;
  expectedDuration?: number;
};

export type OcrJobRecord = {
  id: string;
  organizationId: string;
  jobType: "ocr.extract_live_report";
  status: OcrJobStatus;
  attempt: number;
  aiInvocationId?: string;
  payload: OcrJobPayload;
};

type OcrJobClient = {
  from(
    table:
      | "background_jobs"
      | "ocr_results"
      | "ai_invocations"
      | "usage_events"
      | "audit_logs",
  ): {
    insert(payload: Record<string, unknown>): PromiseLike<{ error: Error | null }>;
    update(payload: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: Error | null }>;
    };
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{
          data: OcrJobRow | null;
          error: Error | null;
        }>;
      };
    };
  };
};

type OcrJobRow = {
  id: string;
  organization_id?: string;
  organizationId?: string;
  job_type?: "ocr.extract_live_report";
  jobType?: "ocr.extract_live_report";
  status: OcrJobStatus;
  attempt: number;
  ai_invocation_id?: string | null;
  aiInvocationId?: string;
  payload: OcrJobPayload;
};

export async function createOcrJob({
  client,
  actor,
  input,
}: {
  client: OcrJobClient;
  actor: AiActor;
  input: OcrJobPayload & {
    id?: string;
    invocationId?: string;
  };
}): Promise<OcrJobRecord> {
  const jobId = input.id ?? randomUUID();
  const invocationId = input.invocationId ?? randomUUID();
  const payload: OcrJobPayload = {
    liveReportId: input.liveReportId,
    screenshotId: input.screenshotId,
    imageBase64: input.imageBase64,
    imageUrl: input.imageUrl,
    expectedDuration: input.expectedDuration,
  };

  await recordAiInvocation({
    client,
    actor,
    input: {
      id: invocationId,
      scene: "ocr.extract_live_report",
      objectType: "live_report",
      objectId: input.liveReportId,
      providerName: "tencent_ocr",
      status: "queued",
      metadata: { jobId, screenshotId: input.screenshotId },
    },
  });

  await insertOrThrow(client, "background_jobs", {
    id: jobId,
    organization_id: actor.organizationId,
    job_type: "ocr.extract_live_report",
    payload,
    status: "queued",
    attempt: 0,
    max_attempts: 3,
    ai_invocation_id: invocationId,
  });

  await insertOrThrow(client, "ocr_results", {
    organization_id: actor.organizationId,
    live_report_id: input.liveReportId,
    screenshot_id: input.screenshotId,
    status: "pending",
    raw_result: {},
    raw_response: {},
    ai_invocation_id: invocationId,
    background_job_id: jobId,
    needs_confirmation: false,
  });

  return {
    id: jobId,
    organizationId: actor.organizationId,
    jobType: "ocr.extract_live_report",
    status: "queued",
    attempt: 0,
    aiInvocationId: invocationId,
    payload,
  };
}

export async function getOcrJob({
  client,
  jobId,
}: {
  client: OcrJobClient;
  jobId: string;
}): Promise<OcrJobRecord | null> {
  const { data, error } = await client
    .from("background_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? toOcrJobRecord(data) : null;
}

export async function listOcrJobs({
  client,
  organizationId,
}: {
  client: {
    from(table: "background_jobs"): {
      select(columns: string): {
        eq(column: string, value: string): {
          order(
            column: string,
            options: { ascending: boolean },
          ): PromiseLike<{ data: OcrJobRow[] | null; error: Error | null }>;
        };
      };
    };
  };
  organizationId: string;
}): Promise<OcrJobRecord[]> {
  const { data, error } = await client
    .from("background_jobs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? [])
    .filter((job) => (job.job_type ?? job.jobType) === "ocr.extract_live_report")
    .map(toOcrJobRecord);
}

export async function retryOcrJob({
  client,
  actor,
  jobId,
}: {
  client: OcrJobClient;
  actor: AiActor;
  jobId: string;
}): Promise<OcrJobRecord> {
  const job = await requireOcrJob(client, jobId);
  const attempt = job.attempt + 1;

  await updateOrThrow(client, "background_jobs", jobId, {
    status: "queued",
    attempt,
    error_summary: null,
    run_after: new Date().toISOString(),
  });

  await writeAuditLog(client as Parameters<typeof writeAuditLog>[0], {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "ai",
    objectType: "background_job",
    objectId: jobId,
    after: { status: "queued", attempt },
    changedFields: ["status", "attempt"],
  });

  return { ...job, status: "queued", attempt };
}

export async function runOcrJobOnce({
  client,
  actor,
  jobId,
  provider,
}: {
  client: OcrJobClient;
  actor: AiActor;
  jobId: string;
  provider: TencentOcrProvider;
}): Promise<OcrJobRecord> {
  const job = await requireOcrJob(client, jobId);
  const attempt = job.attempt + 1;

  await updateOrThrow(client, "background_jobs", jobId, {
    status: "running",
    attempt,
    locked_at: new Date().toISOString(),
  });

  const providerResult = await provider.runGeneralBasicOcr(
    job.payload.imageUrl
      ? { imageUrl: job.payload.imageUrl }
      : { imageBase64: job.payload.imageBase64 ?? "" },
  );

  if (providerResult.status !== "succeeded") {
    const errorSummary =
      providerResult.errorSummary ??
      providerResult.degradedReason ??
      "Tencent OCR failed";
    await updateOcrResult(client, job, {
      status: providerResult.status === "degraded" ? "failed" : "failed",
      raw_response: providerResult.rawResponse ?? {},
      error_message: errorSummary,
      needs_confirmation: false,
    });
    await updateOrThrow(client, "background_jobs", jobId, {
      status: "failed",
      error_summary: errorSummary,
    });
    return { ...job, status: "failed", attempt };
  }

  const parsed = parseLiveReportOcrText(providerResult.textLines, {
    expectedDuration: job.payload.expectedDuration,
  });
  const reasons = [...parsed.reasons];
  if (providerResult.confidence < 70) {
    reasons.push("low_provider_confidence");
  }
  const status: OcrJobStatus =
    parsed.status === "trusted" && providerResult.confidence >= 70
      ? "succeeded"
      : "needs_confirmation";

  await updateOcrResult(client, job, {
    status,
    raw_result: {
      textLines: providerResult.textLines,
      requestId: providerResult.requestId,
      parseReasons: reasons,
    },
    raw_response: providerResult.rawResponse ?? {},
    extracted_duration: parsed.extractedDuration,
    extracted_viewers: parsed.extractedViewers,
    provider: "tencent_ocr",
    confidence: providerResult.confidence,
    needs_confirmation: status === "needs_confirmation",
    error_message: reasons.length ? reasons.join("; ") : null,
  });

  await updateOrThrow(client, "background_jobs", jobId, {
    status,
    error_summary: reasons.length ? reasons.join("; ") : null,
  });

  await recordUsageEvent({
    client: client as Parameters<typeof recordUsageEvent>[0]["client"],
    actor,
    input: {
      metric: "ocr",
      quantity: 1,
      source: "ocr_job",
      objectType: "background_job",
      objectId: jobId,
      metadata: {
        provider: "tencent_ocr",
        requestId: providerResult.requestId,
        status,
      },
    },
  });

  return { ...job, status, attempt };
}

async function requireOcrJob(
  client: OcrJobClient,
  jobId: string,
): Promise<OcrJobRecord> {
  const job = await getOcrJob({ client, jobId });
  if (!job) {
    throw new Error("OCR job not found");
  }
  if (job.jobType !== "ocr.extract_live_report") {
    throw new Error("Background job is not an OCR job");
  }
  return job;
}

async function insertOrThrow(
  client: OcrJobClient,
  table: "background_jobs" | "ocr_results",
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from(table).insert(payload);
  if (error) {
    throw error;
  }
}

async function updateOrThrow(
  client: OcrJobClient,
  table: "background_jobs" | "ocr_results",
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from(table).update(payload).eq("id", id);
  if (error) {
    throw error;
  }
}

async function updateOcrResult(
  client: OcrJobClient,
  job: OcrJobRecord,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .from("ocr_results")
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq("background_job_id", job.id);
  if (error) {
    throw error;
  }
}

function toOcrJobRecord(row: OcrJobRow): OcrJobRecord {
  return {
    id: row.id,
    organizationId: row.organization_id ?? row.organizationId ?? "",
    jobType: row.job_type ?? row.jobType ?? "ocr.extract_live_report",
    status: row.status,
    attempt: row.attempt,
    aiInvocationId: row.ai_invocation_id ?? row.aiInvocationId ?? undefined,
    payload: row.payload,
  };
}
