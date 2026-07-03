import { describe, expect, it, vi } from "vitest";

import type { PlatformAccountRecord } from "./account-library-service";
import {
  addAccountDevice,
  recordAccountLogin,
  revokeAccountDevice,
  type AccountDeviceRecord,
  type AccountLoginLogRecord,
} from "./account-security-service";

const actor = {
  userId: "33333333-3333-3333-3333-333333333333",
  name: "运营负责人",
  role: "ops_manager" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

function accountRecord(): PlatformAccountRecord {
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
  };
}

function deviceRecord(
  overrides: Partial<AccountDeviceRecord> = {},
): AccountDeviceRecord {
  return {
    id: "DEV-1",
    organizationId: actor.organizationId,
    accountId: "ACC-1",
    deviceName: "直播间主力机",
    deviceFingerprint: "FP-001",
    status: "active",
    ...overrides,
  };
}

function loginLogRecord(
  overrides: Partial<AccountLoginLogRecord> = {},
): AccountLoginLogRecord {
  return {
    id: "LOG-1",
    organizationId: actor.organizationId,
    accountId: "ACC-1",
    deviceFingerprint: "FP-001",
    deviceName: "直播间主力机",
    loggedInAt: "2026-07-03T08:00:00.000Z",
    isWhitelisted: true,
    riskLevel: "normal",
    ...overrides,
  };
}

function securityRepo(overrides: Record<string, unknown> = {}) {
  return {
    getById: vi.fn().mockResolvedValue(accountRecord()),
    createDevice: vi.fn().mockResolvedValue(deviceRecord()),
    getDeviceById: vi.fn().mockResolvedValue(deviceRecord()),
    updateDevice: vi
      .fn()
      .mockResolvedValue(deviceRecord({ status: "revoked" })),
    hasActiveDevice: vi.fn().mockResolvedValue(true),
    createLoginLog: vi.fn().mockResolvedValue(loginLogRecord()),
    ...overrides,
  };
}

describe("account device whitelist", () => {
  it("adds a device and audits the creation", async () => {
    const repo = securityRepo();
    const audit = vi.fn().mockResolvedValue(undefined);

    await addAccountDevice({
      repo,
      audit,
      actor,
      accountId: "ACC-1",
      input: {
        deviceName: " 直播间主力机 ",
        deviceFingerprint: " FP-001 ",
      },
    });

    expect(repo.createDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ACC-1",
        deviceName: "直播间主力机",
        deviceFingerprint: "FP-001",
        createdBy: actor.userId,
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        objectType: "platform_account_device",
      }),
    );
  });

  it("refuses to revoke a device from another account", async () => {
    const repo = securityRepo({
      getDeviceById: vi
        .fn()
        .mockResolvedValue(deviceRecord({ accountId: "ACC-OTHER" })),
    });
    const audit = vi.fn();

    await expect(
      revokeAccountDevice({
        repo,
        audit,
        actor,
        accountId: "ACC-1",
        deviceId: "DEV-1",
      }),
    ).rejects.toThrow("Account device not found");
    expect(repo.updateDevice).not.toHaveBeenCalled();
  });

  it("refuses to revoke an already revoked device", async () => {
    const repo = securityRepo({
      getDeviceById: vi
        .fn()
        .mockResolvedValue(deviceRecord({ status: "revoked" })),
    });
    const audit = vi.fn();

    await expect(
      revokeAccountDevice({
        repo,
        audit,
        actor,
        accountId: "ACC-1",
        deviceId: "DEV-1",
      }),
    ).rejects.toThrow("Device is already revoked");
  });
});

describe("account login recording", () => {
  it("keeps whitelisted logins silent", async () => {
    const repo = securityRepo();
    const audit = vi.fn();
    const notify = vi.fn();

    const log = await recordAccountLogin({
      repo,
      audit,
      notify,
      actor,
      accountId: "ACC-1",
      input: { deviceFingerprint: "FP-001" },
    });

    expect(log.riskLevel).toBe("normal");
    expect(repo.createLoginLog).toHaveBeenCalledWith(
      expect.objectContaining({
        isWhitelisted: true,
        riskLevel: "normal",
      }),
    );
    expect(notify).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("flags non-whitelisted logins and raises a high-risk alert", async () => {
    const suspiciousLog = loginLogRecord({
      deviceFingerprint: "FP-UNKNOWN",
      deviceName: "陌生设备",
      isWhitelisted: false,
      riskLevel: "suspicious",
    });
    const repo = securityRepo({
      hasActiveDevice: vi.fn().mockResolvedValue(false),
      createLoginLog: vi.fn().mockResolvedValue(suspiciousLog),
    });
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);

    const log = await recordAccountLogin({
      repo,
      audit,
      notify,
      actor,
      accountId: "ACC-1",
      input: { deviceFingerprint: "FP-UNKNOWN", deviceName: "陌生设备" },
    });

    expect(log.riskLevel).toBe("suspicious");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientRole: "ops_manager",
        type: "high_risk",
        isHighRisk: true,
        objectId: suspiciousLog.id,
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "login",
        isHighRisk: true,
      }),
    );
  });

  it("rejects login recording without a device fingerprint", async () => {
    const repo = securityRepo();
    const audit = vi.fn();
    const notify = vi.fn();

    await expect(
      recordAccountLogin({
        repo,
        audit,
        notify,
        actor,
        accountId: "ACC-1",
        input: { deviceFingerprint: "  " },
      }),
    ).rejects.toThrow("deviceFingerprint is required");
    expect(repo.createLoginLog).not.toHaveBeenCalled();
  });
});
