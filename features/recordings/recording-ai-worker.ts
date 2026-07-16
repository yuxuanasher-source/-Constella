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
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "@/features/ai/provider-registry";

import {
  buildRecordingAiAnalysisDraft,
  executeClaimedRecordingAiAnalysis,
  type RecordingAiAnalysisStatus,
} from "./recording-ai-analysis";
import {
  createRecordingAiAnalysisPipeline,
  type RecordingAiDraftPipeline,
  type RecordingAiPipelineStage,
} from "./recording-ai-pipeline";

type RecordingAiWorkerStage = RecordingAiPipelineStage | "persisting";
type ProviderBreakerKey = "doubao_asr" | "deepseek" | "openai" | "hunyuan";

export type RecordingAiWorkerAnalysisSummary = {
  id: string;
  status: RecordingAiAnalysisStatus;
  attempt: number;
};

export type RecordingAiWorkerFailureSummary = {
  analysisId: string;
  errorCode: string;
  errorMessage: string;
};

export type RecordingAiWorkerIterationResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  analyses: RecordingAiWorkerAnalysisSummary[];
  failures: RecordingAiWorkerFailureSummary[];
};

export type RecordingAiWorkerClient = AsyncTaskRuntimeClient &
  Parameters<typeof createProviderCircuitBreakerRepository>[0] &
  Parameters<typeof createRecordingAiAnalysisPipeline>[0]["client"];

export async function runRecordingAiWorkerIteration(input: {
  client: RecordingAiWorkerClient;
  workerId: string;
  limit?: number;
  leaseSeconds: number;
  pipelineFactory?: typeof createRecordingAiAnalysisPipeline;
  now?: () => Date;
  onCurrentJobsChange?: (count: number) => void;
  onStage?: (stage: RecordingAiWorkerStage) => void;
}): Promise<RecordingAiWorkerIterationResult> {
  const now = input.now ?? (() => new Date());
  const runtimeConfig = parseAsyncWorkerRuntimeConfig(process.env);
  if (!isWorkloadEnabled(runtimeConfig, "recording")) {
    return emptyResult();
  }

  const breakerRepository = createProviderCircuitBreakerRepository(input.client);
  const requiredProviderKeys = getRequiredProviderBreakerKeys(process.env);
  const providerChecks = await Promise.all(
    requiredProviderKeys.map((providerKey) =>
      canCallProvider(
        { repository: breakerRepository },
        providerKey,
        input.workerId,
        now(),
      ),
    ),
  );
  if (providerChecks.some((decision) => !decision.allowed)) {
    return emptyResult();
  }

  const claimed = await claimPlatformRecordingAiAnalyses({
    client: input.client,
    workerId: input.workerId,
    limit: input.limit ?? 1,
    leaseSeconds: input.leaseSeconds,
    now: now(),
  });
  if (claimed.length === 0) {
    return emptyResult();
  }
  input.onCurrentJobsChange?.(claimed.length);

  try {
    const result = emptyResult();
    result.claimed = claimed.length;

    for (const analysis of claimed) {
      const one = await runOneClaimedAnalysis({
        client: input.client,
        workerId: input.workerId,
        leaseSeconds: input.leaseSeconds,
        analysis,
        pipelineFactory: input.pipelineFactory ?? createRecordingAiAnalysisPipeline,
        now,
        onStage: input.onStage,
      });
      if (one.outcome === "succeeded") {
        result.succeeded += 1;
        result.analyses.push(one.analysis);
        if (one.asrProvider === "doubao_asr") {
          await ignoreBreakerWriteFailure(
            recordProviderSuccess(
              { repository: breakerRepository },
              { providerKey: "doubao_asr", workerId: input.workerId, now: now() },
            ),
          );
        }
        const successProviderKey = normalizeLlmProviderKey(one.providerName);
        if (successProviderKey) {
          await ignoreBreakerWriteFailure(
            recordProviderSuccess(
              { repository: breakerRepository },
              {
                providerKey: successProviderKey,
                workerId: input.workerId,
                now: now(),
              },
            ),
          );
        }
        if (one.fallbackProviderKey) {
          await ignoreBreakerWriteFailure(
            recordProviderFailure(
              { repository: breakerRepository },
              {
                providerKey: one.fallbackProviderKey,
                workerId: input.workerId,
                errorCode: "provider_failed",
                retryable: true,
                now: now(),
              },
            ),
          );
        }
      } else if (one.outcome === "cancelled") {
        result.cancelled += 1;
        result.analyses.push(one.analysis);
      } else if (one.outcome === "retrying") {
        result.analyses.push(one.analysis);
        if (one.providerFailure) {
          await ignoreBreakerWriteFailure(
            recordProviderFailure(
              { repository: breakerRepository },
              {
                providerKey: one.providerKey,
                workerId: input.workerId,
                errorCode: one.errorCode,
                retryable: true,
                now: now(),
              },
            ),
          );
        }
      } else if (one.outcome === "terminal_failed") {
        result.analyses.push(one.analysis);
        if (one.providerFailure) {
          await ignoreBreakerWriteFailure(
            recordProviderFailure(
              { repository: breakerRepository },
              {
                providerKey: one.providerKey,
                workerId: input.workerId,
                errorCode: one.errorCode,
                retryable: one.providerRetryable,
                now: now(),
              },
            ),
          );
        }
      } else {
        result.failed += 1;
        result.failures.push(one.failure);
        if (one.providerFailure) {
          await ignoreBreakerWriteFailure(
            recordProviderFailure(
              { repository: breakerRepository },
              {
                providerKey: one.providerKey,
                workerId: input.workerId,
                errorCode: one.failure.errorCode,
                retryable: one.providerRetryable,
                now: now(),
              },
            ),
          );
        }
      }
    }

    return result;
  } finally {
    input.onCurrentJobsChange?.(0);
  }
}

async function runOneClaimedAnalysis({
  client,
  workerId,
  leaseSeconds,
  analysis,
  pipelineFactory,
  now,
  onStage,
}: {
  client: RecordingAiWorkerClient;
  workerId: string;
  leaseSeconds: number;
  analysis: RecordingAiClaimedRow;
  pipelineFactory: typeof createRecordingAiAnalysisPipeline;
  now: () => Date;
  onStage?: (stage: RecordingAiWorkerStage) => void;
}): Promise<
  | {
      outcome: "succeeded";
      analysis: RecordingAiWorkerAnalysisSummary;
      providerName: string | null;
      asrProvider: string | null;
      fallbackProviderKey: ProviderBreakerKey | null;
    }
  | { outcome: "cancelled"; analysis: RecordingAiWorkerAnalysisSummary }
  | {
      outcome: "retrying";
      analysis: RecordingAiWorkerAnalysisSummary;
      providerFailure: boolean;
      providerKey: ProviderBreakerKey;
      errorCode: string;
    }
  | {
      outcome: "terminal_failed";
      analysis: RecordingAiWorkerAnalysisSummary;
      providerFailure: boolean;
      providerRetryable: boolean;
      providerKey: ProviderBreakerKey;
      errorCode: string;
    }
  | {
      outcome: "failed";
      failure: RecordingAiWorkerFailureSummary;
      providerFailure: boolean;
      providerRetryable: boolean;
      providerKey: ProviderBreakerKey;
    }
> {
  const actor = createWorkerActor({
    organizationId: analysis.organization_id,
    workerId,
  });
  const controller = new AbortController();
  const renewLease = startLeaseRenewal({
    client,
    taskId: analysis.id,
    workerId,
    leaseSeconds,
    now,
  });
  let finalizationAttempted = false;

  try {
    const basePipeline =
      analysis.cancel_requested_at !== null
        ? null
        : pipelineFactory({ client, actor }) ?? null;
    const pipeline: RecordingAiDraftPipeline | null = basePipeline
      ? async (pipelineInput) => {
          const result = await basePipeline(pipelineInput);
          const cancelled = await isRecordingAiAnalysisCancelled(client, analysis.id);
          if (cancelled) {
            controller.abort();
            throw new DOMException(
              "Recording AI analysis was cancelled",
              "AbortError",
            );
          }
          return result;
        }
      : null;

    const dto = await executeClaimedRecordingAiAnalysis({
      client: client as never,
      actor,
      workItem: analysis as never,
      now,
      draftBuilder: buildRecordingAiAnalysisDraft,
      pipeline,
      signal: controller.signal,
      deferTerminalStatus: true,
      onStage: async (stage) => {
        if (stage !== "extracting_audio" && stage !== "persisting") {
          const cancelled = await isRecordingAiAnalysisCancelled(
            client,
            analysis.id,
          );
          if (cancelled) {
            controller.abort();
            throw new DOMException(
              "Recording AI analysis was cancelled",
              "AbortError",
            );
          }
        }
        await appendStageAndNotify(client, analysis, workerId, stage, onStage);
      },
      beforeFinalize: async ({ status, errorCode, metadata }) => {
        finalizationAttempted = true;
        await finalizeRecordingAiTask({
          client,
          analysis,
          workerId,
          status,
          errorCode,
          metadata,
          now,
        });
      },
    });

    const status = analysis.cancel_requested_at ? "cancelled" : dto.status;
    if (status === "succeeded") {
      return {
        outcome: "succeeded",
        analysis: { id: analysis.id, status, attempt: analysis.attempt },
        providerName: dto.providerName,
        asrProvider: dto.asrProvider,
        fallbackProviderKey: getFallbackProviderKey(dto.riskFlags),
      };
    }
    if (status === "cancelled") {
      return {
        outcome: "cancelled",
        analysis: { id: analysis.id, status, attempt: analysis.attempt },
      };
    }
    if (status === "queued") {
      return {
        outcome: "retrying",
        analysis: { id: analysis.id, status, attempt: analysis.attempt },
        providerFailure: true,
        providerKey: classifyProviderKey(dto.errorSummary),
        errorCode: "provider_failed",
      };
    }
    if (status === "failed") {
      return {
        outcome: "terminal_failed",
        analysis: { id: analysis.id, status, attempt: analysis.attempt },
        providerFailure: true,
        providerRetryable: false,
        providerKey: classifyProviderKey(dto.errorSummary),
        errorCode: "provider_failed",
      };
    }
    return {
      outcome: "failed",
      failure: {
        analysisId: analysis.id,
        errorCode: "provider_failed",
        errorMessage: dto.errorSummary ?? "Recording AI analysis failed",
      },
      providerFailure: true,
      providerRetryable: false,
      providerKey: classifyProviderKey(dto.errorSummary),
    };
  } catch (error) {
    if (finalizationAttempted) {
      return {
        outcome: "failed",
        failure: {
          analysisId: analysis.id,
          errorCode: "finalize_failed",
          errorMessage: sanitizeWorkerError(error),
        },
        providerFailure: false,
        providerRetryable: false,
        providerKey: "doubao_asr",
      };
    }
    try {
      await appendStageAndNotify(client, analysis, workerId, "persisting", onStage);
      await finalizeRecordingAiTask({
        client,
        analysis,
        workerId,
        status: "failed",
        errorCode: "worker_failed",
        metadata: { errorMessage: sanitizeWorkerError(error) },
        now,
      });
    } catch {
      // The finalizer owns terminal events. Do not synthesize a separate
      // terminal event when the atomic transition fails.
    }
    return {
      outcome: "failed",
      failure: {
        analysisId: analysis.id,
        errorCode: "worker_failed",
        errorMessage: sanitizeWorkerError(error),
      },
      providerFailure: false,
      providerRetryable: false,
      providerKey: "doubao_asr",
    };
  } finally {
    controller.abort();
    renewLease.stop();
  }
}

export type RecordingAiClaimedRow = {
  id: string;
  organization_id: string;
  asset_id: string;
  status: RecordingAiAnalysisStatus;
  provider_name: string | null;
  summary: string | null;
  scorecard: unknown;
  dimensions: unknown;
  risk_flags: unknown;
  recommendations: unknown;
  transcript_text?: string | null;
  transcript_utterances?: unknown;
  asr_provider?: string | null;
  attempt: number;
  max_attempts: number;
  stage?: string | null;
  claimed_by?: string | null;
  claimed_at?: string | null;
  lease_expires_at?: string | null;
  cancel_requested_at?: string | null;
  error_summary: string | null;
  ai_invocation_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  recording_ai_segments?: unknown[] | null;
  recording_assets?: unknown;
};

async function claimPlatformRecordingAiAnalyses({
  client,
  workerId,
  limit,
  leaseSeconds,
  now,
}: {
  client: RecordingAiWorkerClient;
  workerId: string;
  limit: number;
  leaseSeconds: number;
  now: Date;
}) {
  const { data, error } = await client.rpc("claim_async_recording_ai", {
    p_worker_id: workerId,
    p_limit: Math.max(1, Math.min(Math.trunc(limit), 10)),
    p_lease_seconds: leaseSeconds,
    p_per_org_limit: 1,
    p_now: now.toISOString(),
  });
  if (error) {
    throw error;
  }
  return Array.isArray(data) ? (data as RecordingAiClaimedRow[]) : [];
}

function startLeaseRenewal({
  client,
  taskId,
  workerId,
  leaseSeconds,
  now,
}: {
  client: RecordingAiWorkerClient;
  taskId: string;
  workerId: string;
  leaseSeconds: number;
  now: () => Date;
}) {
  const interval = setInterval(() => {
    void client.rpc("renew_async_task_lease", {
      p_task_type: "recording_ai",
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

async function appendStageAndNotify(
  client: AsyncTaskRuntimeClient,
  analysis: RecordingAiClaimedRow,
  workerId: string,
  stage: RecordingAiWorkerStage,
  onStage?: (stage: RecordingAiWorkerStage) => void,
) {
  onStage?.(stage);
  await appendTaskEvent(client, {
    organizationId: analysis.organization_id,
    taskType: "recording_ai",
    taskId: analysis.id,
    status: "running",
    stage,
    attempt: analysis.attempt,
    workerId,
  });
}

async function isRecordingAiAnalysisCancelled(
  client: RecordingAiWorkerClient,
  analysisId: string,
) {
  const table = client.from("recording_ai_analyses") as unknown as {
    select?: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle?: () => PromiseLike<{
          data: { cancel_requested_at?: string | null } | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
  const query = table.select?.("cancel_requested_at").eq("id", analysisId);
  if (!query?.maybeSingle) {
    return false;
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(error.message ?? "load recording cancellation failed");
  }
  return Boolean(data?.cancel_requested_at);
}

async function finalizeRecordingAiTask({
  client,
  analysis,
  workerId,
  status,
  errorCode,
  metadata,
  now,
}: {
  client: RecordingAiWorkerClient;
  analysis: RecordingAiClaimedRow;
  workerId: string;
  status: "succeeded" | "failed" | "cancelled";
  errorCode: string | null;
  metadata: Record<string, unknown>;
  now: () => Date;
}) {
  const { data, error } = await client.rpc("finalize_async_task", {
    p_task_type: "recording_ai",
    p_task_id: analysis.id,
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
    throw new Error("Recording AI finalizer did not return an event");
  }
}

function classifyProviderKey(errorSummary: string | null | undefined): ProviderBreakerKey {
  const lower = errorSummary?.toLowerCase() ?? "";
  if (lower.includes("openai")) {
    return "openai";
  }
  if (lower.includes("hunyuan") || lower.includes("混元")) {
    return "hunyuan";
  }
  return lower.includes("llm") || lower.includes("deepseek")
    ? "deepseek"
    : "doubao_asr";
}

function normalizeLlmProviderKey(providerName: string | null): ProviderBreakerKey | null {
  return providerName === "deepseek" ||
    providerName === "openai" ||
    providerName === "hunyuan"
    ? providerName
    : null;
}

function getFallbackProviderKey(riskFlags: string[]): ProviderBreakerKey | null {
  const fallbackFlag = riskFlags.find((flag) =>
    flag.includes("AI 转写分析不可用"),
  );
  return fallbackFlag ? classifyProviderKey(fallbackFlag) : null;
}

function getRequiredProviderBreakerKeys(
  env: Record<string, string | undefined>,
): ProviderBreakerKey[] {
  const keys = new Set<ProviderBreakerKey>(["doubao_asr"]);
  const configuredProviders = createConfiguredAiProviders({ env });
  for (const provider of configuredProviders) {
    const providerKey = normalizeLlmProviderKey(provider.name);
    if (providerKey) {
      keys.add(providerKey);
    }
  }
  const routing = resolveAiProviderRouting(env);
  const primaryProviderKey = normalizeLlmProviderKey(
    routing.primaryProvider ?? null,
  );
  const shadowProviderKey = normalizeLlmProviderKey(routing.shadowProvider ?? null);
  if (primaryProviderKey) {
    keys.add(primaryProviderKey);
  }
  if (shadowProviderKey) {
    keys.add(shadowProviderKey);
  }
  return [...keys];
}

function emptyResult(): RecordingAiWorkerIterationResult {
  return {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    analyses: [],
    failures: [],
  };
}

function sanitizeWorkerError(error: unknown) {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Recording AI worker failed";
  return message
    .replace(/[A-Za-z0-9_.-]+\/[^\s;]+/g, "[redacted]")
    .replace(/secret=([^\s;]+)/gi, "secret=[redacted]")
    .replace(/\n[\s\S]*/g, "")
    .slice(0, 200);
}

async function ignoreBreakerWriteFailure(promise: Promise<void>) {
  try {
    await promise;
  } catch (error) {
    console.error("Recording AI provider breaker update failed", error);
  }
}
