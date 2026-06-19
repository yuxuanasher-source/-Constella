import { describe, expect, it, vi } from "vitest";

import {
  updateProjectStreamerSettlementRule,
  type ProjectStreamerSettlementRecord,
} from "./project-streamer-settlement-service";

const existing: ProjectStreamerSettlementRecord = {
  id: "ps-1",
  projectId: "project-1",
  streamerId: "streamer-1",
  streamerName: "大帅逼",
  settlementMethod: "manual",
  hourlyRate: null,
  baseSalary: null,
  cpsRateBps: null,
};

function createRepo(
  record: ProjectStreamerSettlementRecord | null = existing,
) {
  return {
    getProjectStreamerSettlement: vi.fn(async () => record),
    updateProjectStreamerSettlementRule: vi.fn(
      async (input: {
        patch: Record<string, unknown>;
      }): Promise<ProjectStreamerSettlementRecord> => ({
        ...existing,
        settlementMethod:
          (input.patch.settlement_method as ProjectStreamerSettlementRecord["settlementMethod"]) ??
          existing.settlementMethod,
        hourlyRate:
          (input.patch.hourly_rate as number | undefined) ??
          existing.hourlyRate,
      }),
    ),
  };
}

const owner = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

describe("updateProjectStreamerSettlementRule", () => {
  it("updates the per-project payable rule and writes a high-risk audit log", async () => {
    const repo = createRepo();
    const audit = vi.fn(async () => {});

    const result = await updateProjectStreamerSettlementRule({
      repo,
      audit,
      actor: owner,
      projectId: "project-1",
      streamerId: "streamer-1",
      input: { settlementMethod: "cpt", hourlyRate: 80 },
      reason: "改为 CPT 应付",
    });

    expect(result.settlementMethod).toBe("cpt");
    expect(result.hourlyRate).toBe(80);
    expect(repo.updateProjectStreamerSettlementRule).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        patch: { settlement_method: "cpt", hourly_rate: 80 },
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "settlement",
        objectType: "project_streamer",
        isHighRisk: true,
        reason: "改为 CPT 应付",
        changedFields: ["settlement_method", "hourly_rate"],
      }),
    );
  });

  it("rejects roles other than owner / ops_manager", async () => {
    const repo = createRepo();
    await expect(
      updateProjectStreamerSettlementRule({
        repo,
        audit: vi.fn(),
        actor: { ...owner, role: "finance" },
        projectId: "project-1",
        streamerId: "streamer-1",
        input: { settlementMethod: "cpt", hourlyRate: 80 },
        reason: "x",
      }),
    ).rejects.toThrow("Only owner and ops_manager");
    expect(repo.updateProjectStreamerSettlementRule).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    const repo = createRepo();
    await expect(
      updateProjectStreamerSettlementRule({
        repo,
        audit: vi.fn(),
        actor: owner,
        projectId: "project-1",
        streamerId: "streamer-1",
        input: { settlementMethod: "cpt", hourlyRate: 80 },
        reason: "  ",
      }),
    ).rejects.toThrow("require a reason");
  });

  it("rejects an invalid settlement method", async () => {
    const repo = createRepo();
    await expect(
      updateProjectStreamerSettlementRule({
        repo,
        audit: vi.fn(),
        actor: owner,
        projectId: "project-1",
        streamerId: "streamer-1",
        input: {
          settlementMethod: "bogus" as never,
        },
        reason: "x",
      }),
    ).rejects.toThrow("settlementMethod is invalid");
  });

  it("rejects when there are no fields to update", async () => {
    const repo = createRepo();
    await expect(
      updateProjectStreamerSettlementRule({
        repo,
        audit: vi.fn(),
        actor: owner,
        projectId: "project-1",
        streamerId: "streamer-1",
        input: {},
        reason: "x",
      }),
    ).rejects.toThrow("No settlement rule fields to update");
  });

  it("throws when the project streamer does not exist", async () => {
    const repo = createRepo(null);
    await expect(
      updateProjectStreamerSettlementRule({
        repo,
        audit: vi.fn(),
        actor: owner,
        projectId: "project-1",
        streamerId: "missing",
        input: { settlementMethod: "cpt", hourlyRate: 80 },
        reason: "x",
      }),
    ).rejects.toThrow("Project streamer not found");
  });
});
