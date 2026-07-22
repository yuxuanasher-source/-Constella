import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeHermesSkillGrantsHash } from "@/features/ai/hermes/actor-fingerprint";
import {
  isHermesActorProfile,
  isHermesReadScope,
  isSha256,
  isUuid,
  type HermesActorProfile,
} from "@/features/ai/hermes/contracts";
import {
  createHermesStateRepository,
  type HermesStateRepositoryClient,
} from "@/features/ai/hermes/hermes-state-repository";
import {
  authorizeLiveHermesActor,
  type HermesLiveActorAuthorizationClient,
} from "@/features/ai/hermes/live-actor-authorization";
import {
  authorizeAndExecuteHermesReadTool,
  type HermesReadDbClient,
} from "@/features/ai/hermes/read-api";
import {
  executeHermesToolBrokerCall,
  createHermesApprovedSkillArtifactLoader,
  HermesToolBrokerError,
  type HermesBrokerCapability,
  type HermesToolBrokerErrorCode,
} from "@/features/ai/hermes/tool-broker";
import {
  hermesSkillSigningPublicKeysToRecord,
  getHermesSkillSigningPublicKeysFromPublicEnv,
} from "@/features/ai/hermes/skill-signing";
import type { HermesSkillDraftRegistryClient } from "@/features/ai/hermes/approved-skill-registry";
import {
  parseHermesToolBrokerRequest,
  type HermesToolBrokerEnvelope,
  type HermesToolBrokerRequest,
} from "@/features/ai/hermes/tool-broker-contracts";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ACTIVE_TURN_STATUSES = [
  "accepted",
  "grounding",
  "generating",
  "validating",
] as const;
const ACTIVE_INVOCATION_STATUSES = ["started", "queued"] as const;

type ExecuteService = (input: {
  capabilityToken: string;
  request: HermesToolBrokerRequest;
}) => Promise<HermesToolBrokerEnvelope>;

export function createHermesToolExecuteHandler({
  execute,
}: {
  execute: ExecuteService;
}) {
  return async function handleHermesToolExecute(
    request: Request,
  ): Promise<Response> {
    const capabilityToken = bearerCapability(request);
    if (!capabilityToken) {
      return json({ error: { code: "unauthorized" } }, 401);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (
      contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    ) {
      return json({ error: { code: "unsupported_media_type" } }, 415);
    }

    const body = await request.json().catch(() => null);
    const parsed = parseHermesToolBrokerRequest(body);
    if (!parsed) {
      return json({ error: { code: "invalid_request" } }, 400);
    }

    try {
      return json(await execute({ capabilityToken, request: parsed }), 200);
    } catch (error) {
      if (error instanceof HermesToolBrokerError) {
        return json(
          { error: { code: error.code } },
          statusForBrokerError(error.code),
        );
      }
      return json({ error: { code: "internal_error" } }, 500);
    }
  };
}

const defaultHandler = createHermesToolExecuteHandler({
  execute: executeWithProductPersistence,
});

export async function POST(request: Request): Promise<Response> {
  return defaultHandler(request);
}

async function executeWithProductPersistence(input: {
  capabilityToken: string;
  request: HermesToolBrokerRequest;
}): Promise<HermesToolBrokerEnvelope> {
  const client = createSupabaseAdminClient();
  if (!client) throw new HermesToolBrokerError("persistence_unavailable");

  return executeHermesToolBrokerCall({
    ...input,
    dependencies: {
      repository: createHermesStateRepository(
        client as unknown as HermesStateRepositoryClient,
      ),
      loadCapability: (loadInput) => loadBrokerCapability(client, loadInput),
      reauthorizeActor: (authorizationInput) =>
        authorizeLiveHermesActor({
          client: client as unknown as HermesLiveActorAuthorizationClient,
          ...authorizationInput,
        }),
      executeRead: async ({ actor, toolName, arguments: toolArguments }) => {
        const result = await authorizeAndExecuteHermesReadTool(
          client as unknown as HermesReadDbClient,
          actor,
          toolName,
          toolArguments,
        );
        return result.envelope;
      },
      loadApprovedSkillArtifact: createHermesApprovedSkillArtifactLoader({
        client: client as unknown as HermesSkillDraftRegistryClient,
        publicKeys: hermesSkillSigningPublicKeysToRecord(
          getHermesSkillSigningPublicKeysFromPublicEnv(),
        ),
      }),
    },
  });
}

async function loadBrokerCapability(
  client: SupabaseClient,
  { tokenSha256, now }: { tokenSha256: string; now: Date },
): Promise<HermesBrokerCapability | null> {
  const capabilityResult = await client
    .from("ai_hermes_run_capabilities")
    .select(
      "organization_id, owner_user_id, conversation_id, turn_id, invocation_id, parent_invocation_id, root_invocation_id, actor_fingerprint, allowed_tools, scopes, depth, ai_state_writes_allowed, memory_snapshot_generation, expires_at",
    )
    .eq("token_sha256", tokenSha256)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (capabilityResult.error) {
    throw new HermesToolBrokerError("persistence_unavailable");
  }
  if (!isRecord(capabilityResult.data)) return null;
  const capability = capabilityResult.data;

  const organizationId = stringValue(capability.organization_id);
  const userId = stringValue(capability.owner_user_id);
  const conversationId = stringValue(capability.conversation_id);
  const turnId = stringValue(capability.turn_id);
  const invocationId = stringValue(capability.invocation_id);
  const parentInvocationId = nullableStringValue(
    capability.parent_invocation_id,
  );
  const rootInvocationId = stringValue(capability.root_invocation_id);
  const allowedTools = stringArray(capability.allowed_tools);
  const scopes = scopeArray(capability.scopes);
  const depth = boundedDepth(capability.depth);
  const aiStateWritesAllowed = capability.ai_state_writes_allowed;
  const memorySnapshotGeneration = nonNegativeIntegerValue(
    capability.memory_snapshot_generation,
  );
  if (
    !isUuid(organizationId) ||
    !isUuid(userId) ||
    !isUuid(conversationId) ||
    !isUuid(turnId) ||
    !isUuid(invocationId) ||
    !isUuid(rootInvocationId) ||
    depth === null ||
    typeof aiStateWritesAllowed !== "boolean" ||
    memorySnapshotGeneration === null ||
    (depth === 0 &&
      (parentInvocationId !== null || rootInvocationId !== invocationId)) ||
    (depth > 0 && (!isUuid(parentInvocationId) || aiStateWritesAllowed)) ||
    !isSha256(capability.actor_fingerprint) ||
    !allowedTools ||
    !scopes
  ) {
    return null;
  }

  const turnResult = await client
    .from("ai_chat_turns")
    .select("context_snapshot, ai_invocation_id, memory_snapshot_generation")
    .eq("id", turnId)
    .eq("organization_id", organizationId)
    .eq("owner_user_id", userId)
    .eq("conversation_id", conversationId)
    .in("status", [...ACTIVE_TURN_STATUSES])
    .is("cancel_requested_at", null)
    .gt("lease_expires_at", now.toISOString())
    .maybeSingle();
  if (turnResult.error) {
    throw new HermesToolBrokerError("persistence_unavailable");
  }
  if (
    !isRecord(turnResult.data) ||
    turnResult.data.ai_invocation_id !== rootInvocationId ||
    turnResult.data.memory_snapshot_generation !== memorySnapshotGeneration
  ) {
    return null;
  }

  const invocationResult = await client
    .from("ai_invocations")
    .select("metadata")
    .eq("id", invocationId)
    .eq("organization_id", organizationId)
    .eq("actor_user_id", userId)
    .in("status", [...ACTIVE_INVOCATION_STATUSES])
    .maybeSingle();
  if (invocationResult.error) {
    throw new HermesToolBrokerError("persistence_unavailable");
  }
  if (!isRecord(invocationResult.data)) return null;

  const actor = actorSnapshotFromRecords(
    turnResult.data.context_snapshot,
    invocationResult.data.metadata,
    invocationId,
  );
  if (
    !actor ||
    actor.organizationId !== organizationId ||
    actor.userId !== userId ||
    actor.conversationId !== conversationId ||
    actor.skillGrantsHash !==
      computeHermesSkillGrantsHash(actor.enabledSkillVersions)
  ) {
    return null;
  }

  return {
    actor,
    actorFingerprint: capability.actor_fingerprint,
    turnId,
    invocationId,
    rootInvocationId,
    allowedTools,
    scopes,
    depth,
    aiStateWritesAllowed,
    memorySnapshotGeneration,
  };
}

function actorSnapshotFromRecords(
  contextSnapshot: unknown,
  invocationMetadata: unknown,
  invocationId: string,
): HermesActorProfile | null {
  const context = isRecord(contextSnapshot) ? contextSnapshot : null;
  const gatewayContext =
    context && isRecord(context.gatewayContext) ? context.gatewayContext : null;
  const gatewayMetadata =
    gatewayContext && isRecord(gatewayContext.invocationMetadata)
      ? gatewayContext.invocationMetadata
      : null;
  const metadata = isRecord(invocationMetadata) ? invocationMetadata : null;
  const candidates = [
    context?.hermesActor,
    context?.actor,
    gatewayContext?.actor,
    gatewayMetadata?.hermesActor,
    gatewayMetadata?.actor,
    metadata?.hermesActor,
    metadata?.actor,
  ];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const actor = {
      userId: candidate.userId,
      organizationId: candidate.organizationId,
      role: candidate.role,
      conversationId: candidate.conversationId,
      invocationId,
      allowedReadScopes: candidate.allowedReadScopes,
      enabledSkillVersions: candidate.enabledSkillVersions,
      skillGrantsHash: candidate.skillGrantsHash,
      profileVersion: candidate.profileVersion,
      pageContext: candidate.pageContext,
    };
    if (isHermesActorProfile(actor)) return actor;
  }
  return null;
}

function bearerCapability(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match && CAPABILITY_PATTERN.test(match[1]) ? match[1] : null;
}

function statusForBrokerError(code: HermesToolBrokerErrorCode): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "permission_denied":
      return 403;
    case "idempotency_conflict":
    case "lease_unavailable":
      return 409;
    case "persistence_unavailable":
      return 503;
    case "internal_error":
      return 500;
  }
}

function json(body: unknown, status: number): Response {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableStringValue(value: unknown): string | null {
  return value === null ? null : stringValue(value);
}

function nonNegativeIntegerValue(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function boundedDepth(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2
    ? Number(value)
    : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0)
    ? [...value]
    : null;
}

function scopeArray(value: unknown): HermesBrokerCapability["scopes"] | null {
  return Array.isArray(value) && value.every(isHermesReadScope)
    ? [...value]
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
