import { describe, expect, it, vi } from "vitest";

import {
  assertStreamerCanBeInvited,
  createStreamerProfile,
  updateStreamerRisk,
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

  it("rejects risk edits from operator_business", async () => {
    const repo = {
      createProfile: vi.fn(),
      getById: vi.fn(),
      updateRisk: vi.fn(),
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
});
