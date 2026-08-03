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
  const available = availableConversationContextTokens(input.budget);
  const mandatory = [input.currentRequest, ...input.pinnedFacts];
  if (serializedPromptTokens(input, mandatory) > available) {
    throw new RangeError("conversation_context_budget_exceeded");
  }

  const selected = [...mandatory];
  if (hasConversationMemory(input.summary)) {
    const summary = summaryMessage(input.summary);
    if (serializedPromptTokens(input, [...selected, summary]) <= available) {
      selected.push(summary);
    }
  }

  const selectedIds = new Set(selected.map(messageIdentity).filter(Boolean));
  for (let index = input.recentMessages.length - 1; index >= 0; index -= 1) {
    const message = input.recentMessages[index];
    if (!message) continue;
    const identity = messageIdentity(message);
    if (identity && selectedIds.has(identity)) continue;
    if (serializedPromptTokens(input, [...selected, message]) > available) {
      continue;
    }
    selected.push(message);
    if (identity) selectedIds.add(identity);
  }
  return selected;
}

export function serializeConversationContextPrompt(input: {
  currentRequest: GatewayLedgerTranscriptMessage;
  pinnedFacts: GatewayLedgerTranscriptMessage[];
  selectedMessages: GatewayLedgerTranscriptMessage[];
}): string {
  const currentRequest = input.currentRequest.content.trim();
  const currentReference = promptMessageReference(input.currentRequest);
  const currentIdentity = messageIdentity(input.currentRequest);
  const pinnedIdentities = new Set(
    input.pinnedFacts.map(messageIdentity).filter(Boolean),
  );
  const isCurrent = (message: GatewayLedgerTranscriptMessage) => {
    const identity = messageIdentity(message);
    return (
      message === input.currentRequest ||
      (Boolean(currentIdentity) && identity === currentIdentity)
    );
  };
  const isPinned = (message: GatewayLedgerTranscriptMessage) => {
    const identity = messageIdentity(message);
    return (
      input.pinnedFacts.includes(message) ||
      (Boolean(identity) && pinnedIdentities.has(identity))
    );
  };
  const summaryMessage = input.selectedMessages.find(
    (message) => message.metadata?.kind === "conversation.memory.summary",
  );
  const pinnedLines = input.selectedMessages
    .filter((message) => !isCurrent(message) && isPinned(message))
    .map(serializePromptMessage);
  const historyLines = input.selectedMessages
    .filter(
      (message) =>
        !isCurrent(message) && message !== summaryMessage && !isPinned(message),
    )
    .map(serializePromptMessage);
  const summaryText = summaryMessage?.content ?? "";

  if (!summaryText && historyLines.length === 0 && pinnedLines.length === 0) {
    return `<current_request messageId="${escapeXml(currentReference.messageId)}" sequence="${currentReference.sequence}">${escapeXml(currentRequest)}</current_request>`;
  }
  return [
    "<conversation_context>",
    ...(summaryText ? ["<summary>", escapeXml(summaryText), "</summary>"] : []),
    ...(pinnedLines.length
      ? ["<pinned_facts>", ...pinnedLines, "</pinned_facts>"]
      : []),
    ...(historyLines.length
      ? ["<recent_messages>", ...historyLines, "</recent_messages>"]
      : []),
    "</conversation_context>",
    `<current_request messageId="${escapeXml(currentReference.messageId)}" sequence="${currentReference.sequence}">${escapeXml(currentRequest)}</current_request>`,
  ].join("\n");
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

export function availableConversationContextTokens(
  budget: ConversationTokenBudget,
): number {
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

function serializedPromptTokens(
  input: Pick<
    Parameters<typeof selectConversationContext>[0],
    "currentRequest" | "pinnedFacts"
  >,
  selectedMessages: GatewayLedgerTranscriptMessage[],
): number {
  return estimateConservativeTokens(
    serializeConversationContextPrompt({ ...input, selectedMessages }),
  );
}

function messageIdentity(message: GatewayLedgerTranscriptMessage): string {
  const id = message.metadata?.messageId;
  return typeof id === "string" ? id : "";
}

function serializePromptMessage(
  message: GatewayLedgerTranscriptMessage,
): string {
  const reference = promptMessageReference(message);
  return `<message messageId="${escapeXml(reference.messageId)}" sequence="${reference.sequence}" role="${message.role}">${escapeXml(message.content.trim())}</message>`;
}

function promptMessageReference(message: GatewayLedgerTranscriptMessage): {
  messageId: string;
  sequence: number;
} {
  const messageId = messageIdentity(message);
  const sequence = message.metadata?.sequence;
  if (!messageId || !Number.isInteger(sequence) || Number(sequence) <= 0) {
    throw new RangeError("conversation_context_message_identity_invalid");
  }
  return { messageId, sequence: Number(sequence) };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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
