import { describe, expect, it } from "vitest";

import type { ConversationMemorySummary } from "../conversation-contracts";
import {
  estimateConservativeTokens,
  resolveConversationTokenBudget,
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
        contextWindowTokens: 40,
        reservedSystemTokens: 5,
        reservedToolTokens: 5,
        reservedAttachmentTokens: 5,
        reservedOutputTokens: 5,
      },
    };

    const selected = selectConversationContext({
      ...common,
      recentMessages: [message("too-large", "assistant", "x".repeat(80))],
    });
    expect(selected.map((entry) => entry.metadata?.messageId)).not.toContain(
      "too-large",
    );

    expect(() =>
      selectConversationContext({
        ...common,
        currentRequest: message("request", "user", "x".repeat(200)),
        recentMessages: [],
      }),
    ).toThrow("conversation_context_budget_exceeded");
  });

  it("retains corrected 20-turn memory under the configured budget", () => {
    const sourceIds = Array.from(
      { length: 20 },
      (_, index) =>
        `8f200000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const summary = memorySummary({
      confirmedFacts: [
        {
          text: "The conversion target is 25%",
          sourceMessageIds: [sourceIds[8]],
        },
      ],
      decisions: [
        {
          text: "Review the metric weekly",
          sourceMessageIds: [sourceIds[13]],
        },
      ],
      unresolvedQuestions: [
        {
          text: "Who owns the dashboard?",
          sourceMessageIds: [sourceIds[16]],
        },
      ],
      lastCompactedSequence: 18,
    });
    const fullTranscript = Array.from({ length: 19 }, (_, index) => {
      const sequence = index + 1;
      const content =
        sequence === 1
          ? "The conversion target is 20%"
          : sequence === 9
            ? "Correction: the conversion target is 25%"
            : sequence === 14
              ? "Decision: review the metric weekly"
              : sequence === 17
                ? "Unresolved: who owns the dashboard?"
                : `turn ${sequence}`;
      return message(
        sourceIds[index],
        index % 2 ? "assistant" : "user",
        content,
      );
    });
    const recentMessages = fullTranscript.slice(summary.lastCompactedSequence);
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
      recentMessages,
      budget,
    });
    const serialized = JSON.stringify(selected);
    const selectedTokens = selected.reduce(
      (total, entry) => total + 8 + estimateConservativeTokens(entry.content),
      0,
    );

    expect(fullTranscript[0]?.content).toContain("20%");
    expect(fullTranscript[8]?.content).toContain("25%");
    expect(fullTranscript[13]?.content).toContain("review the metric weekly");
    expect(serialized).toContain("25%");
    expect(serialized).not.toContain("conversion target is 20%");
    expect(serialized).toContain("Review the metric weekly");
    expect(serialized).toContain("Who owns the dashboard?");
    expect(serialized).toContain(sourceIds[19]);
    expect(selectedTokens).toBeLessThanOrEqual(
      budget.contextWindowTokens -
        budget.reservedSystemTokens -
        budget.reservedToolTokens -
        budget.reservedAttachmentTokens -
        budget.reservedOutputTokens,
    );
  });
});

function message(
  messageId: string,
  role: "user" | "assistant" | "tool",
  content: string,
) {
  return { role, content, metadata: { messageId } };
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
