import { describe, expect, it } from "vitest";

import {
  canTransitionConversationTurn,
  isConversationStreamEvent,
  parseCreateTurnCommand,
  parseRetryTurnCommand,
  type ConversationStreamEvent,
} from "./conversation-contracts";
import { hasMeaningfulAiContent } from "./response-quality";

describe("Xingyao conversation protocol contracts", () => {
  it("parses a normalized, idempotent create-turn command", () => {
    expect(
      parseCreateTurnCommand({
        content: "  解读当前风险事项  ",
        mode: "deep",
        clientRequestId: "8c0d349d-9486-43c8-a2d1-7e1761bcd352",
      }),
    ).toEqual({
      content: "解读当前风险事项",
      mode: "deep",
      clientRequestId: "8c0d349d-9486-43c8-a2d1-7e1761bcd352",
      attachments: [],
    });

    expect(
      parseCreateTurnCommand({ content: "", clientRequestId: "request-123" }),
    ).toBeNull();
    expect(parseCreateTurnCommand({ content: "hello" })).toBeNull();
  });

  it("rejects unreadable, unsupported, and oversized attachments before turn creation", () => {
    const base = {
      content: "分析附件",
      mode: "deep",
      clientRequestId: "attachment-request-123",
    };

    expect(
      parseCreateTurnCommand({
        ...base,
        attachments: [{ name: "payload.exe", mimeType: "application/x-msdownload", text: "x" }],
      }),
    ).toBeNull();
    expect(
      parseCreateTurnCommand({
        ...base,
        attachments: [{ name: "empty.txt", mimeType: "text/plain" }],
      }),
    ).toBeNull();
    expect(
      parseCreateTurnCommand({
        ...base,
        attachments: [
          {
            name: "huge.txt",
            mimeType: "text/plain",
            text: "x".repeat(200_001),
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseCreateTurnCommand({
        ...base,
        attachments: [
          {
            name: "oversized.pdf",
            mimeType: "application/pdf",
            fileId: "file-1",
            sizeBytes: 8 * 1024 * 1024 + 1,
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseCreateTurnCommand({
        ...base,
        attachments: [
          {
            name: "../risk report.txt",
            mimeType: "TEXT/PLAIN",
            text: "  high-risk project  ",
            sizeBytes: 24,
          },
        ],
      }),
    ).toMatchObject({
      attachments: [
        {
          name: ".._risk_report.txt",
          mimeType: "text/plain",
          text: "high-risk project",
          sizeBytes: 24,
        },
      ],
    });
  });

  it("requires retry commands to carry a new idempotency key", () => {
    expect(
      parseRetryTurnCommand({
        clientRequestId: "retry-8c0d349d-9486-43c8-a2d1",
      }),
    ).toEqual({ clientRequestId: "retry-8c0d349d-9486-43c8-a2d1" });
    expect(parseRetryTurnCommand({ clientRequestId: "" })).toBeNull();
  });

  it("allows only forward state-machine transitions", () => {
    expect(canTransitionConversationTurn("accepted", "grounding")).toBe(true);
    expect(canTransitionConversationTurn("grounding", "generating")).toBe(true);
    expect(canTransitionConversationTurn("generating", "validating")).toBe(true);
    expect(canTransitionConversationTurn("validating", "completed")).toBe(true);
    expect(canTransitionConversationTurn("validating", "failed")).toBe(true);
    expect(canTransitionConversationTurn("completed", "generating")).toBe(false);
    expect(canTransitionConversationTurn("failed", "completed")).toBe(false);
  });

  it("recognizes typed stream envelopes and rejects malformed events", () => {
    const event: ConversationStreamEvent = {
      type: "response.delta",
      conversationId: "conversation-1",
      turnId: "turn-1",
      messageId: "message-1",
      delta: "建议先处理高风险事项",
    };

    expect(isConversationStreamEvent(event)).toBe(true);
    expect(
      isConversationStreamEvent({
        type: "response.delta",
        conversationId: "conversation-1",
        turnId: "turn-1",
        delta: "missing message id",
      }),
    ).toBe(false);
    expect(isConversationStreamEvent({ type: "done" })).toBe(false);
  });

  it("accepts the native product SSE event contract with explicit outcomes and observation metadata", () => {
    const completed: ConversationStreamEvent = {
      type: "response.completed",
      conversationId: "conversation-1",
      turnId: "turn-1",
      messageId: "message-1",
      content: "基于可用证据完成答复",
      outcome: "partial",
      evidence: ["project:1"],
      missing: ["settlements.summary"],
      observationTimes: {
        firstObservedAt: "2026-07-22T09:00:00.000Z",
        lastObservedAt: "2026-07-22T09:00:01.000Z",
      },
      meta: { traceCode: "ok" },
    };

    expect(isConversationStreamEvent(completed)).toBe(true);
    expect(
      isConversationStreamEvent({
        ...completed,
        outcome: "failed",
      }),
    ).toBe(false);
    expect(
      isConversationStreamEvent({
        type: "response.failed",
        conversationId: "conversation-1",
        turnId: "turn-1",
        code: "gateway_provider_failed",
        retryable: true,
        message: "Provider failed",
        outcome: "partial",
      }),
    ).toBe(false);
    for (const event of [
      { type: "activity.updated", label: "Reading", status: "running" },
      { type: "tool.started", toolCallId: "tool-1", toolName: "projects.search", label: "Project search" },
      { type: "tool.completed", toolCallId: "tool-1", toolName: "projects.search", status: "completed", label: "Project search" },
      {
        type: "clarify.requested",
        clarifyId: "55555555-5555-4555-8555-555555555555",
        question: "Which project?",
        choices: ["A", "B"],
        allowFreeText: false,
      },
      { type: "todo.updated", items: [{ id: "todo-1", label: "Check", status: "done" }] },
      { type: "subagent.updated", subagentId: "subagent-1", label: "Research", status: "running" },
      { type: "response.cancelled", messageId: "message-1" },
      { type: "heartbeat" },
    ]) {
      expect(
        isConversationStreamEvent({
          conversationId: "conversation-1",
          turnId: "turn-1",
          ...event,
        }),
      ).toBe(true);
    }
  });

  it("requires public clarify SSE events to expose the Gateway request id", () => {
    expect(
      isConversationStreamEvent({
        type: "clarify.requested",
        conversationId: "conversation-1",
        turnId: "turn-1",
        question: "Which project?",
        choices: ["A", "B"],
      }),
    ).toBe(false);
  });

  it("does not accept punctuation-only output as meaningful content", () => {
    expect(hasMeaningfulAiContent(".\n.")).toBe(false);
    expect(hasMeaningfulAiContent("**---**")).toBe(false);
    expect(hasMeaningfulAiContent("**处理建议**")).toBe(true);
    expect(hasMeaningfulAiContent("风险数为 0")).toBe(true);
  });
});
