import { randomUUID } from "node:crypto";

import {
  computeHermesSkillBundleSha256,
  getHermesBuiltinSkillArtifact,
  loadHermesSkillDraftApprovalRowsForActor,
  resolveApprovedHermesSkillArtifactForActor,
  type HermesSkillDraftRegistryClient,
} from "./approved-skill-registry";
import type { HermesActorProfile, HermesReadScope } from "./contracts";
import {
  assertHermesSanitizedObject,
  HermesStateRepositoryError,
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
  HERMES_SKILL_TOOL_NAMES,
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
  memorySnapshotGeneration: number;
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
    | "completeMemoryBrokerCall"
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
  loadApprovedSkillArtifact?(input: {
    actor: HermesActorProfile;
    skillId: string;
  }): Promise<{
    skillId: string;
    version: string;
    bundle: string;
    bundleSha256: string;
    source: "builtin" | "draft";
  } | null>;
};

export function createHermesApprovedSkillArtifactLoader({
  client,
  publicKeys,
}: {
  client: HermesSkillDraftRegistryClient;
  publicKeys: Record<string, string>;
}): NonNullable<HermesToolBrokerDependencies["loadApprovedSkillArtifact"]> {
  return async ({ actor, skillId }) => {
    const builtin = getHermesBuiltinSkillArtifact(skillId);
    if (builtin) {
      return {
        skillId: builtin.skillId,
        version: builtin.version,
        bundle: builtin.bundle,
        bundleSha256: builtin.bundleSha256,
        source: "builtin",
      };
    }
    const rows = await loadHermesSkillDraftApprovalRowsForActor({
      client,
      actor: { organizationId: actor.organizationId, userId: actor.userId },
    });
    return resolveApprovedHermesSkillArtifactForActor({
      actor: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        role: actor.role,
        allowedReadScopes: actor.allowedReadScopes,
      },
      rows,
      publicKeys,
      skillId,
    });
  };
}

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

  let response: HermesToolBrokerEnvelope;
  if (isMemoryMutationRequest(request)) {
    try {
      return await executeAtomicMemoryMutation({
        dependencies,
        actor: live.actor,
        capabilityTokenSha256: tokenSha256,
        claim: {
          brokerCallId: claim.brokerCallId,
          claimOwnerId,
          fencingToken: claim.fencingToken,
          observedAt: now.toISOString(),
        },
        request,
      });
    } catch (error) {
      if (error instanceof HermesMemoryPolicyError) {
        response = memoryBrokerEnvelope(
          request,
          now,
          "error",
          "memory_content_rejected",
        );
      } else {
        throw mapRepositoryError(error, "complete");
      }
    }
  } else if (request.toolName === "xingyao_memory_list") {
    response = await executeMemoryListTool({
      dependencies,
      actor: live.actor,
      memorySnapshotGeneration: capability.memorySnapshotGeneration,
      request,
      now,
    });
  } else if (request.toolName === "xingyao_skill_view") {
    response = await executeSkillViewTool({
      dependencies,
      actor: live.actor,
      request,
      now,
    });
  } else {
    response = brokerEnvelope(
      await executeReadTool(dependencies, live.actor, request),
      request,
      now,
    );
  }
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

async function executeMemoryListTool({
  dependencies,
  actor,
  memorySnapshotGeneration,
  request,
  now,
}: {
  dependencies: HermesToolBrokerDependencies;
  actor: HermesActorProfile;
  memorySnapshotGeneration: number;
  request: Extract<
    HermesToolBrokerRequest,
    { toolName: "xingyao_memory_list" }
  >;
  now: Date;
}): Promise<HermesToolBrokerEnvelope> {
  try {
    const memories = await dependencies.repository.loadActiveMemories(
      {
        organizationId: actor.organizationId,
        userId: actor.userId,
      },
      memorySnapshotGeneration,
    );
    return memoryBrokerEnvelope(request, now, "ok", {
      memories: memories.map((memory) => ({
        memoryKey: memory.memoryKey,
        memoryType: memory.memoryType,
        content: memory.content,
        revision: memory.revision,
        updatedAt: memory.updatedAt,
      })),
    });
  } catch {
    throw new HermesToolBrokerError("persistence_unavailable");
  }
}

async function executeAtomicMemoryMutation({
  dependencies,
  actor,
  capabilityTokenSha256,
  claim,
  request,
}: {
  dependencies: HermesToolBrokerDependencies;
  actor: HermesActorProfile;
  capabilityTokenSha256: string;
  claim: {
    brokerCallId: string;
    claimOwnerId: string;
    fencingToken: number;
    observedAt: string;
  };
  request: Extract<
    HermesToolBrokerRequest,
    { toolName: "xingyao_memory_remember" | "xingyao_memory_forget" }
  >;
}): Promise<HermesToolBrokerEnvelope> {
  const mutation =
    request.toolName === "xingyao_memory_remember"
      ? {
          operation: "remember" as const,
          memoryKey: request.arguments.memoryKey ?? null,
          expectedRevision: request.arguments.expectedRevision ?? 0,
          memoryType: request.arguments.memoryType,
          content: prepareHermesMemoryContent(request.arguments.content)
            .canonicalContent,
        }
      : {
          operation: "forget" as const,
          memoryKey: request.arguments.memoryKey,
          expectedRevision: request.arguments.expectedRevision,
        };
  const completion = await dependencies.repository.completeMemoryBrokerCall(
    stateActor(actor),
    claim,
    memoryAuthority(request, capabilityTokenSha256),
    mutation,
  );
  const response = parseStoredHermesToolBrokerEnvelope(
    completion.sanitizedResponseEnvelope,
    request,
  );
  if (!response) throw new HermesToolBrokerError("persistence_unavailable");
  return response;
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

async function executeSkillViewTool({
  dependencies,
  actor,
  request,
  now,
}: {
  dependencies: HermesToolBrokerDependencies;
  actor: HermesActorProfile;
  request: Extract<HermesToolBrokerRequest, { toolName: "xingyao_skill_view" }>;
  now: Date;
}): Promise<HermesToolBrokerEnvelope> {
  const grant = actor.enabledSkillVersions.find(
    (skill) => skill.skillId === request.arguments.skillId,
  );
  if (!grant) {
    throw new HermesToolBrokerError("permission_denied");
  }
  const artifact = dependencies.loadApprovedSkillArtifact
    ? await dependencies.loadApprovedSkillArtifact({
        actor,
        skillId: request.arguments.skillId,
      })
    : getHermesBuiltinSkillArtifact(request.arguments.skillId);
  if (
    !artifact ||
    artifact.skillId !== grant.skillId ||
    artifact.version !== grant.version ||
    artifact.bundleSha256 !== grant.bundleSha256 ||
    computeHermesSkillBundleSha256(artifact.bundle) !== grant.bundleSha256
  ) {
    throw new HermesToolBrokerError("permission_denied");
  }
  return skillBrokerEnvelope(request, now, {
    skillId: artifact.skillId,
    version: artifact.version,
    bundleSha256: artifact.bundleSha256,
    bundle: artifact.bundle,
    source: artifact.source,
  });
}

function skillBrokerEnvelope(
  request: Extract<HermesToolBrokerRequest, { toolName: "xingyao_skill_view" }>,
  now: Date,
  data: Record<string, unknown>,
): HermesToolBrokerEnvelope {
  return {
    status: "ok",
    data: sanitizeHermesReadValue(data),
    evidenceRefs: [`skill:${request.arguments.skillId}`],
    sourceLabels: ["approved_skill_bundle"],
    updatedAt: now.toISOString(),
    observedAt: now.toISOString(),
    missingData: [],
    permissionDenials: [],
    truncated: false,
    invocationId: request.invocationId,
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    traceId: request.toolCallId,
  };
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
    // A capability-listed state call is claimed before the write RPC makes the
    // final authority decision, so denials remain tool-local and auditable.
    return;
  }
  if (isSkillToolRequest(request)) return;
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

function isSkillToolName(
  toolName: HermesToolBrokerRequest["toolName"],
): toolName is (typeof HERMES_SKILL_TOOL_NAMES)[number] {
  return (HERMES_SKILL_TOOL_NAMES as readonly string[]).includes(toolName);
}

function isSkillToolRequest(
  request: HermesToolBrokerRequest,
): request is Extract<
  HermesToolBrokerRequest,
  { toolName: (typeof HERMES_SKILL_TOOL_NAMES)[number] }
> {
  return isSkillToolName(request.toolName);
}

function isMemoryMutationRequest(
  request: HermesToolBrokerRequest,
): request is Extract<
  HermesToolBrokerRequest,
  { toolName: "xingyao_memory_remember" | "xingyao_memory_forget" }
> {
  return (
    request.toolName === "xingyao_memory_remember" ||
    request.toolName === "xingyao_memory_forget"
  );
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
