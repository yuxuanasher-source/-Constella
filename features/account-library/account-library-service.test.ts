import { describe, expect, it, vi } from "vitest";

import {
  bindStreamerToAccount,
  createPlatformAccount,
  updatePlatformAccount,
  type PlatformAccountRecord,
} from "./account-library-service";

const actor = {
  userId: "33333333-3333-3333-3333-333333333333",
  name: "次级运营",
  role: "operator_business" as const,
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

describe("account library service", () => {
  it("creates a platform account and audits written fields", async () => {
    const repo = {
      createAccount: vi.fn().mockResolvedValue(accountRecord()),
      getById: vi.fn(),
      updateAccount: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await createPlatformAccount({
      repo,
      audit,
      actor,
      input: {
        platform: " 抖音 ",
        accountUid: " douyin-001 ",
        accountSource: "自注册",
        xingtuId: "XT-9",
        realNameHolder: "张三",
        realNamePhone: "13800001111",
      },
    });

    expect(repo.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: actor.organizationId,
        platform: "抖音",
        accountUid: "douyin-001",
        accountType: "self_incubated",
        status: "active",
        realNameHolder: "张三",
        realNamePhone: "13800001111",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        module: "account_library",
        objectType: "platform_account",
      }),
    );
  });

  it("requires a bound streamer for streamer-owned accounts", async () => {
    const repo = {
      createAccount: vi.fn(),
      getById: vi.fn(),
      updateAccount: vi.fn(),
    };
    const audit = vi.fn();

    await expect(
      createPlatformAccount({
        repo,
        audit,
        actor,
        input: {
          platform: "抖音",
          accountUid: "douyin-002",
          accountType: "streamer_owned",
        },
      }),
    ).rejects.toThrow("Streamer-owned accounts require a bound streamer");
    expect(repo.createAccount).not.toHaveBeenCalled();
  });

  it("rejects account management from finance role", async () => {
    const repo = {
      createAccount: vi.fn(),
      getById: vi.fn(),
      updateAccount: vi.fn(),
    };
    const audit = vi.fn();

    await expect(
      createPlatformAccount({
        repo,
        audit,
        actor: { ...actor, role: "finance" },
        input: { platform: "抖音", accountUid: "douyin-003" },
      }),
    ).rejects.toThrow("Current role cannot manage platform accounts");
  });

  it("requires a reason and writes high-risk audit when real-name fields change", async () => {
    const before = accountRecord({ realNamePhone: "13800001111" });
    const after = accountRecord({ realNamePhone: "13900002222" });
    const repo = {
      createAccount: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      updateAccount: vi.fn().mockResolvedValue(after),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await expect(
      updatePlatformAccount({
        repo,
        audit,
        actor,
        accountId: before.id,
        input: { realNamePhone: "13900002222" },
      }),
    ).rejects.toThrow("Updating real-name fields requires a reason");

    await updatePlatformAccount({
      repo,
      audit,
      actor,
      accountId: before.id,
      input: { realNamePhone: "13900002222" },
      reason: "实名信息更正",
    });

    expect(repo.updateAccount).toHaveBeenCalledWith(before.id, {
      real_name_phone: "13900002222",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        isHighRisk: true,
        reason: "实名信息更正",
      }),
    );
  });

  it("does not flag non-sensitive updates as high risk", async () => {
    const before = accountRecord();
    const after = accountRecord({ status: "idle" });
    const repo = {
      createAccount: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      updateAccount: vi.fn().mockResolvedValue(after),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await updatePlatformAccount({
      repo,
      audit,
      actor,
      accountId: before.id,
      input: { status: "idle" },
    });

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ isHighRisk: false }),
    );
  });

  it("blocks unbinding a streamer-owned account", async () => {
    const before = accountRecord({
      accountType: "streamer_owned",
      boundStreamerId: "S-1",
    });
    const repo = {
      createAccount: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      updateAccount: vi.fn(),
    };
    const audit = vi.fn();

    await expect(
      bindStreamerToAccount({
        repo,
        audit,
        actor,
        accountId: before.id,
        streamerId: null,
      }),
    ).rejects.toThrow(
      "Streamer-owned accounts must stay bound to a streamer",
    );
    expect(repo.updateAccount).not.toHaveBeenCalled();
  });
});
