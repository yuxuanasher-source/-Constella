import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlatformAdminContext } from "./platform-admin-auth";
import {
  changePlatformSubscription,
  createPlatformCostVersion,
  createPlatformPriceVersion,
  updatePlatformPlan,
  type PlatformAdminBillingRepository,
} from "./platform-admin-billing-service";
import {
  hashPlatformAdminRequest,
  type PlatformAdminOperationLog,
} from "./platform-admin-operation-log";

const actor: PlatformAdminContext = {
  userId: "admin-user",
  email: "admin@example.com",
  name: "平台管理员",
  role: "super_admin",
};

const plan = {
  id: "plan-basic",
  code: "basic",
  tier: "basic" as const,
  name: "基础版",
  monthlyPriceCents: 9900,
  annualPriceCents: 99000,
  includedActiveStreamers: 5,
  includedSeats: 3,
  includedOcr: 100,
  includedAi: 20,
  includedStorageMb: 1024,
  includedExports: 10,
  features: { settlement: true },
  updatedAt: "2026-07-26T08:00:00.000Z",
};

const targetPlan = {
  ...plan,
  id: "plan-pro",
  code: "pro",
  tier: "pro" as const,
  name: "专业版",
  monthlyPriceCents: 29900,
  annualPriceCents: 299000,
  includedActiveStreamers: 30,
  includedSeats: 10,
};

const subscription = {
  organizationId: "org-1",
  planId: "plan-basic",
  status: "active" as const,
  billingCycle: "monthly" as const,
  currentPeriodStart: "2026-07-25",
  currentPeriodEnd: "2026-08-25",
  pendingPlanId: null,
  pendingBillingCycle: null,
  autoRenew: true,
  updatedAt: "2026-07-26T08:00:00.000Z",
};

function createLog(): PlatformAdminOperationLog {
  return {
    findByIdempotency: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
  };
}

function createRepo(
  overrides: Partial<PlatformAdminBillingRepository> = {},
): PlatformAdminBillingRepository {
  return {
    operationLog: createLog(),
    getPlan: vi.fn(async (id) =>
      id === targetPlan.id ? targetPlan : plan,
    ),
    getSubscription: vi.fn(async () => subscription),
    updateSubscription: vi.fn(async (_organizationId, patch) => ({
      ...subscription,
      ...patch,
      updatedAt: "2026-07-26T09:00:00.000Z",
    })),
    updatePlanMetadata: vi.fn(async (_planId, patch) => ({
      ...plan,
      ...patch,
      updatedAt: "2026-07-26T09:00:00.000Z",
    })),
    getActivePriceVersion: vi.fn(async () => ({
      id: "price-old",
      planId: plan.id,
      billingCycle: "monthly" as const,
      priceCents: 9900,
      currency: "CNY",
      active: true,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
    })),
    createPriceVersionAtomic: vi.fn(async (input) => ({
      id: "price-new",
      planId: input.planId,
      billingCycle: input.billingCycle,
      priceCents: input.priceCents,
      currency: input.currency,
      active: true,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
    })),
    findOverlappingCostVersion: vi.fn(async () => null),
    createCostVersion: vi.fn(async (input) => ({
      id: "cost-new",
      ...input,
    })),
    ...overrides,
  };
}

const governance = {
  expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
  reason: "客户升级",
  idempotencyKey: "billing-change-1",
};

describe("changePlatformSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previews without writing and applies an immediate plan change", async () => {
    const repo = createRepo();
    const command = {
      action: "change_plan" as const,
      targetPlanId: "plan-pro",
      targetBillingCycle: "annual" as const,
      timing: "immediate" as const,
      ...governance,
    };

    const preview = await changePlatformSubscription({
      repo,
      actor,
      organizationId: "org-1",
      mode: "preview",
      command,
      today: "2026-07-26",
    });
    expect(preview.preview).toMatchObject({
      currentPlan: "基础版",
      targetPlan: "专业版",
      effectiveAt: "2026-07-26",
      currentPriceCents: 9900,
      targetPriceCents: 299000,
    });
    expect(repo.updateSubscription).not.toHaveBeenCalled();

    await changePlatformSubscription({
      repo,
      actor,
      organizationId: "org-1",
      mode: "apply",
      command,
      today: "2026-07-26",
    });
    expect(repo.updateSubscription).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        planId: "plan-pro",
        billingCycle: "annual",
        pendingPlanId: null,
        pendingBillingCycle: null,
      }),
      governance.expectedUpdatedAt,
    );
  });

  it("schedules a next-cycle plan change without replacing the current plan", async () => {
    const repo = createRepo();

    await changePlatformSubscription({
      repo,
      actor,
      organizationId: "org-1",
      mode: "apply",
      command: {
        action: "change_plan",
        targetPlanId: "plan-pro",
        targetBillingCycle: "annual",
        timing: "next_cycle",
        ...governance,
      },
      today: "2026-07-26",
    });

    expect(repo.updateSubscription).toHaveBeenCalledWith(
      "org-1",
      {
        pendingPlanId: "plan-pro",
        pendingBillingCycle: "annual",
      },
      governance.expectedUpdatedAt,
    );
  });

  it("renews from the later of today and current period end", async () => {
    const repo = createRepo();

    const result = await changePlatformSubscription({
      repo,
      actor,
      organizationId: "org-1",
      mode: "apply",
      command: {
        action: "renew",
        periods: 1,
        ...governance,
      },
      today: "2026-07-26",
    });

    expect(result.preview.nextPeriodEnd).toBe("2026-09-25");
    expect(repo.updateSubscription).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ currentPeriodEnd: "2026-09-25" }),
      governance.expectedUpdatedAt,
    );
  });

  it("rejects an extension that does not move beyond the later base date", async () => {
    const repo = createRepo();

    await expect(
      changePlatformSubscription({
        repo,
        actor,
        organizationId: "org-1",
        mode: "apply",
        command: {
          action: "extend",
          periodEnd: "2026-08-20",
          ...governance,
        },
        today: "2026-07-26",
      }),
    ).rejects.toThrow("shorten");
    expect(repo.updateSubscription).not.toHaveBeenCalled();
  });

  it.each([
    ["cancel", "cancelled", false],
    ["restore", "active", true],
  ] as const)("can %s a subscription", async (action, status, autoRenew) => {
    const repo = createRepo();

    await changePlatformSubscription({
      repo,
      actor,
      organizationId: "org-1",
      mode: "apply",
      command: { action, ...governance },
      today: "2026-07-26",
    });

    expect(repo.updateSubscription).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ status, autoRenew }),
      governance.expectedUpdatedAt,
    );
  });
});

describe("plan economics", () => {
  it("edits metadata and quotas without changing the stable plan code", async () => {
    const repo = createRepo();

    await updatePlatformPlan({
      repo,
      actor,
      planId: plan.id,
      command: {
        name: "基础协作版",
        features: { settlement: true, export_center: true },
        included: { seats: 5, ocr: 200 },
        ...governance,
      },
    });

    expect(repo.updatePlanMetadata).toHaveBeenCalledWith(
      plan.id,
      expect.not.objectContaining({ code: expect.anything() }),
      governance.expectedUpdatedAt,
    );
  });

  it("rejects negative included quantities", async () => {
    await expect(
      updatePlatformPlan({
        repo: createRepo(),
        actor,
        planId: plan.id,
        command: {
          included: { seats: -1 },
          ...governance,
        },
      }),
    ).rejects.toThrow("non-negative");
  });

  it("rejects a stale plan version before writing", async () => {
    const repo = createRepo({
      getPlan: vi.fn(async () => ({
        ...plan,
        updatedAt: "2026-07-26T09:00:00.000Z",
      })),
    });

    await expect(
      updatePlatformPlan({
        repo,
        actor,
        planId: plan.id,
        command: {
          name: "基础协作版",
          ...governance,
        },
      }),
    ).rejects.toThrow("changed after");
    expect(repo.updatePlanMetadata).not.toHaveBeenCalled();
  });

  it("returns a successful idempotent plan update without writing twice", async () => {
    const result = {
      ...plan,
      name: "基础协作版",
      updatedAt: "2026-07-26T09:00:00.000Z",
    };
    const log = createLog();
    vi.mocked(log.findByIdempotency).mockResolvedValue({
      requestHash: hashPlatformAdminRequest({
        planId: plan.id,
        name: "基础协作版",
        expectedUpdatedAt: governance.expectedUpdatedAt,
      }),
      result: "success",
      resultValue: result,
    });
    const repo = createRepo({ operationLog: log });

    await expect(
      updatePlatformPlan({
        repo,
        actor,
        planId: plan.id,
        command: {
          name: "基础协作版",
          ...governance,
        },
      }),
    ).resolves.toEqual(result);
    expect(repo.updatePlanMetadata).not.toHaveBeenCalled();
  });

  it("creates a new price version while atomically closing the old version", async () => {
    const repo = createRepo();

    await createPlatformPriceVersion({
      repo,
      actor,
      planId: plan.id,
      command: {
        billingCycle: "monthly",
        priceCents: 12900,
        currency: "CNY",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        ...governance,
      },
    });

    expect(repo.createPriceVersionAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        previousPriceVersionId: "price-old",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
      }),
      governance.expectedUpdatedAt,
    );
  });

  it("rejects overlapping cost versions before writing", async () => {
    const repo = createRepo({
      findOverlappingCostVersion: vi.fn(async () => ({
        id: "cost-existing",
      })),
    });

    await expect(
      createPlatformCostVersion({
        repo,
        actor,
        planId: plan.id,
        command: {
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
          fixedCostCents: 1000,
          perSeatCostCents: 100,
          perActiveStreamerCostCents: 200,
          metricUnitCosts: { ocr: 2 },
          ...governance,
        },
      }),
    ).rejects.toThrow("overlap");
    expect(repo.createCostVersion).not.toHaveBeenCalled();
  });

  it("requires a reason for applied economic changes", async () => {
    await expect(
      createPlatformPriceVersion({
        repo: createRepo(),
        actor,
        planId: plan.id,
        command: {
          billingCycle: "monthly",
          priceCents: 12900,
          currency: "CNY",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          ...governance,
          reason: " ",
        },
      }),
    ).rejects.toThrow("reason");
  });
});
