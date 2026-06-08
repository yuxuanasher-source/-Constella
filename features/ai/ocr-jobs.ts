import { randomUUID } from "node:crypto";

import { writeAuditLog } from "@/lib/audit/audit";
import { recordUsageEvent } from "@/features/billing/usage-metering";

import type { AiActor } from "./contracts";
import { recordAiInvocation } from "./invocation-ledger";
import { parseLiveReportOcrText } from "./ocr-template-parser";
import type {
  TencentOcrInput,
  TencentOcrProvider,
} from "./providers/tencent-ocr-provider";

export type OcrJobStatus =
  | "queued"
  | "running"
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "needs_confirmation"
  | "needs_review"
  | "cancelled";

export type OcrJobPayload = {
  liveReportId: string;
  screenshotId?: string;
  imageBase64?: string;
  imageUrl?: string;
  imageBucket?: string;
  imagePath?: string;
  expectedDuration?: number;
};

export type OcrJobRecord = {
  id: string;
  organizationId: string;
  jobType: "ocr.extract_live_report";
  status: OcrJobStatus;
  attempt: number;
  maxAttempts?: number;
  runAfter?: string;
  nextRunAt?: string;
  lockedAt?: string;
  lockedBy?: string;
  errorCode?: string;
  errorMessage?: string;
  result?: Record<string, unknown>;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  aiInvocationId?: string;
  payload: OcrJobPayload;
};

type OcrJobClient = {
  rpc?: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    data: Record<string, unknown>[] | null;
    error: Error | null;
  }>;
  from(table: string): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
    update(payload: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: Error | null }>;
    };
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: Record<string, unknown> | null;
          error: Error | null;
        }>;
        order(
          column: string,
          options: { ascending: boolean },
        ): PromiseLike<{ data: OcrJobRow[] | null; error: Error | null }>;
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
  max_attempts?: number;
  maxAttempts?: number;
  run_after?: string | null;
  runAfter?: string | null;
  next_run_at?: string | null;
  nextRunAt?: string | null;
  locked_at?: string | null;
  lockedAt?: string | null;
  locked_by?: string | null;
  lockedBy?: string | null;
  error_code?: string | null;
  errorCode?: string | null;
  error_message?: string | null;
  errorMessage?: string | null;
  error_summary?: string | null;
  errorSummary?: string | null;
  result?: Record<string, unknown> | null;
  reviewed_by?: string | null;
  reviewedBy?: string | null;
  reviewed_at?: string | null;
  reviewedAt?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  ai_invocation_id?: string | null;
  aiInvocationId?: string;
  payload: OcrJobPayload;
};

type LiveReportAccessRow = {
  id: string;
  organization_id?: string;
  organizationId?: string;
  project_id?: string;
  projectId?: string;
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
  if (!input.imageBase64 && !input.imageUrl && !input.imagePath) {
    throw new Error("OCR job requires imageBase64, imageUrl, or imagePath");
  }
  await assertLiveReportAccessible({
    client,
    actor,
    liveReportId: input.liveReportId,
  });
  const payload: OcrJobPayload = {
    liveReportId: input.liveReportId,
    screenshotId: input.screenshotId,
    imageBase64: input.imageBase64,
    imageUrl: input.imageUrl,
    imageBucket: input.imageBucket,
    imagePath: input.imagePath,
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
    run_after: new Date().toISOString(),
    next_run_at: new Date().toISOString(),
    result: {},
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
    maxAttempts: 3,
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

  return data ? toOcrJobRecord(data as OcrJobRow) : null;
}

export async function listOcrJobs({
  client,
  organizationId,
  status,
}: {
  client: OcrJobClient;
  organizationId: string;
  status?: string;
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
    .filter(
      (job) => (job.job_type ?? job.jobType) === "ocr.extract_live_report",
    )
    .filter((job) =>
      status && status !== "all"
        ? normalizeStatus(job.status) === normalizeStatus(status)
        : true,
    )
    .map(toOcrJobRecord);
}

export async function listRunnableOcrJobs({
  client,
  organizationId,
  now = new Date(),
  lockTimeoutMs = 15 * 60 * 1000,
  limit = 10,
}: {
  client: OcrJobClient;
  organizationId: string;
  now?: Date;
  lockTimeoutMs?: number;
  limit?: number;
}): Promise<OcrJobRecord[]> {
  const jobs = await listOcrJobs({ client, organizationId });
  return jobs
    .filter((job) => isRunnableOcrJob(job, now, lockTimeoutMs))
    .slice(0, limit);
}

export async function claimRunnableOcrJobs({
  client,
  organizationId,
  runnerId,
  now = new Date(),
  lockTimeoutMs = 15 * 60 * 1000,
  limit = 10,
}: {
  client: OcrJobClient;
  organizationId: string;
  runnerId: string;
  now?: Date;
  lockTimeoutMs?: number;
  limit?: number;
}): Promise<OcrJobRecord[]> {
  if (typeof client.rpc === "function") {
    const { data, error } = await client.rpc("claim_ocr_jobs", {
      p_organization_id: organizationId,
      p_runner_id: runnerId,
      p_limit: Math.max(1, Math.trunc(limit)),
      p_lock_timeout_seconds: Math.max(1, Math.trunc(lockTimeoutMs / 1000)),
      p_now: now.toISOString(),
    });
    if (error) {
      throw error;
    }
    return (data ?? []).map((row) => toOcrJobRecord(row as OcrJobRow));
  }

  return listRunnableOcrJobs({
    client,
    organizationId,
    now,
    lockTimeoutMs,
    limit,
  });
}

export async function retryOcrJob({
  client,
  actor,
  jobId,
  now = () => new Date(),
}: {
  client: OcrJobClient;
  actor: AiActor;
  jobId: string;
  now?: () => Date;
}): Promise<OcrJobRecord> {
  const job = await requireOcrJob(client, jobId);
  await assertOcrJobAccessible({ client, actor, job });
  const runAt = now().toISOString();
  const currentMaxAttempts = job.maxAttempts ?? 3;
  const maxAttempts =
    job.attempt >= currentMaxAttempts ? job.attempt + 1 : currentMaxAttempts;

  await updateOrThrow(client, "background_jobs", jobId, {
    status: "queued",
    max_attempts: maxAttempts,
    run_after: runAt,
    next_run_at: runAt,
    locked_at: null,
    locked_by: null,
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
    after: { status: "queued", attempt: job.attempt, maxAttempts },
    changedFields: ["status", "max_attempts", "run_after", "locked_at"],
  });

  return {
    ...job,
    status: "queued",
    maxAttempts,
    runAfter: runAt,
    nextRunAt: runAt,
  };
}

export async function runOcrJobOnce({
  client,
  actor,
  jobId,
  provider,
  runnerId = "manual-runner",
  now = () => new Date(),
  lockTimeoutMs = 15 * 60 * 1000,
  imageResolver = defaultOcrImageResolver,
}: {
  client: OcrJobClient;
  actor: AiActor;
  jobId: string;
  provider: TencentOcrProvider;
  runnerId?: string;
  now?: () => Date;
  lockTimeoutMs?: number;
  imageResolver?: (payload: OcrJobPayload) => Promise<TencentOcrInput>;
}): Promise<OcrJobRecord> {
  const job = await requireOcrJob(client, jobId);
  await assertOcrJobAccessible({ client, actor, job });
  const startedAt = now();
  if (isLockedByAnotherRunner(job, startedAt, lockTimeoutMs, runnerId)) {
    throw new Error("OCR job is locked by another runner");
  }
  if (!isRunnableOcrJob(job, startedAt, lockTimeoutMs, runnerId)) {
    throw new Error("OCR job is not runnable");
  }
  const attempt = job.attempt + 1;
  const maxAttempts = job.maxAttempts ?? 3;
  if (attempt > maxAttempts) {
    throw new Error("OCR job max attempts reached");
  }

  await updateOrThrow(client, "background_jobs", jobId, {
    status: "running",
    attempt,
    locked_at: startedAt.toISOString(),
    locked_by: runnerId,
  });

  let providerInput: TencentOcrInput;
  try {
    providerInput = await imageResolver(job.payload);
  } catch (error) {
    return failOcrJobAttempt({
      client,
      job,
      attempt,
      maxAttempts,
      startedAt,
      errorCode: "image_source_failed",
      errorSummary:
        error instanceof Error && error.message.trim()
          ? error.message
          : "OCR image source failed",
    });
  }

  const providerResult = await provider.runGeneralBasicOcr(providerInput);

  if (providerResult.status !== "succeeded") {
    const errorSummary =
      providerResult.errorSummary ??
      providerResult.degradedReason ??
      "Tencent OCR failed";
    const errorCode = safeProviderErrorCode(providerResult);
    return failOcrJobAttempt({
      client,
      job,
      attempt,
      maxAttempts,
      startedAt,
      errorCode,
      errorSummary,
    });
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

  const result = {
    extractedDuration: parsed.extractedDuration,
    extractedViewers: parsed.extractedViewers,
    provider: "tencent_ocr",
    confidence: providerResult.confidence,
    requestId: providerResult.requestId,
    parseReasons: reasons,
  };
  await updateOrThrow(client, "background_jobs", jobId, {
    status,
    attempt,
    locked_at: null,
    locked_by: null,
    error_code: status === "needs_confirmation" ? "needs_review" : null,
    error_message: reasons.length ? reasons.join("; ") : null,
    error_summary: reasons.length ? reasons.join("; ") : null,
    result,
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

  return {
    ...job,
    status,
    attempt,
    lockedAt: undefined,
    lockedBy: undefined,
    errorCode: status === "needs_confirmation" ? "needs_review" : undefined,
    errorMessage: reasons.length ? reasons.join("; ") : undefined,
    result,
  };
}

export async function confirmOcrJob({
  client,
  actor,
  jobId,
  manualResult,
  now = () => new Date(),
}: {
  client: OcrJobClient;
  actor: AiActor;
  jobId: string;
  manualResult: Record<string, unknown>;
  now?: () => Date;
}): Promise<OcrJobRecord> {
  const job = await requireOcrJob(client, jobId);
  await assertOcrJobAccessible({ client, actor, job });
  const reviewedAt = now().toISOString();
  const result = {
    ...(job.result ?? {}),
    manualResult,
  };

  await updateOcrResult(client, job, {
    status: "succeeded",
    needs_confirmation: false,
    manual_result: manualResult,
    reviewed_by: actor.userId,
    reviewed_at: reviewedAt,
  });
  await updateOrThrow(client, "background_jobs", jobId, {
    status: "succeeded",
    error_code: null,
    error_message: null,
    error_summary: null,
    result,
    review_payload: manualResult,
    reviewed_by: actor.userId,
    reviewed_at: reviewedAt,
    locked_at: null,
    locked_by: null,
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
    after: { status: "succeeded", reviewedAt },
    changedFields: ["status", "reviewed_by", "reviewed_at", "review_payload"],
  });

  return {
    ...job,
    status: "succeeded",
    errorCode: undefined,
    errorMessage: undefined,
    result,
    reviewedBy: actor.userId,
    reviewedAt,
  };
}

export async function markOcrJobNeedsReview({
  client,
  actor,
  jobId,
  reason = "manual_review_requested",
}: {
  client: OcrJobClient;
  actor: AiActor;
  jobId: string;
  reason?: string;
}): Promise<OcrJobRecord> {
  const job = await requireOcrJob(client, jobId);
  await assertOcrJobAccessible({ client, actor, job });
  await updateOrThrow(client, "background_jobs", jobId, {
    status: "needs_review",
    error_code: "needs_review",
    error_message: reason,
    error_summary: reason,
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
    after: { status: "needs_review", reason },
    changedFields: ["status", "error_code", "error_message"],
  });
  return {
    ...job,
    status: "needs_review",
    errorCode: "needs_review",
    errorMessage: reason,
  };
}

async function defaultOcrImageResolver(
  payload: OcrJobPayload,
): Promise<TencentOcrInput> {
  if (payload.imageUrl) return { imageUrl: payload.imageUrl };
  if (payload.imageBase64) return { imageBase64: payload.imageBase64 };
  throw new Error("OCR job requires imageBase64, imageUrl, or imagePath");
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

async function assertOcrJobAccessible({
  client,
  actor,
  job,
}: {
  client: OcrJobClient;
  actor: AiActor;
  job: OcrJobRecord;
}): Promise<void> {
  if (job.organizationId !== actor.organizationId) {
    throw new Error("Cross-organization access is not allowed");
  }
  await assertLiveReportAccessible({
    client,
    actor,
    liveReportId: job.payload.liveReportId,
  });
}

async function assertLiveReportAccessible({
  client,
  actor,
  liveReportId,
}: {
  client: OcrJobClient;
  actor: AiActor;
  liveReportId: string;
}): Promise<void> {
  const { data, error } = await client
    .from("live_reports")
    .select("id, organization_id, project_id")
    .eq("id", liveReportId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const report = data as LiveReportAccessRow | null;
  const organizationId = report?.organization_id ?? report?.organizationId;
  if (!report || organizationId !== actor.organizationId) {
    throw new Error("Live report not found or inaccessible");
  }
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

async function failOcrJobAttempt({
  client,
  job,
  attempt,
  maxAttempts,
  startedAt,
  errorCode,
  errorSummary,
}: {
  client: OcrJobClient;
  job: OcrJobRecord;
  attempt: number;
  maxAttempts: number;
  startedAt: Date;
  errorCode: string;
  errorSummary: string;
}): Promise<OcrJobRecord> {
  const safeMessage = sanitizeErrorMessage(errorSummary);
  const finalAttempt = attempt >= maxAttempts;
  const retryAt = new Date(
    startedAt.getTime() + retryDelayMs(attempt),
  ).toISOString();

  await updateOcrResult(client, job, {
    status: finalAttempt ? "failed" : "pending",
    error_code: errorCode,
    error_message: safeMessage,
    needs_confirmation: false,
  });
  await updateOrThrow(client, "background_jobs", job.id, {
    status: finalAttempt ? "failed" : "queued",
    attempt,
    run_after: finalAttempt ? startedAt.toISOString() : retryAt,
    next_run_at: finalAttempt ? null : retryAt,
    locked_at: null,
    locked_by: null,
    error_code: errorCode,
    error_message: safeMessage,
    error_summary: safeMessage,
  });

  return {
    ...job,
    status: finalAttempt ? "failed" : "queued",
    attempt,
    runAfter: finalAttempt ? startedAt.toISOString() : retryAt,
    nextRunAt: finalAttempt ? undefined : retryAt,
    lockedAt: undefined,
    lockedBy: undefined,
    errorCode,
    errorMessage: safeMessage,
  };
}

function toOcrJobRecord(row: OcrJobRow): OcrJobRecord {
  const errorMessage =
    row.error_message ??
    row.errorMessage ??
    row.error_summary ??
    row.errorSummary ??
    undefined;
  return {
    id: row.id,
    organizationId: row.organization_id ?? row.organizationId ?? "",
    jobType: row.job_type ?? row.jobType ?? "ocr.extract_live_report",
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts ?? row.maxAttempts ?? 3,
    runAfter: row.run_after ?? row.runAfter ?? undefined,
    nextRunAt: row.next_run_at ?? row.nextRunAt ?? row.run_after ?? undefined,
    lockedAt: row.locked_at ?? row.lockedAt ?? undefined,
    lockedBy: row.locked_by ?? row.lockedBy ?? undefined,
    errorCode: row.error_code ?? row.errorCode ?? undefined,
    errorMessage,
    result: row.result ?? undefined,
    reviewedBy: row.reviewed_by ?? row.reviewedBy ?? undefined,
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? undefined,
    createdAt: row.created_at ?? row.createdAt ?? undefined,
    updatedAt: row.updated_at ?? row.updatedAt ?? undefined,
    aiInvocationId: row.ai_invocation_id ?? row.aiInvocationId ?? undefined,
    payload: row.payload,
  };
}

function normalizeStatus(status: string): OcrJobStatus {
  if (status === "pending") return "queued";
  if (status === "processing") return "running";
  if (status === "needs_review") return "needs_confirmation";
  return status as OcrJobStatus;
}

function isRunnableOcrJob(
  job: OcrJobRecord,
  now: Date,
  lockTimeoutMs: number,
  runnerId?: string,
): boolean {
  if (job.jobType !== "ocr.extract_live_report") {
    return false;
  }
  if (job.attempt >= (job.maxAttempts ?? 3)) {
    return false;
  }

  const status = normalizeStatus(job.status);
  if (status === "queued") {
    const runAt = job.nextRunAt ?? job.runAfter;
    return !runAt || new Date(runAt).getTime() <= now.getTime();
  }

  if (status === "running") {
    if (runnerId && job.lockedBy === runnerId) {
      return true;
    }
    if (!job.lockedAt) {
      return true;
    }
    return now.getTime() - new Date(job.lockedAt).getTime() >= lockTimeoutMs;
  }

  return false;
}

function isLockedByAnotherRunner(
  job: OcrJobRecord,
  now: Date,
  lockTimeoutMs: number,
  runnerId: string,
): boolean {
  const status = normalizeStatus(job.status);
  if (status !== "running" || !job.lockedAt || job.lockedBy === runnerId) {
    return false;
  }
  return now.getTime() - new Date(job.lockedAt).getTime() < lockTimeoutMs;
}

function retryDelayMs(attempt: number): number {
  const baseMs = 60_000;
  const cappedAttempt = Math.max(0, Math.min(attempt - 1, 5));
  return baseMs * 2 ** cappedAttempt;
}

function safeProviderErrorCode(providerResult: {
  degradedReason?: string;
  errorSummary?: string;
}): string {
  if (providerResult.degradedReason === "provider_unconfigured") {
    return "provider_unconfigured";
  }
  return "provider_failed";
}

function sanitizeErrorMessage(value: unknown): string {
  const message =
    typeof value === "string" && value.trim()
      ? value.trim()
      : "OCR provider failed";
  return message
    .replace(/\s+with\s+secret[^\s;]*/gi, "")
    .replace(/secret[^\s;]*/gi, "[redacted]")
    .replace(/key[=\s:][^\s;]*/gi, "key=[redacted]")
    .replace(/\n[\s\S]*/g, "")
    .slice(0, 240);
}
