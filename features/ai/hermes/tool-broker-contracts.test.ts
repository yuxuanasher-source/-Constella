import { describe, expect, it } from "vitest";

import { HERMES_EVIDENCE_REF_MAX_LENGTH } from "./contracts";
import {
  hashHermesToolBrokerRequest,
  parseHermesToolBrokerRequest,
  parseStoredHermesToolBrokerEnvelope,
} from "./tool-broker-contracts";

const INVOCATION_ID = "11111111-1111-4111-8111-111111111111";

describe("Hermes Tool Broker contracts", () => {
  it("accepts only the four-key Broker request", () => {
    expect(parseHermesToolBrokerRequest(validRequest())).toEqual(
      validRequest(),
    );
  });

  it("accepts only the three named memory tools with strict per-tool arguments", () => {
    const list = memoryRequest("xingyao_memory_list", {});
    const remember = memoryRequest("xingyao_memory_remember", {
      memoryType: "preference",
      content: "Prefer concise answers",
      parentInvocationId: "22222222-2222-4222-8222-222222222222",
      sourceMessageId: "33333333-3333-4333-8333-333333333333",
    });
    const update = memoryRequest("xingyao_memory_remember", {
      memoryKey: "44444444-4444-4444-8444-444444444444",
      expectedRevision: 2,
      memoryType: "workflow",
      content: "Use a checklist",
      parentInvocationId: "22222222-2222-4222-8222-222222222222",
      sourceMessageId: "33333333-3333-4333-8333-333333333333",
    });
    const forget = memoryRequest("xingyao_memory_forget", {
      memoryKey: "44444444-4444-4444-8444-444444444444",
      expectedRevision: 2,
      parentInvocationId: "22222222-2222-4222-8222-222222222222",
      sourceMessageId: "33333333-3333-4333-8333-333333333333",
    });

    expect(parseHermesToolBrokerRequest(list)).toEqual(list);
    expect(parseHermesToolBrokerRequest(remember)).toEqual(remember);
    expect(parseHermesToolBrokerRequest(update)).toEqual(update);
    expect(parseHermesToolBrokerRequest(forget)).toEqual(forget);
  });

  it.each([
    ["xingyao_memory_list", { limit: 10 }],
    [
      "xingyao_memory_remember",
      {
        memoryType: "financial",
        content: "Prefer concise answers",
        parentInvocationId: "22222222-2222-4222-8222-222222222222",
        sourceMessageId: "33333333-3333-4333-8333-333333333333",
      },
    ],
    [
      "xingyao_memory_remember",
      {
        memoryType: "preference",
        content: "Prefer concise answers",
        parentInvocationId: "not-an-invocation",
        sourceMessageId: "33333333-3333-4333-8333-333333333333",
      },
    ],
    [
      "xingyao_memory_remember",
      {
        memoryType: "preference",
        content: "Prefer concise answers",
        parentInvocationId: "22222222-2222-4222-8222-222222222222",
        sourceMessageId: "33333333-3333-4333-8333-333333333333",
        authority: "owner",
      },
    ],
    [
      "xingyao_memory_forget",
      {
        memoryKey: "44444444-4444-4444-8444-444444444444",
        expectedRevision: 0,
        parentInvocationId: "22222222-2222-4222-8222-222222222222",
        sourceMessageId: "33333333-3333-4333-8333-333333333333",
      },
    ],
  ])("rejects malformed memory tool arguments for %s", (toolName, args) => {
    expect(parseHermesToolBrokerRequest(memoryRequest(toolName, args))).toBeNull();
  });

  it.each(["authority", "model", "provider", "url", "table", "sql"])(
    "rejects forbidden memory argument field %s",
    (field) => {
      expect(
        parseHermesToolBrokerRequest(
          memoryRequest("xingyao_memory_remember", {
            memoryType: "preference",
            content: "Prefer concise answers",
            parentInvocationId: "22222222-2222-4222-8222-222222222222",
            sourceMessageId: "33333333-3333-4333-8333-333333333333",
            [field]: "client-controlled",
          }),
        ),
      ).toBeNull();
    },
  );

  it.each([
    "organizationId",
    "userId",
    "ownerUserId",
    "conversationId",
    "sessionId",
    "role",
    "scopes",
    "skills",
    "model",
    "provider",
    "tools",
    "allowedTools",
    "capability",
    "actorJws",
    "url",
    "method",
    "table",
    "sql",
    "operation",
    "extra",
  ])("rejects the extra identity or authority field %s", (field) => {
    expect(
      parseHermesToolBrokerRequest({
        ...validRequest(),
        [field]: "client-controlled",
      }),
    ).toBeNull();
  });

  it.each([
    null,
    [],
    { ...validRequest(), invocationId: "session-guess" },
    { ...validRequest(), toolCallId: "" },
    { ...validRequest(), toolCallId: "contains whitespace" },
    { ...validRequest(), toolName: "https://internal.example/read" },
    { ...validRequest(), toolName: "xingyao_unknown_tool" },
    { ...validRequest(), arguments: [] },
    { ...validRequest(), arguments: { organizationId: "evil" } },
  ])("rejects malformed or authority-bearing input", (value) => {
    expect(parseHermesToolBrokerRequest(value)).toBeNull();
  });

  it("hashes a canonical request independently of argument key order", () => {
    const left = parseHermesToolBrokerRequest({
      ...validRequest(),
      arguments: { limit: 5, query: "Project" },
    });
    const right = parseHermesToolBrokerRequest({
      ...validRequest(),
      arguments: { query: "Project", limit: 5 },
    });
    const changed = parseHermesToolBrokerRequest({
      ...validRequest(),
      arguments: { query: "Different", limit: 5 },
    });

    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(changed).not.toBeNull();
    expect(hashHermesToolBrokerRequest(left!)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashHermesToolBrokerRequest(left!)).toBe(
      hashHermesToolBrokerRequest(right!),
    );
    expect(hashHermesToolBrokerRequest(left!)).not.toBe(
      hashHermesToolBrokerRequest(changed!),
    );
  });

  it("rejects replay envelopes with extra or mismatched identity fields", () => {
    const request = validRequest();
    const envelope = {
      status: "ok" as const,
      data: { rows: [] },
      evidenceRefs: [],
      sourceLabels: [],
      updatedAt: "2026-07-21T23:59:00.000Z",
      observedAt: "2026-07-22T00:00:00.000Z",
      missingData: [],
      permissionDenials: [],
      truncated: false,
      invocationId: INVOCATION_ID,
      toolCallId: "gateway-call-1",
      toolName: "xingyao_search_projects" as const,
      traceId: "trace-read",
    };

    expect(parseStoredHermesToolBrokerEnvelope(envelope, request)).toEqual(
      envelope,
    );
    expect(
      parseStoredHermesToolBrokerEnvelope(
        { ...envelope, capability: "must-not-replay" },
        request,
      ),
    ).toBeNull();
    expect(
      parseStoredHermesToolBrokerEnvelope(
        { ...envelope, invocationId: "22222222-2222-4222-8222-222222222222" },
        request,
      ),
    ).toBeNull();
  });

  it("accepts evidence refs at the replay bound and rejects max plus one", () => {
    const prefix = "knowledge:";
    const kbBase = "kb_mqu7f3_q42";
    const atMax = `${prefix}${kbBase}${"x".repeat(
      HERMES_EVIDENCE_REF_MAX_LENGTH - prefix.length - kbBase.length,
    )}`;
    const envelope = storedEnvelope([atMax]);

    expect(atMax).toHaveLength(HERMES_EVIDENCE_REF_MAX_LENGTH);
    expect(
      parseStoredHermesToolBrokerEnvelope(envelope, validRequest()),
    ).toEqual(envelope);
    expect(
      parseStoredHermesToolBrokerEnvelope(
        storedEnvelope([`${atMax}x`]),
        validRequest(),
      ),
    ).toBeNull();
  });
});

function storedEnvelope(evidenceRefs: string[]) {
  return {
    status: "ok" as const,
    data: { rows: [] },
    evidenceRefs,
    sourceLabels: [],
    updatedAt: "2026-07-21T23:59:00.000Z",
    observedAt: "2026-07-22T00:00:00.000Z",
    missingData: [],
    permissionDenials: [],
    truncated: false,
    invocationId: INVOCATION_ID,
    toolCallId: "gateway-call-1",
    toolName: "xingyao_search_projects" as const,
    traceId: "trace-read",
  };
}

function validRequest() {
  return {
    invocationId: INVOCATION_ID,
    toolCallId: "gateway-call-1",
    toolName: "xingyao_search_projects" as const,
    arguments: {},
  };
}

function memoryRequest(toolName: string, argumentsValue: unknown) {
  return {
    invocationId: INVOCATION_ID,
    toolCallId: "memory-call-1",
    toolName,
    arguments: argumentsValue,
  };
}
