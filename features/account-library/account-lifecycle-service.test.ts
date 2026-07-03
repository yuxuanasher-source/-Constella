import { describe, expect, it, vi } from "vitest";

import {
  markIdlePlatformAccounts,
  transitionPlatformAccountStatus,
} from "./account-lifecycle-service";
import type { PlatformAccountRecord } from "./account-library-service";

const actor = {
  userId: "33333333-3333-3333-3333-333333333333",
  name: "运营负责人",
  role: "ops_manager" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

function accountRecord(
  overrides: Partial<PlatformAccountRecord> = {},
): PlatformAccountRecord {
  return {
    id: "ACC-1",
    organizationId: actor.organizationId,
    platform: "抖音",
    accountUid: "douyin-001",
    accountType: "self_incubated",
    status: "active",
    boundStreamerId: null,
    realNameHolder: null,
    realNamePhone: null,
    ...overrides,
  };
}

function lifecycleRepo(overrides: Record<string, unknown> = {}) {
  return {
    getById: vi.fn().mockResolvedValue(accountRecord()),
    updateAccount: vi.fn().mockResolvedValue(accountRecord()),
    createStatusLog: vi.fn().mockResolvedValue(undefined),
    createBanRecord: vi.fn().mockResolvedValue(undefined),
    liftOpenBanRecords: vi.fn().mockResolvedValue(undefined),
    listAutoIdleCandidates: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("account lifecycle transitions", () => {
  it("moves a nurturing account into active with a status log", async () => {
    const before = accountRecord({ status: "nurturing" });
    const after = accountRecord({ status: "active" });
    const repo = lifecycleRepo({
      getById: vi.fn().mockResolvedValue(before),
      updateAccount: vi.fn().mockResolvedValue(after),
    });
    const audit = vi.fn().mockResolvedValue(undefined);

    const account = await transitionPlatformAccountStatus({
      repo,
      audit,
      actor,
      accountId: before.id,
      toStatus: "active",
      reason: "养号达标启用",
    });

    expect(account.status).toBe("active");
    expect(repo.updateAccount).toHaveBeenCalledWith(before.id, {
      status: "active",
    });
    expect(repo.createStatusLog).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: "nurturing",
        toStatus: "active",
        source: "manual",
        changedBy: actor.userId,
      }),
    );
    expect(repo.createBanRecord).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ changedFields: ["status"], isHighRisk: false }),
    );
  });

  it("rejects transitions that are not in the state machine", async () => {
    const repo = lifecycleRepo({
      getById: vi.fn().mockResolvedValue(accountRecord({ status: "retired" })),
    });
    const audit = vi.fn();

    await expect(
      transitionPlatformAccountStatus({
        repo,
        audit,
        actor,
        accountId: "ACC-1",
        toStatus: "active",
      }),
    ).rejects.toThrow("Cannot transition account from retired to active");
    expect(repo.updateAccount).not.toHaveBeenCalled();
  });

  it("requires a reason to freeze and archives a ban record", async () => {
    const before = accountRecord({ status: "active" });
    const after = accountRecord({ status: "frozen" });
    const repo = lifecycleRepo({
      getById: vi.fn().mockResolvedValue(before),
      updateAccount: vi.fn().mockResolvedValue(after),
    });
    const audit = vi.fn().mockResolvedValue(undefined);

    await expect(
      transitionPlatformAccountStatus({
        repo,
        audit,
        actor,
        accountId: before.id,
        toStatus: "frozen",
      }),
    ).rejects.toThrow("Freezing or retiring an account requires a reason");

    await transitionPlatformAccountStatus({
      repo,
      audit,
      actor,
      accountId: before.id,
      toStatus: "frozen",
      reason: "平台判定违规",
      banSource: "抖音违规通知",
    });

    expect(repo.createBanRecord).toHaveBeenCalledWith({
      organizationId: actor.organizationId,
      accountId: before.id,
      reason: "平台判定违规",
      source: "抖音违规通知",
      createdBy: actor.userId,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ isHighRisk: true, reason: "平台判定违规" }),
    );
  });

  it("closes open ban records when unfreezing", async () => {
    const before = accountRecord({ status: "frozen" });
    const after = accountRecord({ status: "active" });
    const repo = lifecycleRepo({
      getById: vi.fn().mockResolvedValue(before),
      updateAccount: vi.fn().mockResolvedValue(after),
    });
    const audit = vi.fn().mockResolvedValue(undefined);

    await transitionPlatformAccountStatus({
      repo,
      audit,
      actor,
      accountId: before.id,
      toStatus: "active",
      reason: "申诉解封成功",
      now: "2026-07-03T08:00:00.000Z",
    });

    expect(repo.liftOpenBanRecords).toHaveBeenCalledWith(before.id, {
      liftedBy: actor.userId,
      liftedReason: "申诉解封成功",
      liftedAt: "2026-07-03T08:00:00.000Z",
    });
  });

  it("rejects lifecycle changes from streamer role", async () => {
    const repo = lifecycleRepo();
    const audit = vi.fn();

    await expect(
      transitionPlatformAccountStatus({
        repo,
        audit,
        actor: { ...actor, role: "streamer" },
        accountId: "ACC-1",
        toStatus: "idle",
      }),
    ).rejects.toThrow("Current role cannot manage platform accounts");
  });
});

describe("auto idle marking", () => {
  it("marks stale active accounts idle and notifies ops", async () => {
    const stale = accountRecord({ id: "ACC-9", status: "active" });
    const repo = lifecycleRepo({
      listAutoIdleCandidates: vi.fn().mockResolvedValue([stale]),
      updateAccount: vi
        .fn()
        .mockResolvedValue(accountRecord({ id: "ACC-9", status: "idle" })),
    });
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);

    const result = await markIdlePlatformAccounts({
      repo,
      audit,
      notify,
      actor,
      now: "2026-07-03T08:00:00.000Z",
      idleAfterDays: 14,
    });

    expect(result).toEqual({ scannedCount: 1, markedCount: 1 });
    expect(repo.listAutoIdleCandidates).toHaveBeenCalledWith({
      organizationId: actor.organizationId,
      cutoffIso: "2026-06-19T08:00:00.000Z",
    });
    expect(repo.updateAccount).toHaveBeenCalledWith("ACC-9", {
      status: "idle",
    });
    expect(repo.createStatusLog).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ACC-9",
        fromStatus: "active",
        toStatus: "idle",
        source: "auto_idle",
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientRole: "ops_manager",
        type: "system",
      }),
    );
  });

  it("stays quiet when no account crosses the idle threshold", async () => {
    const repo = lifecycleRepo();
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();

    const result = await markIdlePlatformAccounts({
      repo,
      audit,
      notify,
      actor,
    });

    expect(result).toEqual({ scannedCount: 0, markedCount: 0 });
    expect(notify).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ objectType: "account_idle_scan" }),
    );
  });
});
