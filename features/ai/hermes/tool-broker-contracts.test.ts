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
