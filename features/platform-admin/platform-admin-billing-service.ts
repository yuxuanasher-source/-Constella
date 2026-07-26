import { advancePeriod } from "@/features/billing/billing-period";
import type {
  PlanRecord,
  SubscriptionRecord,
} from "@/features/billing/billing-repo";
import type { BillingCycle } from "@/features/billing/order-types";

import type { PlatformAdminContext } from "./platform-admin-auth";
import { PlatformAdminValidationError } from "./platform-admin-errors";
import { executePlatformAdminOperation } from "./platform-admin-mutations";
import type { PlatformAdminOperationLog } from "./platform-admin-operation-log";

export type PlatformBillingPlanRecord = PlanRecord & {
  features: Record<string, boolean>;
  updatedAt: string;
};

export type PlatformSubscriptionAdminRecord = SubscriptionRecord & {
  updatedAt: string;
};

export type PlatformPriceVersionRecord = {
  id: string;
  planId: string;
  billingCycle: BillingCycle;
  priceCents: number;
  currency: string;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type PlatformCostVersionRecord = {
  id: string;
  planId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  fixedCostCents: number;
  perSeatCostCents: number;
  perActiveStreamerCostCents: number;
  metricUnitCosts: Record<string, number>;
  reason: string;
  createdBy: string;
};

export type PlatformPlanMetadataPatch = {
  name?: string;
  features?: Record<string, boolean>;
  includedActiveStreamers?: number;
  includedSeats?: number;
  includedOcr?: number;
  includedAi?: number;
  includedStorageMb?: number;
  includedExports?: number;
};

export type PlatformAdminBillingRepository = {
  operationLog: PlatformAdminOperationLog;
  getPlan(planId: string): Promise<PlatformBillingPlanRecord | null>;
  getSubscription(
    organizationId: string,
  ): Promise<PlatformSubscriptionAdminRecord | null>;
  updateSubscription(
    organizationId: string,
    patch: Partial<SubscriptionRecord>,
    expectedUpdatedAt: string,
  ): Promise<PlatformSubscriptionAdminRecord>;
  updatePlanMetadata(
    planId: string,
    patch: PlatformPlanMetadataPatch,
    expectedUpdatedAt: string,
  ): Promise<PlatformBillingPlanRecord>;
  getActivePriceVersion(
    planId: string,
    billingCycle: BillingCycle,
  ): Promise<PlatformPriceVersionRecord | null>;
  createPriceVersionAtomic(
    input: {
      planId: string;
      billingCycle: BillingCycle;
      priceCents: number;
      currency: string;
      effectiveFrom: string;
      previousPriceVersionId: string | null;
    },
    expectedPlanUpdatedAt: string,
  ): Promise<PlatformPriceVersionRecord>;
  findOverlappingCostVersion(input: {
    planId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }): Promise<{ id: string } | null>;
  createCostVersion(
    input: Omit<PlatformCostVersionRecord, "id">,
    expectedPlanUpdatedAt: string,
  ): Promise<PlatformCostVersionRecord>;
};

export type SubscriptionChangePreview = {
  currentPlan: string;
  targetPlan: string;
  effectiveAt: string;
  currentPeriodEnd: string;
  nextPeriodEnd: string;
  currentPriceCents: number;
  targetPriceCents: number;
  includedQuantityChanges: Record<string, { from: number; to: number }>;
};

type GovernanceFields = {
  expectedUpdatedAt: string;
  reason: string;
  idempotencyKey: string;
};

export type SubscriptionChangeCommand =
  | (GovernanceFields & {
      action: "change_plan";
      targetPlanId: string;
      targetBillingCycle: BillingCycle;
      timing: "immediate" | "next_cycle";
    })
  | (GovernanceFields & {
      action: "renew";
      periods: number;
    })
  | (GovernanceFields & {
      action: "extend";
      periodEnd: string;
    })
  | (GovernanceFields & {
      action: "cancel" | "restore";
    });

export async function changePlatformSubscription(input: {
  repo: PlatformAdminBillingRepository;
  actor: PlatformAdminContext;
  organizationId: string;
  mode: "preview" | "apply";
  command: SubscriptionChangeCommand;
  today?: string;
}) {
  const subscription = await requireSubscription(
    input.repo,
    input.organizationId,
  );
  const currentPlan = await requirePlan(input.repo, subscription.planId);
  const targetPlan =
    input.command.action === "change_plan"
      ? await requirePlan(input.repo, input.command.targetPlanId)
      : currentPlan;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const change = buildSubscriptionChange({
    subscription,
    currentPlan,
    targetPlan,
    command: input.command,
    today,
  });

  if (input.mode === "preview") {
    return { preview: change.preview, applied: null };
  }

  const applied = await executePlatformAdminOperation({
    actor: input.actor,
    action: `subscription.${input.command.action}`,
    target: {
      type: "organization_subscription",
      organizationId: input.organizationId,
    },
    reason: input.command.reason,
    highRisk: true,
    idempotencyKey: input.command.idempotencyKey,
    request: {
      organizationId: input.organizationId,
      ...input.command,
    },
    loadBefore: async () => subscriptionSnapshot(subscription),
    execute: () =>
      input.repo.updateSubscription(
        input.organizationId,
        change.patch,
        input.command.expectedUpdatedAt,
      ),
    summarizeAfter: subscriptionSnapshot,
    log: input.repo.operationLog,
  });
  return { preview: change.preview, applied };
}

export async function updatePlatformPlan(input: {
  repo: PlatformAdminBillingRepository;
  actor: PlatformAdminContext;
  planId: string;
  command: GovernanceFields & {
    name?: string;
    features?: Record<string, boolean>;
    included?: Partial<{
      activeStreamers: number;
      seats: number;
      ocr: number;
      ai: number;
      storageMb: number;
      exports: number;
    }>;
  };
}) {
  const plan = await requirePlan(input.repo, input.planId);
  const patch = normalizePlanPatch(input.command);
  return executePlatformAdminOperation({
    actor: input.actor,
    action: "plan.update",
    target: { type: "billing_plan", id: input.planId },
    reason: input.command.reason,
    highRisk: true,
    idempotencyKey: input.command.idempotencyKey,
    request: {
      planId: input.planId,
      ...patch,
      expectedUpdatedAt: input.command.expectedUpdatedAt,
    },
    loadBefore: async () => planSnapshot(plan),
    execute: () =>
      input.repo.updatePlanMetadata(
        input.planId,
        patch,
        input.command.expectedUpdatedAt,
      ),
    summarizeAfter: planSnapshot,
    log: input.repo.operationLog,
  });
}

export async function createPlatformPriceVersion(input: {
  repo: PlatformAdminBillingRepository;
  actor: PlatformAdminContext;
  planId: string;
  command: GovernanceFields & {
    billingCycle: BillingCycle;
    priceCents: number;
    currency: string;
    effectiveFrom: string;
  };
}) {
  const plan = await requirePlan(input.repo, input.planId);
  assertNonNegativeInteger(input.command.priceCents, "Price");
  const currency = input.command.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new PlatformAdminValidationError(
      "Currency must be a three-letter code.",
    );
  }
  assertInstant(input.command.effectiveFrom, "Price effective time");
  const previous = await input.repo.getActivePriceVersion(
    input.planId,
    input.command.billingCycle,
  );
  if (previous && previous.effectiveFrom >= input.command.effectiveFrom) {
    throw new PlatformAdminValidationError(
      "New price must become effective after the current price version.",
    );
  }

  return executePlatformAdminOperation({
    actor: input.actor,
    action: "plan.price.create",
    target: { type: "billing_plan", id: input.planId },
    reason: input.command.reason,
    highRisk: true,
    idempotencyKey: input.command.idempotencyKey,
    request: {
      planId: input.planId,
      ...input.command,
      currency,
    },
    loadBefore: async () => planSnapshot(plan),
    execute: () =>
      input.repo.createPriceVersionAtomic(
        {
          planId: input.planId,
          billingCycle: input.command.billingCycle,
          priceCents: input.command.priceCents,
          currency,
          effectiveFrom: input.command.effectiveFrom,
          previousPriceVersionId: previous?.id ?? null,
        },
        input.command.expectedUpdatedAt,
      ),
    summarizeAfter: priceSnapshot,
    log: input.repo.operationLog,
  });
}

export async function createPlatformCostVersion(input: {
  repo: PlatformAdminBillingRepository;
  actor: PlatformAdminContext;
  planId: string;
  command: GovernanceFields & {
    effectiveFrom: string;
    effectiveTo: string | null;
    fixedCostCents: number;
    perSeatCostCents: number;
    perActiveStreamerCostCents: number;
    metricUnitCosts: Record<string, number>;
  };
}) {
  const plan = await requirePlan(input.repo, input.planId);
  assertInstant(input.command.effectiveFrom, "Cost effective time");
  if (input.command.effectiveTo) {
    assertInstant(input.command.effectiveTo, "Cost end time");
    if (input.command.effectiveTo <= input.command.effectiveFrom) {
      throw new PlatformAdminValidationError(
        "Cost version end must be after its start.",
      );
    }
  }
  assertNonNegativeInteger(input.command.fixedCostCents, "Fixed cost");
  assertNonNegativeInteger(input.command.perSeatCostCents, "Per-seat cost");
  assertNonNegativeInteger(
    input.command.perActiveStreamerCostCents,
    "Per-streamer cost",
  );
  Object.entries(input.command.metricUnitCosts).forEach(([metric, value]) => {
    assertNonNegativeInteger(value, `Metric cost ${metric}`);
  });

  return executePlatformAdminOperation({
    actor: input.actor,
    action: "plan.cost.create",
    target: { type: "billing_plan", id: input.planId },
    reason: input.command.reason,
    highRisk: true,
    idempotencyKey: input.command.idempotencyKey,
    request: {
      planId: input.planId,
      ...input.command,
    },
    loadBefore: async () => planSnapshot(plan),
    execute: async () => {
      const overlap = await input.repo.findOverlappingCostVersion({
        planId: input.planId,
        effectiveFrom: input.command.effectiveFrom,
        effectiveTo: input.command.effectiveTo,
      });
      if (overlap) {
        throw new PlatformAdminValidationError(
          "The cost version would overlap an existing version.",
        );
      }
      return input.repo.createCostVersion(
        {
          planId: input.planId,
          effectiveFrom: input.command.effectiveFrom,
          effectiveTo: input.command.effectiveTo,
          fixedCostCents: input.command.fixedCostCents,
          perSeatCostCents: input.command.perSeatCostCents,
          perActiveStreamerCostCents:
            input.command.perActiveStreamerCostCents,
          metricUnitCosts: input.command.metricUnitCosts,
          reason: input.command.reason.trim(),
          createdBy: input.actor.userId,
        },
        input.command.expectedUpdatedAt,
      );
    },
    summarizeAfter: costSnapshot,
    log: input.repo.operationLog,
  });
}

function buildSubscriptionChange(input: {
  subscription: PlatformSubscriptionAdminRecord;
  currentPlan: PlatformBillingPlanRecord;
  targetPlan: PlatformBillingPlanRecord;
  command: SubscriptionChangeCommand;
  today: string;
}) {
  const { subscription, currentPlan, targetPlan, command, today } = input;
  let patch: Partial<SubscriptionRecord>;
  let effectiveAt = today;
  let nextPeriodEnd = subscription.currentPeriodEnd;
  let targetCycle = subscription.billingCycle;

  switch (command.action) {
    case "change_plan":
      targetCycle = command.targetBillingCycle;
      effectiveAt =
        command.timing === "immediate" ? today : subscription.currentPeriodEnd;
      patch =
        command.timing === "immediate"
          ? {
              planId: targetPlan.id,
              billingCycle: command.targetBillingCycle,
              pendingPlanId: null,
              pendingBillingCycle: null,
            }
          : {
              pendingPlanId: targetPlan.id,
              pendingBillingCycle: command.targetBillingCycle,
            };
      break;
    case "renew": {
      if (!Number.isInteger(command.periods) || command.periods < 1) {
        throw new PlatformAdminValidationError(
          "Renewal periods must be a positive integer.",
        );
      }
      const base = laterDate(today, subscription.currentPeriodEnd);
      nextPeriodEnd = advancePeriods(
        base,
        subscription.billingCycle,
        command.periods,
      );
      effectiveAt = base;
      patch = {
        currentPeriodEnd: nextPeriodEnd,
        status: "active",
        autoRenew: true,
      };
      break;
    }
    case "extend": {
      const base = laterDate(today, subscription.currentPeriodEnd);
      if (command.periodEnd <= base) {
        throw new PlatformAdminValidationError(
          "An extension cannot shorten or preserve the current expiry.",
        );
      }
      nextPeriodEnd = command.periodEnd;
      effectiveAt = base;
      patch = { currentPeriodEnd: command.periodEnd };
      break;
    }
    case "cancel":
      patch = { status: "cancelled", autoRenew: false };
      break;
    case "restore":
      patch = { status: "active", autoRenew: true };
      break;
  }

  return {
    patch,
    preview: {
      currentPlan: currentPlan.name,
      targetPlan: targetPlan.name,
      effectiveAt,
      currentPeriodEnd: subscription.currentPeriodEnd,
      nextPeriodEnd,
      currentPriceCents: planPrice(currentPlan, subscription.billingCycle),
      targetPriceCents: planPrice(targetPlan, targetCycle),
      includedQuantityChanges: includedQuantityChanges(
        currentPlan,
        targetPlan,
      ),
    } satisfies SubscriptionChangePreview,
  };
}

function normalizePlanPatch(command: {
  name?: string;
  features?: Record<string, boolean>;
  included?: Partial<{
    activeStreamers: number;
    seats: number;
    ocr: number;
    ai: number;
    storageMb: number;
    exports: number;
  }>;
}) {
  const patch: PlatformPlanMetadataPatch = {};
  if (command.name !== undefined) {
    const name = command.name.trim();
    if (!name) {
      throw new PlatformAdminValidationError("Plan name is required.");
    }
    patch.name = name;
  }
  if (command.features !== undefined) {
    if (
      Object.values(command.features).some(
        (enabled) => typeof enabled !== "boolean",
      )
    ) {
      throw new PlatformAdminValidationError(
        "Plan features must be boolean values.",
      );
    }
    patch.features = command.features;
  }
  const includedMap = {
    activeStreamers: "includedActiveStreamers",
    seats: "includedSeats",
    ocr: "includedOcr",
    ai: "includedAi",
    storageMb: "includedStorageMb",
    exports: "includedExports",
  } as const;
  Object.entries(command.included ?? {}).forEach(([key, value]) => {
    assertNonNegativeInteger(value, `Included ${key}`);
    patch[includedMap[key as keyof typeof includedMap]] = value;
  });
  if (Object.keys(patch).length === 0) {
    throw new PlatformAdminValidationError(
      "At least one plan metadata field is required.",
    );
  }
  return patch;
}

function includedQuantityChanges(
  current: PlanRecord,
  target: PlanRecord,
) {
  const fields = {
    activeStreamers: "includedActiveStreamers",
    seats: "includedSeats",
    ocr: "includedOcr",
    ai: "includedAi",
    storageMb: "includedStorageMb",
    exports: "includedExports",
  } as const;
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, field]) => [
        key,
        { from: current[field], to: target[field] },
      ])
      .filter(([, change]) => {
        const typed = change as { from: number; to: number };
        return typed.from !== typed.to;
      }),
  ) as Record<string, { from: number; to: number }>;
}

function planPrice(plan: PlanRecord, cycle: BillingCycle) {
  return cycle === "annual"
    ? plan.annualPriceCents
    : plan.monthlyPriceCents;
}

function advancePeriods(
  base: string,
  cycle: BillingCycle,
  periods: number,
) {
  let result = base;
  for (let index = 0; index < periods; index += 1) {
    result = advancePeriod(result, cycle);
  }
  return result;
}

function laterDate(left: string, right: string) {
  return left > right ? left : right;
}

async function requirePlan(
  repo: PlatformAdminBillingRepository,
  planId: string,
) {
  const plan = await repo.getPlan(planId);
  if (!plan) {
    throw new PlatformAdminValidationError("Billing plan not found.");
  }
  return plan;
}

async function requireSubscription(
  repo: PlatformAdminBillingRepository,
  organizationId: string,
) {
  const subscription = await repo.getSubscription(organizationId);
  if (!subscription) {
    throw new PlatformAdminValidationError("Organization subscription not found.");
  }
  return subscription;
}

function assertNonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new PlatformAdminValidationError(
      `${label} must be a non-negative integer.`,
    );
  }
}

function assertInstant(value: string, label: string) {
  if (!Number.isFinite(new Date(value).getTime())) {
    throw new PlatformAdminValidationError(`${label} is invalid.`);
  }
}

function subscriptionSnapshot(
  value: PlatformSubscriptionAdminRecord,
): Record<string, unknown> {
  return { ...value };
}

function planSnapshot(
  value: PlatformBillingPlanRecord,
): Record<string, unknown> {
  return { ...value };
}

function priceSnapshot(
  value: PlatformPriceVersionRecord,
): Record<string, unknown> {
  return { ...value };
}

function costSnapshot(
  value: PlatformCostVersionRecord,
): Record<string, unknown> {
  return { ...value };
}
