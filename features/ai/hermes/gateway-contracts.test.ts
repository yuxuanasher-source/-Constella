import { describe, expect, it } from "vitest";

import {
  HERMES_CAPABILITY_MANIFEST_SHA256,
  HERMES_PROFILE_VERSION,
  HERMES_PROTOCOL_VERSION,
  HERMES_UPSTREAM_COMMIT,
  HERMES_UPSTREAM_TAG,
} from "./contracts";
import {
  parseHermesGatewayCommand,
  parseHermesGatewayEvent,
  parseHermesGatewayHealth,
  parseHermesGatewayProviderState,
} from "./gateway-contracts";

describe("Hermes Gateway v2 runtime contracts", () => {
  it("accepts only the minimal reusable Product session envelope", () => {
    const state = {
      generation: 4,
      sessionId: SESSION_ID,
      checkpointId: "checkpoint-4",
      provider: "hermes",
      model: "hermes-official-gateway",
      lastUsedAt: "2026-08-03T16:00:00.000Z",
    };

    expect(parseHermesGatewayProviderState(state)).toEqual(state);
    expect(
      parseHermesGatewayProviderState({
        ...state,
        organizationId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBeNull();
    expect(
      parseHermesGatewayProviderState({
        ...state,
        invocationCapability: INVOCATION_CAPABILITY,
      }),
    ).toBeNull();
    expect(
      parseHermesGatewayProviderState({ ...state, lastUsedAt: "not-a-date" }),
    ).toBeNull();
  });

  it("accepts only the pinned, exact health handshake", () => {
    expect(parseHermesGatewayHealth(HEALTH)).toEqual(HEALTH);

    for (const drift of [
      { status: "starting" },
      { upstreamTag: "v2026.7.21" },
      { protocolVersion: "xingyao-hermes-gateway-v3" },
      { profileVersion: "hermes-xingyao-v1" },
      { upstreamCommit: "b".repeat(40) },
      { upstreamCommit: HERMES_UPSTREAM_COMMIT.slice(0, 39) },
      { forkCommit: "not-a-full-commit" },
      { capabilityManifestSha256: "a".repeat(64) },
      { capabilityManifestSha256: "not-a-sha256" },
    ]) {
      expect(parseHermesGatewayHealth({ ...HEALTH, ...drift })).toBeNull();
    }

    expect(
      parseHermesGatewayHealth({ ...HEALTH, provider: "client-visible" }),
    ).toBeNull();
  });

  it("parses the complete closed method set with exact parameters", () => {
    const commands = [
      command("session.create", {
        conversationId: CONVERSATION_ID,
        invocationId: INVOCATION_ID,
        actorAssertion: ACTOR_ASSERTION,
        invocationCapability: INVOCATION_CAPABILITY,
      }),
      command("session.resume", {
        sessionId: SESSION_ID,
        conversationId: CONVERSATION_ID,
        invocationId: INVOCATION_ID,
        actorAssertion: ACTOR_ASSERTION,
        invocationCapability: INVOCATION_CAPABILITY,
      }),
      command("session.info", {
        sessionId: SESSION_ID,
        actorAssertion: ACTOR_ASSERTION,
      }),
      command("session.list", { actorAssertion: ACTOR_ASSERTION }),
      command("session.branch", {
        sessionId: SESSION_ID,
        conversationId: BRANCH_CONVERSATION_ID,
        invocationId: INVOCATION_ID,
        actorAssertion: ACTOR_ASSERTION,
        invocationCapability: INVOCATION_CAPABILITY,
      }),
      command("session.compress", {
        sessionId: SESSION_ID,
        invocationId: INVOCATION_ID,
        actorAssertion: ACTOR_ASSERTION,
        invocationCapability: INVOCATION_CAPABILITY,
      }),
      attachmentCommand("image.attach_bytes", "image/png"),
      attachmentCommand("pdf.attach", "application/pdf"),
      attachmentCommand("file.attach", "text/csv"),
      command("prompt.submit", {
        sessionId: SESSION_ID,
        conversationId: CONVERSATION_ID,
        invocationId: INVOCATION_ID,
        actorAssertion: ACTOR_ASSERTION,
        invocationCapability: INVOCATION_CAPABILITY,
        text: "Compare the current project risks.",
        mode: "deep",
      }),
      command("clarify.respond", {
        sessionId: SESSION_ID,
        invocationId: INVOCATION_ID,
        requestId: CLARIFY_REQUEST_ID,
        actorAssertion: ACTOR_ASSERTION,
        invocationCapability: INVOCATION_CAPABILITY,
        answer: "Use the approved settlement batch.",
      }),
      command("session.interrupt", {
        sessionId: SESSION_ID,
        invocationId: INVOCATION_ID,
        actorAssertion: ACTOR_ASSERTION,
        invocationCapability: INVOCATION_CAPABILITY,
      }),
    ];

    for (const value of commands) {
      expect(parseHermesGatewayCommand(value)).toEqual(value);
    }
  });

  it("rejects unknown methods, extra fields, malformed UUIDs, and path attachments", () => {
    expect(
      parseHermesGatewayCommand(
        command("model.select", { model: "forbidden" }),
      ),
    ).toBeNull();

    const prompt = command("prompt.submit", {
      sessionId: SESSION_ID,
      conversationId: CONVERSATION_ID,
      invocationId: INVOCATION_ID,
      actorAssertion: ACTOR_ASSERTION,
      invocationCapability: INVOCATION_CAPABILITY,
      text: "hello",
      mode: "fast",
    });
    expect(
      parseHermesGatewayCommand({
        ...prompt,
        params: { ...prompt.params, model: "forbidden" },
      }),
    ).toBeNull();
    expect(
      parseHermesGatewayCommand({
        ...prompt,
        params: { ...prompt.params, invocationId: "not-a-uuid" },
      }),
    ).toBeNull();

    const attachment = attachmentCommand("file.attach", "text/plain");
    expect(
      parseHermesGatewayCommand({
        ...attachment,
        params: { ...attachment.params, path: "C:\\secret.txt" },
      }),
    ).toBeNull();
  });

  it("parses product-visible message, tool, todo, subagent, status, and terminal events", () => {
    const metadata = {
      evidenceRefs: ["project:11111111-1111-4111-8111-111111111111"],
      sourceLabels: ["projects"],
      updatedAt: "2026-07-22T10:00:00.000Z",
      missingData: [],
      permissionDenials: [],
      truncated: false,
    };
    const todos = [
      { id: "todo-1", content: "Compare sources", status: "in_progress" },
    ];
    const events = [
      readyEvent(),
      event("message.delta", { text: " " }),
      event("message.complete", { text: "Current risks are documented." }),
      event("tool.start", {
        toolCallId: TOOL_CALL_ID,
        name: "xingyao_get_project_summary",
        label: "Read project summary",
      }),
      event("tool.complete", {
        toolCallId: TOOL_CALL_ID,
        name: "xingyao_get_project_summary",
        status: "ok",
        summary: "Project summary loaded",
        metadata,
        todos,
      }),
      event("todo.updated", { todos }),
      event("clarify.request", {
        requestId: CLARIFY_REQUEST_ID,
        question: "Which batch should be compared?",
        choices: ["Current approved batch", "Latest draft batch"],
      }),
      event("subagent.start", {
        subagentId: SUBAGENT_ID,
        parentSubagentId: null,
        goal: "Cross-check evidence",
        depth: 1,
      }),
      event("subagent.progress", {
        subagentId: SUBAGENT_ID,
        status: "working",
        summary: "Comparing project and settlement data",
      }),
      event("subagent.complete", {
        subagentId: SUBAGENT_ID,
        outcome: "complete",
        summary: "Evidence cross-check complete",
        metadata,
      }),
      event("status.update", {
        status: "compacting",
        message: "Summarizing the session",
      }),
      event("turn.terminal", {
        outcome: "partial",
        message: "Completed with missing settlement evidence",
        metadata: { ...metadata, missingData: ["settlement export"] },
      }),
      event("turn.terminal", {
        outcome: "failed",
        message: "Gateway execution failed",
        metadata,
      }),
      event("turn.terminal", {
        outcome: "cancelled",
        message: "User cancelled the turn",
        metadata,
      }),
    ];

    for (const value of events) {
      expect(parseHermesGatewayEvent(value)).toEqual(value);
    }
  });

  it("rejects unknown, private-reasoning, malformed, and widened events", () => {
    for (const type of ["unknown.event", "reasoning.delta", "thinking.delta"]) {
      expect(
        parseHermesGatewayEvent(event(type, { text: "private" })),
      ).toBeNull();
    }

    const terminal = event("turn.terminal", {
      outcome: "timed_out",
      message: "not in the terminal set",
      metadata: EMPTY_METADATA,
    });
    expect(parseHermesGatewayEvent(terminal)).toBeNull();

    expect(
      parseHermesGatewayEvent(
        event("turn.terminal", {
          outcome: "failed",
          message: "Invalid observation timestamp",
          metadata: { ...EMPTY_METADATA, updatedAt: "not-a-timestamp" },
        }),
      ),
    ).toBeNull();

    const sequenced = event("message.delta", { text: "hello" });
    for (const sequence of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        parseHermesGatewayEvent({
          ...sequenced,
          params: { ...sequenced.params, sequence },
        }),
      ).toBeNull();
    }

    expect(
      parseHermesGatewayEvent(
        event("message.delta", { text: "hello", extra: "forbidden" }),
      ),
    ).toBeNull();

    const delta = event("message.delta", { text: "hello" });
    expect(
      parseHermesGatewayEvent({
        ...delta,
        params: { ...delta.params, debugReasoning: "private" },
      }),
    ).toBeNull();

    const ready = readyEvent();
    expect(
      parseHermesGatewayEvent({
        ...ready,
        params: {
          ...ready.params,
          payload: { ...HEALTH, profileVersion: "hermes-xingyao-v1" },
        },
      }),
    ).toBeNull();
  });
});

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const INVOCATION_ID = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT_ID = "44444444-4444-4444-8444-444444444444";
const CLARIFY_REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const TOOL_CALL_ID = "66666666-6666-4666-8666-666666666666";
const SUBAGENT_ID = "77777777-7777-4777-8777-777777777777";
const SESSION_ID = "gateway-session-1";
const ACTOR_ASSERTION = "signed.actor.assertion";
const INVOCATION_CAPABILITY = "opaque-invocation-capability";

const HEALTH = {
  status: "ready",
  upstreamTag: HERMES_UPSTREAM_TAG,
  upstreamCommit: HERMES_UPSTREAM_COMMIT,
  forkCommit: "a9c8ea249494075ab7180c7a9df4b07b478d4708",
  protocolVersion: HERMES_PROTOCOL_VERSION,
  profileVersion: HERMES_PROFILE_VERSION,
  capabilityManifestSha256: HERMES_CAPABILITY_MANIFEST_SHA256,
} as const;

const EMPTY_METADATA = {
  evidenceRefs: [],
  sourceLabels: [],
  updatedAt: "2026-07-22T10:00:00.000Z",
  missingData: [],
  permissionDenials: [],
  truncated: false,
};

function command(method: string, params: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: REQUEST_ID, method, params };
}

function attachmentCommand(method: string, mimeType: string) {
  return command(method, {
    sessionId: SESSION_ID,
    invocationId: INVOCATION_ID,
    attachmentId: ATTACHMENT_ID,
    actorAssertion: ACTOR_ASSERTION,
    invocationCapability: INVOCATION_CAPABILITY,
    filename: method === "pdf.attach" ? "evidence.pdf" : "evidence.bin",
    mimeType,
    contentBase64: "SGVybWVz",
  });
}

function readyEvent() {
  return {
    jsonrpc: "2.0",
    method: "event",
    params: { type: "gateway.ready", payload: HEALTH },
  };
}

function event(type: string, payload: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    method: "event",
    params: {
      type,
      sessionId: SESSION_ID,
      invocationId: INVOCATION_ID,
      sequence: 1,
      payload,
    },
  };
}
