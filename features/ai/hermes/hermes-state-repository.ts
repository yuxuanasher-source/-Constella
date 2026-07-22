import { createHash } from "node:crypto";

import type { AiProviderName } from "../contracts";
import { isHermesOutcome, isUuid, type HermesOutcome } from "./contracts";
import {
  isHermesMemoryType,
  prepareHermesMemoryContent,
  type HermesMemoryType,
} from "./memory-policy";

export type { HermesMemoryType } from "./memory-policy";

const CHILD_FORBIDDEN_STATE_TOOLS = new Set([
  "xingyao_memory_remember",
  "xingyao_memory_forget",
  "xingyao_skill_draft",
]);

type RepositoryResult<T> = { data: T | null; error: unknown };

type HermesStateQuery = PromiseLike<RepositoryResult<unknown>> & {
  eq(column: string, value: unknown): HermesStateQuery;
  order(
    column: string,
    options: { ascending: boolean },
  ): PromiseLike<RepositoryResult<unknown>> | HermesStateQuery;
  select(columns: string): HermesStateQuery;
};

export type HermesStateRepositoryClient = {
  from(table: string): {
    select(columns: string): HermesStateQuery;
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<RepositoryResult<unknown>>;
};

export type HermesStateOwnerActor = {
  organizationId: string;
  userId: string;
};

export type HermesStateActor = HermesStateOwnerActor & {
  conversationId: string;
  invocationId: string;
};

export type HermesCapabilityActorSnapshot = HermesStateActor & {
  actorFingerprint: string;
};

export type HermesRunCapabilityBinding = {
  tokenSha256: string;
  allowedTools: readonly string[];
  scopes: readonly string[];
  skillDraftIds: readonly string[];
  depth: number;
  aiStateWritesAllowed: boolean;
  parentCapability?: {
    invocationId: string;
    tokenSha256: string;
  };
};

export type HermesMemoryWriteAuthority = {
  capabilityTokenSha256: string;
  parentInvocationId: string;
  sourceMessageId: string;
};

export type HermesRememberMemoryProposal = {
  memoryKey: string | null;
  expectedRevision: number;
  memoryType: HermesMemoryType;
  content: string;
};

export type HermesForgetMemoryCommand = {
  memoryKey: string;
  expectedRevision: number;
};

export type HermesMemoryBrokerMutation =
  | ({ operation: "remember" } & HermesRememberMemoryProposal)
  | ({ operation: "forget" } & HermesForgetMemoryCommand);

export type HermesMemoryBrokerClaim = {
  brokerCallId: string;
  claimOwnerId: string;
  fencingToken: number;
  observedAt: string;
};

export type HermesSkillDraftProposal = {
  skillId: string;
  version: number;
  manifest: Record<string, unknown>;
  bundle: string;
};

export type HermesSkillDraftReviewCommand = {
  draftId: string;
  nextStatus: "pending_review" | "approved" | "rejected" | "superseded";
  reviewNote?: string | null;
  signature?: string | null;
  signingKeyId?: string | null;
};

export type HermesTurnFinish = {
  outcome: HermesOutcome;
  content?: string;
  providerName?: AiProviderName | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  retryable: boolean;
  metadata?: Record<string, unknown>;
};

export type HermesStateRepositoryErrorCode =
  | "not_found"
  | "permission_denied"
  | "idempotency_conflict"
  | "lease_expired"
  | "parallel_limit"
  | "state_conflict"
  | "invalid_input";

const ERROR_MESSAGES: Record<HermesStateRepositoryErrorCode, string> = {
  not_found: "Hermes state resource was not found",
  permission_denied: "Hermes state access was denied",
  idempotency_conflict: "Hermes state request conflicts with a prior request",
  lease_expired: "Hermes state lease has expired",
  parallel_limit: "Hermes parallel capability limit was reached",
  state_conflict: "Hermes state changed concurrently",
  invalid_input: "Hermes state input is invalid",
};

export class HermesStateRepositoryError extends Error {
  constructor(public readonly code: HermesStateRepositoryErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "HermesStateRepositoryError";
  }
}

export type IssuedHermesCapability = {
  capabilityId: string;
  expiresAt: string;
};

export type HermesBrokerCallClaim = {
  brokerCallId: string;
  status: "claimed" | "completed" | "failed" | "denied";
  execute: boolean;
  reused: boolean;
  fencingToken: number;
  sanitizedResponseEnvelope: Record<string, unknown> | null;
};

export type CompletedHermesBrokerCall = {
  brokerCallId: string;
  status: "completed" | "failed" | "denied";
  reused: boolean;
  fencingToken: number;
  messageId: string;
  sequence: number;
};

export type CompletedHermesMemoryBrokerCall = CompletedHermesBrokerCall & {
  sanitizedResponseEnvelope: Record<string, unknown>;
};

export type AppendedHermesToolMessage = {
  messageId: string;
  sequence: number;
};

export type HermesMemory = {
  id: string;
  memoryKey: string;
  memoryType: HermesMemoryType;
  content: string;
  contentHash: string;
  revision: number;
  sourceConversationId: string;
  sourceMessageId: string;
  sourceInvocationId: string;
  createdAt: string;
  updatedAt: string;
};

export type HermesMemoryRevision = {
  memoryId: string;
  memoryKey: string;
  revision: number;
  active: boolean;
  reused: boolean;
};

export type HermesSkillDraftWrite = {
  draftId: string;
  status: "draft" | "pending_review" | "approved" | "rejected" | "superseded";
  reused: boolean;
};

export type HermesSkillDraftReview = {
  draftId: string;
  status: "pending_review" | "approved" | "rejected" | "superseded";
};

export type HermesTurnCancellation = {
  turnId: string;
  status: "completed" | "failed" | "cancelled";
  outcome: "cancelled" | null;
  cancelRequested: boolean;
  alreadyTerminal: boolean;
  childSessions: string[];
  revokedCapabilityIds: string[];
};

export type HermesStateRepository = {
  issueRunCapability(
    actorSnapshot: HermesCapabilityActorSnapshot,
    turn: { id: string; conversationId: string },
    binding: HermesRunCapabilityBinding,
    expiresAt: Date,
  ): Promise<IssuedHermesCapability>;
  claimBrokerCall(
    actor: HermesStateOwnerActor,
    capabilityHash: string,
    actorFingerprint: string,
    claimOwnerId: string,
    toolCallId: string,
    toolName: string,
    requestHash: string,
    sanitizedEnvelope: Record<string, unknown>,
  ): Promise<HermesBrokerCallClaim>;
  completeBrokerCall(
    actor: HermesStateOwnerActor,
    claimId: string,
    claimOwnerId: string,
    fencingToken: number,
    status: "completed" | "failed" | "denied",
    sanitizedEnvelope: Record<string, unknown>,
    auditMessage: { content: string; metadata?: Record<string, unknown> },
  ): Promise<CompletedHermesBrokerCall>;
  completeMemoryBrokerCall(
    actor: HermesStateActor,
    claim: HermesMemoryBrokerClaim,
    authority: HermesMemoryWriteAuthority,
    mutation: HermesMemoryBrokerMutation,
  ): Promise<CompletedHermesMemoryBrokerCall>;
  appendToolMessage(
    actor: HermesStateActor,
    turnId: string,
    auditMessage: { content: string; metadata?: Record<string, unknown> },
  ): Promise<AppendedHermesToolMessage>;
  loadActiveMemories(
    actor: HermesStateOwnerActor,
    memorySnapshotGeneration: number,
  ): Promise<HermesMemory[]>;
  rememberMemory(
    actor: HermesStateActor,
    authority: HermesMemoryWriteAuthority,
    proposal: HermesRememberMemoryProposal,
  ): Promise<HermesMemoryRevision>;
  forgetMemory(
    actor: HermesStateActor,
    authority: HermesMemoryWriteAuthority,
    command: HermesForgetMemoryCommand,
  ): Promise<HermesMemoryRevision>;
  upsertSkillDraft(
    actor: HermesStateActor,
    proposal: HermesSkillDraftProposal,
  ): Promise<HermesSkillDraftWrite>;
  reviewSkillDraft(
    ownerActor: HermesStateOwnerActor,
    command: HermesSkillDraftReviewCommand,
  ): Promise<HermesSkillDraftReview>;
  compareAndSwapGatewayState(
    actor: HermesStateOwnerActor,
    conversationId: string,
    expectedGeneration: number,
    nextState: Record<string, unknown>,
  ): Promise<number>;
  cancelTurn(
    actor: HermesStateOwnerActor,
    conversationId: string,
    turnId: string,
  ): Promise<HermesTurnCancellation>;
  renewTurnLease(actor: HermesStateOwnerActor, turnId: string): Promise<void>;
  finishTurn(
    actor: HermesStateOwnerActor & { invocationId: string },
    turnId: string,
    result: HermesTurnFinish,
  ): Promise<void>;
};

export function createHermesStateRepository(
  client: HermesStateRepositoryClient,
): HermesStateRepository {
  return {
    async issueRunCapability(actorSnapshot, turn, binding, expiresAt) {
      requireActor(actorSnapshot);
      requireHash(actorSnapshot.actorFingerprint);
      requireUuidInput(turn.id);
      requireUuidInput(turn.conversationId);
      if (turn.conversationId !== actorSnapshot.conversationId) invalidInput();
      const allowedTools = canonicalTextList(binding.allowedTools);
      const scopes = canonicalTextList(binding.scopes);
      const skillDraftIds = canonicalUuidList(binding.skillDraftIds);
      requireHash(binding.tokenSha256);
      if (
        !Number.isInteger(binding.depth) ||
        binding.depth < 0 ||
        binding.depth > 2
      ) {
        invalidInput();
      }
      if (typeof binding.aiStateWritesAllowed !== "boolean") invalidInput();
      if (binding.depth === 0 && binding.parentCapability) invalidInput();
      if (binding.depth > 0 && !binding.parentCapability) invalidInput();
      if (binding.depth > 0 && binding.aiStateWritesAllowed) invalidInput();
      if (
        binding.depth > 0 &&
        allowedTools.some((toolName) =>
          CHILD_FORBIDDEN_STATE_TOOLS.has(toolName),
        )
      ) {
        invalidInput();
      }
      if (binding.parentCapability) {
        requireUuidInput(binding.parentCapability.invocationId);
        requireHash(binding.parentCapability.tokenSha256);
      }
      if (
        !(expiresAt instanceof Date) ||
        !Number.isFinite(expiresAt.getTime())
      ) {
        invalidInput();
      }

      const data = await callRpc(client, "issue_ai_hermes_run_capability", {
        p_token_sha256: binding.tokenSha256.toLowerCase(),
        p_organization_id: actorSnapshot.organizationId,
        p_owner_user_id: actorSnapshot.userId,
        p_conversation_id: actorSnapshot.conversationId,
        p_turn_id: turn.id,
        p_invocation_id: actorSnapshot.invocationId,
        p_parent_invocation_id: binding.parentCapability?.invocationId ?? null,
        p_parent_token_sha256:
          binding.parentCapability?.tokenSha256.toLowerCase() ?? null,
        p_actor_fingerprint: actorSnapshot.actorFingerprint.toLowerCase(),
        p_allowed_tools: allowedTools,
        p_allowed_tools_hash: canonicalArrayHash(allowedTools),
        p_scopes: scopes,
        p_scope_hash: canonicalArrayHash(scopes),
        p_skill_grants_hash: canonicalArrayHash(skillDraftIds),
        p_skill_draft_ids: skillDraftIds,
        p_depth: binding.depth,
        p_ai_state_writes_allowed: binding.aiStateWritesAllowed,
        p_expires_at: expiresAt.toISOString(),
      });
      return parseIssuedCapability(data);
    },

    async claimBrokerCall(
      actor,
      capabilityHash,
      actorFingerprint,
      claimOwnerId,
      toolCallId,
      toolName,
      requestHash,
      sanitizedEnvelope,
    ) {
      requireIdentity(actor);
      requireHash(capabilityHash);
      requireHash(actorFingerprint);
      requireUuidInput(claimOwnerId);
      requireNonEmpty(toolCallId);
      requireNonEmpty(toolName);
      requireHash(requestHash);
      const envelope = copySanitizedObject(sanitizedEnvelope);
      const data = await callRpc(client, "claim_ai_hermes_broker_call", {
        p_organization_id: actor.organizationId,
        p_owner_user_id: actor.userId,
        p_token_sha256: capabilityHash.toLowerCase(),
        p_actor_fingerprint: actorFingerprint.toLowerCase(),
        p_claim_owner_id: claimOwnerId,
        p_tool_call_id: toolCallId,
        p_tool_name: toolName,
        p_request_sha256: requestHash.toLowerCase(),
        p_sanitized_request_envelope: envelope,
      });
      return parseBrokerClaim(data);
    },

    async completeBrokerCall(
      actor,
      claimId,
      claimOwnerId,
      fencingToken,
      status,
      sanitizedEnvelope,
      auditMessage,
    ) {
      requireIdentity(actor);
      requireUuidInput(claimId);
      requireUuidInput(claimOwnerId);
      if (!isPositiveInteger(fencingToken)) invalidInput();
      if (!isBrokerTerminalStatus(status)) invalidInput();
      const envelope = copySanitizedObject(sanitizedEnvelope);
      requireNonEmpty(auditMessage.content);
      const metadata = copySanitizedObject(auditMessage.metadata ?? {});
      const data = await callRpc(client, "complete_ai_hermes_broker_call", {
        p_organization_id: actor.organizationId,
        p_owner_user_id: actor.userId,
        p_broker_call_id: claimId,
        p_claim_owner_id: claimOwnerId,
        p_fencing_token: fencingToken,
        p_status: status,
        p_sanitized_response_envelope: envelope,
        p_error_code: null,
        p_tool_content: auditMessage.content,
        p_tool_metadata: metadata,
      });
      return parseBrokerCompletion(data);
    },

    async completeMemoryBrokerCall(actor, claim, authority, mutation) {
      requireActor(actor);
      requireMemoryWriteAuthority(actor, authority);
      requireUuidInput(claim.brokerCallId);
      requireUuidInput(claim.claimOwnerId);
      if (!isPositiveInteger(claim.fencingToken)) invalidInput();
      requireDateStringInput(claim.observedAt);

      let memoryType: HermesMemoryType | null = null;
      let content: string | null = null;
      let contentHash: string | null = null;
      if (mutation.operation === "remember") {
        if (mutation.memoryKey !== null) requireUuidInput(mutation.memoryKey);
        if (
          (mutation.memoryKey === null && mutation.expectedRevision !== 0) ||
          (mutation.memoryKey !== null &&
            !isPositiveInteger(mutation.expectedRevision))
        ) {
          invalidInput();
        }
        if (!isHermesMemoryType(mutation.memoryType)) invalidInput();
        const prepared = prepareHermesMemoryContent(mutation.content);
        memoryType = mutation.memoryType;
        content = prepared.canonicalContent;
        contentHash = prepared.contentHash;
      } else {
        requireUuidInput(mutation.memoryKey);
        if (!isPositiveInteger(mutation.expectedRevision)) invalidInput();
      }

      const data = await callRpc(
        client,
        "complete_ai_hermes_memory_broker_call",
        {
          p_organization_id: actor.organizationId,
          p_owner_user_id: actor.userId,
          p_broker_call_id: claim.brokerCallId,
          p_claim_owner_id: claim.claimOwnerId,
          p_fencing_token: claim.fencingToken,
          p_observed_at: claim.observedAt,
          p_operation: mutation.operation,
          p_capability_token_sha256:
            authority.capabilityTokenSha256.toLowerCase(),
          p_parent_invocation_id: authority.parentInvocationId,
          p_memory_key: mutation.memoryKey,
          p_expected_revision: mutation.expectedRevision,
          p_memory_type: memoryType,
          p_content: content,
          p_content_hash: contentHash,
          p_source_conversation_id: actor.conversationId,
          p_source_message_id: authority.sourceMessageId,
          p_source_invocation_id: actor.invocationId,
        },
      );
      return parseMemoryBrokerCompletion(data);
    },

    async appendToolMessage(actor, turnId, auditMessage) {
      requireActor(actor);
      requireUuidInput(turnId);
      requireNonEmpty(auditMessage.content);
      const metadata = copySanitizedObject(auditMessage.metadata ?? {});
      const data = await callRpc(client, "append_ai_hermes_tool_message", {
        p_organization_id: actor.organizationId,
        p_owner_user_id: actor.userId,
        p_conversation_id: actor.conversationId,
        p_turn_id: turnId,
        p_invocation_id: actor.invocationId,
        p_content: auditMessage.content,
        p_metadata: metadata,
      });
      return parseAppendedToolMessage(data);
    },

    async loadActiveMemories(actor, memorySnapshotGeneration) {
      requireIdentity(actor);
      if (!isNonNegativeInteger(memorySnapshotGeneration)) invalidInput();
      const data = await callRpc(client, "load_ai_hermes_memory_snapshot", {
        p_organization_id: actor.organizationId,
        p_owner_user_id: actor.userId,
        p_snapshot_generation: memorySnapshotGeneration,
      });
      if (!Array.isArray(data)) malformedPayload();
      return data.map(parseMemory);
    },

    async rememberMemory(actor, authority, proposal) {
      requireActor(actor);
      requireMemoryWriteAuthority(actor, authority);
      if (proposal.memoryKey !== null) requireUuidInput(proposal.memoryKey);
      if (!isNonNegativeInteger(proposal.expectedRevision)) invalidInput();
      if (proposal.memoryKey === null && proposal.expectedRevision !== 0) {
        invalidInput();
      }
      if (
        proposal.memoryKey !== null &&
        !isPositiveInteger(proposal.expectedRevision)
      ) {
        invalidInput();
      }
      if (!isHermesMemoryType(proposal.memoryType)) invalidInput();
      const prepared = prepareHermesMemoryContent(proposal.content);
      const data = await callRpc(client, "write_ai_hermes_memory_revision", {
        p_organization_id: actor.organizationId,
        p_owner_user_id: actor.userId,
        p_capability_token_sha256:
          authority.capabilityTokenSha256.toLowerCase(),
        p_parent_invocation_id: authority.parentInvocationId,
        p_idempotency_key: `${actor.invocationId}:${prepared.contentHash}`,
        p_memory_key: proposal.memoryKey,
        p_expected_revision: proposal.expectedRevision,
        p_memory_type: proposal.memoryType,
        p_content: prepared.canonicalContent,
        p_content_hash: prepared.contentHash,
        p_active: true,
        p_source_conversation_id: actor.conversationId,
        p_source_message_id: authority.sourceMessageId,
        p_source_invocation_id: actor.invocationId,
      });
      return parseMemoryRevision(data);
    },

    async forgetMemory(actor, authority, command) {
      requireActor(actor);
      requireMemoryWriteAuthority(actor, authority);
      requireUuidInput(command.memoryKey);
      if (!isPositiveInteger(command.expectedRevision)) invalidInput();
      const data = await callRpc(client, "forget_ai_hermes_memory", {
        p_organization_id: actor.organizationId,
        p_owner_user_id: actor.userId,
        p_capability_token_sha256:
          authority.capabilityTokenSha256.toLowerCase(),
        p_parent_invocation_id: authority.parentInvocationId,
        p_memory_key: command.memoryKey,
        p_expected_revision: command.expectedRevision,
        p_source_conversation_id: actor.conversationId,
        p_source_message_id: authority.sourceMessageId,
        p_source_invocation_id: actor.invocationId,
      });
      return parseMemoryRevision(data);
    },

    async upsertSkillDraft(actor, proposal) {
      requireActor(actor);
      requireNonEmpty(proposal.skillId);
      if (!isPositiveInteger(proposal.version)) invalidInput();
      requireNonEmpty(proposal.bundle);
      const manifest = copySanitizedObject(proposal.manifest);
      const data = await callRpc(client, "write_ai_hermes_skill_draft", {
        p_organization_id: actor.organizationId,
        p_owner_user_id: actor.userId,
        p_skill_id: proposal.skillId,
        p_version: proposal.version,
        p_manifest: manifest,
        p_bundle: proposal.bundle,
        p_bundle_sha256: sha256(proposal.bundle),
        p_source_conversation_id: actor.conversationId,
        p_source_invocation_id: actor.invocationId,
      });
      return parseSkillDraftWrite(data);
    },

    async reviewSkillDraft(ownerActor, command) {
      requireIdentity(ownerActor);
      requireUuidInput(command.draftId);
      if (!isReviewStatus(command.nextStatus)) invalidInput();
      const data = await callRpc(client, "review_ai_hermes_skill_draft", {
        p_organization_id: ownerActor.organizationId,
        p_owner_user_id: ownerActor.userId,
        p_draft_id: command.draftId,
        p_reviewer_user_id: ownerActor.userId,
        p_next_status: command.nextStatus,
        p_review_note: normalizedOptionalString(command.reviewNote),
        p_signature: normalizedOptionalString(command.signature),
        p_signing_key_id: normalizedOptionalString(command.signingKeyId),
      });
      return parseSkillDraftReview(data);
    },

    async compareAndSwapGatewayState(
      actor,
      conversationId,
      expectedGeneration,
      nextState,
    ) {
      requireIdentity(actor);
      requireUuidInput(conversationId);
      if (!isNonNegativeInteger(expectedGeneration)) invalidInput();
      const state = copySanitizedObject(nextState);
      const data = await callRpc(
        client,
        "update_ai_conversation_hermes_state",
        {
          p_organization_id: actor.organizationId,
          p_owner_user_id: actor.userId,
          p_conversation_id: conversationId,
          p_expected_generation: expectedGeneration,
          p_next_hermes_state: state,
        },
      );
      return parseGatewayGeneration(data, expectedGeneration);
    },

    async cancelTurn(actor, conversationId, turnId) {
      requireIdentity(actor);
      requireUuidInput(conversationId);
      requireUuidInput(turnId);
      const data = await callRpc(client, "cancel_ai_chat_turn", {
        p_organization_id: actor.organizationId,
        p_owner_user_id: actor.userId,
        p_conversation_id: conversationId,
        p_turn_id: turnId,
      });
      return parseTurnCancellation(data);
    },

    async renewTurnLease(actor, turnId) {
      requireIdentity(actor);
      requireUuidInput(turnId);
      const data = await callRpc(client, "renew_ai_chat_turn_lease", {
        p_organization_id: actor.organizationId,
        p_owner_user_id: actor.userId,
        p_turn_id: turnId,
      });
      if (data !== true) {
        throw new HermesStateRepositoryError("lease_expired");
      }
    },

    async finishTurn(actor, turnId, result) {
      requireIdentity(actor);
      requireUuidInput(actor.invocationId);
      requireUuidInput(turnId);
      if (!isHermesOutcome(result.outcome)) invalidInput();
      if (typeof result.retryable !== "boolean") invalidInput();
      const metadata = copySanitizedObject(result.metadata ?? {});
      const data = await callRpc(client, "finish_ai_chat_turn_v2", {
        p_organization_id: actor.organizationId,
        p_owner_user_id: actor.userId,
        p_turn_id: turnId,
        p_outcome: result.outcome,
        p_content: result.content ?? "",
        p_provider_name: result.providerName ?? null,
        p_ai_invocation_id: actor.invocationId,
        p_error_code: normalizedOptionalString(result.errorCode),
        p_error_summary: normalizedOptionalString(result.errorSummary),
        p_retryable: result.retryable,
        p_metadata: metadata,
      });
      if (data !== true) {
        throw new HermesStateRepositoryError("state_conflict");
      }
    },
  };
}

export function mapHermesStateRepositoryError(
  error: unknown,
): HermesStateRepositoryError {
  if (error instanceof HermesStateRepositoryError) return error;
  const text = errorText(error);
  if (/\bcapability_parallel_limit\b/.test(text)) {
    return new HermesStateRepositoryError("parallel_limit");
  }
  if (/not_found|not found|pgrst116/.test(text)) {
    return new HermesStateRepositoryError("not_found");
  }
  if (
    /idempotency|request_conflict|completion_conflict|hash_conflict|23505/.test(
      text,
    )
  ) {
    return new HermesStateRepositoryError("idempotency_conflict");
  }
  if (/lease|fence/.test(text)) {
    return new HermesStateRepositoryError("lease_expired");
  }
  if (
    /permission|not_authorized|actor_mismatch|tool_not_allowed|state_write_not_allowed|skill_grant_not_approved|memory_(source|capability|parent_invocation|actor)_invalid|capability_(invalid|parent_invalid|context_invalid|binding_invalid)|42501/.test(
      text,
    )
  ) {
    return new HermesStateRepositoryError("permission_denied");
  }
  if (/invalid|required|22p02|22023/.test(text)) {
    return new HermesStateRepositoryError("invalid_input");
  }
  return new HermesStateRepositoryError("state_conflict");
}

export function assertHermesSanitizedObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return copySanitizedObject(value);
}

async function callRpc(
  client: HermesStateRepositoryClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw mapHermesStateRepositoryError(error);
  return data;
}

function parseIssuedCapability(value: unknown): IssuedHermesCapability {
  if (!isRecord(value)) malformedPayload();
  const capabilityId = requiredUuid(value.capability_id);
  const expiresAt = requiredDateString(value.expires_at);
  return { capabilityId, expiresAt };
}

function parseBrokerClaim(value: unknown): HermesBrokerCallClaim {
  if (!isRecord(value)) malformedPayload();
  const status = value.status;
  if (!isBrokerStatus(status)) malformedPayload();
  if (typeof value.execute !== "boolean" || typeof value.reused !== "boolean") {
    malformedPayload();
  }
  const fencingToken = requiredPositiveInteger(value.fencing_token);
  const response = value.sanitized_response_envelope;
  if (response !== null && !isRecord(response)) malformedPayload();
  return {
    brokerCallId: requiredUuid(value.broker_call_id),
    status,
    execute: value.execute,
    reused: value.reused,
    fencingToken,
    sanitizedResponseEnvelope:
      response === null ? null : copySanitizedObject(response),
  };
}

function parseBrokerCompletion(value: unknown): CompletedHermesBrokerCall {
  if (!isRecord(value) || !isBrokerTerminalStatus(value.status)) {
    malformedPayload();
  }
  if (typeof value.reused !== "boolean") malformedPayload();
  return {
    brokerCallId: requiredUuid(value.broker_call_id),
    status: value.status,
    reused: value.reused,
    fencingToken: requiredPositiveInteger(value.fencing_token),
    messageId: requiredUuid(value.message_id),
    sequence: requiredPositiveInteger(value.sequence_no),
  };
}

function parseMemoryBrokerCompletion(
  value: unknown,
): CompletedHermesMemoryBrokerCall {
  if (!isRecord(value)) malformedPayload();
  const completion = parseBrokerCompletion(value);
  if (!isRecord(value.sanitized_response_envelope)) malformedPayload();
  return {
    ...completion,
    sanitizedResponseEnvelope: copySanitizedObject(
      value.sanitized_response_envelope,
    ),
  };
}

function parseAppendedToolMessage(value: unknown): AppendedHermesToolMessage {
  if (!isRecord(value)) malformedPayload();
  return {
    messageId: requiredUuid(value.message_id),
    sequence: requiredPositiveInteger(value.sequence_no),
  };
}

function parseMemory(value: unknown): HermesMemory {
  if (!isRecord(value) || !isMemoryType(value.memory_type)) malformedPayload();
  return {
    id: requiredUuid(value.id),
    memoryKey: requiredUuid(value.memory_key),
    memoryType: value.memory_type,
    content: requiredString(value.content),
    contentHash: requiredHash(value.content_hash),
    revision: requiredPositiveInteger(value.revision),
    sourceConversationId: requiredUuid(value.source_conversation_id),
    sourceMessageId: requiredUuid(value.source_message_id),
    sourceInvocationId: requiredUuid(value.source_invocation_id),
    createdAt: requiredDateString(value.created_at),
    updatedAt: requiredDateString(value.updated_at),
  };
}

function parseMemoryRevision(value: unknown): HermesMemoryRevision {
  if (!isRecord(value)) malformedPayload();
  if (typeof value.active !== "boolean" || typeof value.reused !== "boolean") {
    malformedPayload();
  }
  return {
    memoryId: requiredUuid(value.memory_id),
    memoryKey: requiredUuid(value.memory_key),
    revision: requiredPositiveInteger(value.revision),
    active: value.active,
    reused: value.reused,
  };
}

function parseSkillDraftWrite(value: unknown): HermesSkillDraftWrite {
  if (!isRecord(value) || !isSkillDraftStatus(value.status)) malformedPayload();
  if (typeof value.reused !== "boolean") malformedPayload();
  return {
    draftId: requiredUuid(value.draft_id),
    status: value.status,
    reused: value.reused,
  };
}

function parseSkillDraftReview(value: unknown): HermesSkillDraftReview {
  if (!isRecord(value) || !isReviewStatus(value.status)) malformedPayload();
  return {
    draftId: requiredUuid(value.draft_id),
    status: value.status,
  };
}

function parseGatewayGeneration(value: unknown, expected: number): number {
  if (!isRecord(value) || !isPositiveInteger(value.generation)) {
    malformedPayload();
  }
  if (value.generation !== expected + 1) malformedPayload();
  return value.generation;
}

function parseTurnCancellation(value: unknown): HermesTurnCancellation {
  if (!isRecord(value) || !isTerminalTurnStatus(value.status)) {
    malformedPayload();
  }
  if (
    typeof value.already_terminal !== "boolean" ||
    (value.cancel_requested !== undefined &&
      typeof value.cancel_requested !== "boolean")
  ) {
    malformedPayload();
  }
  const cancelRequested = value.cancel_requested === true;
  if (
    !value.already_terminal &&
    (value.status !== "cancelled" || !cancelRequested)
  ) {
    malformedPayload();
  }
  return {
    turnId: requiredUuid(value.turn_id),
    status: value.status,
    outcome: value.status === "cancelled" ? "cancelled" : null,
    cancelRequested,
    alreadyTerminal: value.already_terminal,
    childSessions: optionalStringList(value.child_sessions),
    revokedCapabilityIds: optionalUuidList(value.revoked_capability_ids),
  };
}

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "actorassertion",
  "organizationid",
  "owneruserid",
  "rawcapability",
  "userid",
]);

const PROTOTYPE_CONTROL_KEYS = new Set(["constructor", "proto", "prototype"]);

function copySanitizedObject(value: unknown): Record<string, unknown> {
  const copied = copySanitizedValue(value, new WeakSet<object>(), 0);
  if (!isRecord(copied)) invalidInput();
  return copied;
}

function copySanitizedValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > 64) invalidInput();
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidInput();
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) invalidInput();
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) invalidInput();
    return copySanitizedArray(value, seen, depth);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) invalidInput();
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") invalidInput();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      invalidInput();
    }
    validatePayloadProperty(key, descriptor.value);
    const copiedValue = copySanitizedValue(descriptor.value, seen, depth + 1);
    Object.defineProperty(copy, key, {
      value: copiedValue,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

function copySanitizedArray(
  value: unknown[],
  seen: WeakSet<object>,
  depth: number,
): unknown[] {
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !isArrayIndexKey(key, value.length)) {
      invalidInput();
    }
  }

  const copy = new Array<unknown>(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      invalidInput();
    }
    Object.defineProperty(copy, key, {
      value: copySanitizedValue(descriptor.value, seen, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function normalizePayloadKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function validatePayloadProperty(key: string, value: unknown): void {
  const normalized = normalizePayloadKey(key);
  if (PROTOTYPE_CONTROL_KEYS.has(normalized)) invalidInput();
  if (normalized.endsWith("hash") || normalized.endsWith("sha256")) {
    requireHash(value);
    return;
  }
  if (
    FORBIDDEN_PAYLOAD_KEYS.has(normalized) ||
    normalized.includes("authorization") ||
    normalized.includes("bearer") ||
    normalized.endsWith("token") ||
    normalized.endsWith("apikey") ||
    normalized.includes("cookie") ||
    normalized.endsWith("password") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("secretkey") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("jws") ||
    normalized.endsWith("jwt")
  ) {
    invalidInput();
  }
}

function canonicalTextList(values: readonly string[]): string[] {
  if (!Array.isArray(values)) invalidInput();
  const canonical = values.map((value) => {
    requireNonEmpty(value);
    if (value !== value.trim()) invalidInput();
    return value;
  });
  return sortUnique(canonical);
}

function canonicalUuidList(values: readonly string[]): string[] {
  if (!Array.isArray(values)) invalidInput();
  return sortUnique(
    values.map((value) => {
      requireUuidInput(value);
      if (value !== value.trim()) invalidInput();
      return value.toLowerCase();
    }),
  );
}

function sortUnique(values: string[]): string[] {
  const sorted = [...values].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  if (new Set(sorted).size !== sorted.length) invalidInput();
  return sorted;
}

function canonicalArrayHash(values: readonly string[]): string {
  return sha256(`[${values.map((value) => JSON.stringify(value)).join(", ")}]`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireActor(actor: HermesStateActor): void {
  requireIdentity(actor);
  requireUuidInput(actor.conversationId);
  requireUuidInput(actor.invocationId);
}

function requireMemoryWriteAuthority(
  actor: HermesStateActor,
  authority: HermesMemoryWriteAuthority,
): void {
  requireHash(authority.capabilityTokenSha256);
  requireUuidInput(authority.parentInvocationId);
  requireUuidInput(authority.sourceMessageId);
  if (authority.parentInvocationId !== actor.invocationId) invalidInput();
}

function requireIdentity(actor: HermesStateOwnerActor): void {
  requireUuidInput(actor.organizationId);
  requireUuidInput(actor.userId);
}

function requireUuidInput(value: unknown): asserts value is string {
  if (typeof value !== "string" || !isUuid(value)) invalidInput();
}

function requireHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    invalidInput();
  }
}

function requiredHash(value: unknown): string {
  requireHash(value);
  return value.toLowerCase();
}

function requireNonEmpty(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) invalidInput();
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) malformedPayload();
  return value;
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !isUuid(value)) malformedPayload();
  return value;
}

function optionalUuidList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) malformedPayload();
  return value.map(requiredUuid);
}

function optionalStringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) malformedPayload();
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim()) malformedPayload();
    return item;
  });
}

function requiredDateString(value: unknown): string {
  if (!isDateString(value)) malformedPayload();
  return value;
}

function requireDateStringInput(value: unknown): asserts value is string {
  if (!isDateString(value)) invalidInput();
}

function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  const zone = match[8];
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      return false;
    }
  }
  return Number.isFinite(Date.parse(value));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function requiredPositiveInteger(value: unknown): number {
  if (!isPositiveInteger(value)) malformedPayload();
  return value;
}

function normalizedOptionalString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) invalidInput();
  return value.trim();
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isBrokerStatus(
  value: unknown,
): value is "claimed" | "completed" | "failed" | "denied" {
  return ["claimed", "completed", "failed", "denied"].includes(String(value));
}

function isBrokerTerminalStatus(
  value: unknown,
): value is "completed" | "failed" | "denied" {
  return ["completed", "failed", "denied"].includes(String(value));
}

function isMemoryType(value: unknown): value is HermesMemoryType {
  return isHermesMemoryType(value);
}

function isSkillDraftStatus(
  value: unknown,
): value is HermesSkillDraftWrite["status"] {
  return [
    "draft",
    "pending_review",
    "approved",
    "rejected",
    "superseded",
  ].includes(String(value));
}

function isReviewStatus(
  value: unknown,
): value is HermesSkillDraftReview["status"] {
  return ["pending_review", "approved", "rejected", "superseded"].includes(
    String(value),
  );
}

function isTerminalTurnStatus(
  value: unknown,
): value is HermesTurnCancellation["status"] {
  return ["completed", "failed", "cancelled"].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error.toLowerCase();
  if (!isRecord(error)) return "";
  const message = typeof error.message === "string" ? error.message : "";
  const code = typeof error.code === "string" ? error.code : "";
  return `${code} ${message}`.toLowerCase();
}

function invalidInput(): never {
  throw new HermesStateRepositoryError("invalid_input");
}

function malformedPayload(): never {
  throw new HermesStateRepositoryError("state_conflict");
}
