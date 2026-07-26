import { randomUUID } from "node:crypto";

import type { PlatformAdminContext } from "./platform-admin-auth";
import {
  PlatformAdminConflictError,
  PlatformAdminValidationError,
} from "./platform-admin-errors";
import {
  hashPlatformAdminRequest,
  redactPlatformAdminError,
  redactPlatformAdminPayload,
  type PlatformAdminOperationLog,
  type PlatformAdminOperationLogEntry,
} from "./platform-admin-operation-log";

export async function executePlatformAdminOperation<T>(input: {
  actor: PlatformAdminContext;
  action: string;
  target: { type: string; id?: string; organizationId?: string };
  reason: string;
  highRisk: boolean;
  idempotencyKey?: string;
  request: Record<string, unknown>;
  loadBefore?: () => Promise<Record<string, unknown>>;
  execute: () => Promise<T>;
  summarizeAfter: (result: T) => Record<string, unknown>;
  log: PlatformAdminOperationLog;
  traceId?: string;
}): Promise<T> {
  const reason = input.reason.trim();
  if (input.highRisk && !reason) {
    throw new PlatformAdminValidationError(
      "A reason is required for high-risk operations.",
    );
  }

  const requestHash = hashPlatformAdminRequest(input.request);
  if (input.idempotencyKey) {
    const existing = await input.log.findByIdempotency({
      actorUserId: input.actor.userId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new PlatformAdminConflictError(
          "Idempotency key was already used for a different request.",
        );
      }
      if (existing.result === "success") {
        return existing.resultValue as T;
      }
      throw new PlatformAdminConflictError(
        "A prior attempt with this idempotency key failed. Retry with a new key.",
      );
    }
  }

  const traceId = input.traceId ?? randomUUID();
  const before = input.loadBefore ? await input.loadBefore() : {};
  const redactedRequest = redactPlatformAdminPayload(input.request);
  const redactedBefore = redactPlatformAdminPayload(before);

  const concurrencyConflict = staleUpdateConflict(input.request, before);
  if (concurrencyConflict) {
    await input.log.write(
      operationEntry(input, {
        reason,
        requestHash,
        traceId,
        request: redactedRequest,
        before: redactedBefore,
        after: {},
        result: "failure",
        errorMessage: concurrencyConflict.message,
      }),
    );
    throw concurrencyConflict;
  }

  let result: T;
  try {
    result = await input.execute();
  } catch (error) {
    await input.log.write(
      operationEntry(input, {
        reason,
        requestHash,
        traceId,
        request: redactedRequest,
        before: redactedBefore,
        after: {},
        result: "failure",
        errorMessage: redactPlatformAdminError(error, input.request),
      }),
    );
    throw error;
  }

  const after = redactPlatformAdminPayload(input.summarizeAfter(result));
  await input.log.write(
    operationEntry(input, {
      reason,
      requestHash,
      traceId,
      request: redactedRequest,
      before: redactedBefore,
      after,
      result: "success",
      resultValue: redactPlatformAdminPayload(result),
    }),
  );
  return result;
}

function operationEntry(
  input: {
    actor: PlatformAdminContext;
    action: string;
    target: { type: string; id?: string; organizationId?: string };
    highRisk: boolean;
    idempotencyKey?: string;
  },
  detail: Omit<
    PlatformAdminOperationLogEntry,
    "actorUserId" | "action" | "target" | "highRisk" | "idempotencyKey"
  >,
): PlatformAdminOperationLogEntry {
  return {
    actorUserId: input.actor.userId,
    action: input.action,
    target: input.target,
    highRisk: input.highRisk,
    idempotencyKey: input.idempotencyKey,
    ...detail,
  };
}

function staleUpdateConflict(
  request: Record<string, unknown>,
  before: Record<string, unknown>,
) {
  const expectedUpdatedAt = request.expectedUpdatedAt;
  const currentUpdatedAt = before.updatedAt ?? before.updated_at;
  if (
    typeof expectedUpdatedAt === "string" &&
    typeof currentUpdatedAt === "string" &&
    expectedUpdatedAt !== currentUpdatedAt
  ) {
    return new PlatformAdminConflictError(
      "The record changed after it was loaded. Refresh and try again.",
    );
  }
  return null;
}
