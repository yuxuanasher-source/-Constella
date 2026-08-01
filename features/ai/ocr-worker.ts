import { resolveOcrImageInput } from "@/features/ai/ocr-image-source";
import {
  claimPlatformOcrJobs,
  failClaimedOcrJobBeforeProvider,
  runClaimedOcrJob,
  type OcrJobRecord,
} from "@/features/ai/ocr-jobs";
import {
  createTencentOcrProvider,
  readTencentOcrConfigFromEnv,
  type TencentOcrInput,
  type TencentOcrProvider,
} from "@/features/ai/providers/tencent-ocr-provider";
import {
  canCallProvider,
  createProviderCircuitBreakerRepository,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/features/async-tasks/provider-circuit-breaker";
import {
  appendTaskEvent,
  type AsyncTaskRuntimeClient,
} from "@/features/async-tasks/repository";
import {
  isWorkloadEnabled,
  parseAsyncWorkerRuntimeConfig,
} from "@/features/async-tasks/runtime-config";
import { createWorkerActor } from "@/features/async-tasks/system-actor";
import { getPrivateStorageBucket } from "@/lib/config/env";

type OcrWorkerResult = { claimed: number; succeeded: number; failed: number };
type OcrWorkerJobSummary = {
  id: string;
  status: OcrJobRecord["status"];
  attempt: number;
};
type OcrWorkerFailureSummary = {
  jobId: string;
  errorCode: string;
  errorMessage: string;
};
type OcrWorkerIterationResult = OcrWorkerResult & {
  jobs: OcrWorkerJobSummary[];
  failures: OcrWorkerFailureSummary[];
};

export type OcrWorkerClient = AsyncTaskRuntimeClient &
  Parameters<typeof createProviderCircuitBreakerRepository>[0] &
  Parameters<typeof claimPlatformOcrJobs>[0]["client"];

export async function runOcrWorkerIteration(input: {
  client: OcrWorkerClient;
  workerId: string;
  limit: number;
  leaseSeconds: number;
  now?: () => Date;
  provider?: TencentOcrProvider;
  imageResolver?: (
    payload: OcrJobRecord["payload"],
  ) => Promise<TencentOcrInput>;
  onCurrentJobsChange?: (count: number) => void;
}): Promise<OcrWorkerIterationResult> {
  const now = input.now ?? (() => new Date());
  const runtimeConfig = parseAsyncWorkerRuntimeConfig(process.env);
  if (!isWorkloadEnabled(runtimeConfig, "ocr")) {
    return emptyResult();
  }

  const breakerRepository = createProviderCircuitBreakerRepository(
    input.client,
  );
  const breakerDecision = await canCallProvider(
    { repository: breakerRepository },
    "tencent_ocr",
    input.workerId,
    now(),
  );
  if (!breakerDecision.allowed) {
    return emptyResult();
  }

  const jobs = await claimPlatformOcrJobs({
    client: input.client,
    workerId: input.workerId,
    limit: input.limit,
    leaseSeconds: input.leaseSeconds,
    now: now(),
  });
  if (jobs.length === 0) {
    return emptyResult();
  }
  input.onCurrentJobsChange?.(jobs.length);

  try {
    let provider: TencentOcrProvider;
    try {
      provider =
        input.provider ??
        createTencentOcrProvider(readTencentOcrConfigFromEnv(process.env));
    } catch (error) {
      const completedJobs: OcrWorkerJobSummary[] = [];
      const failures: OcrWorkerFailureSummary[] = [];
      for (const job of jobs) {
        try {
          const result = await failClaimedOcrJobBeforeProvider({
            client: input.client,
            job,
            startedAt: now(),
            errorCode: "provider_unconfigured",
            errorSummary: sanitizeWorkerError(error),
            deferTerminalJobUpdate: true,
            beforePostTerminalFailureSideEffects: async (terminalJob) => {
              await finalizeOcrTask({
                client: input.client,
                job,
                workerId: input.workerId,
                status: "failed",
                errorCode: terminalJob.errorCode ?? "provider_unconfigured",
                metadata: { errorMessage: terminalJob.errorMessage },
                now,
              });
            },
          });
          completedJobs.push({
            id: result.id,
            status: result.status,
            attempt: result.attempt,
          });
        } catch (failure) {
          failures.push({
            jobId: job.id,
            errorCode: "provider_configuration_cleanup_failed",
            errorMessage: sanitizeWorkerError(failure),
          });
        }
      }
      return {
        claimed: jobs.length,
        succeeded: 0,
        failed: failures.length,
        jobs: completedJobs,
        failures,
      };
    }
    const imageResolver =
      input.imageResolver ??
      ((payload: OcrJobRecord["payload"]) =>
        resolveOcrImageInput({
          client: input.client as never,
          payload,
          defaultBucket: getPrivateStorageBucket(),
        }));

    let succeeded = 0;
    let failed = 0;
    const completedJobs: OcrWorkerJobSummary[] = [];
    const failures: OcrWorkerFailureSummary[] = [];
    for (const job of jobs) {
      const result = await runOneClaimedJob({
        client: input.client,
        workerId: input.workerId,
        leaseSeconds: input.leaseSeconds,
        job,
        provider,
        imageResolver,
        now,
      });
      if (result.outcome === "succeeded") {
        succeeded += 1;
        completedJobs.push(result.job);
        await ignoreBreakerWriteFailure(
          recordProviderSuccess(
            { repository: breakerRepository },
            {
              providerKey: "tencent_ocr",
              workerId: input.workerId,
              now: now(),
            },
          ),
        );
      } else if (result.outcome === "retrying") {
        completedJobs.push(result.job);
        if (result.providerFailure) {
          await ignoreBreakerWriteFailure(
            recordProviderFailure(
              { repository: breakerRepository },
              {
                providerKey: "tencent_ocr",
                workerId: input.workerId,
                errorCode: result.errorCode,
                retryable: true,
                now: now(),
              },
            ),
          );
        }
      } else if (result.outcome === "terminal_failed") {
        completedJobs.push(result.job);
        if (result.providerFailure) {
          await ignoreBreakerWriteFailure(
            recordProviderFailure(
              { repository: breakerRepository },
              {
                providerKey: "tencent_ocr",
                workerId: input.workerId,
                errorCode: result.errorCode,
                retryable: result.providerRetryable,
                now: now(),
              },
            ),
          );
        }
      } else {
        failed += 1;
        failures.push(result.failure);
        if (result.providerFailure) {
          await ignoreBreakerWriteFailure(
            recordProviderFailure(
              { repository: breakerRepository },
              {
                providerKey: "tencent_ocr",
                workerId: input.workerId,
                errorCode: result.failure.errorCode,
                retryable: result.providerRetryable,
                now: now(),
              },
            ),
          );
        }
      }
    }

    return {
      claimed: jobs.length,
      succeeded,
      failed,
      jobs: completedJobs,
      failures,
    };
  } finally {
    input.onCurrentJobsChange?.(0);
  }
}

async function runOneClaimedJob({
  client,
  workerId,
  leaseSeconds,
  job,
  provider,
  imageResolver,
  now,
}: {
  client: OcrWorkerClient;
  workerId: string;
  leaseSeconds: number;
  job: OcrJobRecord;
  provider: TencentOcrProvider;
  imageResolver: (payload: OcrJobRecord["payload"]) => Promise<TencentOcrInput>;
  now: () => Date;
}): Promise<
  | { outcome: "succeeded"; job: OcrWorkerJobSummary }
  | {
      outcome: "retrying";
      job: OcrWorkerJobSummary;
      errorCode: string;
      providerFailure: boolean;
    }
  | {
      outcome: "terminal_failed";
      job: OcrWorkerJobSummary;
      errorCode: string;
      providerFailure: boolean;
      providerRetryable: boolean;
    }
  | {
      outcome: "failed";
      failure: OcrWorkerFailureSummary;
      providerFailure: boolean;
      providerRetryable: boolean;
    }
> {
  const actor = createWorkerActor({
    organizationId: job.organizationId,
    workerId,
  });
  let persistingStageAppended = false;
  let finalizationAttempted = false;
  const renewLease = startLeaseRenewal({
    client,
    taskId: job.id,
    workerId,
    leaseSeconds,
    now,
  });

  try {
    await appendStage(client, job, workerId, "resolving_image");
    let terminalFinalized = false;
    const result = await runClaimedOcrJob({
      client,
      actor,
      job,
      provider,
      metricClient: client as never,
      startedAt: now(),
      imageResolver,
      deferTerminalJobUpdate: true,
      beforeProvider: () => appendStage(client, job, workerId, "recognizing"),
      beforePostTerminalSideEffects: async (terminalJob) => {
        const terminal = terminalStatus(terminalJob.status);
        if (!terminal) {
          return;
        }
        await appendPersistingStage();
        finalizationAttempted = true;
        await finalizeOcrTask({
          client,
          job,
          workerId,
          status: terminal,
          errorCode: terminalJob.errorCode ?? null,
          metadata: { result: terminalJob.result ?? {} },
          now,
        });
        terminalFinalized = true;
      },
      beforePostTerminalFailureSideEffects: async (terminalJob) => {
        const terminal = terminalStatus(terminalJob.status);
        if (!terminal) {
          return;
        }
        await appendPersistingStage();
        finalizationAttempted = true;
        await finalizeOcrTask({
          client,
          job,
          workerId,
          status: terminal,
          errorCode: terminalJob.errorCode ?? null,
          metadata: { result: terminalJob.result ?? {} },
          now,
        });
        terminalFinalized = true;
      },
    });
    const terminal = terminalStatus(result.status);
    if (terminal && !terminalFinalized) {
      await appendPersistingStage();
      finalizationAttempted = true;
      await finalizeOcrTask({
        client,
        job,
        workerId,
        status: terminal,
        errorCode: result.errorCode ?? null,
        metadata: { result: result.result ?? {} },
        now,
      });
    }
    if (
      result.status === "succeeded" ||
      result.status === "needs_confirmation"
    ) {
      return {
        outcome: "succeeded",
        job: { id: result.id, status: result.status, attempt: result.attempt },
      };
    }
    if (result.status === "queued") {
      return {
        outcome: "retrying",
        job: { id: result.id, status: result.status, attempt: result.attempt },
        errorCode: result.errorCode ?? "ocr_retrying",
        providerFailure: isProviderFailureCode(result.errorCode),
      };
    }
    if (result.status === "failed") {
      return {
        outcome: "terminal_failed",
        job: { id: result.id, status: result.status, attempt: result.attempt },
        errorCode: result.errorCode ?? "ocr_failed",
        providerFailure: isProviderFailureCode(result.errorCode),
        providerRetryable: false,
      };
    }
    return {
      outcome: "failed",
      failure: {
        jobId: job.id,
        errorCode: result.errorCode ?? "ocr_failed",
        errorMessage: result.errorMessage ?? "OCR job failed",
      },
      providerFailure: isProviderFailureCode(result.errorCode),
      providerRetryable: result.errorCode === "provider_failed",
    };
  } catch (error) {
    if (finalizationAttempted) {
      return {
        outcome: "failed",
        failure: {
          jobId: job.id,
          errorCode: "finalize_failed",
          errorMessage: sanitizeWorkerError(error),
        },
        providerFailure: false,
        providerRetryable: false,
      };
    }
    await appendPersistingStage();
    try {
      await finalizeOcrTask({
        client,
        job,
        workerId,
        status: "failed",
        errorCode: "provider_failed",
        metadata: { errorMessage: sanitizeWorkerError(error) },
        now,
      });
    } catch {
      // The finalizer owns terminal events. Do not synthesize a separate
      // terminal event if the atomic transition fails.
    }
    return {
      outcome: "failed",
      failure: {
        jobId: job.id,
        errorCode: "worker_failed",
        errorMessage: sanitizeWorkerError(error),
      },
      providerFailure: false,
      providerRetryable: false,
    };
  } finally {
    renewLease.stop();
  }

  async function appendPersistingStage() {
    if (!persistingStageAppended) {
      await appendStage(client, job, workerId, "persisting");
      persistingStageAppended = true;
    }
  }
}

function startLeaseRenewal({
  client,
  taskId,
  workerId,
  leaseSeconds,
  now,
}: {
  client: OcrWorkerClient;
  taskId: string;
  workerId: string;
  leaseSeconds: number;
  now: () => Date;
}) {
  const interval = setInterval(() => {
    void client.rpc("renew_async_task_lease", {
      p_task_type: "ocr",
      p_task_id: taskId,
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
      p_now: now().toISOString(),
    });
  }, 30_000);

  return {
    stop() {
      clearInterval(interval);
    },
  };
}

async function appendStage(
  client: AsyncTaskRuntimeClient,
  job: OcrJobRecord,
  workerId: string,
  stage: "resolving_image" | "recognizing" | "persisting",
) {
  await appendTaskEvent(client, {
    organizationId: job.organizationId,
    taskType: "ocr",
    taskId: job.id,
    status: "running",
    stage,
    attempt: job.attempt,
    workerId,
  });
}

async function finalizeOcrTask({
  client,
  job,
  workerId,
  status,
  errorCode,
  metadata,
  now,
}: {
  client: OcrWorkerClient;
  job: OcrJobRecord;
  workerId: string;
  status: "succeeded" | "failed" | "needs_confirmation";
  errorCode: string | null;
  metadata: Record<string, unknown>;
  now: () => Date;
}) {
  const { data, error } = await client.rpc("finalize_async_task", {
    p_task_type: "ocr",
    p_task_id: job.id,
    p_worker_id: workerId,
    p_status: status,
    p_error_code: errorCode,
    p_metadata: metadata,
    p_now: now().toISOString(),
  });
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("OCR finalizer did not return an event");
  }
}

function terminalStatus(
  status: OcrJobRecord["status"],
): "succeeded" | "failed" | "needs_confirmation" | null {
  if (status === "succeeded") return "succeeded";
  if (status === "needs_confirmation" || status === "needs_review") {
    return "needs_confirmation";
  }
  if (status === "failed") return "failed";
  return null;
}

function emptyResult(): OcrWorkerIterationResult {
  return { claimed: 0, succeeded: 0, failed: 0, jobs: [], failures: [] };
}

function isProviderFailureCode(errorCode: string | undefined) {
  return (
    errorCode === "provider_failed" || errorCode === "provider_unconfigured"
  );
}

function sanitizeWorkerError(error: unknown) {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "OCR worker failed";
  return message
    .replace(/[A-Za-z0-9_.-]+\/[^\s;]+/g, "[redacted]")
    .replace(/\s+with\s+secret[^\s;]*/gi, "")
    .replace(/secret[^\s;]*/gi, "[redacted]")
    .replace(/\n[\s\S]*/g, "")
    .slice(0, 160);
}

async function ignoreBreakerWriteFailure(promise: Promise<void>) {
  try {
    await promise;
  } catch (error) {
    console.error("OCR provider breaker update failed", error);
  }
}
