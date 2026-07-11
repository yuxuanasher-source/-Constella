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
    case "response.delta":
      return nonEmptyString(value.messageId) && typeof value.delta === "string";
    case "response.completed":
      return (
        nonEmptyString(value.messageId) &&
        typeof value.content === "string" &&
        hasMeaningfulAiContent(value.content) &&
        (value.meta == null || isRecord(value.meta)) &&
        (value.invocationId == null || nonEmptyString(value.invocationId))
      );
    case "response.failed":
      return (
        nonEmptyString(value.code) &&
        typeof value.retryable === "boolean" &&
        nonEmptyString(value.message) &&
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
