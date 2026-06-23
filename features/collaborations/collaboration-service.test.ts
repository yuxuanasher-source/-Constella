import { describe, expect, it, vi } from "vitest";

import {
  acceptCollaboration,
  changeCollaborationStatus,
  openCollaboration,
  updateCollaborationSettlement,
  type CollaborationRecord,
} from "./collaboration-service";

const hostActor = {
  userId: "11111111-1111-1111-1111-111111111111",
  name: "甲方运营",
  role: "ops_manager" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

const partnerActor = {
  userId: "22222222-2222-2222-2222-222222222222",
  name: "乙方运营",
  role: "ops_manager" as const,
  organizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
};

function collaboration(
  overrides: Partial<CollaborationRecord> = {},
): CollaborationRecord {
  return {
    id: "C-1",
    hostOrganizationId: hostActor.organizationId,
    projectId: "P-1",
    partnerOrganizationId: null,
    inviteCode: "COLLAB-ABCD1234",
    status: "invited",
    settlementMode: "percentage",
    sharePercentage: 0.2,
    hourlyFixedAmount: null,
    ...overrides,
  };
}

describe("collaboration service", () => {
  it("opens a collaboration with a generated invite code", async () => {
    const repo = {
      createCollaboration: vi.fn().mockResolvedValue(collaboration()),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await openCollaboration({
      repo,
      audit,
      actor: hostActor,
      input: { projectId: "P-1", settlementMode: "percentage", sharePercentage: 0.2 },
      inviteCode: "COLLAB-FIXED",
    });

    expect(repo.createCollaboration).toHaveBeenCalledWith(
      expect.objectContaining({
        hostOrganizationId: hostActor.organizationId,
        projectId: "P-1",
        inviteCode: "COLLAB-FIXED",
        settlementMode: "percentage",
        sharePercentage: 0.2,
        hourlyFixedAmount: null,
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ module: "collaboration", action: "create" }),
    );
  });

  it("rejects percentage outside 0..1", async () => {
    const repo = { createCollaboration: vi.fn() };
    const audit = vi.fn();

    await expect(
      openCollaboration({
        repo,
        audit,
        actor: hostActor,
        input: { projectId: "P-1", settlementMode: "percentage", sharePercentage: 1.5 },
      }),
    ).rejects.toThrow("Share percentage must be between 0 and 1");
    expect(repo.createCollaboration).not.toHaveBeenCalled();
  });

  it("requires an hourly amount for hourly_fixed mode", async () => {
    const repo = { createCollaboration: vi.fn() };
    const audit = vi.fn();

    await expect(
      openCollaboration({
        repo,
        audit,
        actor: hostActor,
        input: { projectId: "P-1", settlementMode: "hourly_fixed" },
      }),
    ).rejects.toThrow("Hourly fixed mode requires an hourly amount");
  });

  it("rejects collaboration management from streamer role", async () => {
    const repo = { createCollaboration: vi.fn() };
    const audit = vi.fn();

    await expect(
      openCollaboration({
        repo,
        audit,
        actor: { ...hostActor, role: "streamer" },
        input: { projectId: "P-1", settlementMode: "percentage", sharePercentage: 0.2 },
      }),
    ).rejects.toThrow("Current role cannot manage project collaborations");
  });

  it("accepts an invite as partner staff and notifies the host", async () => {
    const accepted = collaboration({
      partnerOrganizationId: partnerActor.organizationId,
      status: "active",
    });
    const repo = {
      acceptByInviteCode: vi.fn().mockResolvedValue(accepted),
    };
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);

    await acceptCollaboration({
      repo,
      audit,
      notify,
      actor: partnerActor,
      inviteCode: "COLLAB-ABCD1234",
    });

    expect(repo.acceptByInviteCode).toHaveBeenCalledWith({
      inviteCode: "COLLAB-ABCD1234",
      partnerOrganizationId: partnerActor.organizationId,
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: accepted.hostOrganizationId,
        type: "system",
      }),
    );
  });

  it("blocks status changes from a non-host organization", async () => {
    const repo = {
      getById: vi.fn().mockResolvedValue(
        collaboration({ status: "active" }),
      ),
      updateCollaboration: vi.fn(),
    };
    const audit = vi.fn();

    await expect(
      changeCollaborationStatus({
        repo,
        audit,
        actor: partnerActor,
        collaborationId: "C-1",
        status: "revoked",
      }),
    ).rejects.toThrow("Only host organization staff can change collaboration");
    expect(repo.updateCollaboration).not.toHaveBeenCalled();
  });

  it("updates settlement config for the host", async () => {
    const before = collaboration({ status: "active" });
    const after = collaboration({
      status: "active",
      settlementMode: "hourly_fixed",
      sharePercentage: null,
      hourlyFixedAmount: 50,
    });
    const repo = {
      getById: vi.fn().mockResolvedValue(before),
      updateCollaboration: vi.fn().mockResolvedValue(after),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await updateCollaborationSettlement({
      repo,
      audit,
      actor: hostActor,
      collaborationId: "C-1",
      input: { settlementMode: "hourly_fixed", hourlyFixedAmount: 50 },
    });

    expect(repo.updateCollaboration).toHaveBeenCalledWith("C-1", {
      settlement_mode: "hourly_fixed",
      share_percentage: null,
      hourly_fixed_amount: 50,
    });
  });
});
