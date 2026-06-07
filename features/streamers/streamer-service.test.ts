import { describe, expect, it, vi } from "vitest";

import {
  assertStreamerCanBeInvited,
  createStreamerProfile,
  updateStreamerRisk,
  updateStreamerSettlementRule,
} from "./streamer-service";

const actor = {
  userId: "33333333-3333-3333-3333-333333333333",
  name: "次级运营",
  role: "operator_business" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

describe("streamer service", () => {
  it("blocks invitations for blacklisted streamers", () => {
    expect(() =>
      assertStreamerCanBeInvited({
        id: "S-1",
        displayName: "阿七",
        riskLevel: "blacklisted",
        cooperationStatus: "active",
      }),
    ).toThrow("Blacklisted streamers cannot be invited");
  });

  it("creates streamer profiles without login user binding", async () => {
    const repo = {
      createProfile: vi.fn().mockResolvedValue({
        id: "S-1",
        displayName: "NIKO",
        userId: null,
        riskLevel: "low",
        cooperationStatus: "not_started",
      }),
      getById: vi.fn(),
      updateRisk: vi.fn(),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    const streamer = await createStreamerProfile({
      repo,
      audit,
      actor,
      input: { displayName: "NIKO" },
    });

    expect(streamer.userId).toBeNull();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        module: "streamer",
        objectType: "streamer",
      }),
    );
  });

  it("creates full streamer profiles and audits the written fields", async () => {
    const repo = {
      createProfile: vi.fn().mockResolvedValue({
        id: "S-2",
        displayName: "小鹿",
        userId: "streamer-user",
        riskLevel: "low",
        cooperationStatus: "not_started",
      }),
      getById: vi.fn(),
      updateRisk: vi.fn(),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await createStreamerProfile({
      repo,
      audit,
      actor,
      input: {
        displayName: " 小鹿 ",
        realName: " 鹿鸣 ",
        gender: "女",
        sourceType: "signed",
        categories: ["二游", "卡牌", ""],
        platforms: ["抖音"],
        styles: ["高能整活"],
        defaultSettlementMethod: "cps",
        userId: "streamer-user",
      },
    });

    expect(repo.createProfile).toHaveBeenCalledWith({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      displayName: "小鹿",
      realName: "鹿鸣",
      gender: "女",
      sourceType: "signed",
      categories: ["二游", "卡牌"],
      platforms: ["抖音"],
      styles: ["高能整活"],
      defaultSettlementMethod: "cps",
      userId: "streamer-user",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        changedFields: [
          "display_name",
          "user_id",
          "real_name",
          "gender",
          "source_type",
          "categories",
          "platforms",
          "styles",
          "default_settlement_method",
        ],
      }),
    );
  });

  it("creates streamer profiles with default settlement pricing", async () => {
    const repo = {
      createProfile: vi.fn().mockResolvedValue({
        id: "S-price",
        displayName: "Price Streamer",
        userId: null,
        riskLevel: "low",
        cooperationStatus: "not_started",
      }),
      getById: vi.fn(),
      updateRisk: vi.fn(),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await createStreamerProfile({
      repo,
      audit,
      actor,
      input: {
        displayName: " Price Streamer ",
        defaultSettlementMethod: "base_salary_cpt",
        defaultHourlyRate: 80,
        defaultBaseSalary: 6000,
        defaultCpsRateBps: 1500,
      },
    });

    expect(repo.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Price Streamer",
        defaultSettlementMethod: "base_salary_cpt",
        defaultHourlyRate: 80,
        defaultBaseSalary: 6000,
        defaultCpsRateBps: 1500,
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        changedFields: expect.arrayContaining([
          "default_settlement_method",
          "default_price",
          "default_base_salary",
          "default_cps_rate_bps",
        ]),
      }),
    );
  });

  it("rejects invalid streamer default settlement numbers", async () => {
    const repo = {
      createProfile: vi.fn(),
      getById: vi.fn(),
      updateRisk: vi.fn(),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn();

    await expect(
      createStreamerProfile({
        repo,
        audit,
        actor,
        input: { displayName: "Bad", defaultHourlyRate: -1 },
      }),
    ).rejects.toThrow("defaultHourlyRate must be non-negative");

    await expect(
      createStreamerProfile({
        repo,
        audit,
        actor,
        input: { displayName: "Bad", defaultBaseSalary: -1 },
      }),
    ).rejects.toThrow("defaultBaseSalary must be non-negative");

    await expect(
      createStreamerProfile({
        repo,
        audit,
        actor,
        input: { displayName: "Bad", defaultCpsRateBps: 10001 },
      }),
    ).rejects.toThrow("defaultCpsRateBps must be between 0 and 10000");
  });

  it("rejects risk edits from operator_business", async () => {
    const repo = {
      createProfile: vi.fn(),
      getById: vi.fn(),
      updateRisk: vi.fn(),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn();

    await expect(
      updateStreamerRisk({
        repo,
        audit,
        actor,
        streamerId: "S-1",
        input: {
          riskLevel: "high",
          riskReason: "近期多次报数异常",
        },
        reason: "风控复核",
      }),
    ).rejects.toThrow("Only owner and ops_manager can update streamer risk");
  });

  it("writes high-risk audit for owner risk edits", async () => {
    const before = {
      id: "S-1",
      displayName: "阿七",
      riskLevel: "medium" as const,
      cooperationStatus: "active" as const,
    };
    const after = { ...before, riskLevel: "high" as const };
    const repo = {
      createProfile: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      updateRisk: vi.fn().mockResolvedValue(after),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await updateStreamerRisk({
      repo,
      audit,
      actor: { ...actor, role: "owner" },
      streamerId: before.id,
      input: {
        riskLevel: "high",
        riskReason: "近 7 天报数异常率过高",
      },
      reason: "负责人风控调整",
    });

    expect(repo.updateRisk).toHaveBeenCalledWith(before.id, {
      risk_level: "high",
      risk_reason: "近 7 天报数异常率过高",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        module: "streamer",
        isHighRisk: true,
        reason: "负责人风控调整",
      }),
    );
  });

  it("updates streamer settlement defaults with high-risk audit", async () => {
    const before = {
      id: "S-price",
      displayName: "Price Streamer",
      userId: null,
      riskLevel: "low" as const,
      cooperationStatus: "active" as const,
    };
    const after = { ...before };
    const repo = {
      createProfile: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      updateRisk: vi.fn(),
      updateSettlementRule: vi.fn().mockResolvedValue(after),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await updateStreamerSettlementRule({
      repo,
      audit,
      actor: { ...actor, role: "owner" },
      streamerId: before.id,
      input: {
        defaultSettlementMethod: "cps",
        defaultHourlyRate: 0,
        defaultBaseSalary: 0,
        defaultCpsRateBps: 1500,
      },
      reason: "signed cps update",
    });

    expect(repo.updateSettlementRule).toHaveBeenCalledWith(before.id, {
      default_settlement_method: "cps",
      default_price: 0,
      default_base_salary: 0,
      default_cps_rate_bps: 1500,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        module: "streamer",
        objectType: "streamer",
        isHighRisk: true,
        reason: "signed cps update",
        changedFields: [
          "default_settlement_method",
          "default_price",
          "default_base_salary",
          "default_cps_rate_bps",
        ],
      }),
    );
  });

  it("requires owner or ops_manager and reason for settlement default updates", async () => {
    const repo = {
      createProfile: vi.fn(),
      getById: vi.fn().mockResolvedValue({
        id: "S-price",
        displayName: "Price Streamer",
        riskLevel: "low",
        cooperationStatus: "active",
      }),
      updateRisk: vi.fn(),
      updateSettlementRule: vi.fn(),
    };

    await expect(
      updateStreamerSettlementRule({
        repo,
        audit: vi.fn(),
        actor,
        streamerId: "S-price",
        input: { defaultCpsRateBps: 1500 },
        reason: "update",
      }),
    ).rejects.toThrow(
      "Only owner and ops_manager can update streamer settlement rules",
    );

    await expect(
      updateStreamerSettlementRule({
        repo,
        audit: vi.fn(),
        actor: { ...actor, role: "ops_manager" },
        streamerId: "S-price",
        input: { defaultCpsRateBps: 1500 },
        reason: " ",
      }),
    ).rejects.toThrow("Streamer settlement rule changes require a reason");
  });
});
