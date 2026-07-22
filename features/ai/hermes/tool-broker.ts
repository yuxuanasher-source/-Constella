import { randomUUID } from "node:crypto";

import type { HermesActorProfile, HermesReadScope } from "./contracts";
import {
  assertHermesSanitizedObject,
  HermesStateRepositoryError,
  type HermesStateRepository,
} from "./hermes-state-repository";
import { HermesLiveActorAuthorizationError } from "./live-actor-authorization";
import {
  HERMES_READ_ENDPOINTS,
  authorizeHermesReadActor,
  hermesReadError,
  type HermesReadEnvelope,
} from "./read-api";
import {
  hashHermesCapabilityToken,
  HermesRunCapabilityError,
} from "./run-capability";
import {
  hashHermesToolBrokerRequest,
  parseStoredHermesToolBrokerEnvelope,
  type HermesToolBrokerEnvelope,
  type HermesToolBrokerRequest,
} from "./tool-broker-contracts";

export type HermesBrokerCapability = {
  actor: HermesActorProfile;
  actorFingerprint: string;
  turnId: string;
  invocationId: string;
  rootInvocationId: string;
  allowedTools: readonly string[];
  scopes: readonly HermesReadScope[];
};

export type HermesToolBrokerErrorCode =
  | "unauthorized"
  | "permission_denied"
  | "idempotency_conflict"
  | "lease_unavailable"
  | "persistence_unavailable"
  | "upstream_unavailable"
  | "internal_error";

const ERROR_MESSAGES: Record<HermesToolBrokerErrorCode, string> = {
  unauthorized: "Hermes Tool Broker authorization failed",
  permission_denied: "Hermes Tool Broker permission was denied",
  idempotency_conflict: "Hermes Tool Broker request conflicts with a replay",
  lease_unavailable: "Hermes Tool Broker lease is unavailable",
  persistence_unavailable: "Hermes Tool Broker persistence is unavailable",
  upstream_unavailable: "Hermes Tool Broker upstream is unavailable",
  internal_error: "Hermes Tool Broker failed",
};

export class HermesToolBrokerError extends Error {
  constructor(public readonly code: HermesToolBrokerErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "HermesToolBrokerError";
  }
}

export type HermesToolBrokerDependencies = {
  repository: Pick<
    HermesStateRepository,
    "claimBrokerCall" | "completeBrokerCall" | "appendToolMessage"
  >;
  loadCapability(input: {
    tokenSha256: string;
    now: Date;
  }): Promise<HermesBrokerCapability | null>;
  reauthorizeActor(input: {
    actorSnapshot: HermesActorProfile;
    expectedActorFingerprint: string;
  }): Promise<{ actor: HermesActorProfile; actorFingerprint: string }>;
  executeRead(input: {
    actor: HermesActorProfile;
    toolName: HermesToolBrokerRequest["toolName"];
    arguments: Record<string, unknown>;
  }): Promise<HermesReadEnvelope>;
};

export async function executeHermesToolBrokerCall({
  capabilityToken,
  request,
  dependencies,
  now = new Date(),
}: {
  capabilityToken: string;
  request: HermesToolBrokerRequest;
  dependencies: HermesToolBrokerDependencies;
  now?: Date;
}): Promise<HermesToolBrokerEnvelope> {
  const tokenSha256 = capabilityHash(capabilityToken);
  const capability = await loadCapability(dependencies, tokenSha256, now);
  if (
    !capability ||
    capability.invocationId !== request.invocationId ||
    capability.actor.invocationId !== capability.invocationId
  ) {
    throw new HermesToolBrokerError("unauthorized");
  }

  const live = await reauthorize(dependencies, capability);
  const spec = HERMES_READ_ENDPOINTS[request.toolName];
  if (
    !capability.allowedTools.includes(request.toolName) ||
    !capability.scopes.includes(spec.requiredScope) ||
    live.actor.invocationId !== request.invocationId ||
    authorizeHermesReadActor(live.actor, spec) !== null
  ) {
    throw new HermesToolBrokerError("permission_denied");
  }

  const claimOwnerId = randomUUID();
  const requestHash = hashHermesToolBrokerRequest(request);
  const sanitizedRequest = assertHermesSanitizedObject({
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    arguments: sanitizeRecord(request.arguments),
  });
  const owner = {
    organizationId: live.actor.organizationId,
    userId: live.actor.userId,
  };
  const claim = await claimBrokerCall(dependencies, {
    owner,
    tokenSha256,
    actorFingerprint: live.actorFingerprint,
    claimOwnerId,
    request,
    requestHash,
    sanitizedRequest,
  });

  if (!claim.execute) {
    if (!claim.sanitizedResponseEnvelope) {
      throw new HermesToolBrokerError("lease_unavailable");
    }
    const replay = parseStoredHermesToolBrokerEnvelope(
      claim.sanitizedResponseEnvelope,
      request,
    );
    if (!replay) {
      throw new HermesToolBrokerError("persistence_unavailable");
    }
    return replay;
  }

  const readEnvelope = await executeReadTool(dependencies, live.actor, request);
  const response = brokerEnvelope(readEnvelope, request, now);
  const sanitizedResponse = assertHermesSanitizedObject(
    response as unknown as Record<string, unknown>,
  ) as unknown as HermesToolBrokerEnvelope;
  const completionStatus = response.status === "error" ? "failed" : "completed";

  await completeBrokerCall(dependencies, {
    owner,
    claimId: claim.brokerCallId,
    claimOwnerId,
    fencingToken: claim.fencingToken,
    completionStatus,
    sanitizedResponse,
  });

  await appendToolMessage(dependencies, capability, live.actor, request, {
    request: sanitizedRequest,
    response: sanitizedResponse,
  });
  return sanitizedResponse;
}

async function loadCapability(
  dependencies: HermesToolBrokerDependencies,
  tokenSha256: string,
  now: Date,
): Promise<HermesBrokerCapability | null> {
  try {
    return await dependencies.loadCapability({ tokenSha256, now });
  } catch (error) {
    if (error instanceof HermesToolBrokerError) throw error;
    throw new HermesToolBrokerError("persistence_unavailable");
  }
}

async function reauthorize(
  dependencies: HermesToolBrokerDependencies,
  capability: HermesBrokerCapability,
): Promise<{ actor: HermesActorProfile; actorFingerprint: string }> {
  try {
    const live = await dependencies.reauthorizeActor({
      actorSnapshot: capability.actor,
      expectedActorFingerprint: capability.actorFingerprint,
    });
    if (live.actorFingerprint !== capability.actorFingerprint) {
      throw new HermesToolBrokerError("permission_denied");
    }
    return live;
  } catch (error) {
    if (error instanceof HermesToolBrokerError) throw error;
    if (error instanceof HermesLiveActorAuthorizationError) {
      if (error.code === "membership_query_failed") {
        throw new HermesToolBrokerError("persistence_unavailable");
      }
      throw new HermesToolBrokerError("permission_denied");
    }
    throw new HermesToolBrokerError("permission_denied");
  }
}

async function claimBrokerCall(
  dependencies: HermesToolBrokerDependencies,
  input: {
    owner: { organizationId: string; userId: string };
    tokenSha256: string;
    actorFingerprint: string;
    claimOwnerId: string;
    request: HermesToolBrokerRequest;
    requestHash: string;
    sanitizedRequest: Record<string, unknown>;
  },
) {
  try {
    return await dependencies.repository.claimBrokerCall(
      input.owner,
      input.tokenSha256,
      input.actorFingerprint,
      input.claimOwnerId,
      input.request.toolCallId,
      input.request.toolName,
      input.requestHash,
      input.sanitizedRequest,
    );
  } catch (error) {
    throw mapRepositoryError(error, "claim");
  }
}

async function completeBrokerCall(
  dependencies: HermesToolBrokerDependencies,
  input: {
    owner: { organizationId: string; userId: string };
    claimId: string;
    claimOwnerId: string;
    fencingToken: number;
    completionStatus: "completed" | "failed";
    sanitizedResponse: HermesToolBrokerEnvelope;
  },
): Promise<void> {
  try {
    await dependencies.repository.completeBrokerCall(
      input.owner,
      input.claimId,
      input.claimOwnerId,
      input.fencingToken,
      input.completionStatus,
      input.sanitizedResponse as unknown as Record<string, unknown>,
    );
  } catch (error) {
    throw mapRepositoryError(error, "complete");
  }
}

async function appendToolMessage(
  dependencies: HermesToolBrokerDependencies,
  capability: HermesBrokerCapability,
  actor: HermesActorProfile,
  request: HermesToolBrokerRequest,
  audit: {
    request: Record<string, unknown>;
    response: HermesToolBrokerEnvelope;
  },
): Promise<void> {
  const content = JSON.stringify({
    toolName: request.toolName,
    toolCallId: request.toolCallId,
    arguments: audit.request.arguments,
    result: audit.response,
  });
  try {
    await dependencies.repository.appendToolMessage(
      {
        organizationId: actor.organizationId,
        userId: actor.userId,
        conversationId: actor.conversationId,
        invocationId: capability.rootInvocationId,
      },
      capability.turnId,
      {
        content,
        metadata: {
          hermesTool: {
            toolName: request.toolName,
            toolCallId: request.toolCallId,
            invocationId: request.invocationId,
            status: audit.response.status,
          },
        },
      },
    );
  } catch (error) {
    throw mapRepositoryError(error, "append");
  }
}

async function executeReadTool(
  dependencies: HermesToolBrokerDependencies,
  actor: HermesActorProfile,
  request: HermesToolBrokerRequest,
): Promise<HermesReadEnvelope> {
  try {
    return await dependencies.executeRead({
      actor,
      toolName: request.toolName,
      arguments: request.arguments,
    });
  } catch {
    return hermesReadError(actor.invocationId, "upstream_unavailable");
  }
}

function brokerEnvelope(
  envelope: HermesReadEnvelope,
  request: HermesToolBrokerRequest,
  now: Date,
): HermesToolBrokerEnvelope {
  const metadata = {
    evidenceRefs: metadataList(
      "evidenceRefs" in envelope ? envelope.evidenceRefs : [],
    ),
    sourceLabels: metadataList(
      "sourceLabels" in envelope ? envelope.sourceLabels : [],
    ),
    updatedAt:
      "updatedAt" in envelope && isTimestamp(envelope.updatedAt)
        ? envelope.updatedAt
        : now.toISOString(),
    observedAt: now.toISOString(),
    missingData: metadataList(
      "missingData" in envelope ? envelope.missingData : [],
    ),
    permissionDenials: metadataList(
      "permissionDenials" in envelope ? envelope.permissionDenials : [],
    ),
    truncated: "truncated" in envelope ? Boolean(envelope.truncated) : false,
    invocationId: request.invocationId,
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    traceId: envelope.traceId,
  };
  if (envelope.status === "error") {
    return { status: "error", error: envelope.error, ...metadata };
  }
  return {
    status: envelope.status,
    data: sanitizeValue(envelope.data),
    ...metadata,
  };
}

function metadataList(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => sanitizeText(value.trim().slice(0, 160)))),
  ]
    .filter((value) => Boolean(value) && value !== "[REDACTED]")
    .slice(0, 100);
}

function sanitizeRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeValue(value);
  return isRecord(sanitized) ? sanitized : {};
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 32) return "[REDACTED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeValue(item, depth + 1));
  }
  if (!isRecord(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    result[key] = sanitizeValue(item, depth + 1);
  }
  return result;
}

function sanitizeText(value: string): string {
  const normalized = value.slice(0, 20_000);
  if (
    /\bBearer\s+[A-Za-z0-9._~-]+/i.test(normalized) ||
    /\b(select|insert|update|delete|alter|drop|create)\b[\s\S]*\b(from|into|table|where)\b/i.test(
      normalized,
    ) ||
    /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?:$|[^A-Za-z0-9_-])/.test(
      normalized,
    ) ||
    /(?:localhost|127\.0\.0\.1|\/api\/internal\/)/i.test(normalized) ||
    /\b(?:capability|secret|authorization|private\s+key|actor\s+jws)\b/i.test(
      normalized,
    ) ||
    /\b(?:eyJ[A-Za-z0-9_-]*|signed)\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(
      normalized,
    )
  ) {
    return "[REDACTED]";
  }
  return normalized;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    [
      "actorassertion",
      "actorjws",
      "authorization",
      "bearer",
      "capability",
      "cookie",
      "internalroute",
      "method",
      "model",
      "operation",
      "organizationid",
      "owneruserid",
      "password",
      "privatekey",
      "provider",
      "rawcapability",
      "secret",
      "sessionid",
      "sql",
      "stack",
      "table",
      "token",
      "url",
      "userid",
    ].includes(normalized) ||
    normalized.includes("authorization") ||
    normalized.includes("bearer") ||
    normalized.includes("cookie") ||
    normalized.endsWith("token") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("password") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("secretkey") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("jws") ||
    normalized.endsWith("jwt")
  );
}

function mapRepositoryError(
  error: unknown,
  phase: "claim" | "complete" | "append",
): HermesToolBrokerError {
  if (error instanceof HermesToolBrokerError) return error;
  if (error instanceof HermesStateRepositoryError) {
    switch (error.code) {
      case "idempotency_conflict":
        return new HermesToolBrokerError("idempotency_conflict");
      case "lease_expired":
        return new HermesToolBrokerError("lease_unavailable");
      case "permission_denied":
      case "not_found":
        return new HermesToolBrokerError(
          phase === "claim" ? "unauthorized" : "persistence_unavailable",
        );
      case "parallel_limit":
      case "state_conflict":
        return new HermesToolBrokerError("persistence_unavailable");
      case "invalid_input":
        return new HermesToolBrokerError("internal_error");
    }
  }
  return new HermesToolBrokerError("persistence_unavailable");
}

function capabilityHash(token: string): string {
  try {
    return hashHermesCapabilityToken(token);
  } catch (error) {
    if (error instanceof HermesRunCapabilityError) {
      throw new HermesToolBrokerError("unauthorized");
    }
    throw new HermesToolBrokerError("unauthorized");
  }
}

function isTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
