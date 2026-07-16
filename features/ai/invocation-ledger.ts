import { randomUUID } from "node:crypto";

import { writeAuditLog } from "@/lib/audit/audit";
import { recordUsageEvent } from "@/features/billing/usage-metering";

import type {
  AiExecutionActor,
  AiInvocationStatus,
  AiProviderName,
  AiUsage,
} from "./contracts";

type AiInvocationLedgerClient = {
  from(table: "ai_invocations" | "usage_events" | "audit_logs"): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
  };
};

export type RecordAiInvocationInput = {
  id?: string;
  scene: string;
  objectType?: string;
  objectId?: string;
  providerName?: AiProviderName | "tencent_ocr" | "doubao_asr";
  primaryProvider?: AiProviderName;
  shadowProvider?: AiProviderName;
  providerRoute?: Record<string, unknown>;
  status: AiInvocationStatus;
  promptKey?: string;
  promptVersion?: number;
  promptHash?: string;
  usage?: AiUsage;
  costCents?: number;
  latencyMs?: number;
  degradedReason?: string;
  errorSummary?: string;
  rawResponse?: unknown;
  metadata?: Record<string, unknown>;
};

export function createAiInvocationId(): string {
  return randomUUID();
}

export async function recordAiInvocation({
  client,
  actor,
  input,
}: {
  client: AiInvocationLedgerClient;
  actor: AiExecutionActor;
  input: RecordAiInvocationInput;
}): Promise<string> {
  const invocationId = input.id ?? createAiInvocationId();
  const usage = normalizeUsage(input.usage);
  const costCents = nonnegativeInt(input.costCents ?? 0);
  const latencyMs =
    input.latencyMs === undefined ? undefined : nonnegativeInt(input.latencyMs);
  const metadata = mergeExecutionMetadata(actor, input.metadata);
  const actorUserId = actor.actorKind === "system" ? null : actor.userId;
  const auditActorUserId =
    actor.actorKind === "system" ? undefined : actor.userId;

  const { error } = await client.from("ai_invocations").insert({
    id: invocationId,
    organization_id: actor.organizationId,
    actor_user_id: actorUserId,
    actor_name: actor.name,
    actor_role: actor.role,
    scene: input.scene,
    object_type: input.objectType,
    object_id: input.objectId,
    provider_name: input.providerName,
    primary_provider: input.primaryProvider,
    shadow_provider: input.shadowProvider,
    provider_route: input.providerRoute ?? {},
    status: input.status,
    prompt_key: input.promptKey,
    prompt_version: input.promptVersion,
    prompt_hash: input.promptHash,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    cost_cents: costCents,
    latency_ms: latencyMs,
    degraded_reason: input.degradedReason,
    error_summary: input.errorSummary,
    raw_response: input.rawResponse ?? {},
    metadata,
    completed_at: ["succeeded", "failed", "degraded"].includes(input.status)
      ? new Date().toISOString()
      : undefined,
  });

  if (error) {
    throw error;
  }

  if (usage.totalTokens > 0) {
    await recordUsageEvent({
      client: client as Parameters<typeof recordUsageEvent>[0]["client"],
      actor,
      input: {
        metric: "ai",
        quantity: usage.totalTokens,
        source: "ai_runtime",
        objectType: "ai_invocation",
        objectId: invocationId,
        metadata: {
          scene: input.scene,
          providerName: input.providerName,
          costCents,
        },
      },
    });
  }

  await writeAuditLog(client as Parameters<typeof writeAuditLog>[0], {
    organizationId: actor.organizationId,
    actorUserId: auditActorUserId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "ai",
    objectType: "ai_invocation",
    objectId: invocationId,
    after: {
      scene: input.scene,
      status: input.status,
      providerName: input.providerName,
      totalTokens: usage.totalTokens,
      costCents,
    },
    changedFields: ["scene", "status"],
    result: input.status === "failed" ? "failure" : "success",
    errorMessage: input.errorSummary,
  });

  return invocationId;
}

function mergeExecutionMetadata(
  actor: AiExecutionActor,
  metadata?: Record<string, unknown>,
): Record<string, unknown> {
  if (actor.actorKind !== "system") {
    return metadata ?? {};
  }
  return { ...(metadata ?? {}), workerId: actor.workerId };
}

function normalizeUsage(usage?: AiUsage): AiUsage {
  const promptTokens = nonnegativeInt(usage?.promptTokens ?? 0);
  const completionTokens = nonnegativeInt(usage?.completionTokens ?? 0);
  const totalTokens =
    usage?.totalTokens === undefined
      ? promptTokens + completionTokens
      : nonnegativeInt(usage.totalTokens);

  return { promptTokens, completionTokens, totalTokens };
}

function nonnegativeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
