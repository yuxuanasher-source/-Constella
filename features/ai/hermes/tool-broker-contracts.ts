import { createHash } from "node:crypto";

import { HERMES_EVIDENCE_REF_MAX_LENGTH, isUuid } from "./contracts";
import {
  HERMES_READ_ENDPOINTS,
  type HermesReadErrorCode,
  type HermesReadToolName,
} from "./read-api";

const REQUEST_KEYS = [
  "arguments",
  "invocationId",
  "toolCallId",
  "toolName",
] as const;
const ARGUMENT_KEYS = new Set(["limit", "projectId", "query", "streamerId"]);
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

export type HermesToolBrokerRequest = {
  invocationId: string;
  toolCallId: string;
  toolName: HermesReadToolName;
  arguments: Record<string, unknown>;
};

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
  toolName: HermesReadToolName;
  traceId: string;
};

export type HermesToolBrokerEnvelope =
  | (HermesToolBrokerMetadata & {
      status: "ok" | "partial";
      data: unknown;
    })
  | (HermesToolBrokerMetadata & {
      status: "error";
      error: { code: HermesReadErrorCode };
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
    !Object.hasOwn(HERMES_READ_ENDPOINTS, value.toolName) ||
    !isPlainRecord(value.arguments) ||
    !Object.keys(value.arguments).every((key) => ARGUMENT_KEYS.has(key)) ||
    !isJsonValue(value.arguments)
  ) {
    return null;
  }

  return {
    invocationId: value.invocationId,
    toolCallId: value.toolCallId,
    toolName: value.toolName as HermesReadToolName,
    arguments: structuredClone(value.arguments),
  };
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
      !isHermesReadErrorCode(value.error.code)
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

function isHermesReadErrorCode(value: unknown): value is HermesReadErrorCode {
  return [
    "unauthorized",
    "permission_denied",
    "not_found",
    "invalid_request",
    "rate_limited",
    "upstream_unavailable",
    "internal_error",
  ].includes(String(value));
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
