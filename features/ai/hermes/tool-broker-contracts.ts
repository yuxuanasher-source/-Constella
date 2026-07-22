import { createHash } from "node:crypto";

import { HERMES_EVIDENCE_REF_MAX_LENGTH, isUuid } from "./contracts";
import {
  HERMES_READ_ENDPOINTS,
  type HermesReadErrorCode,
  type HermesReadToolName,
} from "./read-api";
import { isHermesMemoryType, type HermesMemoryType } from "./memory-policy";

const REQUEST_KEYS = [
  "arguments",
  "invocationId",
  "toolCallId",
  "toolName",
] as const;
const TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ENVELOPE_METADATA_KEYS = [
  "evidenceRefs",
  "invocationId",
  "missingData",
  "observedAt",
  "permissionDenials",
  "sourceLabels",
  "status",
  "toolCallId",
  "toolName",
  "traceId",
  "truncated",
  "updatedAt",
] as const;

export const HERMES_MEMORY_TOOL_NAMES = [
  "xingyao_memory_list",
  "xingyao_memory_remember",
  "xingyao_memory_forget",
] as const;

export type HermesMemoryToolName = (typeof HERMES_MEMORY_TOOL_NAMES)[number];
export type HermesToolBrokerToolName =
  | HermesReadToolName
  | HermesMemoryToolName;
export type HermesToolBrokerErrorEnvelopeCode =
  | HermesReadErrorCode
  | "memory_content_rejected";

type HermesReadToolBrokerRequest = {
  invocationId: string;
  toolCallId: string;
  toolName: HermesReadToolName;
  arguments: Record<string, unknown>;
};

export type HermesMemoryListToolBrokerRequest = {
  invocationId: string;
  toolCallId: string;
  toolName: "xingyao_memory_list";
  arguments: Record<string, never>;
};

export type HermesMemoryRememberToolBrokerRequest = {
  invocationId: string;
  toolCallId: string;
  toolName: "xingyao_memory_remember";
  arguments: {
    memoryType: HermesMemoryType;
    content: string;
    parentInvocationId: string;
    sourceMessageId: string;
    memoryKey?: string;
    expectedRevision?: number;
  };
};

export type HermesMemoryForgetToolBrokerRequest = {
  invocationId: string;
  toolCallId: string;
  toolName: "xingyao_memory_forget";
  arguments: {
    memoryKey: string;
    expectedRevision: number;
    parentInvocationId: string;
    sourceMessageId: string;
  };
};

export type HermesToolBrokerRequest =
  | HermesReadToolBrokerRequest
  | HermesMemoryListToolBrokerRequest
  | HermesMemoryRememberToolBrokerRequest
  | HermesMemoryForgetToolBrokerRequest;

type HermesToolBrokerMetadata = {
  evidenceRefs: string[];
  sourceLabels: string[];
  updatedAt: string;
  observedAt: string;
  missingData: string[];
  permissionDenials: string[];
  truncated: boolean;
  invocationId: string;
  toolCallId: string;
  toolName: HermesToolBrokerToolName;
  traceId: string;
};

export type HermesToolBrokerEnvelope =
  | (HermesToolBrokerMetadata & {
      status: "ok" | "partial";
      data: unknown;
    })
  | (HermesToolBrokerMetadata & {
      status: "error";
      error: { code: HermesToolBrokerErrorEnvelopeCode };
    });

export function parseHermesToolBrokerRequest(
  value: unknown,
): HermesToolBrokerRequest | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) return null;
  if (
    !isUuid(value.invocationId) ||
    typeof value.toolCallId !== "string" ||
    !TOOL_CALL_ID_PATTERN.test(value.toolCallId) ||
    typeof value.toolName !== "string" ||
    !isHermesToolBrokerToolName(value.toolName) ||
    !isPlainRecord(value.arguments) ||
    !isJsonValue(value.arguments) ||
    !isToolArguments(value.toolName, value.arguments)
  ) {
    return null;
  }

  return {
    invocationId: value.invocationId,
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    arguments: structuredClone(value.arguments),
  } as HermesToolBrokerRequest;
}

export function hashHermesToolBrokerRequest(
  request: HermesToolBrokerRequest,
): string {
  return createHash("sha256").update(canonicalJson(request)).digest("hex");
}

export function parseStoredHermesToolBrokerEnvelope(
  value: unknown,
  request: HermesToolBrokerRequest,
): HermesToolBrokerEnvelope | null {
  if (!isPlainRecord(value)) return null;
  const status = value.status;
  if (status !== "ok" && status !== "partial" && status !== "error") {
    return null;
  }
  const payloadKey = status === "error" ? "error" : "data";
  if (
    !hasExactKeys(value, [...ENVELOPE_METADATA_KEYS, payloadKey]) ||
    value.invocationId !== request.invocationId ||
    value.toolCallId !== request.toolCallId ||
    value.toolName !== request.toolName ||
    !isMetadataList(value.evidenceRefs, HERMES_EVIDENCE_REF_MAX_LENGTH) ||
    !isMetadataList(value.sourceLabels) ||
    !isMetadataList(value.missingData) ||
    !isMetadataList(value.permissionDenials) ||
    !isTimestamp(value.updatedAt) ||
    !isTimestamp(value.observedAt) ||
    typeof value.truncated !== "boolean" ||
    typeof value.traceId !== "string" ||
    !TOOL_CALL_ID_PATTERN.test(value.traceId)
  ) {
    return null;
  }
  if (status === "error") {
    if (
      !isPlainRecord(value.error) ||
      !hasExactKeys(value.error, ["code"]) ||
      !isHermesToolBrokerErrorEnvelopeCode(value.error.code)
    ) {
      return null;
    }
  } else if (!isJsonValue(value.data)) {
    return null;
  }
  return structuredClone(value) as HermesToolBrokerEnvelope;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Value is not canonical JSON");
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return (
    isPlainRecord(value) &&
    Object.entries(value).every(
      ([key, item]) => !isPrototypeKey(key) && isJsonValue(item),
    )
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isMetadataList(
  value: unknown,
  maxItemLength = HERMES_EVIDENCE_REF_MAX_LENGTH,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    new Set(value).size === value.length &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= maxItemLength &&
        item === item.trim(),
    )
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isHermesToolBrokerErrorEnvelopeCode(
  value: unknown,
): value is HermesToolBrokerErrorEnvelopeCode {
  return [
    "unauthorized",
    "permission_denied",
    "not_found",
    "invalid_request",
    "rate_limited",
    "upstream_unavailable",
    "internal_error",
    "memory_content_rejected",
  ].includes(String(value));
}

function isHermesToolBrokerToolName(
  value: string,
): value is HermesToolBrokerToolName {
  return (
    Object.hasOwn(HERMES_READ_ENDPOINTS, value) ||
    (HERMES_MEMORY_TOOL_NAMES as readonly string[]).includes(value)
  );
}

function isToolArguments(
  toolName: HermesToolBrokerToolName,
  value: Record<string, unknown>,
): boolean {
  switch (toolName) {
    case "xingyao_get_current_context":
      return hasExactKeys(value, []);
    case "xingyao_search_projects":
      return (
        hasArgumentKeys(value, [], ["limit", "query"]) &&
        hasValidOptionalLimit(value) &&
        hasValidOptionalQuery(value)
      );
    case "xingyao_get_project_summary":
      return hasExactKeys(value, ["projectId"]) && isUuid(value.projectId);
    case "xingyao_get_streamer_project_profile":
    case "xingyao_search_live_reports":
      return (
        hasArgumentKeys(value, [], ["limit", "projectId", "streamerId"]) &&
        hasValidOptionalLimit(value) &&
        hasValidOptionalUuid(value, "projectId") &&
        hasValidOptionalUuid(value, "streamerId")
      );
    case "xingyao_search_recording_reviews":
      return (
        hasArgumentKeys(
          value,
          [],
          ["limit", "projectId", "query", "streamerId"],
        ) &&
        hasValidOptionalLimit(value) &&
        hasValidOptionalQuery(value) &&
        hasValidOptionalUuid(value, "projectId") &&
        hasValidOptionalUuid(value, "streamerId")
      );
    case "xingyao_search_knowledge":
      return (
        hasArgumentKeys(value, ["query"], ["limit"]) &&
        isQuery(value.query) &&
        hasValidOptionalLimit(value)
      );
    case "xingyao_get_settlement_summary":
      return (
        hasArgumentKeys(value, [], ["limit", "projectId"]) &&
        hasValidOptionalLimit(value) &&
        hasValidOptionalUuid(value, "projectId")
      );
    case "xingyao_memory_list":
      return hasExactKeys(value, []);
    case "xingyao_memory_remember":
      return isRememberArguments(value);
    case "xingyao_memory_forget":
      return (
        hasExactKeys(value, [
          "expectedRevision",
          "memoryKey",
          "parentInvocationId",
          "sourceMessageId",
        ]) &&
        isUuid(value.memoryKey) &&
        isPositiveInteger(value.expectedRevision) &&
        isUuid(value.parentInvocationId) &&
        isUuid(value.sourceMessageId)
      );
    default:
      return false;
  }
}

function hasArgumentKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function hasValidOptionalLimit(value: Record<string, unknown>): boolean {
  return !Object.hasOwn(value, "limit") || Number.isInteger(value.limit);
}

function hasValidOptionalQuery(value: Record<string, unknown>): boolean {
  return !Object.hasOwn(value, "query") || isQuery(value.query);
}

function hasValidOptionalUuid(
  value: Record<string, unknown>,
  key: "projectId" | "streamerId",
): boolean {
  return !Object.hasOwn(value, key) || isUuid(value[key]);
}

function isQuery(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isRememberArguments(value: Record<string, unknown>): boolean {
  const createKeys = [
    "content",
    "memoryType",
    "parentInvocationId",
    "sourceMessageId",
  ] as const;
  const updateKeys = [...createKeys, "expectedRevision", "memoryKey"] as const;
  const isCreate = hasExactKeys(value, createKeys);
  const isUpdate = hasExactKeys(value, updateKeys);
  return (
    (isCreate || isUpdate) &&
    isHermesMemoryType(value.memoryType) &&
    typeof value.content === "string" &&
    Boolean(value.content.trim()) &&
    isUuid(value.parentInvocationId) &&
    isUuid(value.sourceMessageId) &&
    (!isUpdate ||
      (isUuid(value.memoryKey) && isPositiveInteger(value.expectedRevision)))
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isPrototypeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
