import type {
  AiConversationDto,
  AiConversationMessageDto,
  ConversationContextSnapshot,
  ConversationMemoryDelta,
  ConversationMemorySummary,
  ConversationStreamEvent,
  ConversationMessageRole,
  ConversationMessageStatus,
  ConversationSessionAction,
  ConversationTurnStage,
  ConversationTurnStatus,
} from "./conversation-contracts";
import {
  isConversationSessionAction,
  isConversationTurnStage,
  parseConversationMemorySummary,
} from "./conversation-contracts";
import type { AiChatMode, AiProviderName } from "./contracts";
import {
  createHermesStateRepository,
  HermesStateRepositoryError,
  mapHermesStateRepositoryError,
  type HermesTurnCancellation,
} from "./hermes/hermes-state-repository";
import { isHermesOutcome, type HermesOutcome } from "./hermes/contracts";
import { parseHermesGatewayProviderState } from "./hermes/gateway-contracts";

type QueryResult<T> = { data: T | null; error: unknown };

type RepositoryQuery = PromiseLike<QueryResult<unknown>> & {
  eq(column: string, value: unknown): RepositoryQuery;
  in(column: string, values: string[]): RepositoryQuery;
  order(column: string, options: { ascending: boolean }): RepositoryQuery;
  limit(count: number): RepositoryQuery;
  select(columns: string): RepositoryQuery;
  single(): PromiseLike<QueryResult<unknown>>;
  maybeSingle(): PromiseLike<QueryResult<unknown>>;
  returns<T>(): PromiseLike<QueryResult<T>>;
};

export type ConversationRepositoryClient = {
  from(table: string): {
    insert(payload: Record<string, unknown>): RepositoryQuery;
    select(columns: string): RepositoryQuery;
    update(payload: Record<string, unknown>): RepositoryQuery;
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<QueryResult<unknown>>;
};

type ConversationRow = {
  id: string;
  title: string;
  status: "active" | "archived";
  last_message_at: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sequence_no: number;
  role: ConversationMessageRole;
  status: ConversationMessageStatus;
  content: string;
  parent_message_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type StoredConversationTurn = {
  id: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  mode: AiChatMode;
  status: ConversationTurnStatus;
  attempt: number;
  contextSnapshot: ConversationContextSnapshot | null;
  retryOfTurnId: string | null;
  regenerateOfTurnId: string | null;
  providerName: AiProviderName | null;
  outcome?: HermesOutcome | null;
  cancelRequestedAt?: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  retryable: boolean;
};

type TurnRow = {
  id: string;
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  mode: AiChatMode;
  status: ConversationTurnStatus;
  attempt_no: number;
  context_snapshot: ConversationContextSnapshot | null;
  retry_of_turn_id: string | null;
  regenerate_of_turn_id: string | null;
  provider_name: AiProviderName | null;
  outcome?: HermesOutcome | null;
  cancel_requested_at?: string | null;
  error_code: string | null;
  error_summary: string | null;
  retryable: boolean;
};

export type CreatedConversationTurn = {
  conversationId: string;
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
  status: ConversationTurnStatus;
  attempt: number;
  duplicate: boolean;
};

export type RecordedConversationTurnStage = {
  turnId: string;
  stage: ConversationTurnStage;
  observedAt: string;
  sessionAction?: ConversationSessionAction;
};

export class ConversationTurnStagePersistenceError extends Error {
  readonly code = "conversation_turn_stage_persist_failed";

  constructor() {
    super("Conversation turn stage could not be persisted");
    this.name = "ConversationTurnStagePersistenceError";
  }
}

export type ConversationGatewayState = {
  generation: number;
  sessionId?: string;
  checkpointId?: string;
  provider?: string;
  model?: string;
  lastUsedAt?: string;
  childSessions: string[];
  summary: ConversationMemorySummary;
  summaryVersion: number;
  memoryStatus: "ready" | "degraded";
  memoryDegradedAt: string | null;
  pendingClarify?: ConversationGatewayPendingClarify;
};

export type ConversationGatewayPendingClarify = {
  turnId: string;
  clarifyId: string;
  requestId: string;
  question: string;
  choices: string[];
  allowFreeText: boolean;
  response?: {
    clarifyId: string;
    answerSha256: string;
  };
};

export type ConversationClarifyClaim = {
  status: "claimed" | "duplicate" | "conflict";
  generation?: number;
};

export async function createAiConversation(
  client: ConversationRepositoryClient,
  input: { organizationId: string; ownerUserId: string; title: string },
): Promise<AiConversationDto | null> {
  const { data, error } = await client
    .from("ai_conversations")
    .insert({
      organization_id: input.organizationId,
      owner_user_id: input.ownerUserId,
      title: input.title,
    })
    .select("id, title, status, last_message_at, created_at, updated_at")
    .single();

  return error || !isConversationRow(data) ? null : toConversationDto(data);
}

export async function listAiConversations(
  client: ConversationRepositoryClient,
  input: { organizationId: string; ownerUserId: string; limit?: number },
): Promise<AiConversationDto[]> {
  const { data, error } = (await client
    .from("ai_conversations")
    .select("id, title, status, last_message_at, created_at, updated_at")
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.ownerUserId)
    .eq("status", "active")
    .order("last_message_at", { ascending: false })
    .limit(input.limit ?? 30)) as QueryResult<unknown[]>;

  return error || !Array.isArray(data)
    ? []
    : data.filter(isConversationRow).map(toConversationDto);
}

export async function getAiConversation(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
  },
): Promise<AiConversationDto | null> {
  const { data, error } = await client
    .from("ai_conversations")
    .select("id, title, status, last_message_at, created_at, updated_at")
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.ownerUserId)
    .maybeSingle();

  return error || !isConversationRow(data) ? null : toConversationDto(data);
}

export async function listAiConversationMessages(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
    limit?: number;
  },
): Promise<AiConversationMessageDto[]> {
  const { data, error } = (await client
    .from("ai_chat_messages")
    .select(
      "id, conversation_id, sequence_no, role, status, content, parent_message_id, metadata, created_at, updated_at",
    )
    .eq("conversation_id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.ownerUserId)
    .order("sequence_no", { ascending: false })
    .limit(input.limit ?? 200)) as QueryResult<unknown[]>;

  return error || !Array.isArray(data)
    ? []
    : data.filter(isMessageRow).map(toMessageDto).reverse();
}

export async function getAiConversationGatewayState(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
  },
): Promise<ConversationGatewayState | null> {
  const { data, error } = await client
    .from("ai_conversations")
    .select(
      "provider_state, summary, summary_version, memory_status, memory_degraded_at",
    )
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.ownerUserId)
    .maybeSingle();

  if (error || !isRecord(data)) return null;
  const providerState = isRecord(data.provider_state)
    ? data.provider_state
    : {};
  const hermesGateway = isRecord(providerState.hermesGateway)
    ? providerState.hermesGateway
    : {};
  const generation = numberValue(hermesGateway.generation) ?? 0;
  const sessionId = stringValue(hermesGateway.sessionId);
  const reusableSession = sessionId
    ? parseHermesGatewayProviderState({
        generation,
        sessionId,
        ...(stringValue(hermesGateway.checkpointId)
          ? { checkpointId: stringValue(hermesGateway.checkpointId)! }
          : {}),
        provider: hermesGateway.provider,
        model: hermesGateway.model,
        lastUsedAt: hermesGateway.lastUsedAt,
      })
    : null;
  const checkpoint = isRecord(hermesGateway.checkpoint)
    ? hermesGateway.checkpoint
    : {};
  const childSessions = [
    ...new Set([
      ...stringList(hermesGateway.childSessions),
      ...stringList(checkpoint.childSessions),
    ]),
  ];
  const pendingClarify = parsePendingClarify(hermesGateway.pendingClarify);
  const parsedSummary = parseConversationMemorySummary(data.summary);
  const summary = parsedSummary ?? emptyConversationMemorySummary();
  const summaryVersion = numberValue(data.summary_version) ?? 0;
  const persistedMemoryStatus = stringValue(data.memory_status);
  const memoryStatus =
    parsedSummary && persistedMemoryStatus === "ready" ? "ready" : "degraded";
  const memoryDegradedAt = stringValue(data.memory_degraded_at);
  return {
    generation,
    ...(sessionId ? { sessionId } : {}),
    ...(reusableSession?.checkpointId
      ? { checkpointId: reusableSession.checkpointId }
      : {}),
    ...(reusableSession
      ? {
          provider: reusableSession.provider,
          model: reusableSession.model,
          lastUsedAt: reusableSession.lastUsedAt,
        }
      : {}),
    childSessions,
    ...(pendingClarify ? { pendingClarify } : {}),
    summary,
    summaryVersion,
    memoryStatus,
    memoryDegradedAt,
  };
}

export async function syncAiConversationSummary(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
    expectedSummaryVersion: number;
    summary: Record<string, unknown>;
  },
): Promise<boolean> {
  const nextVersion = input.expectedSummaryVersion + 1;
  const { data, error } = await client
    .from("ai_conversations")
    .update({
      summary: input.summary,
      summary_version: nextVersion,
    })
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.ownerUserId)
    .eq("summary_version", input.expectedSummaryVersion)
    .select("id")
    .returns<{ id: string }[]>();

  return !error && (data?.length ?? 0) > 0;
}

export async function createAiConversationTurn(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
    clientRequestId: string;
    mode: AiChatMode;
    kind: "user" | "retry" | "regenerate";
    content?: string;
    sourceTurnId?: string;
    contextSnapshot?: ConversationContextSnapshot;
  },
): Promise<CreatedConversationTurn | null> {
  const { data, error } = await client.rpc("create_ai_chat_turn", {
    p_organization_id: input.organizationId,
    p_owner_user_id: input.ownerUserId,
    p_conversation_id: input.conversationId,
    p_idempotency_key: input.clientRequestId,
    p_mode: input.mode,
    p_kind: input.kind,
    p_content: input.content ?? null,
    p_source_turn_id: input.sourceTurnId ?? null,
  });

  if (error) return null;
  const turn = parseCreatedTurn(data);
  if (!turn) return null;
  if (input.contextSnapshot && !turn.duplicate) {
    const persisted = await transitionAiConversationTurn(client, {
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      turnId: turn.turnId,
      from: turn.status,
      to: turn.status,
      patch: { contextSnapshot: input.contextSnapshot },
    });
    if (!persisted) return null;
  }
  return turn;
}

export async function getAiConversationTurn(
  client: ConversationRepositoryClient,
  input: { organizationId: string; ownerUserId: string; turnId: string },
): Promise<StoredConversationTurn | null> {
  const { data, error } = await client
    .from("ai_chat_turns")
    .select(
      "id, conversation_id, user_message_id, assistant_message_id, mode, status, attempt_no, context_snapshot, retry_of_turn_id, regenerate_of_turn_id, provider_name, outcome, cancel_requested_at, error_code, error_summary, retryable",
    )
    .eq("id", input.turnId)
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.ownerUserId)
    .maybeSingle();

  return error || !isTurnRow(data) ? null : toStoredTurn(data);
}

export async function listAiConversationTurns(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
    limit?: number;
  },
): Promise<StoredConversationTurn[]> {
  const { data, error } = (await client
    .from("ai_chat_turns")
    .select(
      "id, conversation_id, user_message_id, assistant_message_id, mode, status, attempt_no, context_snapshot, retry_of_turn_id, regenerate_of_turn_id, provider_name, outcome, cancel_requested_at, error_code, error_summary, retryable",
    )
    .eq("conversation_id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.ownerUserId)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 200)) as QueryResult<unknown[]>;

  return error || !Array.isArray(data)
    ? []
    : data.filter(isTurnRow).map(toStoredTurn).reverse();
}

export async function transitionAiConversationTurn(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    turnId: string;
    from: ConversationTurnStatus;
    to: ConversationTurnStatus;
    patch?: {
      contextSnapshot?: ConversationContextSnapshot;
      contextHash?: string;
      providerName?: AiProviderName;
      invocationId?: string;
    };
  },
): Promise<boolean> {
  const payload: Record<string, unknown> = { status: input.to };
  if (input.patch?.contextSnapshot) {
    payload.context_snapshot = input.patch.contextSnapshot;
    payload.snapshot_version = input.patch.contextSnapshot.version;
  }
  if (input.patch?.contextHash) payload.context_hash = input.patch.contextHash;
  if (input.patch?.providerName)
    payload.provider_name = input.patch.providerName;
  if (input.patch?.invocationId)
    payload.ai_invocation_id = input.patch.invocationId;
  if (input.to === "generating") payload.started_at = new Date().toISOString();

  const { data, error } = await client
    .from("ai_chat_turns")
    .update(payload)
    .eq("id", input.turnId)
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.ownerUserId)
    .eq("status", input.from)
    .select("id")
    .returns<{ id: string }[]>();

  return !error && (data?.length ?? 0) > 0;
}

export async function completeAiConversationTurn(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    turnId: string;
    content: string;
    providerName?: AiProviderName;
    invocationId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  return finishAiConversationTurn(client, {
    ...input,
    succeeded: true,
    errorCode: null,
    errorSummary: null,
    retryable: false,
  });
}

export async function failAiConversationTurn(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    turnId: string;
    content?: string;
    providerName?: AiProviderName;
    invocationId?: string;
    errorCode: string;
    errorSummary: string;
    retryable: boolean;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  return finishAiConversationTurn(client, {
    ...input,
    succeeded: false,
  });
}

export async function renewAiConversationTurnLease(
  client: ConversationRepositoryClient,
  input: { organizationId: string; ownerUserId: string; turnId: string },
): Promise<boolean> {
  const { data, error } = await client.rpc("renew_ai_chat_turn_lease", {
    p_organization_id: input.organizationId,
    p_owner_user_id: input.ownerUserId,
    p_turn_id: input.turnId,
  });
  return !error && data === true;
}

export async function recordAiConversationTurnStage(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
    turnId: string;
    stage: ConversationTurnStage;
    observedAt: string;
    sessionAction?: ConversationSessionAction;
  },
): Promise<RecordedConversationTurnStage> {
  let result: QueryResult<unknown>;
  try {
    result = await client.rpc("record_ai_chat_turn_stage", {
      p_organization_id: input.organizationId,
      p_owner_user_id: input.ownerUserId,
      p_conversation_id: input.conversationId,
      p_turn_id: input.turnId,
      p_stage: input.stage,
      p_observed_at: input.observedAt,
      p_session_action: input.sessionAction ?? null,
    });
  } catch {
    throw new ConversationTurnStagePersistenceError();
  }
  const recorded = result.error
    ? null
    : parseRecordedTurnStage(result.data, input.turnId, input.stage);
  if (!recorded) {
    throw new ConversationTurnStagePersistenceError();
  }
  return recorded;
}

export async function finishAiConversationTurnV2(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    turnId: string;
    invocationId: string;
    outcome: HermesOutcome;
    content?: string;
    providerName?: AiProviderName | null;
    errorCode?: string | null;
    errorSummary?: string | null;
    retryable: boolean;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await createHermesStateRepository(client).finishTurn(
    {
      organizationId: input.organizationId,
      userId: input.ownerUserId,
      invocationId: input.invocationId,
    },
    input.turnId,
    {
      outcome: input.outcome,
      content: input.content,
      providerName: input.providerName,
      errorCode: input.errorCode,
      errorSummary: input.errorSummary,
      retryable: input.retryable,
      metadata: input.metadata,
    },
  );
}

export type ConversationMemoryFinishResult = {
  completed: true;
  memoryStatus: "ready" | "degraded";
  summaryVersion: number;
};

export async function finishAiConversationTurnV3(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    turnId: string;
    invocationId: string;
    outcome: HermesOutcome;
    content?: string;
    providerName?: AiProviderName | null;
    errorCode?: string | null;
    errorSummary?: string | null;
    retryable: boolean;
    metadata?: Record<string, unknown>;
    expectedSummaryVersion: number;
    memoryDelta: ConversationMemoryDelta | null;
  },
): Promise<ConversationMemoryFinishResult> {
  let result: QueryResult<unknown>;
  try {
    result = await client.rpc("finish_ai_chat_turn_v3", {
      p_organization_id: input.organizationId,
      p_owner_user_id: input.ownerUserId,
      p_turn_id: input.turnId,
      p_outcome: input.outcome,
      p_content: input.content ?? "",
      p_provider_name: input.providerName ?? null,
      p_ai_invocation_id: input.invocationId,
      p_error_code: input.errorCode ?? null,
      p_error_summary: input.errorSummary ?? null,
      p_retryable: input.retryable,
      p_metadata: input.metadata ?? {},
      p_expected_summary_version: input.expectedSummaryVersion,
      p_memory_delta: input.memoryDelta,
    });
  } catch (error) {
    throw mapHermesStateRepositoryError(error);
  }
  if (result.error) throw mapHermesStateRepositoryError(result.error);
  if (!isRecord(result.data) || result.data.completed !== true) {
    throw new HermesStateRepositoryError("state_conflict");
  }
  const memoryStatus = result.data.memory_status;
  const summaryVersion = numberValue(result.data.summary_version);
  if (
    (memoryStatus !== "ready" && memoryStatus !== "degraded") ||
    summaryVersion == null ||
    !Number.isInteger(summaryVersion) ||
    summaryVersion < 0
  ) {
    throw new HermesStateRepositoryError("state_conflict");
  }
  return { completed: true, memoryStatus, summaryVersion };
}

export async function cancelAiConversationTurnV2(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
    turnId: string;
  },
): Promise<HermesTurnCancellation> {
  return createHermesStateRepository(client).cancelTurn(
    { organizationId: input.organizationId, userId: input.ownerUserId },
    input.conversationId,
    input.turnId,
  );
}

export async function renewAiConversationTurnLeaseV2(
  client: ConversationRepositoryClient,
  input: { organizationId: string; ownerUserId: string; turnId: string },
): Promise<void> {
  await createHermesStateRepository(client).renewTurnLease(
    { organizationId: input.organizationId, userId: input.ownerUserId },
    input.turnId,
  );
}

export async function compareAndSwapAiConversationGatewayState(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
    expectedGeneration: number;
    nextState: Record<string, unknown>;
  },
): Promise<number> {
  return createHermesStateRepository(client).compareAndSwapGatewayState(
    { organizationId: input.organizationId, userId: input.ownerUserId },
    input.conversationId,
    input.expectedGeneration,
    input.nextState,
  );
}

export async function claimAiConversationClarifyResponse(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
    turnId: string;
    clarifyId: string;
    answerSha256: string;
  },
): Promise<ConversationClarifyClaim> {
  const { data, error } = await client.rpc(
    "claim_ai_conversation_clarify_response",
    {
      p_organization_id: input.organizationId,
      p_owner_user_id: input.ownerUserId,
      p_conversation_id: input.conversationId,
      p_turn_id: input.turnId,
      p_clarify_id: input.clarifyId,
      p_answer_sha256: input.answerSha256,
    },
  );
  if (error || !isRecord(data)) {
    throw error ?? new Error("clarify_claim_malformed");
  }
  if (!isClarifyClaimStatus(data.status)) {
    throw new Error("clarify_claim_malformed");
  }
  const generation = numberValue(data.generation);
  return {
    status: data.status,
    ...(generation !== null ? { generation } : {}),
  };
}

export async function verifyAiConversationTerminalState(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    turnId: string;
    event: ConversationStreamEvent;
  },
): Promise<boolean> {
  const { data, error } = await client
    .from("ai_chat_turns")
    .select("status, outcome, assistant_message_id")
    .eq("id", input.turnId)
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.ownerUserId)
    .maybeSingle();

  if (error || !isRecord(data)) return false;
  const status = stringValue(data.status);
  const outcome = stringValue(data.outcome);
  const assistantMessageId = stringValue(data.assistant_message_id);
  const event = input.event;

  if (event.type === "response.completed") {
    return (
      status === "completed" &&
      outcome === event.outcome &&
      assistantMessageId === event.messageId
    );
  }
  if (event.type === "response.failed") {
    return status === "failed" && outcome === "failed";
  }
  if (event.type === "response.cancelled") {
    return (
      status === "cancelled" &&
      outcome === "cancelled" &&
      assistantMessageId === event.messageId
    );
  }
  return false;
}

async function finishAiConversationTurn(
  client: ConversationRepositoryClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    turnId: string;
    succeeded: boolean;
    content?: string;
    providerName?: AiProviderName;
    invocationId?: string;
    errorCode: string | null;
    errorSummary: string | null;
    retryable: boolean;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const { data, error } = await client.rpc("finish_ai_chat_turn", {
    p_organization_id: input.organizationId,
    p_owner_user_id: input.ownerUserId,
    p_turn_id: input.turnId,
    p_succeeded: input.succeeded,
    p_content: input.content ?? "",
    p_provider_name: input.providerName ?? null,
    p_ai_invocation_id: input.invocationId ?? null,
    p_error_code: input.errorCode,
    p_error_summary: input.errorSummary,
    p_retryable: input.retryable,
    p_metadata: input.metadata ?? {},
  });
  return !error && data === true;
}

function toConversationDto(row: ConversationRow): AiConversationDto {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function emptyConversationMemorySummary(): ConversationMemorySummary {
  return {
    schemaVersion: 1,
    goals: [],
    confirmedFacts: [],
    decisions: [],
    unresolvedQuestions: [],
    lastCompactedSequence: 0,
  };
}

function toMessageDto(row: MessageRow): AiConversationMessageDto {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequence: row.sequence_no,
    role: row.role,
    status: row.status,
    content: row.content,
    parentMessageId: row.parent_message_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStoredTurn(row: TurnRow): StoredConversationTurn {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    mode: row.mode,
    status: row.status,
    attempt: row.attempt_no,
    contextSnapshot: row.context_snapshot,
    retryOfTurnId: row.retry_of_turn_id,
    regenerateOfTurnId: row.regenerate_of_turn_id,
    providerName: row.provider_name,
    outcome: isHermesOutcome(row.outcome) ? row.outcome : null,
    cancelRequestedAt:
      typeof row.cancel_requested_at === "string" &&
      row.cancel_requested_at.trim()
        ? row.cancel_requested_at
        : null,
    errorCode: row.error_code,
    errorSummary: row.error_summary,
    retryable: row.retryable,
  };
}

function parseCreatedTurn(value: unknown): CreatedConversationTurn | null {
  if (!isRecord(value)) return null;
  const conversationId = stringValue(value.conversation_id);
  const turnId = stringValue(value.turn_id);
  const userMessageId = stringValue(value.user_message_id);
  const assistantMessageId = stringValue(value.assistant_message_id);
  const status = stringValue(value.status) as ConversationTurnStatus | null;
  const attempt = numberValue(value.attempt_no);
  if (
    !conversationId ||
    !turnId ||
    !userMessageId ||
    !assistantMessageId ||
    !status ||
    !attempt
  ) {
    return null;
  }
  return {
    conversationId,
    turnId,
    userMessageId,
    assistantMessageId,
    status,
    attempt,
    duplicate: value.duplicate === true,
  };
}

function parseRecordedTurnStage(
  value: unknown,
  expectedTurnId: string,
  expectedStage: ConversationTurnStage,
): RecordedConversationTurnStage | null {
  if (!isRecord(value)) return null;
  const turnId = stringValue(value.turnId);
  const observedAt = stringValue(value.observedAt);
  if (
    turnId !== expectedTurnId ||
    !isConversationTurnStage(value.stage) ||
    value.stage !== expectedStage ||
    !observedAt ||
    !Number.isFinite(Date.parse(observedAt))
  ) {
    return null;
  }
  if (value.stage !== "session_ready" && value.sessionAction != null) {
    return null;
  }
  if (
    value.sessionAction != null &&
    !isConversationSessionAction(value.sessionAction)
  ) {
    return null;
  }
  return {
    turnId,
    stage: value.stage,
    observedAt,
    ...(value.sessionAction != null
      ? { sessionAction: value.sessionAction }
      : {}),
  };
}

function isConversationRow(value: unknown): value is ConversationRow {
  return (
    isRecord(value) &&
    stringValue(value.id) !== null &&
    stringValue(value.title) !== null &&
    (value.status === "active" || value.status === "archived") &&
    stringValue(value.last_message_at) !== null &&
    stringValue(value.created_at) !== null &&
    stringValue(value.updated_at) !== null
  );
}

function isMessageRow(value: unknown): value is MessageRow {
  return (
    isRecord(value) &&
    stringValue(value.id) !== null &&
    stringValue(value.conversation_id) !== null &&
    numberValue(value.sequence_no) !== null &&
    ["user", "assistant", "system", "tool"].includes(String(value.role)) &&
    ["pending", "streaming", "completed", "failed", "superseded"].includes(
      String(value.status),
    ) &&
    typeof value.content === "string" &&
    stringValue(value.created_at) !== null &&
    stringValue(value.updated_at) !== null
  );
}

function isTurnRow(value: unknown): value is TurnRow {
  return (
    isRecord(value) &&
    stringValue(value.id) !== null &&
    stringValue(value.conversation_id) !== null &&
    stringValue(value.user_message_id) !== null &&
    stringValue(value.assistant_message_id) !== null &&
    (value.mode === "fast" || value.mode === "deep") &&
    stringValue(value.status) !== null &&
    numberValue(value.attempt_no) !== null &&
    (value.outcome === undefined ||
      value.outcome === null ||
      isHermesOutcome(value.outcome)) &&
    (value.cancel_requested_at === undefined ||
      value.cancel_requested_at === null ||
      stringValue(value.cancel_requested_at) !== null) &&
    typeof value.retryable === "boolean"
  );
}

function parsePendingClarify(
  value: unknown,
): ConversationGatewayPendingClarify | null {
  if (!isRecord(value)) return null;
  const turnId = stringValue(value.turnId);
  const clarifyId = stringValue(value.clarifyId);
  const requestId = stringValue(value.requestId) ?? clarifyId;
  const question = stringValue(value.question);
  const choices = Array.isArray(value.choices)
    ? value.choices.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
  if (!turnId || !clarifyId || !requestId || !question) return null;
  const responseClarifyId = isRecord(value.response)
    ? stringValue(value.response.clarifyId)
    : null;
  const responseAnswerSha256 = isRecord(value.response)
    ? stringValue(value.response.answerSha256)
    : null;
  const response =
    responseClarifyId === clarifyId && isSha256(responseAnswerSha256)
      ? { clarifyId: responseClarifyId, answerSha256: responseAnswerSha256 }
      : undefined;
  return {
    turnId,
    clarifyId,
    requestId,
    question,
    choices,
    allowFreeText: value.allowFreeText === true,
    ...(response ? { response } : {}),
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isClarifyClaimStatus(
  value: unknown,
): value is ConversationClarifyClaim["status"] {
  return value === "claimed" || value === "duplicate" || value === "conflict";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
