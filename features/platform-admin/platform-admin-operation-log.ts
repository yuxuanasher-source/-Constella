import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

type OperationResult = "success" | "failure";

export type ExistingPlatformAdminOperation = {
  requestHash: string;
  result: OperationResult;
  resultValue?: unknown;
};

export type PlatformAdminOperationLogEntry = {
  actorUserId: string;
  action: string;
  target: {
    type: string;
    id?: string;
    organizationId?: string;
  };
  reason: string;
  highRisk: boolean;
  requestHash: string;
  request: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  result: OperationResult;
  resultValue?: unknown;
  errorMessage?: string;
  traceId: string;
  idempotencyKey?: string;
};

export type PlatformAdminOperationLog = {
  findByIdempotency(input: {
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<ExistingPlatformAdminOperation | null>;
  write(entry: PlatformAdminOperationLogEntry): Promise<void>;
};

export class SupabasePlatformAdminOperationLog implements PlatformAdminOperationLog {
  constructor(private readonly client: SupabaseClient) {}

  async findByIdempotency(input: {
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<ExistingPlatformAdminOperation | null> {
    const { data, error } = await this.client
      .from("platform_admin_operation_logs")
      .select("before_json, after_json, result")
      .eq("actor_user_id", input.actorUserId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle<{
        before_json: {
          requestHash?: unknown;
        };
        after_json: {
          resultValue?: unknown;
        };
        result: OperationResult;
      }>();
    if (error) {
      throw new Error(`Failed to load operation log: ${error.message}`);
    }
    if (!data || typeof data.before_json?.requestHash !== "string") {
      return null;
    }
    return {
      requestHash: data.before_json.requestHash,
      result: data.result,
      resultValue: data.after_json?.resultValue,
    };
  }

  async write(entry: PlatformAdminOperationLogEntry): Promise<void> {
    const { error } = await this.client
      .from("platform_admin_operation_logs")
      .insert({
        actor_user_id: entry.actorUserId,
        action: entry.action,
        target_type: entry.target.type,
        target_id: entry.target.id ?? null,
        target_organization_id: entry.target.organizationId ?? null,
        before_json: {
          requestHash: entry.requestHash,
          request: redactPlatformAdminPayload(entry.request),
          snapshot: redactPlatformAdminPayload(entry.before),
        },
        after_json: {
          summary: redactPlatformAdminPayload(entry.after),
          resultValue: redactPlatformAdminPayload(entry.resultValue),
        },
        reason: entry.reason || null,
        is_high_risk: entry.highRisk,
        result: entry.result,
        error_message: entry.errorMessage ?? null,
        trace_id: entry.traceId,
        idempotency_key: entry.idempotencyKey ?? null,
      });
    if (error) {
      throw new Error(`Failed to write operation log: ${error.message}`);
    }
  }
}

export function hashPlatformAdminRequest(
  request: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(request)))
    .digest("hex");
}

export function redactPlatformAdminPayload<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T;
}

export function redactPlatformAdminError(
  error: unknown,
  request: Record<string, unknown>,
) {
  const message = error instanceof Error ? error.message : "Operation failed";
  const secrets = collectSensitiveStrings(request);
  let redacted = message
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(password|token|secret|service[_-]?role[_-]?key)\s*[=:]\s*\S+/gi,
      "$1=[REDACTED]",
    );
  secrets.forEach((secret) => {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  });
  return redacted.slice(0, 500);
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[REDACTED]";
    }
    seen.add(value);
    const result = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        isSensitiveKey(key) ? "[REDACTED]" : redactValue(nested, seen),
      ]),
    );
    seen.delete(value);
    return result;
  }
  return value;
}

function isSensitiveKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    normalized.includes("password") ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("authorization") ||
    normalized.includes("providerpayload") ||
    normalized.includes("servicerolekey")
  );
}

function collectSensitiveStrings(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nested]) => {
      if (isSensitiveKey(key)) {
        if (typeof nested === "string" && nested.length >= 4) {
          return [nested];
        }
        return collectStrings(nested);
      }
      return collectSensitiveStrings(nested);
    },
  );
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return value.length >= 4 ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(
      collectStrings,
    );
  }
  return [];
}
