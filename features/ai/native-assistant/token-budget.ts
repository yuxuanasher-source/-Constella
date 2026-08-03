import type { ConversationMemorySummary } from "../conversation-contracts";
import type { GatewayLedgerTranscriptMessage } from "./context-engine";

export type ConversationTokenBudget = {
  contextWindowTokens: number;
  reservedSystemTokens: number;
  reservedToolTokens: number;
  reservedAttachmentTokens: number;
  reservedOutputTokens: number;
};

export const DEFAULT_CONVERSATION_CONTEXT_WINDOW_TOKENS = 16_384;
export const CONVERSATION_MESSAGE_ENVELOPE_TOKENS = 8;

export function estimateConservativeTokens(text: string): number {
  let asciiBytes = 0;
  let nonAsciiCodePoints = 0;
  for (const codePoint of text) {
    if (codePoint.codePointAt(0)! <= 0x7f) asciiBytes += 1;
    else nonAsciiCodePoints += 1;
  }
  return nonAsciiCodePoints + Math.ceil(asciiBytes / 4);
}

export function selectConversationContext(input: {
  currentRequest: GatewayLedgerTranscriptMessage;
  pinnedFacts: GatewayLedgerTranscriptMessage[];
  summary: ConversationMemorySummary;
  recentMessages: GatewayLedgerTranscriptMessage[];
  budget: ConversationTokenBudget;
}): GatewayLedgerTranscriptMessage[] {
  const available = availableContextTokens(input.budget);
  const mandatory = [input.currentRequest, ...input.pinnedFacts];
  let used = mandatory.reduce(
    (total, message) => total + messageTokens(message),
    0,
  );
  if (used > available) {
    throw new RangeError("conversation_context_budget_exceeded");
  }

  const selected = [...mandatory];
  if (hasConversationMemory(input.summary)) {
    const summary = summaryMessage(input.summary);
    const summaryTokens = messageTokens(summary);
    if (used + summaryTokens <= available) {
      selected.push(summary);
      used += summaryTokens;
    }
  }

  const selectedIds = new Set(selected.map(messageIdentity).filter(Boolean));
  for (let index = input.recentMessages.length - 1; index >= 0; index -= 1) {
    const message = input.recentMessages[index];
    if (!message) continue;
    const identity = messageIdentity(message);
    if (identity && selectedIds.has(identity)) continue;
    const tokens = messageTokens(message);
    if (used + tokens > available) continue;
    selected.push(message);
    used += tokens;
    if (identity) selectedIds.add(identity);
  }
  return selected;
}

function hasConversationMemory(summary: ConversationMemorySummary): boolean {
  return (
    summary.lastCompactedSequence > 0 ||
    summary.goals.length > 0 ||
    summary.confirmedFacts.length > 0 ||
    summary.decisions.length > 0 ||
    summary.unresolvedQuestions.length > 0
  );
}

export function resolveConversationTokenBudget(
  model: string,
): ConversationTokenBudget {
  const contextWindowTokens =
    model === "hermes-official-gateway"
      ? 32_768
      : DEFAULT_CONVERSATION_CONTEXT_WINDOW_TOKENS;
  return {
    contextWindowTokens,
    reservedSystemTokens: 1_024,
    reservedToolTokens: 2_048,
    reservedAttachmentTokens: 2_048,
    reservedOutputTokens: 4_096,
  };
}

function availableContextTokens(budget: ConversationTokenBudget): number {
  for (const value of Object.values(budget)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError("conversation_token_budget_invalid");
    }
  }
  return Math.max(
    0,
    budget.contextWindowTokens -
      budget.reservedSystemTokens -
      budget.reservedToolTokens -
      budget.reservedAttachmentTokens -
      budget.reservedOutputTokens,
  );
}

function messageTokens(message: GatewayLedgerTranscriptMessage): number {
  return (
    CONVERSATION_MESSAGE_ENVELOPE_TOKENS +
    estimateConservativeTokens(message.content)
  );
}

function messageIdentity(message: GatewayLedgerTranscriptMessage): string {
  const id = message.metadata?.messageId;
  return typeof id === "string" ? id : "";
}

function summaryMessage(
  summary: ConversationMemorySummary,
): GatewayLedgerTranscriptMessage {
  return {
    role: "tool",
    content: JSON.stringify(summary),
    metadata: {
      messageId: "conversation-memory-summary",
      kind: "conversation.memory.summary",
    },
  };
}
