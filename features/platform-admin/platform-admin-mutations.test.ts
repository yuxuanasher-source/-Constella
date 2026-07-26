import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlatformAdminContext } from "./platform-admin-auth";
import { PlatformAdminConflictError } from "./platform-admin-errors";
import {
  hashPlatformAdminRequest,
  type PlatformAdminOperationLog,
} from "./platform-admin-operation-log";
import { executePlatformAdminOperation } from "./platform-admin-mutations";

const actor: PlatformAdminContext = {
  userId: "admin-user",
  email: "admin@example.com",
  name: "平台管理员",
  role: "super_admin",
};

function createLog(): PlatformAdminOperationLog & {
  findByIdempotency: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
} {
  return {
    findByIdempotency: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
  };
}

function operationInput(log: PlatformAdminOperationLog) {
  return {
    actor,
    action: "organization.freeze",
    target: {
      type: "organization",
      id: "org-1",
      organizationId: "org-1",
    },
    reason: "合同款项逾期",
    highRisk: true,
    idempotencyKey: "freeze-org-1",
    request: { lifecycleStatus: "frozen" },
    loadBefore: vi.fn(async () => ({
      lifecycleStatus: "active",
      updatedAt: "2026-07-25T08:00:00.000Z",
    })),
    execute: vi.fn(async () => ({
      id: "org-1",
      lifecycleStatus: "frozen",
    })),
    summarizeAfter: vi.fn((result) => ({
      lifecycleStatus: result.lifecycleStatus,
    })),
    log,
  };
}

describe("executePlatformAdminOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a blank reason for high-risk operations", async () => {
    const log = createLog();
    const input = operationInput(log);

    await expect(
      executePlatformAdminOperation({ ...input, reason: "  " }),
    ).rejects.toThrow("reason");
    expect(input.execute).not.toHaveBeenCalled();
    expect(log.write).not.toHaveBeenCalled();
  });

  it("returns the prior success for a repeated idempotency request", async () => {
    const log = createLog();
    const input = operationInput(log);
    const priorResult = {
      id: "org-1",
      lifecycleStatus: "frozen",
    };
    log.findByIdempotency.mockResolvedValue({
      requestHash: hashPlatformAdminRequest(input.request),
      result: "success",
      resultValue: priorResult,
    });

    await expect(executePlatformAdminOperation(input)).resolves.toEqual(
      priorResult,
    );
    expect(input.execute).not.toHaveBeenCalled();
    expect(log.write).not.toHaveBeenCalled();
  });

  it("rejects the same idempotency key with a different request", async () => {
    const log = createLog();
    const input = operationInput(log);
    log.findByIdempotency.mockResolvedValue({
      requestHash: hashPlatformAdminRequest({
        lifecycleStatus: "archived",
      }),
      result: "success",
      resultValue: {},
    });

    await expect(executePlatformAdminOperation(input)).rejects.toBeInstanceOf(
      PlatformAdminConflictError,
    );
    expect(input.execute).not.toHaveBeenCalled();
  });

  it("rejects a stale updatedAt before executing the mutation", async () => {
    const log = createLog();
    const input = operationInput(log);

    await expect(
      executePlatformAdminOperation({
        ...input,
        request: {
          lifecycleStatus: "frozen",
          expectedUpdatedAt: "2026-07-25T07:00:00.000Z",
        },
      }),
    ).rejects.toBeInstanceOf(PlatformAdminConflictError);

    expect(input.execute).not.toHaveBeenCalled();
    expect(log.write).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "failure",
        traceId: expect.any(String),
      }),
    );
  });

  it("logs failures with a trace ID and redacted payloads", async () => {
    const log = createLog();
    const input = operationInput(log);
    input.execute.mockRejectedValue(new Error("provider rejected request"));

    await expect(
      executePlatformAdminOperation({
        ...input,
        request: {
          password: "plain-password",
          providerPayload: { token: "raw-provider-token" },
          serviceRoleKey: "raw-service-key",
        },
      }),
    ).rejects.toThrow("provider rejected request");

    expect(log.write).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "failure",
        traceId: expect.any(String),
        request: {
          password: "[REDACTED]",
          providerPayload: "[REDACTED]",
          serviceRoleKey: "[REDACTED]",
        },
      }),
    );
    expect(JSON.stringify(log.write.mock.calls)).not.toContain(
      "plain-password",
    );
    expect(JSON.stringify(log.write.mock.calls)).not.toContain(
      "raw-provider-token",
    );
    expect(JSON.stringify(log.write.mock.calls)).not.toContain(
      "raw-service-key",
    );
  });
});
