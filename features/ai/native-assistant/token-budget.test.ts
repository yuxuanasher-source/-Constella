import { describe, expect, it } from "vitest";

import {
  applyConversationMemoryDelta,
  parseConversationMemoryDelta,
  type ConversationMemorySummary,
} from "../conversation-contracts";
import { buildGatewayNativeAssistantContext } from "./context-engine";
import {
  availableConversationContextTokens,
  estimateConservativeTokens,
  resolveConversationTokenBudget,
  serializeConversationContextPrompt,
  selectConversationContext,
} from "./token-budget";

describe("conversation token budgeting", () => {
  it("counts non-ASCII code points and groups ASCII bytes conservatively", () => {
    expect(estimateConservativeTokens("")).toBe(0);
    expect(estimateConservativeTokens("abcd")).toBe(1);
    expect(estimateConservativeTokens("abcde")).toBe(2);
    expect(estimateConservativeTokens("星耀abcde")).toBe(4);
    expect(estimateConservativeTokens("😀a")).toBe(2);
  });

  it("keeps mandatory input, then summary, then newest whole messages", () => {
    const currentRequest = message("request", "user", "current request");
    const pinned = message("pinned", "tool", "pinned fact");
    const recent = [
      message("old", "user", "old message"),
      message("middle", "assistant", "middle message"),
      message("new", "user", "new message"),
    ];

    const selected = selectConversationContext({
      currentRequest,
      pinnedFacts: [pinned],
      summary: memorySummary({
        confirmedFacts: [
          { text: "Pinned target", sourceMessageIds: ["source-1"] },
        ],
      }),
      recentMessages: recent,
      budget: {
        contextWindowTokens: 300,
        reservedSystemTokens: 10,
        reservedToolTokens: 10,
        reservedAttachmentTokens: 10,
        reservedOutputTokens: 10,
      },
    });

    expect(selected.map((entry) => entry.metadata?.messageId)).toEqual([
      "request",
      "pinned",
      "conversation-memory-summary",
      "new",
      "middle",
      "old",
    ]);
  });

  it("never splits a message and fails closed when mandatory context exceeds budget", () => {
    const common = {
      currentRequest: message("request", "user", "12345678"),
      pinnedFacts: [message("pinned", "tool", "12345678")],
      summary: memorySummary(),
      budget: {
        contextWindowTokens: 160,
        reservedSystemTokens: 5,
        reservedToolTokens: 5,
        reservedAttachmentTokens: 5,
        reservedOutputTokens: 5,
      },
    };

    const selected = selectConversationContext({
      ...common,
      recentMessages: [message("too-large", "assistant", "x".repeat(800))],
    });
    expect(selected.map((entry) => entry.metadata?.messageId)).not.toContain(
      "too-large",
    );

    expect(() =>
      selectConversationContext({
        ...common,
        currentRequest: message("request", "user", "x".repeat(1_000)),
        recentMessages: [],
      }),
    ).toThrow("conversation_context_budget_exceeded");
  });

  it("budgets the exact serialized prompt including wrappers and role prefixes", () => {
    const currentRequest = message("request", "user", "current");
    const recent = message("recent", "assistant", "history");
    const mandatoryPrompt = serializeConversationContextPrompt({
      currentRequest,
      pinnedFacts: [],
      selectedMessages: [currentRequest],
    });
    const promptWithRecent = serializeConversationContextPrompt({
      currentRequest,
      pinnedFacts: [],
      selectedMessages: [currentRequest, recent],
    });
    const available = estimateConservativeTokens(promptWithRecent) - 1;
    expect(estimateConservativeTokens(mandatoryPrompt)).toBeLessThanOrEqual(
      available,
    );

    const budget = zeroReserveBudget(available);
    const selected = selectConversationContext({
      currentRequest,
      pinnedFacts: [],
      summary: memorySummary(),
      recentMessages: [recent],
      budget,
    });
    const finalPrompt = serializeConversationContextPrompt({
      currentRequest,
      pinnedFacts: [],
      selectedMessages: selected,
    });

    expect(selected.map((entry) => entry.metadata?.messageId)).toEqual([
      "request",
    ]);
    expect(estimateConservativeTokens(finalPrompt)).toBeLessThanOrEqual(
      availableConversationContextTokens(budget),
    );
  });

  it("fails explicitly when exact mandatory prompt serialization exceeds budget", () => {
    const currentRequest = message("request", "user", "current");
    const pinned = message("pinned", "tool", "pinned fact");
    const mandatoryPrompt = serializeConversationContextPrompt({
      currentRequest,
      pinnedFacts: [pinned],
      selectedMessages: [currentRequest, pinned],
    });

    expect(() =>
      selectConversationContext({
        currentRequest,
        pinnedFacts: [pinned],
        summary: memorySummary(),
        recentMessages: [],
        budget: zeroReserveBudget(
          estimateConservativeTokens(mandatoryPrompt) - 1,
        ),
      }),
    ).toThrow("conversation_context_budget_exceeded");
  });

  it("serializes stable message references with XML-safe content", () => {
    const currentRequest = {
      ...message(
        "77777777-7777-4777-8777-777777777777",
        "user",
        "close </current_request> & continue",
      ),
      metadata: {
        messageId: "77777777-7777-4777-8777-777777777777",
        sequence: 20,
      },
    };
    const recent = {
      ...message(
        "66666666-6666-4666-8666-666666666666",
        "assistant",
        "value < 25%",
      ),
      metadata: {
        messageId: "66666666-6666-4666-8666-666666666666",
        sequence: 19,
      },
    };
    const prompt = serializeConversationContextPrompt({
      currentRequest,
      pinnedFacts: [],
      selectedMessages: [currentRequest, recent],
    });

    expect(prompt).toContain(
      'messageId="77777777-7777-4777-8777-777777777777" sequence="20"',
    );
    expect(prompt).toContain(
      'messageId="66666666-6666-4666-8666-666666666666" sequence="19" role="assistant"',
    );
    expect(prompt).toContain("&lt;/current_request&gt; &amp; continue");
    expect(prompt).toContain("value &lt; 25%");
    expect(prompt.match(/<\/current_request>/g)).toHaveLength(1);
  });

  it("retains corrected memory, decisions, and questions through a 20-turn flow", () => {
    const sourceIds = Array.from(
      { length: 20 },
      (_, index) =>
        `8f200000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const fullTranscript = Array.from({ length: 20 }, (_, index) => {
      const sequence = index + 1;
      const content =
        sequence === 1
          ? "The conversion target is 20%"
          : sequence === 9
            ? "Correction: the conversion target is 25%"
            : sequence === 14
              ? "Decision: review weekly. Unresolved: who owns the dashboard?"
              : sequence === 20
                ? "Recall the current target, decision, and unresolved question"
                : `turn ${sequence}`;
      return conversationMessage(
        sourceIds[index]!,
        sequence,
        index % 2 ? "assistant" : "user",
        content,
      );
    });

    let summary = memorySummary();
    summary = applyValidatedDelta(summary, fullTranscript, {
      goals: [],
      confirmedFacts: [
        memoryItem("The conversion target is 20%", sourceIds[0]!),
      ],
      decisions: [],
      unresolvedQuestions: [],
      throughSequence: 1,
    });
    summary = applyValidatedDelta(summary, fullTranscript, {
      goals: [],
      confirmedFacts: [
        memoryItem("The conversion target is 25%", sourceIds[8]!),
      ],
      decisions: [],
      unresolvedQuestions: [],
      throughSequence: 9,
    });
    summary = applyValidatedDelta(summary, fullTranscript, {
      goals: [],
      confirmedFacts: [
        memoryItem("The conversion target is 25%", sourceIds[8]!),
      ],
      decisions: [memoryItem("Review the metric weekly", sourceIds[13]!)],
      unresolvedQuestions: [
        memoryItem("Who owns the dashboard?", sourceIds[13]!),
      ],
      throughSequence: 14,
    });

    const gatewayContext = buildGatewayNativeAssistantContext({
      auth: {
        userId: USER_ID,
        organizationId: ORG_ID,
        role: "finance",
      },
      conversationId: CONVERSATION_ID,
      invocationId: INVOCATION_ID,
      clientRequest: {
        message: fullTranscript[19]!.content,
        mode: "fast",
      },
      personalMemoryRevision: 0,
      messages: fullTranscript,
      conversationMemory: {
        status: "ready",
        summaryVersion: 3,
        summary,
      },
    });
    expect(gatewayContext).not.toBeNull();

    const currentRequest = message(
      sourceIds[19],
      "user",
      "Recall the current target, decision, and unresolved question",
    );

    const budget = resolveConversationTokenBudget("unknown-model");
    const selected = selectConversationContext({
      currentRequest,
      pinnedFacts: [],
      summary,
      recentMessages: gatewayContext!.ledgerTranscript,
      budget,
    });
    const serialized = serializeConversationContextPrompt({
      currentRequest,
      pinnedFacts: [],
      selectedMessages: selected,
    });

    expect(summary.lastCompactedSequence).toBe(14);
    expect(summary.confirmedFacts).toEqual([
      memoryItem("The conversion target is 25%", sourceIds[8]!),
    ]);
    expect(serialized).toContain("25%");
    expect(serialized).not.toContain("conversion target is 20%");
    expect(serialized).toContain("Review the metric weekly");
    expect(serialized).toContain("Who owns the dashboard?");
    expect(serialized).toContain("turn 15");
    expect(serialized).toContain("Recall the current target");
    expect(estimateConservativeTokens(serialized)).toBeLessThanOrEqual(
      availableConversationContextTokens(budget),
    );
  });
});

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";

function message(
  messageId: string,
  role: "user" | "assistant" | "tool",
  content: string,
) {
  return { role, content, metadata: { messageId, sequence: 1 } };
}

function memorySummary(
  overrides: Partial<ConversationMemorySummary> = {},
): ConversationMemorySummary {
  return {
    schemaVersion: 1,
    goals: [],
    confirmedFacts: [],
    decisions: [],
    unresolvedQuestions: [],
    lastCompactedSequence: 0,
    ...overrides,
  };
}

function zeroReserveBudget(contextWindowTokens: number) {
  return {
    contextWindowTokens,
    reservedSystemTokens: 0,
    reservedToolTokens: 0,
    reservedAttachmentTokens: 0,
    reservedOutputTokens: 0,
  };
}

function memoryItem(text: string, sourceMessageId: string) {
  return { text, sourceMessageIds: [sourceMessageId] };
}

function conversationMessage(
  id: string,
  sequence: number,
  role: "user" | "assistant",
  content: string,
) {
  return {
    id,
    conversationId: CONVERSATION_ID,
    sequence,
    role,
    status: "completed" as const,
    content,
    parentMessageId: null,
    metadata: { ownerUserId: USER_ID },
    createdAt: `2026-08-03T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    updatedAt: `2026-08-03T00:00:${String(sequence).padStart(2, "0")}.000Z`,
  };
}

function applyValidatedDelta(
  previousSummary: ConversationMemorySummary,
  messages: ReturnType<typeof conversationMessage>[],
  candidate: {
    goals: ReturnType<typeof memoryItem>[];
    confirmedFacts: ReturnType<typeof memoryItem>[];
    decisions: ReturnType<typeof memoryItem>[];
    unresolvedQuestions: ReturnType<typeof memoryItem>[];
    throughSequence: number;
  },
) {
  const delta = parseConversationMemoryDelta(candidate, {
    conversationId: CONVERSATION_ID,
    sourceMessages: messages.map(({ id, conversationId, sequence }) => ({
      id,
      conversationId,
      sequence,
    })),
    previousSummary,
  });
  expect(delta).not.toBeNull();
  return applyConversationMemoryDelta(previousSummary, delta!);
}
