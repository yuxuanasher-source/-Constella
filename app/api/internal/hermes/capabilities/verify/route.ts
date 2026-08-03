import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  computeHermesSkillGrantsHash,
  createHermesActorFingerprint,
} from "@/features/ai/hermes/actor-fingerprint";
import {
  isHermesActorProfile,
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

type QueryResult = {
  data?: unknown | null;
  error?: unknown | null;
};

type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  gt: (column: string, value: unknown) => QueryBuilder;
  in: (column: string, values: readonly string[]) => QueryBuilder;
  is: (column: string, value: null) => QueryBuilder;
  maybeSingle: () => Promise<QueryResult>;
};

export type HermesCapabilityVerificationClient = {
  from: (table: string) => QueryBuilder;
};

export type HermesCapabilityVerificationResult = {
  organizationId: string;
  ownerUserId: string;
  conversationId: string;
  invocationId: string;
  actorFingerprint: string;
  expiresAt: string;
  revokedAt: null;
};

type VerificationService = (input: {
  capabilityToken: string;
}) => Promise<HermesCapabilityVerificationResult | null>;

type VerificationErrorCode = "capability_invalid" | "persistence_unavailable";

export class HermesCapabilityVerificationError extends Error {
  constructor(readonly code: VerificationErrorCode) {
    super(code);
    this.name = "HermesCapabilityVerificationError";
  }
}

export function createHermesCapabilityVerifyHandler({
  verify,
}: {
  verify: VerificationService;
}) {
  return async function handleHermesCapabilityVerify(
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
    if (!isExactEmptyObject(body)) {
      return json({ error: { code: "invalid_request" } }, 400);
    }

    try {
      const capability = await verify({ capabilityToken });
      if (!capability) {
        return json({ error: { code: "capability_not_found" } }, 404);
      }
      if (!isVerificationResult(capability)) {
        return json({ error: { code: "internal_error" } }, 500);
      }
      return json(
        {
          capability: {
            organizationId: capability.organizationId,
            ownerUserId: capability.ownerUserId,
            conversationId: capability.conversationId,
            invocationId: capability.invocationId,
            actorFingerprint: capability.actorFingerprint,
            expiresAt: capability.expiresAt,
            revokedAt: null,
          },
        },
        200,
      );
    } catch (error) {
      if (error instanceof HermesCapabilityVerificationError) {
        return json(
          { error: { code: error.code } },
          error.code === "capability_invalid" ? 403 : 503,
        );
      }
      return json({ error: { code: "internal_error" } }, 500);
    }
  };
}

const defaultHandler = createHermesCapabilityVerifyHandler({
  verify: verifyWithAdminClient,
});

export async function POST(request: Request): Promise<Response> {
  return defaultHandler(request);
}

async function verifyWithAdminClient(input: {
  capabilityToken: string;
}): Promise<HermesCapabilityVerificationResult | null> {
  const client = createSupabaseAdminClient();
  if (!client) {
    throw new HermesCapabilityVerificationError("persistence_unavailable");
  }
  return verifyHermesCapabilityWithProductPersistence({
    client: client as unknown as HermesCapabilityVerificationClient,
    capabilityToken: input.capabilityToken,
  });
}

export async function verifyHermesCapabilityWithProductPersistence({
  client,
  capabilityToken,
  now = new Date(),
}: {
  client: HermesCapabilityVerificationClient;
  capabilityToken: string;
  now?: Date;
}): Promise<HermesCapabilityVerificationResult | null> {
  const tokenSha256 = sha256(capabilityToken);
  const capabilityResult = await persistenceQuery(() =>
    client
      .from("ai_hermes_run_capabilities")
      .select(
        "organization_id, owner_user_id, conversation_id, turn_id, invocation_id, root_invocation_id, parent_invocation_id, actor_fingerprint, skill_grants_hash, skill_draft_ids, depth, memory_snapshot_generation, expires_at, revoked_at",
      )
      .eq("token_sha256", tokenSha256)
      .maybeSingle(),
  );
  if (capabilityResult.data === null || capabilityResult.data === undefined) {
    return null;
  }
  if (!isRecord(capabilityResult.data)) invalidCapability();

  const capability = capabilityResult.data;
  const organizationId = stringValue(capability.organization_id);
  const ownerUserId = stringValue(capability.owner_user_id);
  const conversationId = stringValue(capability.conversation_id);
  const turnId = stringValue(capability.turn_id);
  const invocationId = stringValue(capability.invocation_id);
  const rootInvocationId = stringValue(capability.root_invocation_id);
  const parentInvocationId = nullableStringValue(
    capability.parent_invocation_id,
  );
  const actorFingerprint = stringValue(capability.actor_fingerprint);
  const expiresAt = stringValue(capability.expires_at);
  const depth = boundedDepth(capability.depth);
  const memorySnapshotGeneration = nonNegativeInteger(
    capability.memory_snapshot_generation,
  );
  const skillDraftIds = uuidArray(capability.skill_draft_ids);
  const skillDraftHash = stringValue(capability.skill_grants_hash);

  if (
    !isUuid(organizationId) ||
    !isUuid(ownerUserId) ||
    !isUuid(conversationId) ||
    !isUuid(turnId) ||
    !isUuid(invocationId) ||
    !isUuid(rootInvocationId) ||
    !isSha256(actorFingerprint) ||
    !isSha256(skillDraftHash) ||
    !skillDraftIds ||
    !constantTimeEqual(skillDraftHash, canonicalArrayHash(skillDraftIds)) ||
    depth === null ||
    memorySnapshotGeneration === null ||
    !isFutureTimestamp(expiresAt, now) ||
    capability.revoked_at !== null ||
    (depth === 0 &&
      (rootInvocationId !== invocationId || parentInvocationId !== null)) ||
    (depth > 0 && !isUuid(parentInvocationId))
  ) {
    invalidCapability();
  }

  const turnResult = await persistenceQuery(() =>
    client
      .from("ai_chat_turns")
      .select(
        "status, lease_expires_at, cancel_requested_at, ai_invocation_id, memory_snapshot_generation, context_snapshot",
      )
      .eq("id", turnId)
      .eq("organization_id", organizationId)
      .eq("owner_user_id", ownerUserId)
      .eq("conversation_id", conversationId)
      .in("status", ACTIVE_TURN_STATUSES)
      .is("cancel_requested_at", null)
      .gt("lease_expires_at", now.toISOString())
      .maybeSingle(),
  );
  if (!isRecord(turnResult.data)) invalidCapability();
  const turn = turnResult.data;
  if (
    !ACTIVE_TURN_STATUSES.includes(
      turn.status as (typeof ACTIVE_TURN_STATUSES)[number],
    ) ||
    turn.cancel_requested_at !== null ||
    !isFutureTimestamp(stringValue(turn.lease_expires_at), now) ||
    turn.ai_invocation_id !== rootInvocationId ||
    turn.memory_snapshot_generation !== memorySnapshotGeneration
  ) {
    invalidCapability();
  }

  const invocationResult = await loadActiveInvocation(client, {
    invocationId,
    organizationId,
    ownerUserId,
  });
  const invocation = invocationResult;

  if (rootInvocationId !== invocationId) {
    await loadActiveInvocation(client, {
      invocationId: rootInvocationId,
      organizationId,
      ownerUserId,
    });
  }

  const actor = actorSnapshotFromRecords(
    turn.context_snapshot,
    invocation.metadata,
    invocationId,
  );
  if (
    !actor ||
    actor.organizationId !== organizationId ||
    actor.userId !== ownerUserId ||
    actor.conversationId !== conversationId ||
    !constantTimeEqual(
      actor.skillGrantsHash,
      computeHermesSkillGrantsHash(actor.enabledSkillVersions),
    ) ||
    !constantTimeEqual(actorFingerprint, createHermesActorFingerprint(actor))
  ) {
    invalidCapability();
  }

  return {
    organizationId,
    ownerUserId,
    conversationId,
    invocationId,
    actorFingerprint,
    expiresAt,
    revokedAt: null,
  };
}

async function loadActiveInvocation(
  client: HermesCapabilityVerificationClient,
  input: {
    invocationId: string;
    organizationId: string;
    ownerUserId: string;
  },
): Promise<Record<string, unknown>> {
  const result = await persistenceQuery(() =>
    client
      .from("ai_invocations")
      .select("id, status, organization_id, actor_user_id, metadata")
      .eq("id", input.invocationId)
      .eq("organization_id", input.organizationId)
      .eq("actor_user_id", input.ownerUserId)
      .in("status", ACTIVE_INVOCATION_STATUSES)
      .maybeSingle(),
  );
  if (!isRecord(result.data)) invalidCapability();
  if (
    result.data.id !== input.invocationId ||
    result.data.organization_id !== input.organizationId ||
    result.data.actor_user_id !== input.ownerUserId ||
    !ACTIVE_INVOCATION_STATUSES.includes(
      result.data.status as (typeof ACTIVE_INVOCATION_STATUSES)[number],
    )
  ) {
    invalidCapability();
  }
  return result.data;
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

function isVerificationResult(
  value: HermesCapabilityVerificationResult,
): boolean {
  return (
    isUuid(value.organizationId) &&
    isUuid(value.ownerUserId) &&
    isUuid(value.conversationId) &&
    isUuid(value.invocationId) &&
    isSha256(value.actorFingerprint) &&
    isFutureTimestamp(value.expiresAt, new Date()) &&
    value.revokedAt === null
  );
}

async function persistenceQuery(
  load: () => Promise<QueryResult>,
): Promise<QueryResult> {
  try {
    const result = await load();
    if (result.error) {
      throw new HermesCapabilityVerificationError("persistence_unavailable");
    }
    return result;
  } catch (error) {
    if (error instanceof HermesCapabilityVerificationError) throw error;
    throw new HermesCapabilityVerificationError("persistence_unavailable");
  }
}

function invalidCapability(): never {
  throw new HermesCapabilityVerificationError("capability_invalid");
}

function json(body: unknown, status: number): Response {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function isExactEmptyObject(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function isFutureTimestamp(value: string | null, now: Date): value is string {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function boundedDepth(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2
    ? Number(value)
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function uuidArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(isUuid) ? [...value] : null;
}

function canonicalArrayHash(values: readonly string[]): string {
  const sorted = [...values].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  if (new Set(sorted).size !== sorted.length) return "";
  return sha256(`[${sorted.map((value) => JSON.stringify(value)).join(", ")}]`);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableStringValue(value: unknown): string | null {
  return value === null ? null : stringValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
