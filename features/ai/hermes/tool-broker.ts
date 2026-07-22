import { randomUUID } from "node:crypto";

import type { HermesActorProfile, HermesReadScope } from "./contracts";
import {
  assertHermesSanitizedObject,
  HermesStateRepositoryError,
  type HermesMemoryRevision,
  type HermesStateRepository,
} from "./hermes-state-repository";
import { HermesLiveActorAuthorizationError } from "./live-actor-authorization";
import {
  HermesMemoryPolicyError,
  prepareHermesMemoryContent,
} from "./memory-policy";
import {
  HERMES_READ_ENDPOINTS,
  authorizeHermesReadActor,
  hermesReadError,
  normalizeHermesEvidenceRefs,
  sanitizeHermesReadMetadata,
  sanitizeHermesReadValue,
  type HermesReadEnvelope,
  type HermesReadToolName,
} from "./read-api";
import {
  hashHermesCapabilityToken,
  HermesRunCapabilityError,
} from "./run-capability";
import {
  hashHermesToolBrokerRequest,
  HERMES_MEMORY_TOOL_NAMES,
  parseStoredHermesToolBrokerEnvelope,
  type HermesMemoryForgetToolBrokerRequest,
  type HermesMemoryRememberToolBrokerRequest,
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
  depth: number;
  aiStateWritesAllowed: boolean;
};

export type HermesToolBrokerErrorCode =
  | "unauthorized"
  | "permission_denied"
  | "idempotency_conflict"
  | "lease_unavailable"
  | "persistence_unavailable"
  | "internal_error";

const ERROR_MESSAGES: Record<HermesToolBrokerErrorCode, string> = {
  unauthorized: "Hermes Tool Broker authorization failed",
  permission_denied: "Hermes Tool Broker permission was denied",
  idempotency_conflict: "Hermes Tool Broker request conflicts with a replay",
  lease_unavailable: "Hermes Tool Broker lease is unavailable",
  persistence_unavailable: "Hermes Tool Broker persistence is unavailable",
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
    | "claimBrokerCall"
    | "completeBrokerCall"
    | "forgetMemory"
    | "loadActiveMemories"
    | "rememberMemory"
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
    toolName: HermesReadToolName;
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
  if (
    !capability.allowedTools.includes(request.toolName) ||
    live.actor.invocationId !== request.invocationId
  ) {
    throw new HermesToolBrokerError("permission_denied");
  }
  authorizeToolRequest(capability, live.actor, request);

  const claimOwnerId = randomUUID();
  const requestHash = hashHermesToolBrokerRequest(request);
  const sanitizedRequest = sanitizedBrokerRequest(request);
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

  const response = isMemoryToolRequest(request)
    ? await executeMemoryTool({
        dependencies,
        actor: live.actor,
        capabilityTokenSha256: tokenSha256,
        request,
        now,
      })
    : brokerEnvelope(
        await executeReadTool(dependencies, live.actor, request),
        request,
        now,
      );
  const sanitizedResponse = assertHermesSanitizedObject(
    response as unknown as Record<string, unknown>,
  ) as unknown as HermesToolBrokerEnvelope;
  const completionStatus =
    response.status === "error" && response.error.code === "permission_denied"
      ? "denied"
      : response.status === "error"
        ? "failed"
        : "completed";
  const auditMessage = toolAuditMessage(
    request,
    sanitizedRequest,
    sanitizedResponse,
  );

  await completeBrokerCall(dependencies, {
    owner,
    claimId: claim.brokerCallId,
    claimOwnerId,
    fencingToken: claim.fencingToken,
    completionStatus,
    sanitizedResponse,
    auditMessage,
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
    completionStatus: "completed" | "failed" | "denied";
    sanitizedResponse: HermesToolBrokerEnvelope;
    auditMessage: { content: string; metadata: Record<string, unknown> };
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
      input.auditMessage,
    );
  } catch (error) {
    throw mapRepositoryError(error, "complete");
  }
}

function toolAuditMessage(
  request: HermesToolBrokerRequest,
  sanitizedRequest: Record<string, unknown>,
  sanitizedResponse: HermesToolBrokerEnvelope,
): { content: string; metadata: Record<string, unknown> } {
  const content = JSON.stringify({
    toolName: request.toolName,
    toolCallId: request.toolCallId,
    arguments: sanitizedRequest.arguments,
    result: sanitizedResponse,
  });
  return {
    content,
    metadata: {
      hermesTool: {
        toolName: request.toolName,
        toolCallId: request.toolCallId,
        invocationId: request.invocationId,
        status: sanitizedResponse.status,
      },
    },
  };
}

async function executeReadTool(
  dependencies: HermesToolBrokerDependencies,
  actor: HermesActorProfile,
  request: HermesToolBrokerRequest & { toolName: HermesReadToolName },
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

async function executeMemoryTool({
  dependencies,
  actor,
  capabilityTokenSha256,
  request,
  now,
}: {
  dependencies: HermesToolBrokerDependencies;
  actor: HermesActorProfile;
  capabilityTokenSha256: string;
  request: Extract<
    HermesToolBrokerRequest,
    { toolName: (typeof HERMES_MEMORY_TOOL_NAMES)[number] }
  >;
  now: Date;
}): Promise<HermesToolBrokerEnvelope> {
  try {
    switch (request.toolName) {
      case "xingyao_memory_list": {
        const memories = await dependencies.repository.loadActiveMemories({
          organizationId: actor.organizationId,
          userId: actor.userId,
        });
        return memoryBrokerEnvelope(
          request,
          now,
          "ok",
          {
            memories: memories.map((memory) => ({
              memoryKey: memory.memoryKey,
              memoryType: memory.memoryType,
              content: memory.content,
              revision: memory.revision,
              updatedAt: memory.updatedAt,
            })),
          },
        );
      }
      case "xingyao_memory_remember": {
        const prepared = prepareHermesMemoryContent(request.arguments.content);
        const revision = await dependencies.repository.rememberMemory(
          stateActor(actor),
          memoryAuthority(
            request,
            capabilityTokenSha256,
          ),
          {
            memoryKey: request.arguments.memoryKey ?? null,
            expectedRevision: request.arguments.expectedRevision ?? 0,
            memoryType: request.arguments.memoryType,
            content: prepared.canonicalContent,
          },
        );
        return memoryRevisionEnvelope(request, now, revision);
      }
      case "xingyao_memory_forget": {
        const revision = await dependencies.repository.forgetMemory(
          stateActor(actor),
          memoryAuthority(request, capabilityTokenSha256),
          {
            memoryKey: request.arguments.memoryKey,
            expectedRevision: request.arguments.expectedRevision,
          },
        );
        return memoryRevisionEnvelope(request, now, revision);
      }
    }
  } catch (error) {
    if (error instanceof HermesMemoryPolicyError) {
      return memoryBrokerEnvelope(
        request,
        now,
        "error",
        "memory_content_rejected",
      );
    }
    if (error instanceof HermesStateRepositoryError) {
      if (error.code === "permission_denied" || error.code === "not_found") {
        return memoryBrokerEnvelope(
          request,
          now,
          "error",
          "permission_denied",
        );
      }
      throw mapRepositoryError(error, "complete");
    }
    throw new HermesToolBrokerError("persistence_unavailable");
  }
}

function memoryRevisionEnvelope(
  request: Extract<
    HermesToolBrokerRequest,
    { toolName: "xingyao_memory_remember" | "xingyao_memory_forget" }
  >,
  now: Date,
  revision: HermesMemoryRevision,
): HermesToolBrokerEnvelope {
  return memoryBrokerEnvelope(request, now, "ok", {
    memoryKey: revision.memoryKey,
    revision: revision.revision,
    active: revision.active,
    reused: revision.reused,
  });
}

function memoryBrokerEnvelope(
  request: Extract<
    HermesToolBrokerRequest,
    { toolName: (typeof HERMES_MEMORY_TOOL_NAMES)[number] }
  >,
  now: Date,
  status: "ok",
  data: unknown,
): HermesToolBrokerEnvelope;
function memoryBrokerEnvelope(
  request: Extract<
    HermesToolBrokerRequest,
    { toolName: (typeof HERMES_MEMORY_TOOL_NAMES)[number] }
  >,
  now: Date,
  status: "error",
  errorCode: "permission_denied" | "memory_content_rejected",
): HermesToolBrokerEnvelope;
function memoryBrokerEnvelope(
  request: Extract<
    HermesToolBrokerRequest,
    { toolName: (typeof HERMES_MEMORY_TOOL_NAMES)[number] }
  >,
  now: Date,
  status: "ok" | "error",
  payload: unknown,
): HermesToolBrokerEnvelope {
  const metadata = {
    evidenceRefs: [],
    sourceLabels: ["actor_private_memory"],
    updatedAt: now.toISOString(),
    observedAt: now.toISOString(),
    missingData: [],
    permissionDenials: status === "error" ? [String(payload)] : [],
    truncated: false,
    invocationId: request.invocationId,
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    traceId: request.toolCallId,
  };
  return status === "error"
    ? {
        status,
        error: {
          code: payload as "permission_denied" | "memory_content_rejected",
        },
        ...metadata,
      }
    : { status, data: sanitizeHermesReadValue(payload), ...metadata };
}

function memoryAuthority(
  request:
    | HermesMemoryRememberToolBrokerRequest
    | HermesMemoryForgetToolBrokerRequest,
  capabilityTokenSha256: string,
) {
  return {
    capabilityTokenSha256,
    parentInvocationId: request.arguments.parentInvocationId,
    sourceMessageId: request.arguments.sourceMessageId,
  };
}

function stateActor(actor: HermesActorProfile) {
  return {
    organizationId: actor.organizationId,
    userId: actor.userId,
    conversationId: actor.conversationId,
    invocationId: actor.invocationId,
  };
}

function brokerEnvelope(
  envelope: HermesReadEnvelope,
  request: HermesToolBrokerRequest,
  now: Date,
): HermesToolBrokerEnvelope {
  const metadata = {
    evidenceRefs: normalizeHermesEvidenceRefs(
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
    data: sanitizeHermesReadValue(envelope.data),
    ...metadata,
  };
}

function metadataList(values: readonly string[]): string[] {
  return sanitizeHermesReadMetadata(values);
}

function sanitizeRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeHermesReadValue(value);
  return isRecord(sanitized) ? sanitized : {};
}

function sanitizedBrokerRequest(
  request: HermesToolBrokerRequest,
): Record<string, unknown> {
  const argumentsValue: Record<string, unknown> = { ...request.arguments };
  if (request.toolName === "xingyao_memory_remember") {
    delete argumentsValue.content;
  }
  return assertHermesSanitizedObject({
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    arguments: sanitizeRecord(argumentsValue),
  });
}

function authorizeToolRequest(
  capability: HermesBrokerCapability,
  actor: HermesActorProfile,
  request: HermesToolBrokerRequest,
): void {
  if (isMemoryToolRequest(request)) {
    if (
      request.toolName !== "xingyao_memory_list" &&
      (capability.depth !== 0 ||
        !capability.aiStateWritesAllowed ||
        capability.invocationId !== capability.rootInvocationId ||
        request.arguments.parentInvocationId !== capability.rootInvocationId)
    ) {
      throw new HermesToolBrokerError("permission_denied");
    }
    return;
  }
  const spec = HERMES_READ_ENDPOINTS[request.toolName];
  if (
    !capability.scopes.includes(spec.requiredScope) ||
    authorizeHermesReadActor(actor, spec) !== null
  ) {
    throw new HermesToolBrokerError("permission_denied");
  }
}

function isMemoryToolName(
  toolName: HermesToolBrokerRequest["toolName"],
): toolName is (typeof HERMES_MEMORY_TOOL_NAMES)[number] {
  return (HERMES_MEMORY_TOOL_NAMES as readonly string[]).includes(toolName);
}

function isMemoryToolRequest(
  request: HermesToolBrokerRequest,
): request is Extract<
  HermesToolBrokerRequest,
  { toolName: (typeof HERMES_MEMORY_TOOL_NAMES)[number] }
> {
  return isMemoryToolName(request.toolName);
}

function mapRepositoryError(
  error: unknown,
  phase: "claim" | "complete",
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
