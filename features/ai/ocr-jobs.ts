import { randomUUID } from "node:crypto";

import { writeAuditLog } from "@/lib/audit/audit";
import { recordUsageEvent } from "@/features/billing/usage-metering";
import { resolveReportEvidence } from "@/features/live-operations/live-report-evidence";

import type { AiActor } from "./contracts";
import { parseLiveReportOcrText } from "./ocr-template-parser";
import type {
  TencentOcrInput,
  TencentOcrProvider,
} from "./providers/tencent-ocr-provider";
import {
  normalizeOcrMetricCandidates,
  writeStreamerMetricsFromOcr,
  type StreamerMetricSinkClient,
} from "./streamer-metric-sink";

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

type OcrJobMutationResult = { error: Error | null; count?: number | null };
type OcrJobUpdateFilter = PromiseLike<OcrJobMutationResult> & {
  eq(column: string, value: string): OcrJobUpdateFilter;
};

type OcrJobClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    data: Record<string, unknown> | Record<string, unknown>[] | number | null;
    error: Error | null;
  }>;
  from(table: string): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
    update(
      payload: Record<string, unknown>,
      options?: { count: "exact" },
    ): OcrJobUpdateFilter;
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

  const payload: OcrJobPayload = {
    liveReportId: input.liveReportId,
    ...(input.screenshotId ? { screenshotId: input.screenshotId } : {}),
    ...(input.imageBase64 ? { imageBase64: input.imageBase64 } : {}),
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    ...(input.imageBucket ? { imageBucket: input.imageBucket } : {}),
    ...(input.imagePath ? { imagePath: input.imagePath } : {}),
    ...(input.expectedDuration !== undefined
      ? { expectedDuration: input.expectedDuration }
      : {}),
  };
  const { data, error } = await client.rpc("enqueue_ocr_job", {
    p_job_id: jobId,
    p_invocation_id: invocationId,
    p_organization_id: actor.organizationId,
    p_live_report_id: input.liveReportId,
    p_screenshot_id: input.screenshotId ?? null,
    p_actor_user_id: actor.userId,
    p_actor_name: actor.name,
    p_actor_role: actor.role,
    p_payload: payload,
    p_run_at: new Date().toISOString(),
  });
  if (error) {
    throw error;
  }
  if (!data || Array.isArray(data) || typeof data !== "object") {
    throw new Error("Atomic OCR enqueue did not return a job");
  }

  return toOcrJobRecord(data as OcrJobRow);
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
    if (!Array.isArray(data)) {
      throw new Error("OCR claim RPC returned an invalid payload");
    }
    return data.map((row) => toOcrJobRecord(row as OcrJobRow));
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
  metricClient,
  runnerId = "manual-runner",
  now = () => new Date(),
  lockTimeoutMs = 15 * 60 * 1000,
  imageResolver = defaultOcrImageResolver,
}: {
  client: OcrJobClient;
  actor: AiActor;
  jobId: string;
  provider: TencentOcrProvider;
  metricClient: StreamerMetricSinkClient | null;
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

  try {
    return await runLockedOcrJob({
      client,
      actor,
      job,
      jobId,
      provider,
      metricClient,
      attempt,
      maxAttempts,
      startedAt,
      imageResolver,
    });
  } catch (error) {
    // The lock was already taken; any unexpected error here would otherwise
    // leave the job stuck in `running` until the lock times out. Release the
    // lock and schedule a retry (or fail it out) instead.
    return failOcrJobAttempt({
      client,
      job,
      attempt,
      maxAttempts,
      startedAt,
      errorCode: "runner_error",
      errorSummary:
        error instanceof Error && error.message.trim()
          ? error.message
          : "OCR runner error",
    });
  }
}

async function runLockedOcrJob({
  client,
  actor,
  job,
  jobId,
  provider,
  metricClient,
  attempt,
  maxAttempts,
  startedAt,
  imageResolver,
}: {
  client: OcrJobClient;
  actor: AiActor;
  job: OcrJobRecord;
  jobId: string;
  provider: TencentOcrProvider;
  metricClient: StreamerMetricSinkClient | null;
  attempt: number;
  maxAttempts: number;
  startedAt: Date;
  imageResolver: (payload: OcrJobPayload) => Promise<TencentOcrInput>;
}): Promise<OcrJobRecord> {
  const liveReport = await loadLiveReportForOcrAdvance({
    client,
    liveReportId: job.payload.liveReportId,
  });
  if (liveReport?.status !== "ocr_ing") {
    return cancelOcrJobForInactiveReport({
      client,
      job,
      attempt,
    });
  }

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
    items: providerResult.textItems,
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
      extractedDate: parsed.extractedDate,
      extractedStartedAt: parsed.extractedStartedAt,
      extractedEndedAt: parsed.extractedEndedAt,
      metricCandidates: parsed.metricCandidates,
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
    extractedDate: parsed.extractedDate,
    extractedStartedAt: parsed.extractedStartedAt,
    extractedEndedAt: parsed.extractedEndedAt,
    metricCandidates: parsed.metricCandidates,
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

  // Sync the extracted values back to the live report and move it into the
  // 报数审核池 (review pool). Both trusted and needs-confirmation results enter
  // the pool; conflicting ones carry a flag so reviewers can double-check.
  await advanceLiveReportAfterOcr({
    client,
    metricClient,
    liveReportId: job.payload.liveReportId,
    report: liveReport,
    extractedDuration: parsed.extractedDuration,
    extractedViewers: parsed.extractedViewers,
    metricCandidates: parsed.metricCandidates,
    sourceInvocationId: job.aiInvocationId,
    writeMetrics: status === "succeeded",
    needsConfirmation: status === "needs_confirmation",
    reasons,
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
  confirmationClient,
  actor,
  jobId,
  manualResult,
  now = () => new Date(),
}: {
  client: OcrJobClient;
  confirmationClient: OcrConfirmationClient;
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
  if (job.status !== "needs_confirmation" && job.status !== "needs_review") {
    throw new Error("OCR job is not awaiting confirmation");
  }
  const metricCandidates = pickConfirmedMetricCandidates(manualResult);
  const metrics = normalizeConfirmedOcrMetricCandidates(metricCandidates);
  const confirmedDuration = pickPositiveIntegerField(
    manualResult.extractedDuration,
    manualResult.duration,
  );
  const confirmedViewers = pickPositiveIntegerField(
    manualResult.extractedViewers,
    manualResult.viewers,
  );
  const { data: confirmation, error: confirmationError } =
    await confirmationClient.rpc("confirm_ocr_job_metrics", {
      p_job_id: jobId,
      p_reviewed_by: actor.userId,
      p_reviewed_at: reviewedAt,
      p_manual_result: manualResult,
      p_metrics: metrics,
      p_confirmed_duration: confirmedDuration,
      p_confirmed_viewers: confirmedViewers,
    });
  if (confirmationError) {
    throw confirmationError;
  }
  if (!isSuccessfulOcrConfirmation(confirmation)) {
    throw new Error("OCR job can no longer be confirmed");
  }

  try {
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
  } catch (error) {
    // The privileged RPC has already committed every confirmation write.
    // Audit transport failure must not make the caller retry a completed job.
    console.error(
      `[ocr] audit log failed after atomic confirmation for job ${jobId}`,
      error,
    );
  }

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
}): Promise<LiveReportAccessRow> {
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
  return report;
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

type LiveReportAdvanceRow = {
  id: string;
  status?: string | null;
  system_duration?: number | null;
  systemDuration?: number | null;
  claimed_duration?: number | null;
  claimedDuration?: number | null;
  risk_flags?: string[] | null;
  riskFlags?: string[] | null;
};

async function loadLiveReportForOcrAdvance({
  client,
  liveReportId,
}: {
  client: OcrJobClient;
  liveReportId: string;
}): Promise<LiveReportAdvanceRow | null> {
  const { data, error } = await client
    .from("live_reports")
    .select("id, status, system_duration, claimed_duration, risk_flags")
    .eq("id", liveReportId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data as LiveReportAdvanceRow | null;
}

async function advanceLiveReportAfterOcr({
  client,
  metricClient,
  liveReportId,
  report,
  extractedDuration,
  extractedViewers,
  metricCandidates,
  sourceInvocationId,
  writeMetrics,
  needsConfirmation,
  reasons,
}: {
  client: OcrJobClient;
  metricClient: StreamerMetricSinkClient | null;
  liveReportId: string;
  report: LiveReportAdvanceRow | null;
  extractedDuration: number | null;
  extractedViewers: number | null;
  metricCandidates: readonly unknown[];
  sourceInvocationId?: string;
  writeMetrics: boolean;
  needsConfirmation: boolean;
  reasons: string[];
}): Promise<void> {
  if (!report) {
    return;
  }

  const currentStatus = report.status ?? undefined;
  if (!currentStatus) {
    return;
  }
  if (currentStatus !== "ocr_ing") {
    return;
  }

  if (writeMetrics) {
    if (!metricClient) {
      console.error(
        `[ocr] streamer metric sink unavailable for report ${liveReportId}`,
      );
    } else {
      try {
        await writeStreamerMetricsFromOcr({
          client: metricClient,
          sourceReportId: report.id,
          sourceInvocationId,
          metricCandidates,
        });
      } catch (error) {
        console.error(
          `[ocr] streamer metric sink failed for report ${liveReportId}`,
          error,
        );
      }
    }
  }

  const systemDuration =
    report.system_duration ?? report.systemDuration ?? null;
  const claimedDuration =
    report.claimed_duration ?? report.claimedDuration ?? null;
  const existingFlags = (report.risk_flags ?? report.riskFlags ?? []).filter(
    (flag) => flag !== "ocr_pending",
  );

  const patch: Record<string, unknown> = {
    status: "pending_review",
    screenshot_duration: extractedDuration,
    updated_at: new Date().toISOString(),
  };
  if (extractedViewers !== null) {
    patch.viewers = extractedViewers;
  }

  const riskFlags = new Set(existingFlags);

  // Recompute settlement evidence when we have at least one duration source.
  if (
    systemDuration !== null ||
    extractedDuration !== null ||
    claimedDuration !== null
  ) {
    const evidence = resolveReportEvidence({
      systemDuration,
      screenshotDuration: extractedDuration,
      claimedDuration,
    });
    patch.settlement_duration = evidence.settlementDuration;
    patch.time_source = evidence.timeSource;
    patch.evidence_level = evidence.evidenceLevel;
    patch.divergence_pct = evidence.divergencePct;
    for (const flag of evidence.riskFlags) {
      riskFlags.add(flag);
    }
  }

  if (needsConfirmation) {
    riskFlags.add("ocr_needs_review");
    for (const reason of reasons) {
      riskFlags.add(`ocr_${reason}`);
    }
  } else {
    // A trusted automatic result clears prior OCR review markers.
    for (const flag of [...riskFlags]) {
      if (flag === "ocr_needs_review" || flag.startsWith("ocr_")) {
        riskFlags.delete(flag);
      }
    }
  }

  patch.risk_flags = [...riskFlags];

  const { error: updateError } = await client
    .from("live_reports")
    .update(patch)
    .eq("id", liveReportId)
    .eq("status", currentStatus);
  if (updateError) {
    throw updateError;
  }
}

// Manual confirmation values are optional corrections. A zero (or negative)
// value means "not provided" — the confirm dialog defaults empty fields to 0 —
// so it must NOT override a genuine OCR-extracted measurement. Treating 0 as a
// real override let a blank confirmation wipe the extracted duration to 0,
// which then diverged 100% from the system duration and forced every report to
// yellow evidence (blocking automatic CPT settlement).
function pickPositiveIntegerField(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim() && Number(value) > 0) {
      return Math.floor(Number(value));
    }
  }
  return null;
}

function pickConfirmedMetricCandidates(
  manualResult: Record<string, unknown>,
): unknown[] {
  return Object.prototype.hasOwnProperty.call(
    manualResult,
    "metricCandidates",
  ) && Array.isArray(manualResult.metricCandidates)
    ? manualResult.metricCandidates
    : [];
}

function normalizeConfirmedOcrMetricCandidates(
  metricCandidates: readonly unknown[],
): Array<{ key: string; value: number }> {
  return normalizeOcrMetricCandidates(metricCandidates).filter(
    (metric) => metric.key !== "viewers",
  );
}

type OcrConfirmationClient = {
  rpc(
    name: "confirm_ocr_job_metrics",
    args: {
      p_job_id: string;
      p_reviewed_by: string;
      p_reviewed_at: string;
      p_manual_result: Record<string, unknown>;
      p_metrics: Array<{ key: string; value: number }>;
      p_confirmed_duration: number | null;
      p_confirmed_viewers: number | null;
    },
  ): PromiseLike<{
    data: Record<string, unknown> | null;
    error: Error | null;
  }>;
};

function isSuccessfulOcrConfirmation(
  value: Record<string, unknown> | null,
): boolean {
  return value?.confirmed === true;
}

async function cancelOcrJobForInactiveReport({
  client,
  job,
  attempt,
}: {
  client: OcrJobClient;
  job: OcrJobRecord;
  attempt: number;
}): Promise<OcrJobRecord> {
  const errorCode = "live_report_not_runnable";
  const errorMessage = "Live report is no longer in OCR processing";
  await updateOcrResult(client, job, {
    status: "cancelled",
    error_code: errorCode,
    error_message: errorMessage,
    needs_confirmation: false,
  });
  await updateOrThrow(client, "background_jobs", job.id, {
    status: "cancelled",
    attempt,
    next_run_at: null,
    locked_at: null,
    locked_by: null,
    error_code: errorCode,
    error_message: errorMessage,
    error_summary: errorMessage,
  });

  return {
    ...job,
    status: "cancelled",
    attempt,
    nextRunAt: undefined,
    lockedAt: undefined,
    lockedBy: undefined,
    errorCode,
    errorMessage,
  };
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
