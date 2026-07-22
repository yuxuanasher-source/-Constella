import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deriveHermesChildRunCapability,
  HermesRunCapabilityError,
  parseHermesCapabilityDerivationRequest,
  revealHermesCapabilityToken,
  type HermesCapabilityDerivationDependencies,
  type HermesCapabilityDerivationRequest,
  type HermesParentRunCapability,
} from "@/features/ai/hermes/run-capability";
import {
  authorizeLiveHermesActor,
  type HermesLiveActorAuthorizationClient,
} from "@/features/ai/hermes/live-actor-authorization";
import {
  createHermesStateRepository,
  type HermesStateRepositoryClient,
} from "@/features/ai/hermes/hermes-state-repository";
import {
  isHermesActorProfile,
  isHermesMode,
  isHermesReadScope,
  isSha256,
  isUuid,
  type HermesActorProfile,
} from "@/features/ai/hermes/contracts";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ACTIVE_TURN_STATUSES = [
  "accepted",
  "grounding",
  "generating",
  "validating",
] as const;
const ACTIVE_INVOCATION_STATUSES = ["started", "queued"] as const;

export type HermesCapabilityDeriveTransport = {
  childInvocationId: string;
  invocationCapability: string;
  expiresAt: string;
};

type DeriveService = (input: {
  parentCapabilityToken: string;
  request: HermesCapabilityDerivationRequest;
}) => Promise<HermesCapabilityDeriveTransport>;

export function createHermesCapabilityDeriveHandler({
  derive,
}: {
  derive: DeriveService;
}) {
  return async function handleHermesCapabilityDerive(
    request: Request,
  ): Promise<Response> {
    const parentCapabilityToken = bearerCapability(request);
    if (!parentCapabilityToken) {
      return json({ error: { code: "unauthorized" } }, 401);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (
      contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    ) {
      return json({ error: { code: "unsupported_media_type" } }, 415);
    }

    const body = await request.json().catch(() => null);
    const parsed = parseHermesCapabilityDerivationRequest(body);
    if (!parsed) {
      return json({ error: { code: "invalid_request" } }, 400);
    }

    try {
      const result = await derive({ parentCapabilityToken, request: parsed });
      if (
        !isUuid(result.childInvocationId) ||
        !CAPABILITY_PATTERN.test(result.invocationCapability) ||
        !isFutureTimestamp(result.expiresAt)
      ) {
        return json({ error: { code: "internal_error" } }, 500);
      }
      return json(result, 200);
    } catch (error) {
      if (error instanceof HermesRunCapabilityError) {
        return json(
          { error: { code: error.code } },
          statusForCapabilityError(error.code),
        );
      }
      return json({ error: { code: "internal_error" } }, 500);
    }
  };
}

const defaultHandler = createHermesCapabilityDeriveHandler({
  derive: deriveWithProductPersistence,
});

export async function POST(request: Request): Promise<Response> {
  return defaultHandler(request);
}

async function deriveWithProductPersistence(input: {
  parentCapabilityToken: string;
  request: HermesCapabilityDerivationRequest;
}): Promise<HermesCapabilityDeriveTransport> {
  const client = createSupabaseAdminClient();
  if (!client) {
    throw new HermesRunCapabilityError("persistence_failed");
  }

  const issued = await deriveHermesChildRunCapability({
    ...input,
    dependencies: capabilityDependencies(client),
  });
  return {
    childInvocationId: issued.childInvocationId,
    invocationCapability: revealHermesCapabilityToken(issued.capability),
    expiresAt: issued.expiresAt,
  };
}

function capabilityDependencies(
  client: SupabaseClient,
): HermesCapabilityDerivationDependencies {
  return {
    repository: createHermesStateRepository(
      client as unknown as HermesStateRepositoryClient,
    ),
    loadParentCapability: (input) => loadParentCapability(client, input),
    countActiveChildren: (input) => countActiveChildren(client, input),
    createChildInvocation: (input) => createChildInvocation(client, input),
    markChildInvocationFailed: (input) =>
      markChildInvocationFailed(client, input),
    reauthorizeActor: (input) =>
      authorizeLiveHermesActor({
        client: client as unknown as HermesLiveActorAuthorizationClient,
        ...input,
      }),
  };
}

async function loadParentCapability(
  client: SupabaseClient,
  { tokenSha256, now }: { tokenSha256: string; now: Date },
): Promise<HermesParentRunCapability | null> {
  const capabilityResult = await client
    .from("ai_hermes_run_capabilities")
    .select(
      "organization_id, owner_user_id, conversation_id, turn_id, invocation_id, root_invocation_id, actor_fingerprint, allowed_tools, scopes, skill_draft_ids, depth, expires_at",
    )
    .eq("token_sha256", tokenSha256)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (capabilityResult.error) {
    throw new HermesRunCapabilityError("persistence_failed");
  }
  if (!isRecord(capabilityResult.data)) return null;
  const capability = capabilityResult.data;

  const organizationId = stringValue(capability.organization_id);
  const userId = stringValue(capability.owner_user_id);
  const conversationId = stringValue(capability.conversation_id);
  const turnId = stringValue(capability.turn_id);
  const invocationId = stringValue(capability.invocation_id);
  const rootInvocationId = stringValue(capability.root_invocation_id);
  if (
    !isUuid(organizationId) ||
    !isUuid(userId) ||
    !isUuid(conversationId) ||
    !isUuid(turnId) ||
    !isUuid(invocationId) ||
    !isUuid(rootInvocationId) ||
    !isSha256(capability.actor_fingerprint)
  ) {
    return null;
  }

  const turnResult = await client
    .from("ai_chat_turns")
    .select(
      "mode, status, lease_expires_at, context_snapshot, ai_invocation_id",
    )
    .eq("id", turnId)
    .eq("organization_id", organizationId)
    .eq("owner_user_id", userId)
    .eq("conversation_id", conversationId)
    .in("status", [...ACTIVE_TURN_STATUSES])
    .is("cancel_requested_at", null)
    .gt("lease_expires_at", now.toISOString())
    .maybeSingle();
  if (turnResult.error) {
    throw new HermesRunCapabilityError("persistence_failed");
  }
  if (!isRecord(turnResult.data)) return null;

  const invocationResult = await client
    .from("ai_invocations")
    .select("metadata")
    .eq("id", invocationId)
    .eq("organization_id", organizationId)
    .eq("actor_user_id", userId)
    .in("status", [...ACTIVE_INVOCATION_STATUSES])
    .maybeSingle();
  if (invocationResult.error) {
    throw new HermesRunCapabilityError("persistence_failed");
  }
  if (!isRecord(invocationResult.data)) return null;

  const actor = actorSnapshotFromRecords(
    turnResult.data.context_snapshot,
    invocationResult.data.metadata,
    invocationId,
  );
  const allowedTools = stringArray(capability.allowed_tools);
  const scopes = scopeArray(capability.scopes);
  const skillDraftIds = uuidArray(capability.skill_draft_ids);
  const expiresAt = stringValue(capability.expires_at);
  const mode = turnResult.data.mode;
  const depth = capability.depth;
  if (
    !actor ||
    !allowedTools ||
    !scopes ||
    !skillDraftIds ||
    !isHermesMode(mode) ||
    !Number.isInteger(depth) ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    turnResult.data.ai_invocation_id !== rootInvocationId
  ) {
    return null;
  }

  return {
    actor,
    actorFingerprint: capability.actor_fingerprint,
    mode,
    turnId,
    invocationId,
    rootInvocationId,
    allowedTools,
    scopes,
    skillDraftIds,
    depth,
    expiresAt,
  };
}

async function countActiveChildren(
  client: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    turnId: string;
    rootInvocationId: string;
    now: Date;
  },
): Promise<number> {
  const result = await client
    .from("ai_hermes_run_capabilities")
    .select(
      "id, child_invocation:ai_invocations!ai_hermes_run_capabilities_invocation_id_fkey!inner(id)",
      { count: "exact", head: true },
    )
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.userId)
    .eq("turn_id", input.turnId)
    .eq("root_invocation_id", input.rootInvocationId)
    .gt("depth", 0)
    .is("revoked_at", null)
    .gt("expires_at", input.now.toISOString())
    .in("child_invocation.status", [...ACTIVE_INVOCATION_STATUSES]);
  if (result.error || typeof result.count !== "number") {
    throw new HermesRunCapabilityError("persistence_failed");
  }
  return result.count;
}

async function createChildInvocation(
  client: SupabaseClient,
  input: {
    actor: HermesActorProfile;
    childInvocationId: string;
    parentInvocationId: string;
    rootInvocationId: string;
    mode: "fast" | "deep";
    depth: number;
  },
): Promise<void> {
  const childActor = { ...input.actor, invocationId: input.childInvocationId };
  const result = await client.from("ai_invocations").insert({
    id: input.childInvocationId,
    organization_id: input.actor.organizationId,
    actor_user_id: input.actor.userId,
    actor_role: input.actor.role,
    scene: "hermes_native_subagent",
    object_type: "ai_invocation",
    object_id: input.parentInvocationId,
    status: "started",
    metadata: {
      hermesActor: childActor,
      hermesParentInvocationId: input.parentInvocationId,
      hermesRootInvocationId: input.rootInvocationId,
      hermesMode: input.mode,
      hermesDepth: input.depth,
    },
  });
  if (result.error) {
    throw new HermesRunCapabilityError("persistence_failed");
  }
}

async function markChildInvocationFailed(
  client: SupabaseClient,
  input: { actor: HermesActorProfile; childInvocationId: string },
): Promise<void> {
  await client
    .from("ai_invocations")
    .update({
      status: "failed",
      error_summary: "Hermes child capability issuance failed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.childInvocationId)
    .eq("organization_id", input.actor.organizationId)
    .eq("actor_user_id", input.actor.userId);
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
    const actor = pickActor(candidate, invocationId);
    if (isHermesActorProfile(actor)) return actor;
  }
  return null;
}

function pickActor(
  value: Record<string, unknown>,
  invocationId: string,
): Record<string, unknown> {
  return {
    userId: value.userId,
    organizationId: value.organizationId,
    role: value.role,
    conversationId: value.conversationId,
    invocationId,
    allowedReadScopes: value.allowedReadScopes,
    enabledSkillVersions: value.enabledSkillVersions,
    skillGrantsHash: value.skillGrantsHash,
    profileVersion: value.profileVersion,
    pageContext: value.pageContext,
  };
}

function bearerCapability(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match?.[1] ?? null;
}

function json(body: unknown, status: number): Response {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function statusForCapabilityError(
  code: HermesRunCapabilityError["code"],
): number {
  switch (code) {
    case "invalid_request":
      return 400;
    case "parent_not_found":
      return 401;
    case "parent_invalid":
    case "actor_changed":
    case "authority_expansion":
    case "depth_limit":
    case "deadline_expired":
      return 403;
    case "parallel_limit":
      return 409;
    case "persistence_failed":
      return 503;
  }
}

function isFutureTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0)
    ? [...value]
    : null;
}

function scopeArray(
  value: unknown,
): HermesParentRunCapability["scopes"] | null {
  return Array.isArray(value) && value.every(isHermesReadScope)
    ? [...value]
    : null;
}

function uuidArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(isUuid) ? [...value] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
