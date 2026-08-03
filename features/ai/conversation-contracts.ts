import type {
  AiAttachment,
  AiChatMode,
  AiMessage,
  AiProviderName,
} from "./contracts";
import { sanitizeAiAttachments } from "./attachment-validation";
import { hasMeaningfulAiContent } from "./response-quality";

export type ConversationStatus = "active" | "archived";
export type ConversationMessageRole = "user" | "assistant" | "system" | "tool";
export type ConversationMessageStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "superseded";
export type ConversationTurnStatus =
  | "accepted"
  | "grounding"
  | "generating"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled";
export type ConversationTurnStage =
  | "accepted"
  | "context_ready"
  | "session_ready"
  | "agent_ready"
  | "first_delta"
  | "terminal"
  | "persisted";
export type ConversationSessionAction = "resumed" | "rebuilt";

export const CONVERSATION_MEMORY_LIMITS = {
  itemsPerSection: 24,
  textCharacters: 512,
  sourceMessageIdsPerItem: 8,
} as const;

export type ConversationMemoryItem = {
  text: string;
  sourceMessageIds: string[];
};

export type ConversationMemorySummary = {
  schemaVersion: 1;
  goals: ConversationMemoryItem[];
  confirmedFacts: ConversationMemoryItem[];
  decisions: ConversationMemoryItem[];
  unresolvedQuestions: ConversationMemoryItem[];
  lastCompactedSequence: number;
};

export type ConversationMemoryDelta = Omit<
  ConversationMemorySummary,
  "schemaVersion" | "lastCompactedSequence"
> & { throughSequence: number };

export type ConversationMemorySourceMessage = {
  id: string;
  conversationId: string;
  sequence: number;
};

export type ConversationContextSnapshot = {
  version: number;
  summaryVersion: number;
  lastCompactedSequence?: number;
  messageIds: string[];
  groundingRefs: string[];
  assembledAt: string;
  runtimeSelection?: ConversationRuntimeSelection;
  gatewayContext?: ConversationGatewayContext;
};

export type ConversationRuntimeSelection = {
  runtime: "gateway" | "legacy";
  protocol: string;
  profile: string;
};

export type ConversationResponseOutcome = "complete" | "partial" | "blocked";

export type ConversationGatewayContext = {
  messages: AiMessage[];
  attachments: AiAttachment[];
  mode: AiChatMode;
  primaryProvider: AiProviderName;
  lastUserMessage: string;
  responseMetadata: {
    grounding: Record<string, unknown>;
    knowledge: Record<string, unknown>;
    retrospectiveDraft: unknown;
  };
  invocationMetadata: Record<string, unknown>;
};

export type AiConversationDto = {
  id: string;
  title: string;
  status: ConversationStatus;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AiConversationMessageDto = {
  id: string;
  conversationId: string;
  sequence: number;
  role: ConversationMessageRole;
  status: ConversationMessageStatus;
  content: string;
  parentMessageId: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AiConversationTurnDto = {
  id: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  mode: AiChatMode;
  status: ConversationTurnStatus;
  attempt: number;
  retryOfTurnId: string | null;
  regenerateOfTurnId: string | null;
  errorCode: string | null;
  retryable: boolean;
};

export type CreateTurnCommand = {
  content: string;
  mode: AiChatMode;
  clientRequestId: string;
  attachments: AiAttachment[];
};

export type RetryTurnCommand = {
  clientRequestId: string;
};

export type ConversationStreamEvent =
  | {
      type: "turn.started";
      conversationId: string;
      turnId: string;
      userMessageId: string;
      assistantMessageId: string;
    }
  | {
      type: "context.ready";
      conversationId: string;
      turnId: string;
      snapshotVersion: number;
    }
  | {
      type: "activity.updated";
      conversationId: string;
      turnId: string;
      label: string;
      status: "pending" | "running" | "completed" | "failed";
    }
  | {
      type: "tool.started";
      conversationId: string;
      turnId: string;
      toolCallId: string;
      toolName: string;
      label: string;
    }
  | {
      type: "tool.completed";
      conversationId: string;
      turnId: string;
      toolCallId: string;
      toolName: string;
      status: "completed" | "failed" | "denied";
      label: string;
      evidence?: string[];
      missing?: string[];
      observedAt?: string;
    }
  | {
      type: "clarify.requested";
      conversationId: string;
      turnId: string;
      clarifyId: string;
      question: string;
      choices?: string[];
      allowFreeText?: boolean;
    }
  | {
      type: "todo.updated";
      conversationId: string;
      turnId: string;
      items: Array<{
        id: string;
        label: string;
        status: "pending" | "running" | "done" | "blocked";
      }>;
    }
  | {
      type: "subagent.updated";
      conversationId: string;
      turnId: string;
      subagentId: string;
      label: string;
      status: "pending" | "running" | "completed" | "failed";
    }
  | {
      type: "response.delta";
      conversationId: string;
      turnId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: "response.completed";
      conversationId: string;
      turnId: string;
      messageId: string;
      content: string;
      outcome: ConversationResponseOutcome;
      evidence: string[];
      missing: string[];
      observationTimes: {
        firstObservedAt: string | null;
        lastObservedAt: string | null;
      };
      meta?: Record<string, unknown>;
      invocationId?: string;
    }
  | {
      type: "response.failed";
      conversationId: string;
      turnId: string;
      code: string;
      retryable: boolean;
      message: string;
      invocationId?: string;
    }
  | {
      type: "response.cancelled";
      conversationId: string;
      turnId: string;
      messageId: string;
      invocationId?: string;
    }
  | {
      type: "heartbeat";
      conversationId: string;
      turnId: string;
    };

const TURN_TRANSITIONS: Record<
  ConversationTurnStatus,
  readonly ConversationTurnStatus[]
> = {
  accepted: ["grounding", "failed", "cancelled"],
  grounding: ["generating", "failed", "cancelled"],
  generating: ["validating", "failed", "cancelled"],
  validating: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionConversationTurn(
  from: ConversationTurnStatus,
  to: ConversationTurnStatus,
): boolean {
  return TURN_TRANSITIONS[from].includes(to);
}

export function isConversationTurnStage(
  value: unknown,
): value is ConversationTurnStage {
  return (
    typeof value === "string" &&
    [
      "accepted",
      "context_ready",
      "session_ready",
      "agent_ready",
      "first_delta",
      "terminal",
      "persisted",
    ].includes(value)
  );
}

export function isConversationSessionAction(
  value: unknown,
): value is ConversationSessionAction {
  return value === "resumed" || value === "rebuilt";
}

export function parseCreateTurnCommand(
  value: unknown,
): CreateTurnCommand | null {
  if (!isRecord(value)) {
    return null;
  }

  const content = normalizedString(value.content, 12_000);
  const clientRequestId = parseClientRequestId(value.clientRequestId);
  const mode =
    value.mode === "deep"
      ? "deep"
      : value.mode === "fast" || value.mode == null
        ? "fast"
        : null;
  const attachmentResult = sanitizeAiAttachments(value.attachments);
  const attachments = attachmentResult.ok ? attachmentResult.attachments : null;
  if (!content || !clientRequestId || !mode || !attachments) {
    return null;
  }

  return { content, mode, clientRequestId, attachments };
}

export function parseRetryTurnCommand(value: unknown): RetryTurnCommand | null {
  if (!isRecord(value)) {
    return null;
  }
  const clientRequestId = parseClientRequestId(value.clientRequestId);
  return clientRequestId ? { clientRequestId } : null;
}

export function parseConversationMemorySummary(
  value: unknown,
): ConversationMemorySummary | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "goals",
      "confirmedFacts",
      "decisions",
      "unresolvedQuestions",
      "lastCompactedSequence",
    ]) ||
    value.schemaVersion !== 1 ||
    !isNonNegativeInteger(value.lastCompactedSequence)
  ) {
    return null;
  }
  const sections = parseMemorySections(value);
  return sections
    ? {
        schemaVersion: 1,
        ...sections,
        lastCompactedSequence: value.lastCompactedSequence,
      }
    : null;
}

export function parseConversationMemoryDelta(
  value: unknown,
  provenance: {
    conversationId: string;
    sourceMessages: readonly ConversationMemorySourceMessage[];
    previousSummary: ConversationMemorySummary;
  },
): ConversationMemoryDelta | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "goals",
      "confirmedFacts",
      "decisions",
      "unresolvedQuestions",
      "throughSequence",
    ]) ||
    !isNonNegativeInteger(value.throughSequence) ||
    value.throughSequence < provenance.previousSummary.lastCompactedSequence
  ) {
    return null;
  }
  const throughSequence = value.throughSequence;

  const sections = parseMemorySections(value);
  if (!sections) return null;

  const sourceSequences = new Map(
    provenance.sourceMessages
      .filter((message) => message.conversationId === provenance.conversationId)
      .map((message) => [message.id, message.sequence] as const),
  );
  const items = Object.values(sections).flat();
  if (
    items.some((item) =>
      item.sourceMessageIds.some((id) => {
        const sequence = sourceSequences.get(id);
        return sequence == null || sequence > throughSequence;
      }),
    )
  ) {
    return null;
  }

  const maximumSequence = Math.max(
    provenance.previousSummary.lastCompactedSequence,
    ...provenance.sourceMessages
      .filter((message) => message.conversationId === provenance.conversationId)
      .map((message) => message.sequence),
  );
  if (throughSequence > maximumSequence) return null;

  return { ...sections, throughSequence };
}

export function applyConversationMemoryDelta(
  previousSummary: ConversationMemorySummary,
  delta: ConversationMemoryDelta,
): ConversationMemorySummary {
  if (delta.throughSequence < previousSummary.lastCompactedSequence) {
    throw new RangeError("conversation_memory_sequence_regression");
  }
  return {
    schemaVersion: 1,
    goals: delta.goals,
    confirmedFacts: delta.confirmedFacts,
    decisions: delta.decisions,
    unresolvedQuestions: delta.unresolvedQuestions,
    lastCompactedSequence: delta.throughSequence,
  };
}

export function isConversationStreamEvent(
  value: unknown,
): value is ConversationStreamEvent {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.type) ||
    !nonEmptyString(value.conversationId) ||
    !nonEmptyString(value.turnId)
  ) {
    return false;
  }

  switch (value.type) {
    case "turn.started":
      return (
        nonEmptyString(value.userMessageId) &&
        nonEmptyString(value.assistantMessageId)
      );
    case "context.ready":
      return (
        typeof value.snapshotVersion === "number" &&
        Number.isInteger(value.snapshotVersion) &&
        value.snapshotVersion > 0
      );
    case "activity.updated":
      return (
        nonEmptyString(value.label) &&
        ["pending", "running", "completed", "failed"].includes(
          String(value.status),
        ) &&
        !Object.prototype.hasOwnProperty.call(value, "reasoning")
      );
    case "tool.started":
      return (
        nonEmptyString(value.toolCallId) &&
        nonEmptyString(value.toolName) &&
        nonEmptyString(value.label)
      );
    case "tool.completed":
      return (
        nonEmptyString(value.toolCallId) &&
        nonEmptyString(value.toolName) &&
        nonEmptyString(value.label) &&
        ["completed", "failed", "denied"].includes(String(value.status)) &&
        (value.evidence == null || isStringArray(value.evidence)) &&
        (value.missing == null || isStringArray(value.missing)) &&
        (value.observedAt == null || isDateString(value.observedAt))
      );
    case "clarify.requested":
      return (
        nonEmptyString(value.clarifyId) &&
        nonEmptyString(value.question) &&
        (value.choices == null || isStringArray(value.choices)) &&
        (value.allowFreeText == null ||
          typeof value.allowFreeText === "boolean")
      );
    case "todo.updated":
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item) =>
            isRecord(item) &&
            nonEmptyString(item.id) &&
            nonEmptyString(item.label) &&
            ["pending", "running", "done", "blocked"].includes(
              String(item.status),
            ),
        )
      );
    case "subagent.updated":
      return (
        nonEmptyString(value.subagentId) &&
        nonEmptyString(value.label) &&
        ["pending", "running", "completed", "failed"].includes(
          String(value.status),
        )
      );
    case "response.delta":
      return nonEmptyString(value.messageId) && typeof value.delta === "string";
    case "response.completed":
      return (
        nonEmptyString(value.messageId) &&
        typeof value.content === "string" &&
        hasMeaningfulAiContent(value.content) &&
        ["complete", "partial", "blocked"].includes(String(value.outcome)) &&
        isStringArray(value.evidence) &&
        isStringArray(value.missing) &&
        isRecord(value.observationTimes) &&
        (value.observationTimes.firstObservedAt === null ||
          isDateString(value.observationTimes.firstObservedAt)) &&
        (value.observationTimes.lastObservedAt === null ||
          isDateString(value.observationTimes.lastObservedAt)) &&
        (value.meta == null || isRecord(value.meta)) &&
        (value.invocationId == null || nonEmptyString(value.invocationId))
      );
    case "response.failed":
      return (
        nonEmptyString(value.code) &&
        typeof value.retryable === "boolean" &&
        nonEmptyString(value.message) &&
        !Object.prototype.hasOwnProperty.call(value, "outcome") &&
        (value.invocationId == null || nonEmptyString(value.invocationId))
      );
    case "response.cancelled":
      return (
        nonEmptyString(value.messageId) &&
        (value.invocationId == null || nonEmptyString(value.invocationId))
      );
    case "heartbeat":
      return true;
    default:
      return false;
  }
}

function parseClientRequestId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length >= 8 &&
    normalized.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(normalized)
    ? normalized
    : null;
}

function parseMemorySections(
  value: Record<string, unknown>,
): Omit<
  ConversationMemorySummary,
  "schemaVersion" | "lastCompactedSequence"
> | null {
  const goals = parseMemoryItems(value.goals);
  const confirmedFacts = parseMemoryItems(value.confirmedFacts);
  const decisions = parseMemoryItems(value.decisions);
  const unresolvedQuestions = parseMemoryItems(value.unresolvedQuestions);
  return goals && confirmedFacts && decisions && unresolvedQuestions
    ? { goals, confirmedFacts, decisions, unresolvedQuestions }
    : null;
}

function parseMemoryItems(value: unknown): ConversationMemoryItem[] | null {
  if (
    !Array.isArray(value) ||
    value.length > CONVERSATION_MEMORY_LIMITS.itemsPerSection
  ) {
    return null;
  }
  const items: ConversationMemoryItem[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["text", "sourceMessageIds"]) ||
      !isMemoryText(candidate.text) ||
      !Array.isArray(candidate.sourceMessageIds) ||
      candidate.sourceMessageIds.length === 0 ||
      candidate.sourceMessageIds.length >
        CONVERSATION_MEMORY_LIMITS.sourceMessageIdsPerItem ||
      !candidate.sourceMessageIds.every(isUuidString) ||
      new Set(candidate.sourceMessageIds).size !==
        candidate.sourceMessageIds.length
    ) {
      return null;
    }
    items.push({
      text: candidate.text.trim(),
      sourceMessageIds: [...candidate.sourceMessageIds],
    });
  }
  return items;
}

function isMemoryText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return (
    text.length > 0 &&
    text.length <= CONVERSATION_MEMORY_LIMITS.textCharacters &&
    !/[\r\n]/.test(text) &&
    !/^(?:user|assistant|system|tool)\s*:/i.test(text) &&
    !/<\/?(?:conversation_context|current_request|recent_messages|summary)>/i.test(
      text,
    )
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isUuidString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function normalizedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function isDateString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
