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

export type ConversationContextSnapshot = {
  version: number;
  summaryVersion: number;
  messageIds: string[];
  groundingRefs: string[];
  assembledAt: string;
  gatewayContext?: ConversationGatewayContext;
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
      question: string;
      choices?: string[];
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

export function parseCreateTurnCommand(value: unknown): CreateTurnCommand | null {
  if (!isRecord(value)) {
    return null;
  }

  const content = normalizedString(value.content, 12_000);
  const clientRequestId = parseClientRequestId(value.clientRequestId);
  const mode = value.mode === "deep" ? "deep" : value.mode === "fast" || value.mode == null ? "fast" : null;
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
        nonEmptyString(value.question) &&
        (value.choices == null || isStringArray(value.choices))
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
