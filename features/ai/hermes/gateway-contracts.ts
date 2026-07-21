import {
  HERMES_CAPABILITY_MANIFEST_SHA256,
  HERMES_PROFILE_VERSION,
  HERMES_PROTOCOL_VERSION,
  HERMES_UPSTREAM_COMMIT,
  HERMES_UPSTREAM_TAG,
  hasExactKeys,
  isHermesMode,
  isHermesOutcome,
  isUuid,
  type HermesMode,
  type HermesOutcome,
} from "./contracts";

export { HERMES_MODE_BUDGETS } from "./contracts";
export type { HermesModeBudget, HermesOutcome } from "./contracts";

export const HERMES_GATEWAY_METHODS = [
  "session.create",
  "session.resume",
  "session.info",
  "session.list",
  "session.branch",
  "session.compress",
  "image.attach_bytes",
  "pdf.attach",
  "file.attach",
  "prompt.submit",
  "clarify.respond",
  "session.interrupt",
] as const;

export const HERMES_GATEWAY_EVENT_TYPES = [
  "gateway.ready",
  "message.delta",
  "message.complete",
  "tool.start",
  "tool.complete",
  "todo.updated",
  "clarify.request",
  "subagent.start",
  "subagent.progress",
  "subagent.complete",
  "status.update",
  "turn.terminal",
] as const;

export type HermesGatewayHealth = {
  status: "ready";
  upstreamTag: typeof HERMES_UPSTREAM_TAG;
  upstreamCommit: typeof HERMES_UPSTREAM_COMMIT;
  forkCommit: string;
  protocolVersion: typeof HERMES_PROTOCOL_VERSION;
  profileVersion: typeof HERMES_PROFILE_VERSION;
  capabilityManifestSha256: typeof HERMES_CAPABILITY_MANIFEST_SHA256;
};

export type HermesToolResultMetadata = {
  evidenceRefs: string[];
  sourceLabels: string[];
  updatedAt: string;
  missingData: string[];
  permissionDenials: string[];
  truncated: boolean;
};

export type HermesTodo = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
};

type JsonRpcCommand<Method extends string, Params> = {
  jsonrpc: "2.0";
  id: string;
  method: Method;
  params: Params;
};

type ActorParams = {
  actorAssertion: string;
};

type InvocationParams = ActorParams & {
  invocationId: string;
  invocationCapability: string;
};

type SessionInvocationParams = InvocationParams & {
  sessionId: string;
};

type AttachmentParams = SessionInvocationParams & {
  attachmentId: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
};

export type HermesGatewayCommand =
  | JsonRpcCommand<
      "session.create",
      InvocationParams & { conversationId: string }
    >
  | JsonRpcCommand<
      "session.resume",
      SessionInvocationParams & { conversationId: string }
    >
  | JsonRpcCommand<"session.info", ActorParams & { sessionId: string }>
  | JsonRpcCommand<"session.list", ActorParams>
  | JsonRpcCommand<
      "session.branch",
      SessionInvocationParams & { conversationId: string }
    >
  | JsonRpcCommand<"session.compress", SessionInvocationParams>
  | JsonRpcCommand<"image.attach_bytes", AttachmentParams>
  | JsonRpcCommand<"pdf.attach", AttachmentParams>
  | JsonRpcCommand<"file.attach", AttachmentParams>
  | JsonRpcCommand<
      "prompt.submit",
      SessionInvocationParams & {
        conversationId: string;
        text: string;
        mode: HermesMode;
      }
    >
  | JsonRpcCommand<
      "clarify.respond",
      SessionInvocationParams & { requestId: string; answer: string }
    >
  | JsonRpcCommand<"session.interrupt", SessionInvocationParams>;

type GatewayReadyEvent = {
  jsonrpc: "2.0";
  method: "event";
  params: {
    type: "gateway.ready";
    payload: HermesGatewayHealth;
  };
};

type SessionEvent<Type extends string, Payload> = {
  jsonrpc: "2.0";
  method: "event";
  params: {
    type: Type;
    sessionId: string;
    invocationId: string;
    sequence: number;
    payload: Payload;
  };
};

export type HermesGatewayEvent =
  | GatewayReadyEvent
  | SessionEvent<"message.delta", { text: string }>
  | SessionEvent<"message.complete", { text: string }>
  | SessionEvent<
      "tool.start",
      { toolCallId: string; name: string; label: string }
    >
  | SessionEvent<
      "tool.complete",
      {
        toolCallId: string;
        name: string;
        status: "ok" | "error";
        summary: string;
        metadata: HermesToolResultMetadata;
        todos: HermesTodo[];
      }
    >
  | SessionEvent<"todo.updated", { todos: HermesTodo[] }>
  | SessionEvent<
      "clarify.request",
      { requestId: string; question: string; choices: string[] }
    >
  | SessionEvent<
      "subagent.start",
      {
        subagentId: string;
        parentSubagentId: string | null;
        goal: string;
        depth: number;
      }
    >
  | SessionEvent<
      "subagent.progress",
      { subagentId: string; status: string; summary: string }
    >
  | SessionEvent<
      "subagent.complete",
      {
        subagentId: string;
        outcome: HermesOutcome;
        summary: string;
        metadata: HermesToolResultMetadata;
      }
    >
  | SessionEvent<
      "status.update",
      { status: string; message: string }
    >
  | SessionEvent<
      "turn.terminal",
      {
        outcome: HermesOutcome;
        message: string;
        metadata: HermesToolResultMetadata;
      }
    >;

const HEALTH_KEYS = [
  "capabilityManifestSha256",
  "forkCommit",
  "profileVersion",
  "protocolVersion",
  "status",
  "upstreamCommit",
  "upstreamTag",
] as const;
const JSON_RPC_COMMAND_KEYS = ["id", "jsonrpc", "method", "params"] as const;
const JSON_RPC_EVENT_KEYS = ["jsonrpc", "method", "params"] as const;
const READY_EVENT_KEYS = ["payload", "type"] as const;
const SESSION_EVENT_KEYS = [
  "invocationId",
  "payload",
  "sequence",
  "sessionId",
  "type",
] as const;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/;
const MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_ATTACHMENT_BASE64_LENGTH = 70 * 1024 * 1024;

const SUBAGENT_STATUSES = ["queued", "working", "waiting", "completed"];
const TURN_STATUSES = [
  "accepted",
  "planning",
  "working",
  "waiting",
  "compacting",
  "finalizing",
  "ready",
];

export function parseHermesGatewayHealth(
  value: unknown,
): HermesGatewayHealth | null {
  if (!isRecord(value) || !hasExactKeys(value, HEALTH_KEYS)) {
    return null;
  }
  if (
    value.status !== "ready" ||
    value.upstreamTag !== HERMES_UPSTREAM_TAG ||
    value.upstreamCommit !== HERMES_UPSTREAM_COMMIT ||
    !isGitCommit(value.forkCommit) ||
    value.protocolVersion !== HERMES_PROTOCOL_VERSION ||
    value.profileVersion !== HERMES_PROFILE_VERSION ||
    value.capabilityManifestSha256 !== HERMES_CAPABILITY_MANIFEST_SHA256
  ) {
    return null;
  }
  return value as HermesGatewayHealth;
}

export function parseHermesGatewayCommand(
  value: unknown,
): HermesGatewayCommand | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, JSON_RPC_COMMAND_KEYS) ||
    value.jsonrpc !== "2.0" ||
    !isUuid(value.id) ||
    typeof value.method !== "string" ||
    !isRecord(value.params)
  ) {
    return null;
  }

  const valid = isCommandParams(value.method, value.params);
  return valid ? (value as unknown as HermesGatewayCommand) : null;
}

export function parseHermesGatewayEvent(
  value: unknown,
): HermesGatewayEvent | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, JSON_RPC_EVENT_KEYS) ||
    value.jsonrpc !== "2.0" ||
    value.method !== "event" ||
    !isRecord(value.params) ||
    typeof value.params.type !== "string"
  ) {
    return null;
  }

  if (value.params.type === "gateway.ready") {
    if (
      !hasExactKeys(value.params, READY_EVENT_KEYS) ||
      !parseHermesGatewayHealth(value.params.payload)
    ) {
      return null;
    }
    return value as unknown as HermesGatewayEvent;
  }

  if (
    !hasExactKeys(value.params, SESSION_EVENT_KEYS) ||
    !isSessionId(value.params.sessionId) ||
    !isUuid(value.params.invocationId) ||
    !isNonNegativeSafeInteger(value.params.sequence) ||
    !isRecord(value.params.payload) ||
    !isEventPayload(value.params.type, value.params.payload)
  ) {
    return null;
  }

  return value as unknown as HermesGatewayEvent;
}

function isCommandParams(
  method: string,
  params: Record<string, unknown>,
): boolean {
  switch (method) {
    case "session.create":
      return (
        hasExactKeys(params, [
          "actorAssertion",
          "conversationId",
          "invocationCapability",
          "invocationId",
        ]) &&
        isUuid(params.conversationId) &&
        isInvocationParams(params)
      );
    case "session.resume":
    case "session.branch":
      return (
        hasExactKeys(params, [
          "actorAssertion",
          "conversationId",
          "invocationCapability",
          "invocationId",
          "sessionId",
        ]) &&
        isUuid(params.conversationId) &&
        isSessionInvocationParams(params)
      );
    case "session.info":
      return (
        hasExactKeys(params, ["actorAssertion", "sessionId"]) &&
        isActorAssertion(params.actorAssertion) &&
        isSessionId(params.sessionId)
      );
    case "session.list":
      return (
        hasExactKeys(params, ["actorAssertion"]) &&
        isActorAssertion(params.actorAssertion)
      );
    case "session.compress":
    case "session.interrupt":
      return (
        hasExactKeys(params, [
          "actorAssertion",
          "invocationCapability",
          "invocationId",
          "sessionId",
        ]) && isSessionInvocationParams(params)
      );
    case "image.attach_bytes":
    case "pdf.attach":
    case "file.attach":
      return isAttachmentParams(method, params);
    case "prompt.submit":
      return (
        hasExactKeys(params, [
          "actorAssertion",
          "conversationId",
          "invocationCapability",
          "invocationId",
          "mode",
          "sessionId",
          "text",
        ]) &&
        isSessionInvocationParams(params) &&
        isUuid(params.conversationId) &&
        isHermesMode(params.mode) &&
        isBoundedText(params.text, 12_000)
      );
    case "clarify.respond":
      return (
        hasExactKeys(params, [
          "actorAssertion",
          "answer",
          "invocationCapability",
          "invocationId",
          "requestId",
          "sessionId",
        ]) &&
        isSessionInvocationParams(params) &&
        isUuid(params.requestId) &&
        isBoundedText(params.answer, 12_000)
      );
    default:
      return false;
  }
}

function isAttachmentParams(
  method: "image.attach_bytes" | "pdf.attach" | "file.attach",
  params: Record<string, unknown>,
): boolean {
  if (
    !hasExactKeys(params, [
      "actorAssertion",
      "attachmentId",
      "contentBase64",
      "filename",
      "invocationCapability",
      "invocationId",
      "mimeType",
      "sessionId",
    ]) ||
    !isSessionInvocationParams(params) ||
    !isUuid(params.attachmentId) ||
    !isSafeFilename(params.filename) ||
    !isMimeType(params.mimeType) ||
    !isBase64Bytes(params.contentBase64)
  ) {
    return false;
  }

  if (method === "image.attach_bytes") {
    return params.mimeType.startsWith("image/");
  }
  if (method === "pdf.attach") {
    return params.mimeType === "application/pdf";
  }
  return true;
}

function isEventPayload(
  type: string,
  payload: Record<string, unknown>,
): boolean {
  switch (type) {
    case "message.delta":
      return (
        hasExactKeys(payload, ["text"]) &&
        isBoundedString(payload.text, 100_000)
      );
    case "message.complete":
      return (
        hasExactKeys(payload, ["text"]) &&
        isBoundedText(payload.text, 100_000)
      );
    case "tool.start":
      return (
        hasExactKeys(payload, ["label", "name", "toolCallId"]) &&
        isUuid(payload.toolCallId) &&
        isIdentifier(payload.name) &&
        isBoundedText(payload.label, 200)
      );
    case "tool.complete":
      return (
        hasExactKeys(payload, [
          "metadata",
          "name",
          "status",
          "summary",
          "todos",
          "toolCallId",
        ]) &&
        isUuid(payload.toolCallId) &&
        isIdentifier(payload.name) &&
        (payload.status === "ok" || payload.status === "error") &&
        isBoundedText(payload.summary, 2_000) &&
        isHermesToolResultMetadata(payload.metadata) &&
        isHermesTodoArray(payload.todos)
      );
    case "todo.updated":
      return (
        hasExactKeys(payload, ["todos"]) && isHermesTodoArray(payload.todos)
      );
    case "clarify.request":
      return (
        hasExactKeys(payload, ["choices", "question", "requestId"]) &&
        isUuid(payload.requestId) &&
        isBoundedText(payload.question, 2_000) &&
        isUniqueStringArray(payload.choices, 20, 500, true)
      );
    case "subagent.start":
      return (
        hasExactKeys(payload, [
          "depth",
          "goal",
          "parentSubagentId",
          "subagentId",
        ]) &&
        isUuid(payload.subagentId) &&
        (payload.parentSubagentId === null ||
          isUuid(payload.parentSubagentId)) &&
        isBoundedText(payload.goal, 2_000) &&
        typeof payload.depth === "number" &&
        Number.isInteger(payload.depth) &&
        payload.depth >= 1 &&
        payload.depth <= 2
      );
    case "subagent.progress":
      return (
        hasExactKeys(payload, ["status", "subagentId", "summary"]) &&
        isUuid(payload.subagentId) &&
        isOneOf(payload.status, SUBAGENT_STATUSES) &&
        isBoundedText(payload.summary, 2_000)
      );
    case "subagent.complete":
      return (
        hasExactKeys(payload, [
          "metadata",
          "outcome",
          "subagentId",
          "summary",
        ]) &&
        isUuid(payload.subagentId) &&
        isHermesOutcome(payload.outcome) &&
        isBoundedText(payload.summary, 2_000) &&
        isHermesToolResultMetadata(payload.metadata)
      );
    case "status.update":
      return (
        hasExactKeys(payload, ["message", "status"]) &&
        isOneOf(payload.status, TURN_STATUSES) &&
        isBoundedText(payload.message, 2_000)
      );
    case "turn.terminal":
      return (
        hasExactKeys(payload, ["message", "metadata", "outcome"]) &&
        isHermesOutcome(payload.outcome) &&
        isBoundedText(payload.message, 4_000) &&
        isHermesToolResultMetadata(payload.metadata)
      );
    default:
      return false;
  }
}

function isHermesToolResultMetadata(
  value: unknown,
): value is HermesToolResultMetadata {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "evidenceRefs",
      "missingData",
      "permissionDenials",
      "sourceLabels",
      "truncated",
      "updatedAt",
    ]) &&
    isUniqueStringArray(value.evidenceRefs, 200, 500) &&
    isUniqueStringArray(value.sourceLabels, 100, 200) &&
    isIsoTimestamp(value.updatedAt) &&
    isUniqueStringArray(value.missingData, 100, 1_000) &&
    isUniqueStringArray(value.permissionDenials, 100, 1_000) &&
    typeof value.truncated === "boolean"
  );
}

function isHermesTodoArray(value: unknown): value is HermesTodo[] {
  if (!Array.isArray(value) || value.length > 100) {
    return false;
  }
  const ids = new Set<string>();
  for (const todo of value) {
    if (
      !isRecord(todo) ||
      !hasExactKeys(todo, ["content", "id", "status"]) ||
      !isSessionId(todo.id) ||
      ids.has(todo.id) ||
      !isBoundedText(todo.content, 1_000) ||
      (todo.status !== "pending" &&
        todo.status !== "in_progress" &&
        todo.status !== "completed")
    ) {
      return false;
    }
    ids.add(todo.id);
  }
  return true;
}

function isInvocationParams(value: Record<string, unknown>): boolean {
  return (
    isUuid(value.invocationId) &&
    isActorAssertion(value.actorAssertion) &&
    isOpaqueCapability(value.invocationCapability)
  );
}

function isSessionInvocationParams(value: Record<string, unknown>): boolean {
  return isSessionId(value.sessionId) && isInvocationParams(value);
}

function isActorAssertion(value: unknown): value is string {
  return isBoundedToken(value, 16_384);
}

function isOpaqueCapability(value: unknown): value is string {
  return isBoundedToken(value, 4_096);
}

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function isGitCommit(value: unknown): value is string {
  return typeof value === "string" && GIT_COMMIT_PATTERN.test(value);
}

function isMimeType(value: unknown): value is string {
  return typeof value === "string" && MIME_TYPE_PATTERN.test(value);
}

function isBase64Bytes(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ATTACHMENT_BASE64_LENGTH &&
    BASE64_PATTERN.test(value)
  );
}

function isSafeFilename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    value.trim() === value &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0")
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isUniqueStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
  allowEmpty = true,
): value is string[] {
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    (!allowEmpty && value.length === 0)
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (!isBoundedText(item, maxItemLength) || seen.has(item)) {
      return false;
    }
    seen.add(item);
  }
  return true;
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

function isBoundedToken(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/\s/.test(value)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOneOf(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === "string" && allowed.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
