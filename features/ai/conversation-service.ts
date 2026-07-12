import { createHash } from "node:crypto";

import { sanitizeAiAttachments } from "./attachment-validation";
import type {
  AiConversationDto,
  AiConversationMessageDto,
  ConversationContextSnapshot,
  ConversationGatewayContext,
  CreateTurnCommand,
  RetryTurnCommand,
} from "./conversation-contracts";
import type { AiMessage, AiProviderName } from "./contracts";
import {
  completeAiConversationTurn,
  createAiConversation,
  createAiConversationTurn,
  failAiConversationTurn,
  getAiConversation,
  getAiConversationTurn,
  listAiConversationMessages,
  listAiConversationTurns,
  listAiConversations,
  renewAiConversationTurnLease,
  transitionAiConversationTurn,
  type ConversationRepositoryClient,
  type CreatedConversationTurn,
  type StoredConversationTurn,
} from "./conversation-repository";
import { hasMeaningfulAiContent } from "./response-quality";

export type ConversationActor = {
  organizationId: string;
  userId: string;
};

export type ConversationPersistence = {
  createConversation(input: {
    organizationId: string;
    ownerUserId: string;
    title: string;
  }): Promise<AiConversationDto | null>;
  listConversations(input: {
    organizationId: string;
    ownerUserId: string;
    limit?: number;
  }): Promise<AiConversationDto[]>;
  getConversation(input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
  }): Promise<AiConversationDto | null>;
  listMessages(input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
    limit?: number;
  }): Promise<AiConversationMessageDto[]>;
  listTurns(input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
    limit?: number;
  }): Promise<StoredConversationTurn[]>;
  createTurn(
    input: Parameters<typeof createAiConversationTurn>[1],
  ): Promise<CreatedConversationTurn | null>;
  getTurn(
    input: Parameters<typeof getAiConversationTurn>[1],
  ): Promise<StoredConversationTurn | null>;
  transitionTurn(
    input: Parameters<typeof transitionAiConversationTurn>[1],
  ): Promise<boolean>;
  completeTurn(
    input: Parameters<typeof completeAiConversationTurn>[1],
  ): Promise<boolean>;
  failTurn(
    input: Parameters<typeof failAiConversationTurn>[1],
  ): Promise<boolean>;
  renewLease(
    input: Parameters<typeof renewAiConversationTurnLease>[1],
  ): Promise<boolean>;
};

export class ConversationServiceError extends Error {
  constructor(
    public readonly code:
      | "conversation_create_failed"
      | "conversation_not_found"
      | "turn_create_failed"
      | "turn_not_found"
      | "turn_not_retryable"
      | "turn_not_regeneratable"
      | "turn_state_conflict"
      | "invalid_assistant_content",
    message: string,
  ) {
    super(message);
    this.name = "ConversationServiceError";
  }
}

export function createSupabaseConversationPersistence(
  client: ConversationRepositoryClient,
): ConversationPersistence {
  return {
    createConversation: (input) => createAiConversation(client, input),
    listConversations: (input) => listAiConversations(client, input),
    getConversation: (input) => getAiConversation(client, input),
    listMessages: (input) => listAiConversationMessages(client, input),
    listTurns: (input) => listAiConversationTurns(client, input),
    createTurn: (input) => createAiConversationTurn(client, input),
    getTurn: (input) => getAiConversationTurn(client, input),
    transitionTurn: (input) => transitionAiConversationTurn(client, input),
    completeTurn: (input) => completeAiConversationTurn(client, input),
    failTurn: (input) => failAiConversationTurn(client, input),
    renewLease: (input) => renewAiConversationTurnLease(client, input),
  };
}

export function createConversationService(
  persistence: ConversationPersistence,
  options: { now?: () => Date; contextCharacterBudget?: number } = {},
) {
  const now = options.now ?? (() => new Date());
  const contextCharacterBudget = options.contextCharacterBudget ?? 24_000;

  return {
    async createConversation(
      actor: ConversationActor,
      title = "新会话",
    ): Promise<AiConversationDto> {
      const normalizedTitle = title.trim().slice(0, 120) || "新会话";
      const conversation = await persistence.createConversation({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        title: normalizedTitle,
      });
      if (!conversation) {
        throw new ConversationServiceError(
          "conversation_create_failed",
          "Unable to create conversation",
        );
      }
      return conversation;
    },

    listConversations(actor: ConversationActor, limit = 30) {
      return persistence.listConversations({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        limit,
      });
    },

    async getHistory(actor: ConversationActor, conversationId: string) {
      const conversation = await persistence.getConversation({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        conversationId,
      });
      if (!conversation) {
        throw new ConversationServiceError(
          "conversation_not_found",
          "Conversation not found",
        );
      }
      const scope = {
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        conversationId,
      };
      const [messages, turns] = await Promise.all([
        persistence.listMessages(scope),
        persistence.listTurns(scope),
      ]);
      return { conversation, messages, turns };
    },

    async acceptTurn(
      actor: ConversationActor,
      conversationId: string,
      command: CreateTurnCommand,
    ): Promise<CreatedConversationTurn> {
      return requireCreatedTurn(
        await persistence.createTurn({
          organizationId: actor.organizationId,
          ownerUserId: actor.userId,
          conversationId,
          clientRequestId: command.clientRequestId,
          mode: command.mode,
          kind: "user",
          content: command.content,
        }),
      );
    },

    async retryTurn(
      actor: ConversationActor,
      sourceTurnId: string,
      command: RetryTurnCommand,
    ): Promise<CreatedConversationTurn> {
      const source = await requireTurn(persistence, actor, sourceTurnId);
      if (source.status !== "failed" || !source.retryable) {
        throw new ConversationServiceError(
          "turn_not_retryable",
          "Only failed retryable turns can be retried",
        );
      }
      return requireCreatedTurn(
        await persistence.createTurn({
          organizationId: actor.organizationId,
          ownerUserId: actor.userId,
          conversationId: source.conversationId,
          clientRequestId: command.clientRequestId,
          mode: source.mode,
          kind: "retry",
          sourceTurnId,
        }),
      );
    },

    async regenerateTurn(
      actor: ConversationActor,
      sourceTurnId: string,
      command: RetryTurnCommand,
    ): Promise<CreatedConversationTurn> {
      const source = await requireTurn(persistence, actor, sourceTurnId);
      if (source.status !== "completed") {
        throw new ConversationServiceError(
          "turn_not_regeneratable",
          "Only completed turns can be regenerated",
        );
      }
      return requireCreatedTurn(
        await persistence.createTurn({
          organizationId: actor.organizationId,
          ownerUserId: actor.userId,
          conversationId: source.conversationId,
          clientRequestId: command.clientRequestId,
          mode: source.mode,
          kind: "regenerate",
          sourceTurnId,
        }),
      );
    },

    async prepareTurn(
      actor: ConversationActor,
      turnId: string,
      groundingRefs: string[] = [],
    ): Promise<{
      turn: StoredConversationTurn;
      messages: AiMessage[];
      snapshot: ConversationContextSnapshot;
    }> {
      const turn = await requireTurn(persistence, actor, turnId);
      if (turn.status !== "accepted") {
        throw new ConversationServiceError(
          "turn_state_conflict",
          "Turn is no longer waiting for context",
        );
      }

      const frozenSnapshot = normalizeStoredConversationSnapshot(
        turn.contextSnapshot,
      );
      if (frozenSnapshot?.gatewayContext) {
        const persistedSnapshot = requireConversationSnapshot(frozenSnapshot);
        const contextHash = hashConversationSnapshot(persistedSnapshot);
        const transitioned = await persistence.transitionTurn({
          organizationId: actor.organizationId,
          ownerUserId: actor.userId,
          turnId,
          from: "accepted",
          to: "grounding",
          patch: { contextSnapshot: persistedSnapshot, contextHash },
        });
        if (!transitioned) {
          throw new ConversationServiceError(
            "turn_state_conflict",
            "Turn state changed while restoring frozen context",
          );
        }
        return {
          turn,
          messages: frozenSnapshot.gatewayContext.messages.map((message) => ({
            ...message,
          })),
          snapshot: frozenSnapshot,
        };
      }

      const allMessages = await persistence.listMessages({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        conversationId: turn.conversationId,
      });
      const completed = allMessages.filter(
        (message) =>
          message.status === "completed" &&
          (message.role === "user" || message.role === "assistant"),
      );
      const snapshotIds = frozenSnapshot?.messageIds ?? [];
      const eligible = snapshotIds.length
        ? completed.filter((message) => snapshotIds.includes(message.id))
        : completed;
      const selected = takeLatestWithinBudget(eligible, contextCharacterBudget);
      const snapshot = frozenSnapshot ?? {
        version: 1,
        summaryVersion: 0,
        messageIds: selected.map((message) => message.id),
        groundingRefs: [...new Set(groundingRefs)],
        assembledAt: now().toISOString(),
      };
      const persistedSnapshot = requireConversationSnapshot(snapshot);
      const contextHash = hashConversationSnapshot(persistedSnapshot);

      const transitioned = await persistence.transitionTurn({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        turnId,
        from: "accepted",
        to: "grounding",
        patch: { contextSnapshot: persistedSnapshot, contextHash },
      });
      if (!transitioned) {
        throw new ConversationServiceError(
          "turn_state_conflict",
          "Turn state changed while preparing context",
        );
      }

      return {
        turn,
        messages: selected.map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
        })),
        snapshot,
      };
    },

    async captureGatewayContext(
      actor: ConversationActor,
      turnId: string,
      snapshot: ConversationContextSnapshot,
      gatewayContext: ConversationGatewayContext,
    ) {
      const trustedSnapshot = requireConversationSnapshot(snapshot);
      const trustedGatewayContext =
        requireConversationGatewayContext(gatewayContext);
      const nextSnapshot = {
        ...trustedSnapshot,
        gatewayContext: trustedGatewayContext,
      };
      const persistedSnapshot = requireConversationSnapshot(nextSnapshot);
      const captured = await persistence.transitionTurn({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        turnId,
        from: "grounding",
        to: "grounding",
        patch: {
          contextSnapshot: persistedSnapshot,
          contextHash: hashConversationSnapshot(persistedSnapshot),
        },
      });
      if (!captured) {
        throw new ConversationServiceError(
          "turn_state_conflict",
          "Turn context changed before the gateway snapshot was captured",
        );
      }
      return nextSnapshot;
    },

    async markGenerating(
      actor: ConversationActor,
      turnId: string,
      providerName?: AiProviderName,
      invocationId?: string,
    ) {
      await requireTransition(persistence, {
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        turnId,
        from: "grounding",
        to: "generating",
        patch: { providerName, invocationId },
      });
    },

    async markValidating(actor: ConversationActor, turnId: string) {
      await requireTransition(persistence, {
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        turnId,
        from: "generating",
        to: "validating",
      });
    },

    async completeTurn(
      actor: ConversationActor,
      turnId: string,
      input: {
        content: string;
        providerName?: AiProviderName;
        invocationId?: string;
        metadata?: Record<string, unknown>;
      },
    ) {
      if (!hasMeaningfulAiContent(input.content)) {
        throw new ConversationServiceError(
          "invalid_assistant_content",
          "Assistant response has no meaningful content",
        );
      }
      const completed = await persistence.completeTurn({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        turnId,
        ...input,
      });
      if (!completed) {
        throw new ConversationServiceError(
          "turn_state_conflict",
          "Turn could not be completed",
        );
      }
    },

    async failTurn(
      actor: ConversationActor,
      turnId: string,
      input: {
        content?: string;
        providerName?: AiProviderName;
        invocationId?: string;
        errorCode: string;
        errorSummary: string;
        retryable: boolean;
      },
    ) {
      const failed = await persistence.failTurn({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        turnId,
        ...input,
      });
      if (!failed) {
        throw new ConversationServiceError(
          "turn_state_conflict",
          "Turn could not be failed",
        );
      }
    },

    async renewLease(actor: ConversationActor, turnId: string) {
      const renewed = await persistence.renewLease({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        turnId,
      });
      if (!renewed) {
        throw new ConversationServiceError(
          "turn_state_conflict",
          "Turn lease could not be renewed",
        );
      }
    },
  };
}

async function requireTurn(
  persistence: ConversationPersistence,
  actor: ConversationActor,
  turnId: string,
): Promise<StoredConversationTurn> {
  const turn = await persistence.getTurn({
    organizationId: actor.organizationId,
    ownerUserId: actor.userId,
    turnId,
  });
  if (!turn) {
    throw new ConversationServiceError("turn_not_found", "Turn not found");
  }
  return turn;
}

function requireCreatedTurn(
  turn: CreatedConversationTurn | null,
): CreatedConversationTurn {
  if (!turn) {
    throw new ConversationServiceError(
      "turn_create_failed",
      "Unable to create turn",
    );
  }
  return turn;
}

async function requireTransition(
  persistence: ConversationPersistence,
  input: Parameters<ConversationPersistence["transitionTurn"]>[0],
) {
  if (!(await persistence.transitionTurn(input))) {
    throw new ConversationServiceError(
      "turn_state_conflict",
      "Turn state transition was rejected",
    );
  }
}

function takeLatestWithinBudget(
  messages: AiConversationMessageDto[],
  budget: number,
): AiConversationMessageDto[] {
  const selected: AiConversationMessageDto[] = [];
  let remaining = Math.max(1, budget);

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const cost = message.content.length;
    if (cost > remaining && selected.length > 0) continue;
    selected.push(message);
    remaining = Math.max(0, remaining - cost);
    if (remaining === 0) break;
  }

  return selected.reverse();
}

function normalizeStoredConversationSnapshot(
  value: unknown,
): ConversationContextSnapshot | null {
  if (value === null || value === undefined) return null;

  const ownedValue = copyPlainJson(value);
  if (isRecord(ownedValue) && Object.keys(ownedValue).length === 0) return null;
  return requireOwnedConversationSnapshot(ownedValue);
}

function requireConversationSnapshot(
  value: unknown,
): ConversationContextSnapshot {
  return requireOwnedConversationSnapshot(copyPlainJson(value));
}

function requireOwnedConversationSnapshot(
  value: unknown,
): ConversationContextSnapshot {
  if (!isConversationSnapshot(value)) {
    throw new ConversationServiceError(
      "turn_state_conflict",
      "Conversation context snapshot is structurally invalid",
    );
  }
  return value;
}

function requireConversationGatewayContext(
  value: unknown,
): ConversationGatewayContext {
  const ownedValue = copyPlainJson(value);
  if (!isConversationGatewayContext(ownedValue)) {
    throw new ConversationServiceError(
      "turn_state_conflict",
      "Conversation gateway context is structurally invalid",
    );
  }
  return ownedValue;
}

function isConversationSnapshot(
  value: unknown,
): value is ConversationContextSnapshot {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Number.isInteger(value.summaryVersion) &&
    Number(value.summaryVersion) >= 0 &&
    isStringArray(value.messageIds) &&
    isStringArray(value.groundingRefs) &&
    typeof value.assembledAt === "string" &&
    value.assembledAt.trim().length > 0 &&
    Number.isFinite(Date.parse(value.assembledAt)) &&
    (value.gatewayContext === undefined ||
      isConversationGatewayContext(value.gatewayContext))
  );
}

function isConversationGatewayContext(
  value: unknown,
): value is ConversationGatewayContext {
  if (!isRecord(value) || !isRecord(value.responseMetadata)) return false;

  return (
    Array.isArray(value.messages) &&
    value.messages.every(isAiMessage) &&
    hasExactSanitizedAttachments(value.attachments) &&
    (value.mode === "fast" || value.mode === "deep") &&
    typeof value.primaryProvider === "string" &&
    ["openai", "hunyuan", "deepseek", "deterministic"].includes(
      value.primaryProvider,
    ) &&
    typeof value.lastUserMessage === "string" &&
    isRecord(value.responseMetadata.grounding) &&
    isRecord(value.responseMetadata.knowledge) &&
    Object.prototype.hasOwnProperty.call(
      value.responseMetadata,
      "retrospectiveDraft",
    ) &&
    isRecord(value.invocationMetadata)
  );
}

function isAiMessage(value: unknown): value is AiMessage {
  return (
    isRecord(value) &&
    typeof value.role === "string" &&
    ["system", "user", "assistant", "tool"].includes(value.role) &&
    typeof value.content === "string"
  );
}

function hasExactSanitizedAttachments(value: unknown): boolean {
  const result = sanitizeAiAttachments(value);
  return result.ok && areJsonValuesEqual(value, result.attachments);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => areJsonValuesEqual(item, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        areJsonValuesEqual(left[key], right[key]),
    )
  );
}

type PlainJsonValue =
  | null
  | boolean
  | number
  | string
  | PlainJsonValue[]
  | { [key: string]: PlainJsonValue };

function copyPlainJson(value: unknown): PlainJsonValue {
  return copyPlainJsonValue(value, new Set<object>());
}

function copyPlainJsonValue(
  value: unknown,
  ancestors: Set<object>,
): PlainJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    return rejectUnsafeConversationContext();
  }
  if (typeof value !== "object") return rejectUnsafeConversationContext();
  if (ancestors.has(value)) return rejectUnsafeConversationContext();

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return rejectUnsafeConversationContext();
      }
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes("length")) {
        return rejectUnsafeConversationContext();
      }
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return rejectUnsafeConversationContext();
        }
        return copyPlainJsonValue(descriptor.value, ancestors);
      });
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return rejectUnsafeConversationContext();
    }
    const copy: { [key: string]: PlainJsonValue } = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return rejectUnsafeConversationContext();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return rejectUnsafeConversationContext();
      }
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: copyPlainJsonValue(descriptor.value, ancestors),
        writable: true,
      });
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}

function rejectUnsafeConversationContext(): never {
  throw new ConversationServiceError(
    "turn_state_conflict",
    "Conversation context must be owned plain JSON data",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashConversationSnapshot(
  snapshot: ConversationContextSnapshot,
): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
